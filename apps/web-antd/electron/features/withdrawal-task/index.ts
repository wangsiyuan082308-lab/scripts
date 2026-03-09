import { storeStorage, withdrawalTaskStorage } from '../../shared/storage';
import type { StorageUserContext } from '../../shared/storage';
import {
  computeNextRunAt,
  formatScheduleTime,
  WithdrawalTaskRunner,
} from './runner';
import type {
  WithdrawalTask,
  WithdrawalTaskResult,
  WithdrawalTriggerMode,
} from './runner';

interface WithdrawalTaskCreateInput {
  scheduleTime?: string;
  storeIds: string[];
  storeNames?: string[];
  triggerMode: WithdrawalTriggerMode;
}

interface WithdrawalTaskUpdateInput {
  scheduleTime?: string;
  status?: WithdrawalTask['status'];
  taskId: string;
}

interface WithdrawalTaskRunOptions {
  storeIds?: string[];
}

function nowIso() {
  return new Date().toISOString();
}

function createTaskId() {
  const stamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 8);
  return `wd_${stamp}${random}`;
}

function sortTasks(tasks: WithdrawalTask[]) {
  return [...tasks].sort((a, b) => {
    const timeA = new Date(a.updatedAt || a.createdAt).getTime();
    const timeB = new Date(b.updatedAt || b.createdAt).getTime();
    return timeB - timeA;
  });
}

function dedupeStores(storeIds: string[], storeNames: string[] = []) {
  const pairs = storeIds
    .map((storeId, index) => ({
      storeId: String(storeId).trim(),
      storeName: String(storeNames[index] || '').trim(),
    }))
    .filter((item) => item.storeId);

  const seen = new Set<string>();
  const dedupedIds: string[] = [];
  const dedupedNames: string[] = [];

  for (const item of pairs) {
    if (seen.has(item.storeId)) continue;
    seen.add(item.storeId);
    dedupedIds.push(item.storeId);
    dedupedNames.push(item.storeName || item.storeId);
  }

  return { storeIds: dedupedIds, storeNames: dedupedNames };
}

function mergeTaskResults(
  originalResults: WithdrawalTaskResult[],
  retriedResults: WithdrawalTaskResult[],
) {
  const retriedStoreIds = new Set(retriedResults.map((item) => item.storeId));
  return [
    ...originalResults.filter((item) => !retriedStoreIds.has(item.storeId)),
    ...retriedResults,
  ];
}

export class WithdrawalTaskFeature {
  private activeTaskIds = new Set<string>();

  private scheduler: NodeJS.Timeout | null = null;

  async list(user?: StorageUserContext) {
    const tasks = await withdrawalTaskStorage.get(user);
    return sortTasks(tasks);
  }

  async getDetail(taskId: string, user?: StorageUserContext) {
    const tasks = await withdrawalTaskStorage.get(user);
    return tasks.find((item) => item.taskId === taskId || item.id === taskId) || null;
  }

  private async resolveStoreNames(storeIds: string[], user?: StorageUserContext) {
    const stores = await storeStorage.get(user);
    const storeMap = new Map(stores.map((item) => [item.storeId, item.storeName || item.storeId]));
    return storeIds.map((storeId) => storeMap.get(storeId) || storeId);
  }

  private validateCreateInput(input: WithdrawalTaskCreateInput) {
    if (!Array.isArray(input.storeIds) || input.storeIds.length === 0) {
      throw new Error('请至少选择一个门店');
    }
    if (input.triggerMode === 'daily' && !formatScheduleTime(input.scheduleTime)) {
      throw new Error('请选择有效的每日执行时间');
    }
  }

  private getTaskStatusForCreate(triggerMode: WithdrawalTriggerMode): WithdrawalTask['status'] {
    return triggerMode === 'daily' ? 'pending' : 'pending';
  }

