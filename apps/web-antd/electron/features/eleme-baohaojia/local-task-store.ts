import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

import type {
  TaobaoBaohaojiaTaskActivityResult,
  TaobaoBaohaojiaTaskDetailRecord,
  TaobaoBaohaojiaTaskFileRecord,
  TaobaoBaohaojiaTaskMetrics,
  TaobaoBaohaojiaTaskRecord,
  TaobaoBaohaojiaTaskRun,
  TaobaoBaohaojiaTaskRunLog,
} from '../../../src/api/taobao-baohaojia-task-repo';

type LocalStoreState = {
  details: Record<string, TaobaoBaohaojiaTaskDetailRecord>;
  runs: Record<string, TaobaoBaohaojiaTaskRun>;
  tasks: Record<string, TaobaoBaohaojiaTaskRecord>;
};

type CreateTaskInput = {
  id?: string;
  initialStock: number;
  requiresManualReview?: boolean;
  signupMode?: 'all' | 'repeat_only' | 'unsigned_only';
  taskName?: string;
  createdAt?: string;
  updatedAt?: string;
};

type CreateRunInput = {
  taskId: string;
  triggerSource?: string;
};

type SaveRunResultInput = {
  activityResults: TaobaoBaohaojiaTaskActivityResult[];
  outputSummary?: Record<string, unknown>;
  status:
    | 'failed'
    | 'partial_success'
    | 'queued'
    | 'running'
    | 'succeeded'
    | 'waiting_review';
};

const LOCAL_TASK_PREFIX = 'local_baohaojia_task_';
const LOCAL_RUN_PREFIX = 'local_baohaojia_run_';
const STORE_FILENAME = 'taobao-baohaojia-local-tasks.json';
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

