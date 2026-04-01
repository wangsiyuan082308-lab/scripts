import {
  createProcurementTask,
  deleteProcurementTask as deleteTaskApi,
  executeProcurementTask,
  getProcurementTaskDetail,
  getProcurementTaskRuns,
  getProcurementTasks,
  type ProcurementRun,
  type ProcurementTask as ProcurementTaskEntity,
  updateProcurementTask as updateTaskApi,
} from './procurement';

export interface ProcurementTask {
  alertCount?: number;
  autoRetryEnabled?: boolean;
  id: string;
  lastRunTime?: string;
  latestRunId?: string;
  latestRunStatus?: string;
  maxItems?: number;
  platform: 'Aoxiang' | 'Qianniuhua';
  ruleSetId?: null | string;
  schedule?: string;
  scheduleType: 'Instant' | 'Weekly';
  status:
    | 'cancelled'
    | 'closed'
    | 'draft'
    | 'failed'
    | 'partial_success'
    | 'pending'
    | 'running'
    | 'succeeded'
    | 'waiting_retry';
  storeIds: string[];
  storeNames?: string[];
  supplierId?: string;
  supplierIds: string[];
  supplierName?: string;
  supplierNames?: string[];
  tagIds?: string[];
  tagNames?: string[];
  taskId: string;
  taskName?: string;
  weekDay?: string;
}

function normalizeTask(task: ProcurementTaskEntity): ProcurementTask {
  return {
    alertCount: task.alertCount,
    autoRetryEnabled: task.autoRetryEnabled,
    id: task.id,
    lastRunTime: task.lastRunAt,
    latestRunId: task.latestRunId,
    latestRunStatus: task.latestRunStatus,
    maxItems: task.maxItems,
    platform: task.platform,
    ruleSetId: task.ruleSetId,
    schedule:
      task.scheduleType === 'Weekly' && task.weekDay
        ? `Weekly ${task.weekDay}`
        : task.scheduleType,
    scheduleType: task.scheduleType,
    status: task.status,
    storeIds: task.storeIds,
    storeNames: task.storeNames,
    supplierId: task.supplierIds[0],
    supplierIds: task.supplierIds,
    supplierName: task.supplierNames[0],
    supplierNames: task.supplierNames,
    tagIds: task.tagIds,
    tagNames: task.tagNames,
    taskId: task.id,
    taskName: task.taskName,
    weekDay: task.weekDay,
  };
}

export async function getProcurementTaskList(params: any) {
  const data = await getProcurementTasks(params?.data ?? params ?? {});
  return Array.isArray(data?.items) ? data.items.map(normalizeTask) : [];
}

export async function addProcurementTask(data: ProcurementTask) {
  return createProcurementTask({
    autoRetryEnabled: data.autoRetryEnabled,
    maxItems: data.maxItems,
    platform: data.platform,
    ruleSetId: data.ruleSetId,
    scheduleType: data.scheduleType,
    status: data.status,
    storeIds: data.storeIds,
    supplierIds: data.supplierIds,
    tagIds: data.tagIds || [],
    taskName: data.taskName || data.supplierName || '采购任务',
    weekDay: data.weekDay,
  });
}

export async function updateProcurementTask(data: ProcurementTask) {
  return updateTaskApi(data.id || data.taskId, {
    autoRetryEnabled: data.autoRetryEnabled,
    maxItems: data.maxItems,
    platform: data.platform,
    ruleSetId: data.ruleSetId,
    scheduleType: data.scheduleType,
    status: data.status,
    storeIds: data.storeIds,
    supplierIds: data.supplierIds,
    tagIds: data.tagIds || [],
    taskName: data.taskName || data.supplierName || '采购任务',
    weekDay: data.weekDay,
  });
}

export async function deleteProcurementTask(id: string) {
  return deleteTaskApi(id);
}

export async function executeTask(id: string) {
  return executeProcurementTask(id, { triggerSource: 'ui' });
}

export async function getTaskDetail(id: string) {
  return getProcurementTaskDetail(id);
}

export async function getTaskRuns(id: string) {
  return getProcurementTaskRuns(id);
}

export type ProcurementTaskRun = ProcurementRun;