  async create(input: WithdrawalTaskCreateInput, user?: StorageUserContext) {
    this.validateCreateInput(input);

    const normalized = dedupeStores(
      input.storeIds,
      input.storeNames && input.storeNames.length > 0
        ? input.storeNames
        : await this.resolveStoreNames(input.storeIds, user),
    );
    const createdAt = nowIso();
    const taskId = createTaskId();
    const userTasks = await withdrawalTaskStorage.get(user);

    const task: WithdrawalTask = {
      createdAt,
      failedCount: 0,
      id: taskId,
      results: [],
      status: this.getTaskStatusForCreate(input.triggerMode),
      storeCount: normalized.storeIds.length,
      storeIds: normalized.storeIds,
      storeNames: normalized.storeNames,
      successCount: 0,
      summary:
        input.triggerMode === 'daily'
          ? '等待定时调度执行'
          : '等待手动执行',
      taskId,
      taskType: 'eleme_withdrawal',
      triggerMode: input.triggerMode,
      updatedAt: createdAt,
      scheduleTime: formatScheduleTime(input.scheduleTime),
      nextRunAt:
        input.triggerMode === 'daily'
          ? computeNextRunAt(input.scheduleTime, createdAt)
          : undefined,
    };

    await withdrawalTaskStorage.save([...userTasks, task], user);
    return task;
  }

  async update(input: WithdrawalTaskUpdateInput, user?: StorageUserContext) {
    const tasks = await withdrawalTaskStorage.get(user);
    const index = tasks.findIndex((item) => item.taskId === input.taskId || item.id === input.taskId);
    if (index === -1) {
      throw new Error('任务不存在');
    }

    const existing = tasks[index]!;
    if (existing.status === 'running') {
      throw new Error('运行中的任务不能修改');
    }

    const nextStatus = input.status || existing.status;
    const scheduleTime =
      existing.triggerMode === 'daily'
        ? formatScheduleTime(input.scheduleTime || existing.scheduleTime)
        : undefined;

    if (existing.triggerMode === 'daily' && !scheduleTime) {
      throw new Error('定时任务缺少执行时间');
    }

    const nextTask: WithdrawalTask = {
      ...existing,
      scheduleTime,
      status: nextStatus,
      updatedAt: nowIso(),
      nextRunAt:
        existing.triggerMode === 'daily' && nextStatus === 'pending'
          ? computeNextRunAt(scheduleTime)
          : nextStatus === 'paused' || nextStatus === 'cancelled'
            ? undefined
            : existing.nextRunAt,
      summary:
        nextStatus === 'paused'
          ? '任务已暂停'
          : nextStatus === 'cancelled'
            ? '任务已取消'
            : existing.summary,
    };

    tasks[index] = nextTask;
    await withdrawalTaskStorage.save(tasks, user);
    return nextTask;
  }

  async delete(taskId: string, user?: StorageUserContext) {
    const tasks = await withdrawalTaskStorage.get(user);
    const index = tasks.findIndex((item) => item.taskId === taskId || item.id === taskId);
    if (index === -1) {
      return tasks;
    }
    if (tasks[index]?.status === 'running') {
      throw new Error('运行中的任务不能删除');
    }
    tasks.splice(index, 1);
    await withdrawalTaskStorage.save(tasks, user);
    return sortTasks(tasks);
  }

  private ensureNoRunningStoreConflict(task: WithdrawalTask, allTasks: WithdrawalTask[]) {
    const currentStores = new Set(task.storeIds);
    const conflictTask = allTasks.find(
      (item) =>
        item.taskId !== task.taskId &&
        item.status === 'running' &&
        item.storeIds.some((storeId) => currentStores.has(storeId)),
    );

    if (conflictTask) {
      throw new Error(`门店正在被任务 ${conflictTask.taskId} 执行，请稍后重试`);
    }
  }

  private async persistAllTasks(tasks: WithdrawalTask[], user?: StorageUserContext) {
    await withdrawalTaskStorage.save(tasks, user);
  }

