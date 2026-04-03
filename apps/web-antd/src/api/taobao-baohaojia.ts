import type {
  TaobaoBaohaojiaTaskDetailRecord,
  TaobaoBaohaojiaTaskRecord,
  TaobaoBaohaojiaTaskRun,
  TaobaoBaohaojiaTaskRunLog,
} from './taobao-baohaojia-task-repo';

import { requestClient } from './request';

function hasElectronIpc() {
  return typeof window !== 'undefined' && !!window.ipcRenderer?.invoke;
}

function isLocalTaskId(taskId: string) {
  return taskId.startsWith('local_baohaojia_task_');
}

function isLocalRunId(runId: string) {
  return runId.startsWith('local_baohaojia_run_');
}

function mergeTaskRecord(
  base: TaobaoBaohaojiaTaskRecord,
  overlay?: TaobaoBaohaojiaTaskRecord,
): TaobaoBaohaojiaTaskRecord {
  if (!overlay) return base;
  return {
    ...base,
    activityCount: overlay.activityCount || base.activityCount,
    actualStoreCount: overlay.actualStoreCount || base.actualStoreCount,
    actualStoreIds: overlay.actualStoreIds?.length
      ? overlay.actualStoreIds
      : base.actualStoreIds,
    actualStoreNames: overlay.actualStoreNames?.length
      ? overlay.actualStoreNames
      : base.actualStoreNames,
    failedActivityCount: overlay.failedActivityCount || base.failedActivityCount,
    initialStock: overlay.initialStock || base.initialStock,
    lastRunAt: overlay.lastRunAt || base.lastRunAt,
    latestRunId: overlay.latestRunId || base.latestRunId,
    latestRunStatus: overlay.latestRunStatus || base.latestRunStatus,
    metrics: overlay.metrics || base.metrics,
    partialActivityCount: overlay.partialActivityCount || base.partialActivityCount,
    requiresManualReview:
      overlay.requiresManualReview ?? base.requiresManualReview,
    signupMode: overlay.signupMode || base.signupMode,
    status: overlay.status || base.status,
    successActivityCount: overlay.successActivityCount || base.successActivityCount,
    summaryText: overlay.summaryText || base.summaryText,
    taskName: overlay.taskName || base.taskName,
    updatedAt:
      overlay.updatedAt && overlay.updatedAt > base.updatedAt
        ? overlay.updatedAt
        : base.updatedAt,
  };
}

function mergeTaskDetail(
  remote: {
    detail: TaobaoBaohaojiaTaskDetailRecord;
    task: TaobaoBaohaojiaTaskRecord;
  },
  local?: {
    detail: TaobaoBaohaojiaTaskDetailRecord;
    task: TaobaoBaohaojiaTaskRecord;
  },
) {
  if (!local) return remote;
  return {
    detail: {
      ...remote.detail,
      activityResults:
        local.detail.activityResults?.length ? local.detail.activityResults : remote.detail.activityResults,
      auditFile: local.detail.auditFile || remote.detail.auditFile,
      files: local.detail.files?.length ? local.detail.files : remote.detail.files,
      latestRun: local.detail.latestRun || remote.detail.latestRun,
      recentLogs: local.detail.recentLogs?.length ? local.detail.recentLogs : remote.detail.recentLogs,
      uploadFile: local.detail.uploadFile || remote.detail.uploadFile,
    },
    task: mergeTaskRecord(remote.task, local.task),
  };
}

export async function getTaobaoBaohaojiaTasks(params: Record<string, any> = {}) {
  const localItems = hasElectronIpc()
    ? ((await window.ipcRenderer.invoke('list-taobao-baohaojia-local-tasks')) as TaobaoBaohaojiaTaskRecord[])
    : [];
  try {
    const remote = await requestClient.get<{ items: TaobaoBaohaojiaTaskRecord[]; total: number }>(
      '/operation/taobao/baohaojia/tasks',
      { params },
    );
    const localMap = new Map(localItems.map((item) => [item.id, item]));
    const mergedRemote = (remote.items || []).map((item) =>
      mergeTaskRecord(item, localMap.get(item.id)),
    );
    const standaloneLocal = localItems.filter(
      (item) => !(remote.items || []).some((remoteItem) => remoteItem.id === item.id),
    );
    const items = [...mergedRemote, ...standaloneLocal].sort((left, right) =>
      right.updatedAt.localeCompare(left.updatedAt),
    );
    return { items, total: items.length };
  } catch {
    return {
      items: localItems,
      total: localItems.length,
    };
  }
}

export async function getTaobaoBaohaojiaTaskDetail(taskId: string) {
  if (hasElectronIpc() && isLocalTaskId(taskId)) {
    return (await window.ipcRenderer.invoke(
      'get-taobao-baohaojia-local-task-detail',
      taskId,
    )) as {
      detail: TaobaoBaohaojiaTaskDetailRecord;
      task: TaobaoBaohaojiaTaskRecord;
    };
  }
  const remote = await requestClient.get<{
    detail: TaobaoBaohaojiaTaskDetailRecord;
    task: TaobaoBaohaojiaTaskRecord;
  }>(`/operation/taobao/baohaojia/tasks/${taskId}`);
  if (!hasElectronIpc()) return remote;
  const localItems = (await window.ipcRenderer.invoke(
    'list-taobao-baohaojia-local-tasks',
  )) as TaobaoBaohaojiaTaskRecord[];
  if (!localItems.some((item) => item.id === taskId)) {
    return remote;
  }
  const local = (await window.ipcRenderer.invoke(
    'get-taobao-baohaojia-local-task-detail',
    taskId,
  )) as {
    detail: TaobaoBaohaojiaTaskDetailRecord;
    task: TaobaoBaohaojiaTaskRecord;
  };
  return mergeTaskDetail(remote, local);
}

