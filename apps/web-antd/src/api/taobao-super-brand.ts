import type {
  TaobaoSuperBrandTaskDetailRecord,
  TaobaoSuperBrandTaskRecord,
  TaobaoSuperBrandTaskRun,
  TaobaoSuperBrandTaskRunLog,
} from './taobao-super-brand-task-repo';

import { normalizeTaobaoMarketingTaskLike } from '#/features/taobao-marketing-tag/config';

import { requestClient } from './request';

function hasElectronIpc() {
  return typeof window !== 'undefined' && !!window.ipcRenderer?.invoke;
}

function isLocalTaskId(taskId: string) {
  return taskId.startsWith('local_super_brand_task_');
}

function isLocalRunId(runId: string) {
  return runId.startsWith('local_super_brand_run_');
}

function mergeTaskRecord(
  base: TaobaoSuperBrandTaskRecord,
  overlay?: TaobaoSuperBrandTaskRecord,
): TaobaoSuperBrandTaskRecord {
  if (!overlay) return normalizeTaobaoMarketingTaskLike(base);
  return normalizeTaobaoMarketingTaskLike({
    ...base,
    activityCount: overlay.activityCount || base.activityCount,
    actualStoreCount: overlay.actualStoreCount || base.actualStoreCount,
    actualStoreIds: overlay.actualStoreIds?.length
      ? overlay.actualStoreIds
      : base.actualStoreIds,
    actualStoreNames: overlay.actualStoreNames?.length
      ? overlay.actualStoreNames
      : base.actualStoreNames,
    entryScope: overlay.entryScope || base.entryScope,
    failedActivityCount: overlay.failedActivityCount || base.failedActivityCount,
    lastRunAt: overlay.lastRunAt || base.lastRunAt,
    latestRunId: overlay.latestRunId || base.latestRunId,
    latestRunStatus: overlay.latestRunStatus || base.latestRunStatus,
    marketingTag: overlay.marketingTag || base.marketingTag,
    partialActivityCount: overlay.partialActivityCount || base.partialActivityCount,
    status: overlay.status || base.status,
    successActivityCount: overlay.successActivityCount || base.successActivityCount,
    summaryText: overlay.summaryText || base.summaryText,
    taskName: overlay.taskName || base.taskName,
    updatedAt:
      overlay.updatedAt && overlay.updatedAt > base.updatedAt
        ? overlay.updatedAt
        : base.updatedAt,
  });
}

function mergeTaskDetail(
  remote: {
    detail: TaobaoSuperBrandTaskDetailRecord;
    task: TaobaoSuperBrandTaskRecord;
  },
  local?: {
    detail: TaobaoSuperBrandTaskDetailRecord;
    task: TaobaoSuperBrandTaskRecord;
  },
) {
  if (!local) return remote;
  return {
    detail: {
      ...remote.detail,
      activityResults:
        local.detail.activityResults?.length
          ? local.detail.activityResults
          : remote.detail.activityResults,
      latestRun: local.detail.latestRun || remote.detail.latestRun,
      recentLogs:
        local.detail.recentLogs?.length
          ? local.detail.recentLogs
          : remote.detail.recentLogs,
    },
    task: mergeTaskRecord(remote.task, local.task),
  };
}

function normalizeTaskPayload<T extends { entryScope?: 'brand_activity' | 'unsigned_activity'; marketingTag?: string }>(
  payload: T,
) {
  return normalizeTaobaoMarketingTaskLike(payload);
}

export async function getTaobaoSuperBrandTasks(params: Record<string, any> = {}) {
  const localItems = hasElectronIpc()
    ? ((await window.ipcRenderer.invoke(
        'list-taobao-super-brand-local-tasks',
      )) as TaobaoSuperBrandTaskRecord[])
    : [];

  if (hasElectronIpc()) {
    return {
      items: localItems.map((item) => normalizeTaobaoMarketingTaskLike(item)),
      total: localItems.length,
    };
  }

  try {
    const remote = await requestClient.get<{
      items: TaobaoSuperBrandTaskRecord[];
      total: number;
    }>('/operation/taobao/super-brand/tasks', { params });
    const normalizedLocalItems = localItems.map((item) =>
      normalizeTaobaoMarketingTaskLike(item),
    );
    const localMap = new Map(normalizedLocalItems.map((item) => [item.id, item]));
    const mergedRemote = (remote.items || []).map((item) =>
      mergeTaskRecord(item, localMap.get(item.id)),
    );
    const standaloneLocal = normalizedLocalItems.filter(
      (item) => !(remote.items || []).some((remoteItem) => remoteItem.id === item.id),
    );
    const items = [...mergedRemote, ...standaloneLocal].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
    return { items, total: items.length };
  } catch {
    return {
      items: localItems.map((item) => normalizeTaobaoMarketingTaskLike(item)),
      total: localItems.length,
    };
  }
}

