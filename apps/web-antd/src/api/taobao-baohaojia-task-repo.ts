export type TaobaoBaohaojiaTaskStatus =
  | 'draft'
  | 'failed'
  | 'partial_success'
  | 'queued'
  | 'review_rejected'
  | 'running'
  | 'succeeded'
  | 'waiting_review';

export type TaobaoBaohaojiaRunStatus =
  | 'failed'
  | 'partial_success'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'waiting_review';

export type TaobaoBaohaojiaActivityStatus =
  | 'failed'
  | 'partial_success'
  | 'running'
  | 'succeeded'
  | 'waiting_review';

export type TaobaoBaohaojiaTaskFileKind = 'audit' | 'exported' | 'source' | 'upload';
export type TaobaoBaohaojiaSignupMode = 'all' | 'repeat_only' | 'unsigned_only';

export interface TaobaoBaohaojiaTaskItem {
  activityPrice: null | number;
  cartonProcurementCost?: null | number;
  cartonSize?: string;
  id: string;
  isPackage: string;
  packageCount: string;
  price?: '' | null | number;
  procurementCost: null | number;
  productName: string;
  reason?: string;
  reasons?: string[];
  stock?: number;
  upc: string;
}

export interface TaobaoBaohaojiaTaskMetrics {
  excludedCount: number;
  invalidPriceCount: number;
  notFoundCount: number;
  qualifiedCount: number;
  reviewCount: number;
  totalCount: number;
  zeroCostCount: number;
}

export interface TaobaoBaohaojiaTaskFileRecord {
  activityId?: string;
  createdAt?: string;
  downloadUrl?: string;
  fileBase64?: string;
  fileId?: string;
  fileName: string;
  fileSize?: number;
  kind: TaobaoBaohaojiaTaskFileKind;
  localPath?: string;
  mimeType?: string;
  updatedAt?: string;
}

export interface TaobaoBaohaojiaTaskActivityResult {
  activityId: string;
  activityName: string;
  analysisMetrics?: TaobaoBaohaojiaTaskMetrics;
  auditFile?: TaobaoBaohaojiaTaskFileRecord;
  errorMessage?: string;
  exportedFile?: TaobaoBaohaojiaTaskFileRecord;
  exportedRowCount?: number;
  exportTaskId?: string;
  detailRoute?: string;
  message: string;
  qualifiedItems?: TaobaoBaohaojiaTaskItem[];
  reviewItems?: TaobaoBaohaojiaTaskItem[];
  screenshots?: string[];
  sourceTab?: '已报名活动' | '未报名活动';
  status: TaobaoBaohaojiaActivityStatus;
  storeCount?: number;
  storeIds?: string[];
  storeNames?: string[];
  uploadFile?: TaobaoBaohaojiaTaskFileRecord;
  uploadedRowCount?: number;
  excludedItems?: TaobaoBaohaojiaTaskItem[];
}

export interface TaobaoBaohaojiaTaskRunLog {
  action: string;
  context?: Record<string, any>;
  createdAt: string;
  id: string;
  level: 'error' | 'info' | 'warning';
  message: string;
  runId: string;
  stage: string;
}

export interface TaobaoBaohaojiaTaskRun {
  activityResults?: TaobaoBaohaojiaTaskActivityResult[];
  createdAt: string;
  currentStage: string;
  failureReason?: string;
  finishedAt?: string;
  id: string;
  logs?: TaobaoBaohaojiaTaskRunLog[];
  outputSummary?: Record<string, any>;
  startedAt?: string;
  status: TaobaoBaohaojiaRunStatus;
  taskId: string;
  triggerSource?: string;
  updatedAt: string;
}

export interface TaobaoBaohaojiaTaskRecord {
  activityCount?: number;
  actualStoreCount?: number;
  actualStoreIds?: string[];
  actualStoreNames?: string[];
  createdAt: string;
  createdBy?: string;
  failedActivityCount?: number;
  id: string;
  initialStock: number;
  lastRunAt?: string;
  latestRunId?: string;
  latestRunStatus?: TaobaoBaohaojiaRunStatus;
  metrics?: TaobaoBaohaojiaTaskMetrics;
  partialActivityCount?: number;
  requiresManualReview?: boolean;
  signupMode?: TaobaoBaohaojiaSignupMode;
  successActivityCount?: number;
  status: TaobaoBaohaojiaTaskStatus;
  summaryText?: string;
  taskName: string;
  updatedAt: string;
}

export interface TaobaoBaohaojiaTaskDetailRecord {
  activityResults?: TaobaoBaohaojiaTaskActivityResult[];
  auditFile?: TaobaoBaohaojiaTaskFileRecord;
  excludedItems?: TaobaoBaohaojiaTaskItem[];
  files?: TaobaoBaohaojiaTaskFileRecord[];
  id: string;
  latestRun?: TaobaoBaohaojiaTaskRun;
  qualifiedItems?: TaobaoBaohaojiaTaskItem[];
  recentLogs?: TaobaoBaohaojiaTaskRunLog[];
  reviewItems?: TaobaoBaohaojiaTaskItem[];
  taskId: string;
  uploadFile?: TaobaoBaohaojiaTaskFileRecord;
}
