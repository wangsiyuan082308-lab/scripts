import { requestClient } from './request';

export type ProcurementPlatform = 'Aoxiang' | 'Qianniuhua';
export type ProcurementScheduleType = 'Instant' | 'Weekly';
export type ProcurementTaskStatus =
  | 'cancelled'
  | 'closed'
  | 'draft'
  | 'failed'
  | 'partial_success'
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'waiting_retry';

export type ProcurementRunStatus =
  | 'cancelled'
  | 'failed'
  | 'partial_success'
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'waiting_retry';

export interface ProcurementTag {
  color: string;
  createdAt: string;
  description: string;
  id: string;
  status: string;
  tagCode: string;
  tagName: string;
  updatedAt: string;
}

export interface ProcurementTask {
  alertCount: number;
  autoRetryEnabled: boolean;
  createdAt: string;
  createdBy: string;
  id: string;
  lastRunAt?: string;
  latestRunId?: string;
  latestRunStatus?: string;
  maxItems: number;
  platform: ProcurementPlatform;
  reminderStrategy: Record<string, any>;
  ruleSetId?: null | string;
  scheduleType: ProcurementScheduleType;
  status: ProcurementTaskStatus;
  storeIds: string[];
  storeNames: string[];
  supplierIds: string[];
  supplierNames: string[];
  tagIds: string[];
  tagNames: string[];
  taskName: string;
  updatedAt: string;
  weekDay?: string;
}

export interface ProcurementRunLog {
  action: string;
  context: Record<string, any>;
  createdAt: string;
  id: string;
  level: string;
  message: string;
  runId: string;
  stage: string;
}

export interface ProcurementRun {
  attemptNo: number;
  createdAt: string;
  currentStage: string;
  failureReason?: string;
  finishedAt?: string;
  id: string;
  inputSnapshot: Record<string, any>;
  logs?: ProcurementRunLog[];
  outputSummary: Record<string, any>;
  platform: ProcurementPlatform;
  reportId?: string;
  startedAt?: string;
  status: ProcurementRunStatus;
  taskId: string;
  triggerSource: string;
  updatedAt: string;
}

export interface ProcurementReport {
  createdAt: string;
  failedCount: number;
  id: string;
  itemCount: number;
  noStockCount: number;
  notifyStatus: string;
  orderCount: number;
  platform: ProcurementPlatform;
  report: Record<string, any>;
  runId: string;
  storeCount: number;
  successCount: number;
  supplierName: string;
  totalAmount: number;
  updatedAt: string;
}

export interface ProcurementAlertRule {
  alertType: string;
  channels: string[];
  createdAt: string;
  id: string;
  name: string;
  platform: string;
  sourceType: string;
  status: string;
  storeIds: string[];
  supplierIds: string[];
  tagIds: string[];
  triggerCondition: Record<string, any>;
  updatedAt: string;
}

export interface ProcurementAlertEvent {
  alertRuleId?: string;
  alertType: string;
  createdAt: string;
  id: string;
  payloadSummary: string;
  platform: string;
  relatedRunId?: string;
  relatedTaskId?: string;
  sentAt?: string;
  sourceType: string;
  status: string;
  storeIds: string[];
  supplierIds: string[];
  tagIds: string[];
}

export interface ProcurementAlertDelivery {
  channel: string;
  createdAt: string;
  eventId: string;
  failureReason?: string;
  id: string;
  payloadSummary: string;
  sentAt?: string;
  status: string;
}

export interface ProcurementOverviewResponse {
  alertSummary: {
    pending: number;
    sent: number;
    total: number;
  };
  latestAlerts: ProcurementAlertEvent[];
  latestReports: ProcurementReport[];
  latestRuns: ProcurementRun[];
  summary: {
    completedTasks: number;
    failedTasks: number;
    pendingTasks: number;
    runningTasks: number;
    totalReports: number;
    totalTasks: number;
    waitingRetryTasks: number;
  };
}

export interface ProcurementWorkbenchResponse {
  latestReports: ProcurementReport[];
  latestRuns: ProcurementRun[];
  stages: Array<{ count: number; key: string; label: string }>;
  stores: Array<{ label: string; value: string }>;
  suppliers: Array<{ label: string; value: string }>;
  tags: Array<{ color: string; label: string; value: string }>;
}