export async function createTaobaoBaohaojiaTask(payload: {
  initialStock: number;
  requiresManualReview?: boolean;
  signupMode?: 'all' | 'repeat_only' | 'unsigned_only';
  taskName?: string;
}) {
  if (hasElectronIpc()) {
    return (await window.ipcRenderer.invoke(
      'create-taobao-baohaojia-local-task',
      payload,
    )) as {
      detail?: TaobaoBaohaojiaTaskDetailRecord;
      task: TaobaoBaohaojiaTaskRecord;
    };
  }
  return requestClient.post<{
    detail?: TaobaoBaohaojiaTaskDetailRecord;
    task: TaobaoBaohaojiaTaskRecord;
  }>('/operation/taobao/baohaojia/tasks', payload);
}

export async function updateTaobaoBaohaojiaTask(
  taskId: string,
  payload: {
    initialStock?: number;
    requiresManualReview?: boolean;
    signupMode?: 'all' | 'repeat_only' | 'unsigned_only';
    taskName?: string;
  },
) {
  return requestClient.put<{
    detail?: TaobaoBaohaojiaTaskDetailRecord;
    task: TaobaoBaohaojiaTaskRecord;
  }>(`/operation/taobao/baohaojia/tasks/${taskId}`, payload);
}

export async function executeTaobaoBaohaojiaTask(
  task: Record<string, any>,
  payload: Record<string, any> = {},
) {
  const taskId = `${task.id || task.taskId || ''}`.trim();
  if (hasElectronIpc()) {
    await window.ipcRenderer.invoke('create-taobao-baohaojia-local-task', {
      createdAt: task.createdAt,
      id: taskId,
      initialStock: task.initialStock,
      requiresManualReview: task.requiresManualReview,
      signupMode: task.signupMode,
      taskName: task.taskName,
      updatedAt: task.updatedAt,
    });
    return (await window.ipcRenderer.invoke('create-taobao-baohaojia-local-run', {
      taskId,
      triggerSource: payload.triggerSource || 'ui',
    })) as TaobaoBaohaojiaTaskRun;
  }
  return requestClient.post<TaobaoBaohaojiaTaskRun>(
    `/operation/taobao/baohaojia/tasks/${taskId}/execute`,
    payload,
  );
}

export async function continueTaobaoBaohaojiaTaskReview(task: Record<string, any>) {
  const taskId = `${task.id || task.taskId || ''}`.trim();
  if (hasElectronIpc()) {
    await window.ipcRenderer.invoke('create-taobao-baohaojia-local-task', {
      createdAt: task.createdAt,
      id: taskId,
      initialStock: task.initialStock,
      requiresManualReview: task.requiresManualReview,
      signupMode: task.signupMode,
      taskName: task.taskName,
      updatedAt: task.updatedAt,
    });
    return (await window.ipcRenderer.invoke('create-taobao-baohaojia-local-run', {
      taskId,
      triggerSource: 'manual_review',
    })) as TaobaoBaohaojiaTaskRun;
  }
  return requestClient.post<TaobaoBaohaojiaTaskRun>(
    `/operation/taobao/baohaojia/tasks/${taskId}/continue-review`,
  );
}

export async function getTaobaoBaohaojiaTaskRuns(taskId: string) {
  if (hasElectronIpc()) {
    const local = (await window.ipcRenderer.invoke(
      'list-taobao-baohaojia-local-runs',
      taskId,
    )) as { items: TaobaoBaohaojiaTaskRun[]; total: number };
    if (isLocalTaskId(taskId)) return local;
    try {
      const remote = await requestClient.get<{ items: TaobaoBaohaojiaTaskRun[]; total: number }>(
        `/operation/taobao/baohaojia/tasks/${taskId}/runs`,
      );
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
  return requestClient.get<{ items: TaobaoBaohaojiaTaskRun[]; total: number }>(
    `/operation/taobao/baohaojia/tasks/${taskId}/runs`,
  );
}

export async function getTaobaoBaohaojiaTaskRunLogs(runId: string) {
  if (hasElectronIpc() && isLocalRunId(runId)) {
    return (await window.ipcRenderer.invoke(
      'list-taobao-baohaojia-local-run-logs',
      runId,
    )) as { items: TaobaoBaohaojiaTaskRunLog[]; total: number };
  }
  return requestClient.get<{ items: TaobaoBaohaojiaTaskRunLog[]; total: number }>(
    `/operation/taobao/baohaojia/runs/${runId}/logs`,
  );
}

export async function deleteTaobaoBaohaojiaTask(taskId: string) {
  if (hasElectronIpc() && isLocalTaskId(taskId)) {
    return (await window.ipcRenderer.invoke(
      'delete-taobao-baohaojia-local-task',
      taskId,
    )) as boolean;
  }
  return requestClient.delete<boolean>(`/operation/taobao/baohaojia/tasks/${taskId}`);
}
