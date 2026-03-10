import { storeStorage, withdrawalTaskStorage } from '../../shared/storage';
import type { StorageUserContext } from '../../shared/storage';
import {
  computeNextRunAt,
  formatScheduleTime,
  WithdrawalTaskRunner,
} from './runner';
import type {
  WithdrawalTaskHistory,
  WithdrawalTaskHistoryTriggerReason,
  WithdrawalScheduleFrequency,
  WithdrawalTask,
  WithdrawalTaskResult,
  WithdrawalTriggerMode,
} from './runner';

interface WithdrawalTaskCreateInput {
  scheduleFrequency?: WithdrawalScheduleFrequency;
  scheduleTime?: string;
  scheduleWeekday?: number;
  storeIds: string[];
  storeNames?: string[];
  triggerMode: WithdrawalTriggerMode;
}

interface WithdrawalTaskUpdateInput {
  scheduleFrequency?: WithdrawalScheduleFrequency;
  scheduleTime?: string;
  scheduleWeekday?: number;
  storeIds?: string[];
  storeNames?: string[];
  status?: WithdrawalTask['status'];
  taskId: string;
}

interface WithdrawalTaskRunOptions {
  storeIds?: string[];
  triggerReason?: WithdrawalTaskHistoryTriggerReason;
}

function nowIso() {
  return new Date().toISOString();
}

function computeAutoRunAt(delayMs = 2000) {
  return new Date(Date.now() + delayMs).toISOString();
}

