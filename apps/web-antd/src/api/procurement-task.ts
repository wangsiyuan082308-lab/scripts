export interface ProcurementTask {
  taskId: string;
  platform: 'Aoxiang' | 'Qianniuhua';
  supplierIds: string[];
  supplierName?: string;
  status: 'Pending' | 'InProgress' | 'Completed' | 'Failed';
  scheduleType: 'Instant' | 'Weekly';
  schedule?: string; // e.g. "Weekly Wed" or "Instant"
  weekDay?: string; // 'Mon', 'Tue', etc.
  lastRunTime?: string;
  storeIds?: string[];
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

export async function getProcurementTaskList(params: any) {
  return invokeIpc<ProcurementTask[]>('get-tasks', params);
}

export async function addProcurementTask(data: ProcurementTask) {
  return invokeIpc('add-task', data);
}

export async function updateProcurementTask(data: ProcurementTask) {
  return invokeIpc('update-task', data);
}

export async function deleteProcurementTask(id: string) {
  return invokeIpc('delete-task', { taskId: id });
}
