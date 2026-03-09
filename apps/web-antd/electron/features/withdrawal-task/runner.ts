import { executeWithdrawalSession } from './automation';

export type WithdrawalTaskType = 'eleme_withdrawal';
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
export type WithdrawalTaskResultStatus = 'success' | 'failed';

export interface WithdrawalTaskResult {
  executedAt: string;
  message: string;
  status: WithdrawalTaskResultStatus;
  storeId: string;
  storeName: string;
  withdrawAmount?: number;
}

export interface WithdrawalTask {
  id: string;
  taskId: string;
  taskType: WithdrawalTaskType;
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
  merchantId?: string;
}

export interface WithdrawalExecutionResult {
  failedCount: number;
  finishedAt: string;
  lastRunAt: string;
  results: WithdrawalTaskResult[];
  status: WithdrawalTaskStatus;
  successCount: number;
  summary: string;
}

function toDate(input?: Date | string) {
  if (!input) return new Date();
  return input instanceof Date ? input : new Date(input);
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

export function formatScheduleTime(value?: string) {
  if (!value) return undefined;
  const matched = value.match(/^(\d{1,2}):(\d{2})/);
  if (!matched) return undefined;
  const hour = Number(matched[1]);
  const minute = Number(matched[2]);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return undefined;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined;
  return `${pad(hour)}:${pad(minute)}`;
}

export function computeNextRunAt(scheduleTime?: string, from?: Date | string) {
  const normalized = formatScheduleTime(scheduleTime);
  if (!normalized) return undefined;

  const [hour, minute] = normalized.split(':').map(Number);
  const base = toDate(from);
  const next = new Date(base);
  next.setSeconds(0, 0);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= base.getTime()) {
    next.setDate(next.getDate() + 1);
  }
  return next.toISOString();
}

export const WithdrawalTaskRunner = {
  async executeTask(task: WithdrawalTask): Promise<WithdrawalExecutionResult> {
    return executeWithdrawalSession(task);
  },
};