async function readState(): Promise<LocalStoreState> {
  try {
    const raw = await fs.readFile(getStorePath(), 'utf-8');
    try {
      return normalizeState(JSON.parse(raw) as Partial<LocalStoreState>);
    } catch {
      const recovered = recoverJsonPrefix(raw);
      if (!recovered) {
        throw new Error('本地爆好价任务存储已损坏，且无法恢复。');
      }
      const parsed = normalizeState(JSON.parse(recovered) as Partial<LocalStoreState>);
      await writeState(parsed);
      return parsed;
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

function sortTasks(tasks: TaobaoBaohaojiaTaskRecord[]) {
  return [...tasks].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function buildTaskSummary(outputSummary?: Record<string, unknown>) {
  const foundCount = Number(outputSummary?.foundCount || 0);
  const successCount = Number(outputSummary?.successCount || 0);
  const partialCount = Number(outputSummary?.partialCount || 0);
  const failedCount = Number(outputSummary?.failedCount || 0);
  const actualStoreCount = Number(outputSummary?.actualStoreCount || 0);
  const waitingReviewCount = Number(outputSummary?.waitingReviewCount || 0);
  if (!foundCount && !successCount && !partialCount && !failedCount && !waitingReviewCount) {
    return '';
  }
  return [
    `本次命中活动: ${foundCount}`,
    `执行成功: ${successCount}`,
    `部分成功: ${partialCount}`,
    `执行失败: ${failedCount}`,
    `待审核: ${waitingReviewCount}`,
    `实际报名门店: ${actualStoreCount}`,
  ].join('\n');
}

function applyTaskOutputSummary(
  task: TaobaoBaohaojiaTaskRecord,
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
  if (
    outputSummary?.signupMode === 'all' ||
    outputSummary?.signupMode === 'unsigned_only' ||
    outputSummary?.signupMode === 'repeat_only'
  ) {
    task.signupMode = outputSummary.signupMode;
  }
}

function buildTaskMetricsFromActivities(
  activityResults: TaobaoBaohaojiaTaskActivityResult[],
): TaobaoBaohaojiaTaskMetrics {
  const totalCount = activityResults.length;
  const qualifiedCount = activityResults.filter((item) => item.status === 'succeeded').length;
  const reviewCount = activityResults.filter(
    (item) => item.status === 'partial_success' || item.status === 'waiting_review',
  ).length;
  const excludedCount = activityResults.filter((item) => item.status === 'failed').length;
  return {
    excludedCount,
    invalidPriceCount: 0,
    notFoundCount: 0,
    qualifiedCount,
    reviewCount,
    totalCount,
    zeroCostCount: 0,
  };
}

function flattenResultFiles(activityResults: TaobaoBaohaojiaTaskActivityResult[]) {
  const files: TaobaoBaohaojiaTaskFileRecord[] = [];
  const pushFile = (
    file: TaobaoBaohaojiaTaskFileRecord | undefined,
    activityId: string,
  ) => {
    if (!file) return;
    files.push({
      ...file,
      activityId,
      createdAt: file.createdAt || new Date().toISOString(),
      fileId:
        file.fileId ||
        `${activityId}_${file.kind}_${file.fileName}_${Math.floor(Math.random() * 1000)}`,
      updatedAt: new Date().toISOString(),
    });
  };

  for (const activity of activityResults) {
    pushFile(activity.uploadFile, activity.activityId);
    pushFile(activity.auditFile, activity.activityId);
    pushFile(activity.exportedFile, activity.activityId);
  }

  return files;
}

function getPrimaryFile(
  files: TaobaoBaohaojiaTaskFileRecord[],
  kind: TaobaoBaohaojiaTaskFileRecord['kind'],
) {
  return files.find((item) => item.kind === kind);
}

export function isLocalBaohaojiaTaskId(taskId: string) {
  return taskId.startsWith(LOCAL_TASK_PREFIX);
}

export function isLocalBaohaojiaRunId(runId: string) {
  return runId.startsWith(LOCAL_RUN_PREFIX);
}

export async function listLocalBaohaojiaTasks() {
  const state = await readState();
  return sortTasks(Object.values(state.tasks));
}

export async function createLocalBaohaojiaTask(input: CreateTaskInput) {
  return mutateState(async (state) => {
    const now = new Date().toISOString();
    const id = input.id || createId(LOCAL_TASK_PREFIX);
    const existing = state.tasks[id];
    const task: TaobaoBaohaojiaTaskRecord = {
      activityCount: existing?.activityCount,
      actualStoreCount: existing?.actualStoreCount,
      actualStoreIds: existing?.actualStoreIds,
      actualStoreNames: existing?.actualStoreNames,
      createdAt: existing?.createdAt || input.createdAt || now,
      id,
      failedActivityCount: existing?.failedActivityCount,
      initialStock: Number(input.initialStock || 9999),
      latestRunId: existing?.latestRunId,
      latestRunStatus: existing?.latestRunStatus,
      metrics: existing?.metrics,
      partialActivityCount: existing?.partialActivityCount,
      requiresManualReview:
        input.requiresManualReview ?? existing?.requiresManualReview ?? false,
      signupMode: input.signupMode || existing?.signupMode || 'all',
      status: existing?.status || 'draft',
      successActivityCount: existing?.successActivityCount,
      summaryText: existing?.summaryText,
      taskName: `${input.taskName || ''}`.trim() || '爆好价活动报名任务',
      updatedAt: input.updatedAt || now,
    };
    const detail: TaobaoBaohaojiaTaskDetailRecord = state.details[id] || {
      activityResults: [],
      files: [],
      id,
      qualifiedItems: [],
      recentLogs: [],
      reviewItems: [],
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

export async function getLocalBaohaojiaTaskDetail(taskId: string) {
  const state = await readState();
  const task = state.tasks[taskId];
  const detail = state.details[taskId];
  if (!task || !detail) {
    throw new Error('未找到本地爆好价任务');
  }
  return {
    detail,
    task,
  };
}

export async function deleteLocalBaohaojiaTask(taskId: string) {
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

export async function createLocalBaohaojiaRun(input: CreateRunInput) {
  return mutateState(async (state) => {
    const task = state.tasks[input.taskId];
    if (!task) {
      throw new Error('未找到本地爆好价任务，无法创建运行记录');
    }

    const now = new Date().toISOString();
    const runId = createId(LOCAL_RUN_PREFIX);
    const run: TaobaoBaohaojiaTaskRun = {
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

export async function listLocalBaohaojiaRuns(taskId: string) {
  const state = await readState();
  const items = Object.values(state.runs)
    .filter((run) => run.taskId === taskId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return {
    items,
    total: items.length,
  };
}

export async function hasLocalBaohaojiaShadowTask(taskId: string) {
  const state = await readState();
  return !!state.tasks[taskId];
}

export async function listLocalBaohaojiaRunLogs(runId: string) {
  const state = await readState();
  const run = state.runs[runId];
  const items = [...(run?.logs || [])];
  return {
    items,
    total: items.length,
  };
}

export async function appendLocalBaohaojiaRunLog(
  runId: string,
  payload: Omit<TaobaoBaohaojiaTaskRunLog, 'createdAt' | 'id' | 'runId'>,
) {
  return mutateState(async (state) => {
    const run = state.runs[runId];
    if (!run) {
      throw new Error('未找到本地爆好价运行记录');
    }
    const task = state.tasks[run.taskId];
    const detail = state.details[run.taskId];
    const logEntry: TaobaoBaohaojiaTaskRunLog = {
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

export async function updateLocalBaohaojiaRunStatus(
  runId: string,
  payload: {
    currentStage?: string;
    failureReason?: string;
    outputSummary?: Record<string, unknown>;
    status?: TaobaoBaohaojiaTaskRun['status'];
  },
) {
  return mutateState(async (state) => {
    const run = state.runs[runId];
    if (!run) {
      throw new Error('未找到本地爆好价运行记录');
    }
    const task = state.tasks[run.taskId];
    const detail = state.details[run.taskId];
    const now = new Date().toISOString();

    run.currentStage = payload.currentStage || run.currentStage;
    run.failureReason = payload.failureReason || run.failureReason;
    run.outputSummary = payload.outputSummary || run.outputSummary;
    run.status = payload.status || run.status;
    run.updatedAt = now;
    if (
      payload.status &&
      ['failed', 'partial_success', 'succeeded', 'waiting_review'].includes(payload.status)
    ) {
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

export async function saveLocalBaohaojiaRunResult(
  runId: string,
  payload: SaveRunResultInput,
) {
  return mutateState(async (state) => {
    const run = state.runs[runId];
    if (!run) {
      throw new Error('未找到本地爆好价运行记录');
    }
    const task = state.tasks[run.taskId];
    const detail = state.details[run.taskId];
    const now = new Date().toISOString();
    const files = flattenResultFiles(payload.activityResults);

    run.activityResults = payload.activityResults;
    run.outputSummary = payload.outputSummary || {};
    run.status = payload.status;
    run.updatedAt = now;
    run.finishedAt = now;

    if (task) {
      task.latestRunId = runId;
      task.latestRunStatus = payload.status;
      task.lastRunAt = now;
      task.metrics = buildTaskMetricsFromActivities(payload.activityResults);
      task.status = payload.status;
      task.summaryText = buildTaskSummary(payload.outputSummary);
      task.updatedAt = now;
      applyTaskOutputSummary(task, payload.outputSummary);
    }

    if (detail) {
      detail.activityResults = payload.activityResults;
      detail.files = files;
      detail.uploadFile = getPrimaryFile(files, 'upload');
      detail.auditFile = getPrimaryFile(files, 'audit');
      detail.latestRun = run;
      detail.recentLogs = run.logs || [];
    }

    return run;
  });
}
