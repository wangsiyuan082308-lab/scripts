import type { TaobaoMarketingEntryScope } from '#/features/taobao-marketing-tag/config';

export type TaobaoSuperBrandTaskStatus =
  | 'draft'
  | 'failed'
  | 'partial_success'
  | 'queued'
  | 'running'
  | 'succeeded';

export type TaobaoSuperBrandRunStatus =
  | 'failed'
  | 'partial_success'
  | 'queued'
  | 'running'
  | 'succeeded';

export type TaobaoSuperBrandActivityStatus = 'failed' | 'partial_success' | 'succeeded';

export interface TaobaoSuperBrandTaskActivityResult {
  activityId: string;
  activityName: string;
  detailRoute?: string;
  marketingTag?: string;
  merchantRatio?: number;
  message: string;
  screenshot?: string;
  sourceTab?: '品牌活动' | '已报名活动' | '未报名活动';
  status: TaobaoSuperBrandActivityStatus;
  storeCount?: number;
  storeIds?: string[];
  storeNames?: string[];
}

export interface TaobaoSuperBrandTaskRunLog {
  action: string;
  context?: Record<string, any>;
  createdAt: string;
  id: string;
  level: 'error' | 'info' | 'warning';
  message: string;
  runId: string;
  stage: string;
}

export interface TaobaoSuperBrandTaskRun {
  activityResults?: TaobaoSuperBrandTaskActivityResult[];
  createdAt: string;
  currentStage: string;
  failureReason?: string;
  finishedAt?: string;
  id: string;
  logs?: TaobaoSuperBrandTaskRunLog[];
  outputSummary?: Record<string, any>;
  startedAt?: string;
  status: TaobaoSuperBrandRunStatus;
  taskId: string;
  triggerSource?: string;
  updatedAt: string;
}

export interface TaobaoSuperBrandTaskRecord {
  activityCount?: number;
  actualStoreCount?: number;
  actualStoreIds?: string[];
  actualStoreNames?: string[];
  createdAt: string;
  entryScope?: TaobaoMarketingEntryScope;
  failedActivityCount?: number;
  id: string;
  lastRunAt?: string;
  latestRunId?: string;
  latestRunStatus?: TaobaoSuperBrandRunStatus;
  marketingTag?: string;
  partialActivityCount?: number;
  successActivityCount?: number;
  status: TaobaoSuperBrandTaskStatus;
  summaryText?: string;
  taskName: string;
  updatedAt: string;
}

export interface TaobaoSuperBrandTaskDetailRecord {
  activityResults?: TaobaoSuperBrandTaskActivityResult[];
  id: string;
  latestRun?: TaobaoSuperBrandTaskRun;
  recentLogs?: TaobaoSuperBrandTaskRunLog[];
  taskId: string;
}
