import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

import {
  runBaohaojiaSignup,
  type BaohaojiaAutomationLogEntry,
  type RuntimeOptions as BaohaojiaRuntimeOptions,
} from '../eleme-activity/automation/signup-baohao';
import {
  appendLocalBaohaojiaRunLog,
  isLocalBaohaojiaRunId,
  saveLocalBaohaojiaRunResult,
  updateLocalBaohaojiaRunStatus,
} from './local-task-store';

type BackendRunStatus =
  | 'failed'
  | 'partial_success'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'waiting_review';

type ActivityResultStatus = 'failed' | 'partial_success' | 'succeeded' | 'waiting_review';

export interface TaobaoBaohaojiaTask {
  action?: 'continue_review' | 'execute' | 'rerun_recorded';
  accessToken?: string;
  backendBaseUrl?: string;
  initialStock?: number;
  recordedActivityResults?: Array<{
    activityId: string;
    activityName: string;
    detailRoute?: string;
    sourceTab?: string;
  }>;
  requiresManualReview?: boolean;
  signupMode?: 'all' | 'repeat_only' | 'unsigned_only';
  reviewActivityResults?: Array<{
    activityId: string;
    activityName: string;
    sourceTab?: string;
    uploadFile?: {
      fileBase64?: string;
      fileName: string;
      localPath?: string;
      mimeType?: string;
    };
  }>;
  runId?: string;
  taskId: string;
  taskName?: string;
}

interface BaohaojiaRunLogPayload {
  action: string;
  context?: Record<string, unknown>;
  level?: 'error' | 'info' | 'warning';
  message: string;
  stage: string;
}

interface BaohaojiaRunResultFilePayload {
  fileBase64?: string;
  fileName: string;
  kind: 'audit' | 'exported' | 'upload';
  localPath?: string;
  mimeType: string;
}

interface BaohaojiaActivityResultPayload {
  activityId: string;
  activityName: string;
  auditFile?: BaohaojiaRunResultFilePayload;
  detailRoute?: string;
  exportedFile?: BaohaojiaRunResultFilePayload;
  exportTaskId?: string;
  message: string;
  sourceTab?: string;
  status: ActivityResultStatus;
  storeCount?: number;
  storeIds?: string[];
  storeNames?: string[];
  uploadFile?: BaohaojiaRunResultFilePayload;
}

interface BaohaojiaRunResultPayload {
  activityResults: BaohaojiaActivityResultPayload[];
  outputSummary: Record<string, unknown>;
  status: BackendRunStatus;
}

interface BaohaojiaScriptResult {
  activityId?: string;
  audit?: string;
  detailRoute?: string;
  exported?: string;
  exportTaskId?: string;
  message: string;
  name: string;
  processed?: string;
  sourceTab?: string;
  status?: ActivityResultStatus;
  storeCount?: number;
  storeIds?: string[];
  storeNames?: string[];
  success: boolean;
}

interface BaohaojiaSummaryReport {
  found: number;
  results: BaohaojiaScriptResult[];
  reviewMode?: 'auto' | 'manual';
  signupMode?: 'all' | 'repeat_only' | 'unsigned_only';
  timestamp: string;
}

const DEFAULT_BACKEND_BASE_URL = 'http://120.55.244.232';
const RUNNING_TASKS = new Map<string, Promise<void>>();

function normalizeText(value: unknown) {
  return `${value || ''}`.trim();
}

function stripTrailingSlash(value: string) {
  return value.replace(/\/+$/u, '');
}

function resolveBackendBaseUrl(candidate?: string) {
  const raw = stripTrailingSlash(normalizeText(candidate) || DEFAULT_BACKEND_BASE_URL);
  return raw.endsWith('/api') ? raw.slice(0, -4) : raw;
}