export interface ProcurementConfigResponse {
  executionHost?: string;
  platforms?: string[];
  reminderDefaults?: {
    channelTargets?: Record<string, string>;
    channels?: string[];
    enabled?: boolean;
  } & Record<string, any>;
  ruleSets?: Array<{
    id: string;
    name: string;
    platform: string;
    rulePayload: Record<string, any>;
    status: string;
    updatedAt: string;
  }>;
  workbench?: Record<string, any>;
}

export async function getProcurementOverview() {
  return requestClient.get<ProcurementOverviewResponse>('/procurement/overview');
}

export async function getProcurementWorkbench() {
  return requestClient.get<ProcurementWorkbenchResponse>('/procurement/workbench');
}

export async function getProcurementTags() {
  return requestClient.get<ProcurementTag[]>('/procurement/tags');
}

export async function createProcurementTag(data: Partial<ProcurementTag>) {
  return requestClient.post<ProcurementTag>('/procurement/tags', data);
}

export async function updateProcurementTag(id: string, data: Partial<ProcurementTag>) {
  return requestClient.put<ProcurementTag>(`/procurement/tags/${id}`, data);
}

export async function deleteProcurementTag(id: string) {
  return requestClient.delete<boolean>(`/procurement/tags/${id}`);
}

export async function getProcurementTasks(params: Record<string, any> = {}) {
  return requestClient.get<{ items: ProcurementTask[]; total: number }>(
    '/procurement/tasks',
    { params },
  );
}

export async function getProcurementTaskDetail(taskId: string) {
  return requestClient.get<any>(`/procurement/tasks/${taskId}`);
}

export async function createProcurementTask(data: Record<string, any>) {
  return requestClient.post<any>('/procurement/tasks', data);
}

export async function updateProcurementTask(id: string, data: Record<string, any>) {
  return requestClient.put<any>(`/procurement/tasks/${id}`, data);
}

export async function deleteProcurementTask(id: string) {
  return requestClient.delete<boolean>(`/procurement/tasks/${id}`);
}

export async function executeProcurementTask(taskId: string, data: Record<string, any> = {}) {
  return requestClient.post<ProcurementRun>(`/procurement/tasks/${taskId}/execute`, data);
}

export async function getProcurementTaskRuns(taskId: string) {
  return requestClient.get<{ items: ProcurementRun[]; total: number }>(
    `/procurement/tasks/${taskId}/runs`,
  );
}

export async function getProcurementRun(runId: string) {
  return requestClient.get<ProcurementRun>(`/procurement/runs/${runId}`);
}

export async function getProcurementRunLogs(runId: string) {
  return requestClient.get<{ items: ProcurementRunLog[]; total: number }>(
    `/procurement/runs/${runId}/logs`,
  );
}

export async function cancelProcurementRun(runId: string) {
  return requestClient.post<ProcurementRun>(`/procurement/runs/${runId}/cancel`);
}

export async function getProcurementReports(params: Record<string, any> = {}) {
  return requestClient.get<{
    items: ProcurementReport[];
    summary: Record<string, any>;
    total: number;
  }>('/procurement/reports', { params });
}

export async function getProcurementReportDetail(reportId: string) {
  return requestClient.get<ProcurementReport>(`/procurement/reports/${reportId}`);
}

export async function getProcurementConfig() {
  return requestClient.get<ProcurementConfigResponse>('/procurement/config');
}

export async function saveProcurementConfig(data: Record<string, any>) {
  return requestClient.put<ProcurementConfigResponse>('/procurement/config', data);
}

export async function getProcurementAlertRules(params: Record<string, any> = {}) {
  return requestClient.get<{ items: ProcurementAlertRule[]; total: number }>(
    '/procurement/alerts/rules',
    { params },
  );
}

export async function createProcurementAlertRule(data: Record<string, any>) {
  return requestClient.post<ProcurementAlertRule>('/procurement/alerts/rules', data);
}

export async function updateProcurementAlertRule(id: string, data: Record<string, any>) {
  return requestClient.put<ProcurementAlertRule>(`/procurement/alerts/rules/${id}`, data);
}

export async function deleteProcurementAlertRule(id: string) {
  return requestClient.delete<boolean>(`/procurement/alerts/rules/${id}`);
}

export async function getProcurementAlertEvents(params: Record<string, any> = {}) {
  return requestClient.get<{ items: ProcurementAlertEvent[]; total: number }>(
    '/procurement/alerts/events',
    { params },
  );
}

export async function getProcurementAlertDeliveries() {
  return requestClient.get<{ items: ProcurementAlertDelivery[]; total: number }>(
    '/procurement/alerts/deliveries',
  );
}