  private async runTaskInternal(
    taskId: string,
    user?: StorageUserContext,
    options?: WithdrawalTaskRunOptions,
  ) {
    if (this.activeTaskIds.has(taskId)) {
      throw new Error('任务正在执行中，请勿重复触发');
    }

    const tasks = await withdrawalTaskStorage.get(user);
    const index = tasks.findIndex((item) => item.taskId === taskId || item.id === taskId);
    if (index === -1) {
      throw new Error('任务不存在');
    }

    const task = tasks[index]!;
    this.ensureNoRunningStoreConflict(task, tasks);
    this.activeTaskIds.add(task.taskId);

    try {
      const runStoreIds = options?.storeIds?.length
        ? task.storeIds.filter((storeId) => options.storeIds?.includes(storeId))
        : task.storeIds;
      const runStoreNames = task.storeIds
        .map((storeId, idx) => ({ storeId, storeName: task.storeNames[idx] || storeId }))
        .filter((item) => runStoreIds.includes(item.storeId))
        .map((item) => item.storeName);

      const runningTask: WithdrawalTask = {
        ...task,
        status: 'running',
        updatedAt: nowIso(),
        summary: '任务执行中',
      };
      tasks[index] = runningTask;
      await this.persistAllTasks(tasks, user);

      const execution = await WithdrawalTaskRunner.executeTask({
        ...runningTask,
        storeCount: runStoreIds.length,
        storeIds: runStoreIds,
        storeNames: runStoreNames,
      });

      const mergedResults =
        options?.storeIds?.length && task.results.length > 0
          ? mergeTaskResults(task.results, execution.results)
          : execution.results;
      const successCount = mergedResults.filter((item) => item.status === 'success').length;
      const failedCount = mergedResults.length - successCount;

      const finishedTask: WithdrawalTask = {
        ...task,
        failedCount,
        finishedAt: execution.finishedAt,
        lastRunAt: execution.lastRunAt,
        nextRunAt:
          task.triggerMode === 'daily' && task.status !== 'paused' && task.status !== 'cancelled'
            ? computeNextRunAt(task.scheduleTime, execution.finishedAt)
            : undefined,
        results: mergedResults,
        status:
          task.triggerMode === 'daily' && execution.status === 'success'
            ? 'pending'
            : task.triggerMode === 'daily' && execution.status === 'partial_success'
              ? 'pending'
              : execution.status,
        successCount,
        summary: execution.summary,
        updatedAt: nowIso(),
      };

      tasks[index] = finishedTask;
      await this.persistAllTasks(tasks, user);
      return finishedTask;
    } finally {
      this.activeTaskIds.delete(task.taskId);
    }
  }

  async run(taskId: string, user?: StorageUserContext) {
    return this.runTaskInternal(taskId, user);
  }

  async retryFailed(taskId: string, user?: StorageUserContext) {
    const task = await this.getDetail(taskId, user);
    if (!task) {
      throw new Error('任务不存在');
    }
    const failedStoreIds = task.results
      .filter((item) => item.status === 'failed')
      .map((item) => item.storeId);

    if (failedStoreIds.length === 0) {
      throw new Error('当前任务没有失败门店');
    }

    return this.runTaskInternal(task.taskId, user, { storeIds: failedStoreIds });
  }

  async recoverTasks() {
    const tasks = await withdrawalTaskStorage.get();
    let changed = false;

    const recovered = tasks.map((task) => {
      if (task.status !== 'running') return task;
      changed = true;
      return {
        ...task,
        nextRunAt:
          task.triggerMode === 'daily'
            ? computeNextRunAt(task.scheduleTime)
            : task.nextRunAt,
        status: task.triggerMode === 'daily' ? 'pending' : 'failed',
        summary:
          task.triggerMode === 'daily'
            ? '应用重启后已恢复为待执行'
            : '应用重启导致任务中断',
        updatedAt: nowIso(),
      } satisfies WithdrawalTask;
    });

    if (changed) {
      await this.persistAllTasks(recovered);
    }
  }

  async tick() {
    const tasks = await withdrawalTaskStorage.get();
    const now = Date.now();
    const dueTasks = tasks
      .filter(
        (task) =>
          task.triggerMode === 'daily' &&
          task.status === 'pending' &&
          task.nextRunAt &&
          new Date(task.nextRunAt).getTime() <= now,
      )
      .sort(
        (a, b) =>
          new Date(a.nextRunAt || a.updatedAt).getTime() -
          new Date(b.nextRunAt || b.updatedAt).getTime(),
      );

    for (const task of dueTasks) {
      try {
        await this.runTaskInternal(task.taskId);
      } catch (error) {
        console.error('[WithdrawalTaskFeature] 定时执行失败:', task.taskId, error);
      }
    }
  }

  startScheduler() {
    if (this.scheduler) return;
    void this.recoverTasks().then(() => this.tick());
    this.scheduler = setInterval(() => {
      void this.tick();
    }, 30_000);
  }
}

export const withdrawalTaskFeature = new WithdrawalTaskFeature();
export type { WithdrawalTask } from './runner';