function isPastDue(value?: string) {
  if (!value) return false;
  const time = new Date(value).getTime();
  return !Number.isNaN(time) && time <= Date.now();
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

function createHistoryId() {
  return `run_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function normalizeHistories(task: WithdrawalTask) {
  return Array.isArray(task.histories) ? task.histories : [];
}

function appendTaskHistory(task: WithdrawalTask, history: WithdrawalTaskHistory) {
  return [history, ...normalizeHistories(task)].slice(0, 30);
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

  private getRunningTasks(tasks: WithdrawalTask[]) {
    return tasks.filter((item) => item.status === 'running');
  }

  private validateCreateInput(input: WithdrawalTaskCreateInput) {
    if (!Array.isArray(input.storeIds) || input.storeIds.length === 0) {
      throw new Error('请至少选择一个门店');
    }
    if (input.triggerMode === 'daily' && !formatScheduleTime(input.scheduleTime)) {
      throw new Error('请选择有效的每日执行时间');
    }
    if (
      input.triggerMode === 'daily' &&
      (input.scheduleFrequency === 'weekly' || input.scheduleWeekday !== undefined)
    ) {
      const weekday = input.scheduleWeekday;
      if (typeof weekday !== 'number' || weekday < 0 || weekday > 6) {
        throw new Error('请选择有效的每周执行日');
      }
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
    const scheduleFrequency = input.triggerMode === 'daily'
      ? input.scheduleFrequency || 'daily'
      : undefined;
    const scheduleWeekday =
      input.triggerMode === 'daily' && scheduleFrequency === 'weekly'
        ? input.scheduleWeekday ?? 1
        : undefined;

    const task: WithdrawalTask = {
      autoRunAt: input.triggerMode === 'manual' ? computeAutoRunAt() : undefined,
      createdAt,
      failedCount: 0,
      histories: [],
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
          : '计划已生成，等待自动执行',
      taskId,
      taskType: 'eleme_withdrawal',
      triggerMode: input.triggerMode,
      updatedAt: createdAt,
      scheduleFrequency,
      scheduleTime: formatScheduleTime(input.scheduleTime),
      scheduleWeekday,
      nextRunAt:
        input.triggerMode === 'daily'
          ? computeNextRunAt(input.scheduleTime, createdAt, scheduleFrequency, scheduleWeekday)
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
    if (existing.status === 'deleted') {
      throw new Error('已删除的任务不能修改');
    }

    const nextStatus = input.status || existing.status;
    const normalizedStores =
      input.storeIds && input.storeIds.length > 0
        ? dedupeStores(
            input.storeIds,
            input.storeNames && input.storeNames.length > 0
              ? input.storeNames
              : await this.resolveStoreNames(input.storeIds, user),
          )
        : {
            storeIds: existing.storeIds,
            storeNames: existing.storeNames,
          };
    const scheduleFrequency =
      existing.triggerMode === 'daily'
        ? input.scheduleFrequency || existing.scheduleFrequency || 'daily'
        : undefined;
    const scheduleTime =
      existing.triggerMode === 'daily'
        ? formatScheduleTime(input.scheduleTime || existing.scheduleTime)
        : undefined;
    const scheduleWeekday =
      existing.triggerMode === 'daily' && scheduleFrequency === 'weekly'
        ? input.scheduleWeekday ?? existing.scheduleWeekday ?? 1
        : undefined;

    if (existing.triggerMode === 'daily' && !scheduleTime) {
      throw new Error('定时任务缺少执行时间');
    }

    const nextTask: WithdrawalTask = {
      ...existing,
      scheduleFrequency,
      scheduleTime,
      scheduleWeekday,
      storeCount: normalizedStores.storeIds.length,
      storeIds: normalizedStores.storeIds,
      storeNames: normalizedStores.storeNames,
      status: nextStatus,
      updatedAt: nowIso(),
      nextRunAt:
        existing.triggerMode === 'daily' && nextStatus === 'pending'
          ? computeNextRunAt(
              scheduleTime,
              undefined,
              scheduleFrequency,
              scheduleWeekday,
            )
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
      return sortTasks(tasks);
    }
    const task = tasks[index]!;
    const runningTasks = this.getRunningTasks(tasks);
    if (runningTasks.length > 0) {
      throw new Error(`当前有 ${runningTasks.length} 个任务正在执行中，暂不允许删除任务`);
    }
    tasks[index] = {
      ...task,
      autoRunAt: undefined,
      nextRunAt: undefined,
      status: 'deleted',
      summary:
        '任务已删除',
      updatedAt: nowIso(),
    };
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
    if (task.status === 'deleted') {
      throw new Error('已删除的任务不能执行');
    }
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
      const startedAt = nowIso();
      const triggerReason =
        options?.triggerReason ||
        (options?.storeIds?.length ? 'retry' : task.triggerMode === 'daily' ? 'auto' : 'manual');

      const runningTask: WithdrawalTask = {
        ...task,
        autoRunAt: undefined,
        status: 'running',
        updatedAt: startedAt,
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
        histories: appendTaskHistory(task, {
          failedCount,
          finishedAt: execution.finishedAt,
          historyId: createHistoryId(),
          lastRunAt: execution.lastRunAt,
          results: execution.results,
          startedAt: execution.startedAt || startedAt,
          status: execution.status,
          storeIds: runStoreIds,
          storeNames: runStoreNames,
          successCount,
          summary: execution.summary,
          triggerReason,
        }),
        lastRunAt: execution.lastRunAt,
        nextRunAt:
          task.triggerMode === 'daily' && task.status !== 'paused' && task.status !== 'cancelled'
            ? computeNextRunAt(
                task.scheduleTime,
                execution.finishedAt,
                task.scheduleFrequency,
                task.scheduleWeekday,
              )
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
    return this.runTaskInternal(taskId, user, { triggerReason: 'manual' });
  }

  async retryFailed(taskId: string, user?: StorageUserContext) {
    const task = await this.getDetail(taskId, user);
    if (!task) {
      throw new Error('任务不存在');
    }
    if (task.status === 'deleted') {
      throw new Error('已删除的任务不能重试');
    }
    const failedStoreIds = task.results
      .filter((item) => item.status === 'failed')
      .map((item) => item.storeId);

    if (failedStoreIds.length === 0) {
      throw new Error('当前任务没有失败门店');
    }

    return this.runTaskInternal(task.taskId, user, {
      storeIds: failedStoreIds,
      triggerReason: 'retry',
    });
  }

  async recoverTasks() {
    const tasks = await withdrawalTaskStorage.get();
    let changed = false;
    const recoveryTime = nowIso();

    const recovered = tasks.map((task) => {
      if (task.status === 'running') {
        changed = true;
        return {
          ...task,
          autoRunAt: undefined,
          histories: appendTaskHistory(task, {
            failedCount: task.storeCount,
            finishedAt: recoveryTime,
            historyId: createHistoryId(),
            lastRunAt: recoveryTime,
            results: task.storeIds.map((storeId, index) => ({
              executedAt: recoveryTime,
              message:
                task.triggerMode === 'daily'
                  ? '应用重启后中断，本次执行已归档为异常记录'
                  : '应用重启导致任务中断，请手动重新执行',
              status: 'failed',
              storeId,
              storeName: task.storeNames[index] || storeId,
            })),
            startedAt: task.updatedAt || task.createdAt,
            status: 'failed',
            storeIds: task.storeIds,
            storeNames: task.storeNames,
            successCount: 0,
            summary:
              task.triggerMode === 'daily'
                ? '应用重启后执行中断，本次执行已归档'
                : '应用重启导致任务中断，已归档到历史记录',
            triggerReason: 'recover',
          }),
          nextRunAt:
            task.triggerMode === 'daily'
              ? computeNextRunAt(
                  task.scheduleTime,
                  undefined,
                  task.scheduleFrequency,
                  task.scheduleWeekday,
                )
              : task.nextRunAt,
          status: task.triggerMode === 'daily' ? 'pending' : 'failed',
          summary:
            task.triggerMode === 'daily'
              ? '应用重启后已恢复为待执行'
              : '应用重启导致任务中断，已置为失败，请手动重试',
          updatedAt: nowIso(),
        } satisfies WithdrawalTask;
      }

      if (
        task.triggerMode === 'manual' &&
        task.status === 'pending' &&
        isPastDue(task.autoRunAt)
      ) {
        changed = true;
        return {
          ...task,
          autoRunAt: undefined,
          finishedAt: task.finishedAt || nowIso(),
          histories: appendTaskHistory(task, {
            failedCount: task.storeCount,
            finishedAt: recoveryTime,
            historyId: createHistoryId(),
            lastRunAt: recoveryTime,
            results: task.storeIds.map((storeId, index) => ({
              executedAt: recoveryTime,
              message: '立即触发任务在刷新或重启后未获得执行结果，请手动重试',
              status: 'failed',
              storeId,
              storeName: task.storeNames[index] || storeId,
            })),
            startedAt: task.updatedAt || task.createdAt,
            status: 'failed',
            storeIds: task.storeIds,
            storeNames: task.storeNames,
            successCount: 0,
            summary: '立即触发任务未获得执行结果，已归档到历史记录',
            triggerReason: 'recover',
          }),
          status: 'failed',
          summary: '立即触发任务在刷新或重启后未获得执行结果，已置为失败，请手动重试',
          updatedAt: nowIso(),
        } satisfies WithdrawalTask;
      }

      return task;
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
          task.status !== 'deleted' &&
          task.status === 'pending' &&
          (
            (task.triggerMode === 'daily' &&
              task.nextRunAt &&
              new Date(task.nextRunAt).getTime() <= now) ||
            (task.triggerMode === 'manual' &&
              task.autoRunAt &&
              new Date(task.autoRunAt).getTime() <= now)
          ),
      )
      .sort(
        (a, b) =>
          new Date(a.autoRunAt || a.nextRunAt || a.updatedAt).getTime() -
          new Date(b.autoRunAt || b.nextRunAt || b.updatedAt).getTime(),
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
