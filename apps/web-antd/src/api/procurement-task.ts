export interface ProcurementTask {
  id: string;
  taskId: string;
  platform: 'Aoxiang' | 'Qianniuhua';
  supplierIds: string[];
  supplierId?: string;
  supplierName?: string;
  status: 'Pending' | 'InProgress' | 'Completed' | 'Failed';
  scheduleType: 'Instant' | 'Weekly';
  schedule?: string; // e.g. "Weekly Wed" or "Instant"
  weekDay?: string; // 'Mon', 'Tue', etc.
  lastRunTime?: string;
  storeIds: string[];
  storeNames?: string[];
  maxItems?: number;
}

async function invokeIpc<T>(channel: string, ...args: any[]): Promise<T> {
  const result = await window.ipcRenderer.invoke(channel, ...args);
  if (result && typeof result === 'object' && 'code' in result && 'data' in result) {
    if (result.code === 0) {
      return result.data;
    }
    throw new Error(result.message || 'IPC Operation Failed');
  }
  return result;
}

function normalizeProcurementTask(task: Partial<ProcurementTask>): ProcurementTask {
  const id = String(task.id ?? task.taskId ?? '');
  const supplierIds = Array.isArray(task.supplierIds)
    ? task.supplierIds.filter(Boolean)
    : task.supplierId
      ? [task.supplierId]
      : [];

  return {
    id,
    taskId: String(task.taskId ?? task.id ?? ''),
    platform: (task.platform ?? 'Qianniuhua') as ProcurementTask['platform'],
    supplierIds,
    supplierId: task.supplierId ?? supplierIds[0],
    supplierName: task.supplierName,
    status: (task.status ?? 'Pending') as ProcurementTask['status'],
    scheduleType: (task.scheduleType ?? 'Instant') as ProcurementTask['scheduleType'],
    schedule: task.schedule,
    weekDay: task.weekDay,
    lastRunTime: task.lastRunTime,
    storeIds: Array.isArray(task.storeIds) ? task.storeIds.filter(Boolean) : [],
    storeNames: Array.isArray(task.storeNames) ? task.storeNames.filter(Boolean) : [],
    maxItems:
      typeof task.maxItems === 'number' && Number.isFinite(task.maxItems)
        ? Math.min(Math.max(Math.floor(task.maxItems), 1), 500)
        : 500,
  };
}

export async function getProcurementTaskList(params: any) {
  const data = await invokeIpc<ProcurementTask[]>('get-tasks', params);
  return Array.isArray(data) ? data.map(normalizeProcurementTask) : [];
}

export async function addProcurementTask(data: ProcurementTask) {
  return invokeIpc('add-task', normalizeProcurementTask(data));
}

export async function updateProcurementTask(data: ProcurementTask) {
  return invokeIpc('update-task', normalizeProcurementTask(data));
}

export async function deleteProcurementTask(id: string) {
  return invokeIpc('delete-task', id);
}