function buildApiUrl(baseUrl: string, pathname: string) {
  return `${stripTrailingSlash(baseUrl)}/api${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getRuntimeBaseDir() {
  const baseDir = path.join(app.getPath('userData'), 'automation', 'eleme-activity');
  ensureDir(baseDir);
  return baseDir;
}

function getReportDir() {
  const reportDir = path.join(getRuntimeBaseDir(), 'data');
  ensureDir(reportDir);
  return reportDir;
}

function safeJsonStringify(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function buildLogMessage(entry: { data?: unknown; msg: string }) {
  const message = normalizeText(entry.msg);
  if (!entry.data) {
    return message;
  }
  return `${message} ${safeJsonStringify(entry.data)}`.trim();
}

function inferStageFromLine(line: string) {
  const normalized = line.toLowerCase();
  if (normalized.includes('scan') || normalized.includes('page')) return 'scan_activities';
  if (normalized.includes('detail') || normalized.includes('signup')) return 'open_activity';
  if (normalized.includes('store')) return 'select_stores';
  if (normalized.includes('export') || normalized.includes('download')) return 'export_activity_file';
  if (normalized.includes('excel') || normalized.includes('transform')) return 'transform_excel';
  if (normalized.includes('upload') || normalized.includes('uploaded')) return 'upload_excel';
  if (normalized.includes('submit') || normalized.includes('success') || normalized.includes('failed')) {
    return 'submit_signup';
  }
  if (normalized.includes('report') || normalized.includes('summary') || normalized.includes('complete')) {
    return 'generate_report';
  }
  return 'desktop_executor';
}

function buildFilePayload(filePath: string, kind: 'audit' | 'exported' | 'upload') {
  if (!filePath || !fs.existsSync(filePath)) {
    return undefined;
  }
  return {
    fileBase64: fs.readFileSync(filePath).toString('base64'),
    fileName: path.basename(filePath),
    kind,
    localPath: filePath,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  } satisfies BaohaojiaRunResultFilePayload;
}

function mapScriptResultStatus(result: BaohaojiaScriptResult): ActivityResultStatus {
  if (result.status === 'waiting_review') return 'waiting_review';
  if (result.status === 'partial_success') return 'partial_success';
  if (result.success) return 'succeeded';
  return result.processed || result.audit ? 'partial_success' : 'failed';
}

function mapSummaryToPayload(summary: BaohaojiaSummaryReport): BaohaojiaRunResultPayload {
  const activityResults = summary.results.map((result, index) => ({
    activityId: result.activityId || `activity_${index + 1}`,
    activityName: result.name,
    auditFile: result.audit ? buildFilePayload(result.audit, 'audit') : undefined,
    detailRoute: result.detailRoute,
    exportedFile: result.exported ? buildFilePayload(result.exported, 'exported') : undefined,
    exportTaskId: result.exportTaskId,
    message: result.message,
    sourceTab: result.sourceTab,
    status: mapScriptResultStatus(result),
    storeCount: result.storeCount,
    storeIds: result.storeIds,
    storeNames: result.storeNames,
    uploadFile: result.processed ? buildFilePayload(result.processed, 'upload') : undefined,
  }));

  const successCount = activityResults.filter((item) => item.status === 'succeeded').length;
  const partialCount = activityResults.filter((item) => item.status === 'partial_success').length;
  const failedCount = activityResults.filter((item) => item.status === 'failed').length;
  const waitingReviewCount = activityResults.filter(
    (item) => item.status === 'waiting_review',
  ).length;
  const actualStoreNames = Array.from(
    new Set(
      activityResults.flatMap((item) => item.storeNames || []).filter((item) => normalizeText(item)),
    ),
  );
  const actualStoreIds = Array.from(
    new Set(
      activityResults.flatMap((item) => item.storeIds || []).filter((item) => normalizeText(item)),
    ),
  );

  const status: BackendRunStatus =
    waitingReviewCount > 0
      ? 'waiting_review'
      : failedCount === 0
        ? 'succeeded'
        : successCount === 0 && partialCount === 0
          ? 'failed'
          : 'partial_success';

  return {
    activityResults,
    outputSummary: {
      actualStoreCount: actualStoreNames.length,
      actualStoreIds,
      actualStoreNames,
      failedCount,
      foundCount: summary.found,
      partialCount,
      reviewMode: summary.reviewMode || 'auto',
      signupMode: summary.signupMode || 'all',
      successCount,
      timestamp: summary.timestamp,
      waitingReviewCount,
    },
    status,
  };
}

function writeReviewManifest(task: TaobaoBaohaojiaTask, reportDir: string) {
  const activities = (task.reviewActivityResults || []).filter(
    (item) => item.uploadFile?.localPath || item.uploadFile?.fileBase64,
  );
  if (activities.length === 0) {
    throw new Error('娌℃湁鍙户缁彁浜ょ殑寰呭鏍告椿鍔ㄣ€?');
  }

  const tempDir = path.join(reportDir, 'review-manifests');
  ensureDir(tempDir);

  const manifestActivities = activities.map((item, index) => {
    let uploadPath = `${item.uploadFile?.localPath || ''}`.trim();
    if (!uploadPath) {
      const fileName = item.uploadFile?.fileName || `${item.activityId || index + 1}_鎶ュ悕.xlsx`;
      uploadPath = path.join(tempDir, `${Date.now()}_${index}_${fileName}`);
      fs.writeFileSync(uploadPath, Buffer.from(item.uploadFile?.fileBase64 || '', 'base64'));
    }
    return {
      activityId: item.activityId,
      activityName: item.activityName,
      sourceTab: item.sourceTab || '鏈姤鍚嶆椿鍔?',
      uploadPath,
    };
  });

  const manifestPath = path.join(tempDir, `manifest_${task.taskId}_${Date.now()}.json`);
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        activities: manifestActivities,
      },
      null,
      2,
    ),
    'utf-8',
  );
  return manifestPath;
}

function writeRecordedActivityManifest(task: TaobaoBaohaojiaTask, reportDir: string) {
  const activities = (task.recordedActivityResults || []).filter(
    (item) => normalizeText(item.activityId || item.activityName),
  );
  if (activities.length === 0) {
    throw new Error('娌℃湁鍙噸璺戠殑鍘嗗彶娲诲姩璁板綍銆?');
  }

  const tempDir = path.join(reportDir, 'review-manifests');
  ensureDir(tempDir);

  const manifestPath = path.join(tempDir, `rerun_${task.taskId}_${Date.now()}.json`);
  fs.writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        activities: activities.map((item) => ({
          activityId: item.activityId,
          activityName: item.activityName,
          detailRoute: item.detailRoute,
          sourceTab: item.sourceTab || '鏈姤鍚嶆椿鍔?',
        })),
      },
      null,
      2,
    ),
    'utf-8',
  );
  return manifestPath;
}

class BaohaojiaBackendClient {
  constructor(
    private readonly accessToken: string,
    private readonly baseUrl: string,
  ) {}

  private isLocalRun(runId: string) {
    return isLocalBaohaojiaRunId(runId) || !normalizeText(this.accessToken);
  }

  private async request(pathname: string, init: RequestInit = {}) {
    const response = await fetch(buildApiUrl(this.baseUrl, pathname), {
      ...init,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });

    const payload = (await response.json().catch(() => null)) as
      | { code?: number; error?: string; message?: string }
      | null;

    if (!response.ok || (payload && payload.code !== 0)) {
      throw new Error(payload?.error || payload?.message || `HTTP ${response.status}`);
    }

    return payload;
  }

  async appendRunLog(runId: string, payload: BaohaojiaRunLogPayload) {
    if (this.isLocalRun(runId)) {
      await appendLocalBaohaojiaRunLog(runId, {
        action: payload.action,
        context: (payload.context || {}) as Record<string, any>,
        level: payload.level || 'info',
        message: payload.message,
        stage: payload.stage,
      });
      return;
    }
    await this.request(`/operation/taobao/baohaojia/runs/${runId}/logs`, {
      body: JSON.stringify(payload),
      method: 'POST',
    });
  }

  async updateRunStatus(
    runId: string,
    payload: {
      currentStage?: string;
      failureReason?: string;
      outputSummary?: Record<string, unknown>;
      status?: BackendRunStatus;
    },
  ) {
    if (this.isLocalRun(runId)) {
      await updateLocalBaohaojiaRunStatus(runId, payload);
      return;
    }
    await this.request(`/operation/taobao/baohaojia/runs/${runId}/status`, {
      body: JSON.stringify(payload),
      method: 'POST',
    });
  }

  async saveRunResult(runId: string, payload: BaohaojiaRunResultPayload) {
    if (this.isLocalRun(runId)) {
      await saveLocalBaohaojiaRunResult(runId, payload);
      return;
    }
    await this.request(`/operation/taobao/baohaojia/runs/${runId}/result`, {
      body: JSON.stringify(payload),
      method: 'POST',
    });
  }
}

async function postFailureAndExit(
  backendClient: BaohaojiaBackendClient,
  task: TaobaoBaohaojiaTask,
  runId: string,
  reason: string,
) {
  await backendClient.appendRunLog(runId, {
    action: 'desktop-executor',
    context: {
      taskId: task.taskId,
    },
    level: 'error',
    message: reason,
    stage: 'desktop_executor',
  });
  await backendClient.updateRunStatus(runId, {
    currentStage: 'desktop_executor',
    failureReason: reason,
    outputSummary: {
      taskName: task.taskName || '',
    },
    status: 'failed',
  });
}

async function waitForTaskCompletion(
  task: TaobaoBaohaojiaTask,
  runId: string,
  backendClient: BaohaojiaBackendClient,
) {
  const runtimeBaseDir = getRuntimeBaseDir();
  const reportDir = getReportDir();
  const reportPath = path.join(
    reportDir,
    `${task.action === 'continue_review' ? 'baohao_review_submit' : 'baohao_signup'}_${Date.now()}.json`,
  );

  let manifestPath = '';
  const runtimeOptions: BaohaojiaRuntimeOptions = {
    continueAction:
      task.action === 'continue_review' || task.action === 'rerun_recorded' ? task.action : undefined,
    initialStock: task.initialStock || 9999,
    onLog: undefined,
    reportPath,
    reviewMode: task.requiresManualReview ? 'manual' : 'auto',
    runtimeBaseDir,
    signupMode: task.signupMode || 'all',
  };

  if (task.action === 'continue_review') {
    manifestPath = writeReviewManifest(task, reportDir);
    runtimeOptions.continueManifestPath = manifestPath;
  } else if (task.action === 'rerun_recorded') {
    manifestPath = writeRecordedActivityManifest(task, reportDir);
    runtimeOptions.continueManifestPath = manifestPath;
  }

  await backendClient.appendRunLog(runId, {
    action: 'desktop-start',
    context: {
      action: task.action || 'execute',
      executionMode: 'in_process',
      requiresManualReview: task.requiresManualReview,
      runtimeBaseDir,
      signupMode: task.signupMode || 'all',
      taskId: task.taskId,
    },
    message:
      task.action === 'continue_review'
        ? '妗岄潰绔紑濮嬬户缁墽琛岀垎濂戒环瀹℃牳閫氳繃浠诲姟銆?'
        : task.action === 'rerun_recorded'
          ? '妗岄潰绔紑濮嬮噸璺戝綋鍓嶄换鍔″凡璁板綍鐨勭垎濂戒环娲诲姩銆?'
          : '妗岄潰绔紑濮嬫帴绠＄垎濂戒环鑷姩鍖栨墽琛屻€?',
    stage: 'desktop_executor',
  });
  await backendClient.updateRunStatus(runId, {
    currentStage: 'desktop_executor',
    outputSummary: {
      initialStock: task.initialStock || 9999,
      reviewMode: task.requiresManualReview ? 'manual' : 'auto',
      signupMode: task.signupMode || 'all',
      taskName: task.taskName || '',
    },
    status: 'running',
  });

  let currentStage = 'desktop_executor';
  let failureReason = '';

  runtimeOptions.onLog = (entry: BaohaojiaAutomationLogEntry) => {
    const message = buildLogMessage(entry);
    if (!message) return;

    const inferredStage = inferStageFromLine(message);
    if (inferredStage && inferredStage !== currentStage) {
      currentStage = inferredStage;
      void backendClient.updateRunStatus(runId, {
        currentStage,
        outputSummary: {
          lastLine: message,
        },
        status: 'running',
      });
    }

    if (entry.level === 'error') {
      failureReason = message;
    }

    void backendClient.appendRunLog(runId, {
      action: entry.level === 'error' ? 'stderr' : 'stdout',
      context: {
        taskId: task.taskId,
      },
      level: entry.level === 'warn' ? 'warning' : entry.level,
      message,
      stage: currentStage,
    });
  };

  try {
    await runBaohaojiaSignup(runtimeOptions);

    if (fs.existsSync(reportPath)) {
      const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8')) as BaohaojiaSummaryReport;
      const payload = mapSummaryToPayload(report);
      await backendClient.saveRunResult(runId, payload);
      await backendClient.updateRunStatus(runId, {
        currentStage: 'generate_report',
        outputSummary: payload.outputSummary,
        status: payload.status,
      });
      await backendClient.appendRunLog(runId, {
        action: 'desktop-report',
        context: {
          reportPath,
        },
        message: `妗岄潰绔墽琛屽凡鍥炲啓缁撴灉 ${reportPath}`,
        stage: 'generate_report',
      });
      return;
    }

    await postFailureAndExit(
      backendClient,
      task,
      runId,
      failureReason || '妗岄潰绔墽琛屽け璐ワ細鏈骇鐢熺粨鏋滄姤鍛娿€?',
    );
  } catch (error) {
    await postFailureAndExit(
      backendClient,
      task,
      runId,
      `妗岄潰绔墽琛屽彂鐢熷紓甯革細${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    if (manifestPath && fs.existsSync(manifestPath)) {
      fs.unlinkSync(manifestPath);
    }
  }
}

async function startTaskExecution(task: TaobaoBaohaojiaTask) {
  const runId = normalizeText(task.runId);
  if (!runId) {
    return {
      success: false,
      message: '妗岄潰绔墽琛屽け璐ワ細缂哄皯 runId銆?',
    };
  }
  if (RUNNING_TASKS.has(runId)) {
    return {
      success: true,
      message: '妗岄潰绔凡鍦ㄦ墽琛岃鐖嗗ソ浠蜂换鍔★紝璇风◢鍚庢煡鐪嬭繍琛屾棩蹇椼€?',
    };
  }

  const backendClient = new BaohaojiaBackendClient(
    normalizeText(task.accessToken),
    resolveBackendBaseUrl(task.backendBaseUrl),
  );

  const execution = waitForTaskCompletion(task, runId, backendClient).finally(() => {
    RUNNING_TASKS.delete(runId);
  });

  RUNNING_TASKS.set(runId, execution);
  void execution;

  return {
    success: true,
    message: '妗岄潰绔凡寮€濮嬫墽琛岀垎濂戒环浠诲姟銆?',
  };
}

export class TaobaoBaohaojiaTaskRunner {
  static async executeTask(task: TaobaoBaohaojiaTask) {
    return startTaskExecution(task);
  }
}
