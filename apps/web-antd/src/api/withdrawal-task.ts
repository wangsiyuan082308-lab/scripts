export type WithdrawalStoreStatus = 'failed' | 'success';
export type WithdrawalTaskStatus = 'failed' | 'partial_success' | 'success';

export interface WithdrawalTask {
  clientRequestId?: string;
  createdAt?: string;
  failedCount?: number;
  id: string;
  lastRunAt?: string;
  results?: WithdrawalTaskResult[];
  status?: string | WithdrawalTaskStatus;
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

const WITHDRAWAL_HANDLER_MISSING =
  "No handler registered for 'execute-withdrawal-task'";

function normalizeWithdrawalInvokeError(error: unknown) {
  const message =
    error instanceof Error ? error.message : String(error ?? '未知 IPC 错误');

  if (message.includes(WITHDRAWAL_HANDLER_MISSING)) {
    return new Error(
      '当前桌面端主进程版本过旧，尚未注册提现任务处理器。请先重启桌面端；如果你在本地开发，请重新执行 `pnpm dev:antd:electron` 或重新构建 Electron 应用后再试。',
    );
  }

  return error instanceof Error ? error : new Error(message);
}

async function invokeIpc<T>(channel: string, ...args: any[]): Promise<T> {
  let result: unknown;
  try {
    result = await window.ipcRenderer.invoke(channel, ...args);
  } catch (error) {
    throw normalizeWithdrawalInvokeError(error);
  }
  if (
    result &&
    typeof result === 'object' &&
    'code' in result &&
    'data' in result
  ) {
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

export function onWithdrawalLog(
  listener: (payload: WithdrawalLogEvent) => void,
) {
  return window.ipcRenderer.on('withdrawal-log', listener);
}
