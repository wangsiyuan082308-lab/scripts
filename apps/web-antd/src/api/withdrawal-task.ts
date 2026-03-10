export type WithdrawalTriggerMode = 'manual' | 'daily';
export type WithdrawalScheduleFrequency = 'daily' | 'weekly';
export type WithdrawalTaskHistoryTriggerReason = 'auto' | 'manual' | 'recover' | 'retry';
export type WithdrawalTaskStatus =
  | 'draft'
  | 'pending'
  | 'running'
  | 'partial_success'
  | 'success'
  | 'failed'
  | 'paused'
  | 'cancelled'
  | 'deleted';

export interface WithdrawalTaskResult {
  executedAt: string;
  message: string;
  status: 'success' | 'failed';
  storeId: string;
  storeName: string;
  withdrawAmount?: number;
}

export interface WithdrawalTaskHistory {
  failedCount: number;
  finishedAt?: string;
  historyId: string;
  lastRunAt?: string;
  results: WithdrawalTaskResult[];
  startedAt: string;
  status: WithdrawalTaskStatus;
  storeIds: string[];
  storeNames: string[];
  successCount: number;
  summary: string;
  triggerReason: WithdrawalTaskHistoryTriggerReason;
}

export interface WithdrawalTask {
  autoRunAt?: string;
  histories?: WithdrawalTaskHistory[];
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
  scheduleFrequency?: WithdrawalScheduleFrequency;
  scheduleTime?: string;
  scheduleWeekday?: number;
  summary?: string;
  results: WithdrawalTaskResult[];
}

export interface CreateWithdrawalTaskPayload {
  scheduleFrequency?: WithdrawalScheduleFrequency;
  scheduleTime?: string;
  scheduleWeekday?: number;
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
  scheduleFrequency?: WithdrawalScheduleFrequency;
  scheduleTime?: string;
  scheduleWeekday?: number;
  storeIds?: string[];
  storeNames?: string[];
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

export async function getWithdrawalTaskLogs(taskId: string, limit = 200) {
  return invokeIpc<{ list: Array<{
    level: string;
    message: string;
    module: string;
    sessionId?: string;
    store?: string;
    taskId?: string;
    timestamp: string;
  }> }>('get-withdrawal-task-logs', taskId, limit);
}
