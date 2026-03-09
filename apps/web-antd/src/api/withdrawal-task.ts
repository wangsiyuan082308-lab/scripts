export type WithdrawalTriggerMode = 'manual' | 'daily';
export type WithdrawalTaskStatus =
  | 'draft'
  | 'pending'
  | 'running'
  | 'partial_success'
  | 'success'
  | 'failed'
  | 'paused'
  | 'cancelled';

export interface WithdrawalTaskResult {
  executedAt: string;
  message: string;
  status: 'success' | 'failed';
  storeId: string;
  storeName: string;
  withdrawAmount?: number;
}

export interface WithdrawalTask {
  id: string;
  taskId: string;
  taskType: 'eleme_withdrawal';
  triggerMode: WithdrawalTriggerMode;
  status: WithdrawalTaskStatus;
  storeIds: string[];
  storeNames: string[];
  storeCount: number;
  successCount: number;
  failedCount: number;
  createdAt: string;
  updatedAt: string;
  lastRunAt?: string;
  nextRunAt?: string;
  finishedAt?: string;
  scheduleTime?: string;
  summary?: string;
  results: WithdrawalTaskResult[];
}

export interface CreateWithdrawalTaskPayload {
  scheduleTime?: string;
  storeIds: string[];
  storeNames?: string[];
  triggerMode: WithdrawalTriggerMode;
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

export async function getWithdrawalTaskList() {
  return invokeIpc<WithdrawalTask[]>('get-withdrawal-tasks');
}

export async function getWithdrawalTaskDetail(taskId: string) {
  return invokeIpc<WithdrawalTask | null>('get-withdrawal-task-detail', taskId);
}

export async function createWithdrawalTask(data: CreateWithdrawalTaskPayload) {
  return invokeIpc<WithdrawalTask>('add-withdrawal-task', data);
}

export async function updateWithdrawalTask(data: {
  scheduleTime?: string;
  status?: WithdrawalTaskStatus;
  taskId: string;
}) {
  return invokeIpc<WithdrawalTask>('update-withdrawal-task', data);
}

export async function deleteWithdrawalTask(taskId: string) {
  return invokeIpc<WithdrawalTask[]>('delete-withdrawal-task', taskId);
}

export async function runWithdrawalTask(taskId: string) {
  return invokeIpc<WithdrawalTask>('run-withdrawal-task', taskId);
}

export async function retryWithdrawalTask(taskId: string) {
  return invokeIpc<WithdrawalTask>('retry-withdrawal-task', taskId);
}
