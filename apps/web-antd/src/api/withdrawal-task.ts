export type WithdrawalStoreStatus = 'failed' | 'success';
export type WithdrawalTaskStatus = 'failed' | 'partial_success' | 'success';

export interface WithdrawalTask {
  clientRequestId?: string;
  createdAt?: string;
  failedCount?: number;
  id: string;
  lastRunAt?: string;
  results?: WithdrawalTaskResult[];
  status?: WithdrawalTaskStatus | string;
  storeCount?: number;
  storeIds: string[];
  storeNames: string[];
  successCount?: number;
  summary?: string;
  taskId?: string;
  taskType?: string;
  triggerMode?: string;
  updatedAt?: string;
}

export interface WithdrawalTaskResult {
  executedAt: string;
  message: string;
  status: WithdrawalStoreStatus;
  storeId: string;
  storeName: string;
  withdrawAmount?: number;
}

export interface WithdrawalExecutionResult {
  failedCount: number;
  finishedAt: string;
  lastRunAt: string;
  results: WithdrawalTaskResult[];
  runId?: string;
  startedAt: string;
  status: WithdrawalTaskStatus;
  successCount: number;
  summary: string;
}

export interface WithdrawalLogEntry {
  code?: string;
  level: 'DEBUG' | 'ERROR' | 'INFO' | 'WARN' | string;
  message: string;
  module: string;
  reason?: string;
  retryable?: boolean;
  stage?: string;
  store?: string;
  timestamp: string;
}

export interface WithdrawalLogEvent {
  entry: WithdrawalLogEntry;
  runId: string;
}

async function invokeIpc<T>(channel: string, ...args: any[]): Promise<T> {
  const result = await window.ipcRenderer.invoke(channel, ...args);
  if (result && typeof result === 'object' && 'code' in result && 'data' in result) {
    if ((result as any).code === 0) {
      return (result as any).data;
    }
    throw new Error((result as any).message || 'IPC Operation Failed');
  }
  return result as T;
}

export async function executeWithdrawalTask(task: WithdrawalTask) {
  return invokeIpc<WithdrawalExecutionResult>('execute-withdrawal-task', task);
}

export function onWithdrawalLog(listener: (payload: WithdrawalLogEvent) => void) {
  return window.ipcRenderer.on('withdrawal-log', listener);
}
