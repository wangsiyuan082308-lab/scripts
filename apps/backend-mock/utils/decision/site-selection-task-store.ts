import { recommendSiteSelection, type SiteSelectionResult } from './site-selection';

export type SiteSelectionTaskStatus =
  | 'draft'
  | 'failed'
  | 'pending'
  | 'running'
  | 'succeeded';

export interface SiteSelectionTask {
  createdAt: string;
  id: string;
  lastError?: string;
  lastRunAt?: string;
  latestResult?: null | SiteSelectionResult;
  query: string;
  scenePreference?: string;
  status: SiteSelectionTaskStatus;
  taskName: string;
  updatedAt: string;
}

export interface SiteSelectionTaskInput {
  query?: string;
  scenePreference?: string;
  taskName?: string;
}

const taskStore: SiteSelectionTask[] = [];
const activeRuns = new Set<string>();

function normalizeText(value: unknown) {
  return String(value ?? '').trim();
}

function nowIso() {
  return new Date().toISOString();
}

function createTaskName(input: SiteSelectionTaskInput) {
  const query = normalizeText(input.query);
  if (normalizeText(input.taskName)) {
    return normalizeText(input.taskName);
  }
  return query ? `${query}选址任务` : `选址任务-${Date.now()}`;
}

function cloneTask(task: SiteSelectionTask) {
  return JSON.parse(JSON.stringify(task)) as SiteSelectionTask;
}

export function listSiteSelectionTasks(filters: {
  keyword?: string;
  status?: string;
}) {
  const keyword = normalizeText(filters.keyword).toLowerCase();
  const status = normalizeText(filters.status);

  return taskStore
    .filter((task) => {
      if (status && task.status !== status) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      const haystack = [
        task.taskName,
        task.query,
        task.scenePreference,
        task.latestResult?.marketVerdict,
        task.latestResult?.items?.[0]?.locationName,
      ]
        .map((item) => normalizeText(item).toLowerCase())
        .join('\n');

      return haystack.includes(keyword);
    })
    .sort((a, b) => `${b.updatedAt}`.localeCompare(`${a.updatedAt}`))
    .map(cloneTask);
}

export function createSiteSelectionTask(input: SiteSelectionTaskInput) {
  const query = normalizeText(input.query);
  if (!query) {
    throw new Error('选址需求不能为空');
  }

  const timestamp = nowIso();
  const task: SiteSelectionTask = {
    createdAt: timestamp,
    id: `site_selection_${Date.now()}`,
    latestResult: null,
    query,
    scenePreference: normalizeText(input.scenePreference),
    status: 'draft',
    taskName: createTaskName(input),
    updatedAt: timestamp,
  };
  taskStore.unshift(task);
  return cloneTask(task);
}

export function getSiteSelectionTask(taskId: string) {
  const task = taskStore.find((item) => item.id === taskId);
  if (!task) {
    throw new Error('选址任务不存在');
  }
  return cloneTask(task);
}

export function updateSiteSelectionTask(
  taskId: string,
  input: SiteSelectionTaskInput,
) {
  const task = taskStore.find((item) => item.id === taskId);
  if (!task) {
    throw new Error('选址任务不存在');
  }

  const query = normalizeText(input.query);
  if (!query) {
    throw new Error('选址需求不能为空');
  }

  task.query = query;
  task.scenePreference = normalizeText(input.scenePreference);
  task.taskName = createTaskName({
    ...input,
    query,
  });
  task.updatedAt = nowIso();
  return cloneTask(task);
}

export function deleteSiteSelectionTask(taskId: string) {
  const index = taskStore.findIndex((item) => item.id === taskId);
  if (index === -1) {
    throw new Error('选址任务不存在');
  }
  taskStore.splice(index, 1);
  activeRuns.delete(taskId);
  return true;
}

export async function executeSiteSelectionTask(taskId: string) {
  const task = taskStore.find((item) => item.id === taskId);
  if (!task) {
    throw new Error('选址任务不存在');
  }

  task.status = 'running';
  task.updatedAt = nowIso();

  try {
    const result = await recommendSiteSelection({
      limit: 3,
      query: task.query,
      scenePreference: task.scenePreference,
    });

    const finishedAt = nowIso();
    task.lastError = '';
    task.lastRunAt = finishedAt;
    task.latestResult = result;
    task.status = 'succeeded';
    task.updatedAt = finishedAt;
    return cloneTask(task);
  } catch (error: any) {
    const failedAt = nowIso();
    task.lastError = error?.message || '选址任务执行失败';
    task.lastRunAt = failedAt;
    task.latestResult = null;
    task.status = 'failed';
    task.updatedAt = failedAt;
    return cloneTask(task);
  }
}

export function enqueueSiteSelectionTask(taskId: string) {
  const task = taskStore.find((item) => item.id === taskId);
  if (!task) {
    throw new Error('选址任务不存在');
  }

  if (activeRuns.has(taskId)) {
    return cloneTask(task);
  }

  task.status = 'pending';
  task.updatedAt = nowIso();
  task.lastError = '';

  activeRuns.add(taskId);

  setTimeout(() => {
    void executeSiteSelectionTask(taskId).finally(() => {
      activeRuns.delete(taskId);
    });
  }, 0);

  return cloneTask(task);
}
