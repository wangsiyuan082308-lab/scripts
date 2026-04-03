import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

import type {
  TaobaoSuperBrandTaskActivityResult,
  TaobaoSuperBrandTaskDetailRecord,
  TaobaoSuperBrandTaskRecord,
  TaobaoSuperBrandTaskRun,
  TaobaoSuperBrandTaskRunLog,
} from '../../../src/api/taobao-super-brand-task-repo';
import { normalizeTaobaoMarketingTaskLike } from '../../../src/features/taobao-marketing-tag/config';

type LocalStoreState = {
  details: Record<string, TaobaoSuperBrandTaskDetailRecord>;
  runs: Record<string, TaobaoSuperBrandTaskRun>;
  tasks: Record<string, TaobaoSuperBrandTaskRecord>;
};

type CreateTaskInput = {
  createdAt?: string;
  entryScope?: 'brand_activity' | 'unsigned_activity';
  id?: string;
  marketingTag?: string;
  taskName?: string;
  updatedAt?: string;
};

type CreateRunInput = {
  taskId: string;
  triggerSource?: string;
};

type SaveRunResultInput = {
  activityResults: TaobaoSuperBrandTaskActivityResult[];
  outputSummary?: Record<string, unknown>;
  status: 'failed' | 'partial_success' | 'queued' | 'running' | 'succeeded';
};

const LOCAL_TASK_PREFIX = 'local_super_brand_task_';
const LOCAL_RUN_PREFIX = 'local_super_brand_run_';
const STORE_FILENAME = 'taobao-super-brand-local-tasks.json';
let stateMutationQueue = Promise.resolve();

function createId(prefix: string) {
  return `${prefix}${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

function getStorePath() {
  return path.join(app.getPath('userData'), STORE_FILENAME);
}

function createEmptyState(): LocalStoreState {
  return {
    details: {},
    runs: {},
    tasks: {},
  };
}

function recoverJsonPrefix(raw: string) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  let started = false;

  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];

    if (!started) {
      if (char === '{') {
        started = true;
        depth = 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return raw.slice(0, index + 1);
      }
    }
  }

  return '';
}

function normalizeState(parsed: Partial<LocalStoreState> | null | undefined): LocalStoreState {
  return {
    details: parsed?.details || {},
    runs: parsed?.runs || {},
    tasks: parsed?.tasks || {},
  };
}

function normalizePersistedState(state: LocalStoreState) {
  let changed = false;
  const tasks = Object.fromEntries(
    Object.entries(state.tasks).map(([taskId, task]) => {
      const normalizedTask = normalizeTaobaoMarketingTaskLike(task);
      if (
        normalizedTask.entryScope !== task.entryScope ||
        normalizedTask.marketingTag !== task.marketingTag
      ) {
        changed = true;
      }
      return [taskId, normalizedTask];
    }),
  ) as Record<string, TaobaoSuperBrandTaskRecord>;

  return {
    changed,
    state: {
      ...state,
      tasks,
    },
  };
}

async function readState(): Promise<LocalStoreState> {
  try {
    const raw = await fs.readFile(getStorePath(), 'utf-8');
    try {
      const normalized = normalizePersistedState(
        normalizeState(JSON.parse(raw) as Partial<LocalStoreState>),
      );
      if (normalized.changed) {
        await writeState(normalized.state);
      }
      return normalized.state;
    } catch {
      const recovered = recoverJsonPrefix(raw);
      if (!recovered) {
        throw new Error('本地超级品牌红包任务存储已损坏，且无法恢复。');
      }
      const normalized = normalizePersistedState(
        normalizeState(JSON.parse(recovered) as Partial<LocalStoreState>),
      );
      await writeState(normalized.state);
      return normalized.state;
    }
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return createEmptyState();
    }
    throw error;
  }
}

async function writeState(state: LocalStoreState) {
  const storePath = getStorePath();
  const tempPath = `${storePath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(state, null, 2), 'utf-8');
  await fs.rename(tempPath, storePath);
}

async function mutateState<T>(updater: (state: LocalStoreState) => Promise<T> | T) {
  const execute = async () => {
    const state = await readState();
    const result = await updater(state);
    await writeState(state);
    return result;
  };
  const next = stateMutationQueue.then(execute, execute);
  stateMutationQueue = next.then(() => undefined, () => undefined);
  return next;
}