export async function getTaobaoSuperBrandTaskDetail(taskId: string) {
  if (hasElectronIpc() && isLocalTaskId(taskId)) {
    return (await window.ipcRenderer.invoke(
      'get-taobao-super-brand-local-task-detail',
      taskId,
    )) as {
      detail: TaobaoSuperBrandTaskDetailRecord;
      task: TaobaoSuperBrandTaskRecord;
    };
  }

  const remote = await requestClient.get<{
    detail: TaobaoSuperBrandTaskDetailRecord;
    task: TaobaoSuperBrandTaskRecord;
  }>(`/operation/taobao/super-brand/tasks/${taskId}`);

  if (!hasElectronIpc()) {
    return remote;
  }

  const localItems = (await window.ipcRenderer.invoke(
    'list-taobao-super-brand-local-tasks',
  )) as TaobaoSuperBrandTaskRecord[];
  if (!localItems.some((item) => item.id === taskId)) {
    return remote;
  }

  const local = (await window.ipcRenderer.invoke(
    'get-taobao-super-brand-local-task-detail',
    taskId,
  )) as {
    detail: TaobaoSuperBrandTaskDetailRecord;
    task: TaobaoSuperBrandTaskRecord;
  };
  return mergeTaskDetail(remote, {
    ...local,
    task: normalizeTaobaoMarketingTaskLike(local.task),
  });
}

export async function createTaobaoSuperBrandTask(payload: {
  entryScope?: 'brand_activity' | 'unsigned_activity';
  marketingTag?: string;
  taskName?: string;
}) {
  const normalizedPayload = normalizeTaskPayload(payload);
  if (hasElectronIpc()) {
    return (await window.ipcRenderer.invoke(
      'create-taobao-super-brand-local-task',
      normalizedPayload,
    )) as {
      detail?: TaobaoSuperBrandTaskDetailRecord;
      task: TaobaoSuperBrandTaskRecord;
    };
  }
  return requestClient.post<{
    detail?: TaobaoSuperBrandTaskDetailRecord;
    task: TaobaoSuperBrandTaskRecord;
  }>('/operation/taobao/super-brand/tasks', normalizedPayload);
}

export async function executeTaobaoSuperBrandTask(
  task: Record<string, any>,
  payload: Record<string, any> = {},
) {
  const normalizedTask = normalizeTaskPayload({
    entryScope: task.entryScope,
    marketingTag: task.marketingTag,
  });
  const taskId = `${task.id || task.taskId || ''}`.trim();
  if (hasElectronIpc()) {
    await window.ipcRenderer.invoke('create-taobao-super-brand-local-task', {
      createdAt: task.createdAt,
      entryScope: normalizedTask.entryScope,
      id: taskId,
      marketingTag: normalizedTask.marketingTag,
      taskName: task.taskName,
      updatedAt: task.updatedAt,
    });
    return (await window.ipcRenderer.invoke('create-taobao-super-brand-local-run', {
      taskId,
      triggerSource: payload.triggerSource || 'ui',
    })) as TaobaoSuperBrandTaskRun;
  }
  return requestClient.post<TaobaoSuperBrandTaskRun>(
    `/operation/taobao/super-brand/tasks/${taskId}/execute`,
    {
      ...payload,
      entryScope: normalizedTask.entryScope,
      marketingTag: normalizedTask.marketingTag,
    },
  );
}

export async function getTaobaoSuperBrandTaskRuns(taskId: string) {
  if (hasElectronIpc()) {
    const local = (await window.ipcRenderer.invoke(
      'list-taobao-super-brand-local-runs',
      taskId,
    )) as { items: TaobaoSuperBrandTaskRun[]; total: number };
    if (isLocalTaskId(taskId)) return local;

    try {
      const remote = await requestClient.get<{
        items: TaobaoSuperBrandTaskRun[];
        total: number;
      }>(`/operation/taobao/super-brand/tasks/${taskId}/runs`);
      return {
        items: [...local.items, ...(remote.items || [])].sort((left, right) =>
          right.updatedAt.localeCompare(left.updatedAt),
        ),
        total: local.total + (remote.total || 0),
      };
    } catch {
      return local;
    }
  }

  return requestClient.get<{ items: TaobaoSuperBrandTaskRun[]; total: number }>(
    `/operation/taobao/super-brand/tasks/${taskId}/runs`,
  );
}

export async function getTaobaoSuperBrandTaskRunLogs(runId: string) {
  if (hasElectronIpc() && isLocalRunId(runId)) {
    return (await window.ipcRenderer.invoke(
      'list-taobao-super-brand-local-run-logs',
      runId,
    )) as { items: TaobaoSuperBrandTaskRunLog[]; total: number };
  }
  return requestClient.get<{ items: TaobaoSuperBrandTaskRunLog[]; total: number }>(
    `/operation/taobao/super-brand/runs/${runId}/logs`,
  );
}

export async function deleteTaobaoSuperBrandTask(taskId: string) {
  if (hasElectronIpc() && isLocalTaskId(taskId)) {
    return (await window.ipcRenderer.invoke(
      'delete-taobao-super-brand-local-task',
      taskId,
    )) as boolean;
  }
  return requestClient.delete<boolean>(`/operation/taobao/super-brand/tasks/${taskId}`);
}