function sortTasks(tasks: TaobaoSuperBrandTaskRecord[]) {
  return [...tasks].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function buildTaskSummary(outputSummary?: Record<string, unknown>) {
  const foundCount = Number(outputSummary?.foundCount || 0);
  const successCount = Number(outputSummary?.successCount || 0);
  const partialCount = Number(outputSummary?.partialCount || 0);
  const failedCount = Number(outputSummary?.failedCount || 0);
  const actualStoreCount = Number(outputSummary?.actualStoreCount || 0);
  if (!foundCount && !successCount && !partialCount && !failedCount) {
    return '';
  }
  const lines = [`命中活动: ${foundCount}`, `执行成功: ${successCount}`];
  if (partialCount > 0) {
    lines.push(`部分成功: ${partialCount}`);
  }
  lines.push(`执行失败: ${failedCount}`, `实际报名门店: ${actualStoreCount}`);
  return lines.join('\n');
}

function applyTaskOutputSummary(
  task: TaobaoSuperBrandTaskRecord,
  outputSummary?: Record<string, unknown>,
) {
  task.activityCount = Number(outputSummary?.foundCount || 0);
  task.successActivityCount = Number(outputSummary?.successCount || 0);
  task.partialActivityCount = Number(outputSummary?.partialCount || 0);
  task.failedActivityCount = Number(outputSummary?.failedCount || 0);
  task.actualStoreCount = Number(outputSummary?.actualStoreCount || 0);
  task.actualStoreNames = Array.isArray(outputSummary?.actualStoreNames)
    ? (outputSummary?.actualStoreNames as string[])
    : [];
  task.actualStoreIds = Array.isArray(outputSummary?.actualStoreIds)
    ? (outputSummary?.actualStoreIds as string[])
    : [];
  if (outputSummary?.entryScope === 'brand_activity' || outputSummary?.entryScope === 'unsigned_activity') {
    task.entryScope = outputSummary.entryScope;
  }
  task.marketingTag = `${outputSummary?.marketingTag || task.marketingTag || '超级品牌红包'}`;
  task.summaryText = buildTaskSummary(outputSummary);
  Object.assign(task, normalizeTaobaoMarketingTaskLike(task));
}

export function isLocalSuperBrandTaskId(taskId: string) {
  return taskId.startsWith(LOCAL_TASK_PREFIX);
}

export function isLocalSuperBrandRunId(runId: string) {
  return runId.startsWith(LOCAL_RUN_PREFIX);
}

export async function listLocalSuperBrandTasks() {
  const state = await readState();
  return sortTasks(Object.values(state.tasks).map((task) => normalizeTaobaoMarketingTaskLike(task)));
}

export async function createLocalSuperBrandTask(input: CreateTaskInput) {
  return mutateState(async (state) => {
    const now = new Date().toISOString();
    const id = input.id || createId(LOCAL_TASK_PREFIX);
    const existing = state.tasks[id];
    const task: TaobaoSuperBrandTaskRecord = normalizeTaobaoMarketingTaskLike({
      activityCount: existing?.activityCount,
      actualStoreCount: existing?.actualStoreCount,
      actualStoreIds: existing?.actualStoreIds,
      actualStoreNames: existing?.actualStoreNames,
      createdAt: existing?.createdAt || input.createdAt || now,
      entryScope: input.entryScope || existing?.entryScope || 'brand_activity',
      failedActivityCount: existing?.failedActivityCount,
      id,
      lastRunAt: existing?.lastRunAt,
      latestRunId: existing?.latestRunId,
      latestRunStatus: existing?.latestRunStatus,
      marketingTag: `${input.marketingTag || existing?.marketingTag || '超级品牌红包'}`,
      partialActivityCount: existing?.partialActivityCount,
      status: existing?.status || 'draft',
      successActivityCount: existing?.successActivityCount,
      summaryText: existing?.summaryText,
      taskName: `${input.taskName || ''}`.trim() || '超级品牌红包报名任务',
      updatedAt: input.updatedAt || now,
    });
    const detail: TaobaoSuperBrandTaskDetailRecord = state.details[id] || {
      activityResults: [],
      id,
      recentLogs: [],
      taskId: id,
    };
    state.tasks[id] = task;
    state.details[id] = detail;
    return {
      detail,
      task,
    };
  });
}

export async function getLocalSuperBrandTaskDetail(taskId: string) {
  const state = await readState();
  const task = state.tasks[taskId];
  const detail = state.details[taskId];
  if (!task || !detail) {
    throw new Error('未找到本地超级品牌红包任务');
  }
  return {
    detail,
    task: normalizeTaobaoMarketingTaskLike(task),
  };
}

export async function deleteLocalSuperBrandTask(taskId: string) {
  return mutateState(async (state) => {
    delete state.tasks[taskId];
    delete state.details[taskId];
    for (const [runId, run] of Object.entries(state.runs)) {
      if (run.taskId === taskId) {
        delete state.runs[runId];
      }
    }
    return true;
  });
}

export async function createLocalSuperBrandRun(input: CreateRunInput) {
  return mutateState(async (state) => {
    const task = state.tasks[input.taskId];
    if (!task) {
      throw new Error('未找到本地超级品牌红包任务，无法创建运行记录');
    }

    const now = new Date().toISOString();
    const runId = createId(LOCAL_RUN_PREFIX);
    const run: TaobaoSuperBrandTaskRun = {
      activityResults: [],
      createdAt: now,
      currentStage: 'queued',
      id: runId,
      logs: [],
      outputSummary: {},
      startedAt: now,
      status: 'queued',
      taskId: input.taskId,
      triggerSource: input.triggerSource || 'ui',
      updatedAt: now,
    };

    task.lastRunAt = now;
    task.latestRunId = runId;
    task.latestRunStatus = 'queued';
    task.status = 'queued';
    task.updatedAt = now;

    const detail = state.details[input.taskId] || {
      id: input.taskId,
      taskId: input.taskId,
    };
    detail.latestRun = run;
    detail.recentLogs = [];
    state.details[input.taskId] = detail;
    state.runs[runId] = run;
    return run;
  });
}

export async function listLocalSuperBrandRuns(taskId: string) {
  const state = await readState();
  const items = Object.values(state.runs)
    .filter((run) => run.taskId === taskId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return {
    items,
    total: items.length,
  };
}

export async function listLocalSuperBrandRunLogs(runId: string) {
  const state = await readState();
  const run = state.runs[runId];
  const items = [...(run?.logs || [])];
  return {
    items,
    total: items.length,
  };
}

export async function appendLocalSuperBrandRunLog(
  runId: string,
  payload: Omit<TaobaoSuperBrandTaskRunLog, 'createdAt' | 'id' | 'runId'>,
) {
  return mutateState(async (state) => {
    const run = state.runs[runId];
    if (!run) {
      throw new Error('未找到本地超级品牌红包运行记录');
    }
    const task = state.tasks[run.taskId];
    const detail = state.details[run.taskId];
    const logEntry: TaobaoSuperBrandTaskRunLog = {
      ...payload,
      createdAt: new Date().toISOString(),
      id: `${runId}_log_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      runId,
    };
    run.logs = [...(run.logs || []), logEntry];
    run.updatedAt = new Date().toISOString();
    if (detail) {
      detail.recentLogs = [...(detail.recentLogs || []), logEntry].slice(-200);
      detail.latestRun = run;
    }
    if (task) {
      task.updatedAt = new Date().toISOString();
    }
    return logEntry;
  });
}

export async function updateLocalSuperBrandRunStatus(
  runId: string,
  payload: {
    currentStage?: string;
    failureReason?: string;
    outputSummary?: Record<string, unknown>;
    status?: TaobaoSuperBrandTaskRun['status'];
  },
) {
  return mutateState(async (state) => {
    const run = state.runs[runId];
    if (!run) {
      throw new Error('未找到本地超级品牌红包运行记录');
    }
    const task = state.tasks[run.taskId];
    const detail = state.details[run.taskId];
    const now = new Date().toISOString();

    run.currentStage = payload.currentStage || run.currentStage;
    run.failureReason = payload.failureReason || run.failureReason;
    run.outputSummary = payload.outputSummary || run.outputSummary;
    run.status = payload.status || run.status;
    run.updatedAt = now;
    if (payload.status && ['failed', 'partial_success', 'succeeded'].includes(payload.status)) {
      run.finishedAt = now;
    }

    if (task) {
      task.latestRunId = runId;
      task.latestRunStatus = run.status;
      task.lastRunAt = task.lastRunAt || now;
      task.status = run.status;
      task.updatedAt = now;
      applyTaskOutputSummary(task, payload.outputSummary);
      if (payload.failureReason) {
        task.summaryText = payload.failureReason;
      }
    }

    if (detail) {
      detail.latestRun = run;
    }

    return run;
  });
}

export async function saveLocalSuperBrandRunResult(
  runId: string,
  payload: SaveRunResultInput,
) {
  return mutateState(async (state) => {
    const run = state.runs[runId];
    if (!run) {
      throw new Error('未找到本地超级品牌红包运行记录');
    }
    const task = state.tasks[run.taskId];
    const detail = state.details[run.taskId];
    const now = new Date().toISOString();

    run.activityResults = payload.activityResults;
    run.outputSummary = payload.outputSummary || {};
    run.status = payload.status;
    run.currentStage = 'generate_report';
    run.updatedAt = now;
    run.finishedAt = now;

    if (detail) {
      detail.activityResults = payload.activityResults;
      detail.latestRun = run;
    }

    if (task) {
      task.latestRunId = runId;
      task.latestRunStatus = payload.status;
      task.status = payload.status;
      task.lastRunAt = task.lastRunAt || now;
      task.updatedAt = now;
      applyTaskOutputSummary(task, payload.outputSummary);
    }

    return run;
  });
}
