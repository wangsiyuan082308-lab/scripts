import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { app } from 'electron';

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
    sourceTab?: '已报名活动' | '未报名活动';
  }>;
  requiresManualReview?: boolean;
  signupMode?: 'all' | 'repeat_only' | 'unsigned_only';
  reviewActivityResults?: Array<{
    activityId: string;
    activityName: string;
    sourceTab?: '已报名活动' | '未报名活动';
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
  sourceTab?: '已报名活动' | '未报名活动';
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
  sourceTab?: '已报名活动' | '未报名活动';
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
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

function pathExists(target: string) {
  return fs.existsSync(target);
}

function firstExistingPath(candidates: string[]) {
  return candidates.find((candidate) => pathExists(candidate));
}

function getAppBaseCandidates() {
  const currentCwd = process.cwd();
  const appPath = normalizeText(app?.getAppPath?.());
  return Array.from(
    new Set(
      [
        currentCwd,
        path.resolve(currentCwd, 'apps', 'web-antd'),
        appPath,
        appPath ? path.resolve(appPath, 'apps', 'web-antd') : '',
        path.resolve(__dirname, '..'),
        path.resolve(__dirname, '..', '..', '..'),
      ].filter(Boolean),
    ),
  );
}

function getProjectRoot() {
  const basePath = firstExistingPath(
    getAppBaseCandidates().filter((candidate) =>
      pathExists(path.join(candidate, 'package.json')),
    ),
  );
  return basePath || process.cwd();
}

function getScriptPath() {
  const relativePath = path.join(
    'electron',
    'features',
    'eleme-activity',
    'automation',
    'signup-baohao.ts',
  );
  return (
    firstExistingPath(getAppBaseCandidates().map((candidate) => path.join(candidate, relativePath))) ||
    path.join(getProjectRoot(), relativePath)
  );
}

function getReportDir() {
  const relativePath = path.join('electron', 'features', 'eleme-activity', 'data');
  return (
    firstExistingPath(getAppBaseCandidates().map((candidate) => path.join(candidate, relativePath))) ||
    path.join(getProjectRoot(), relativePath)
  );
}

function inferStageFromLine(line: string) {
  if (/全部活动|扫描|第 \d+\/\d+ 页|发现|爆好价/.test(line)) return 'scan_activities';
  if (/详情页|立即报名|追加报名|继续报名|操作进度/.test(line)) return 'open_activity';
  if (/门店|下一步/.test(line)) return 'select_stores';
  if (/导出商品数据|下载中心|导出文件/.test(line)) return 'export_activity_file';
  if (/转换完成|上传文件|审计文件|转换器/.test(line)) return 'transform_excel';
  if (/上传处理后的Excel|uploaded/.test(line)) return 'upload_excel';
  if (/提交报名|报名成功|报名失败/.test(line)) return 'submit_signup';
  if (/汇总|结果|完成/.test(line)) return 'generate_report';
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
      failedCount,
      foundCount: summary.found,
      actualStoreCount: actualStoreNames.length,
      actualStoreIds,
      actualStoreNames,
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

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function writeReviewManifest(task: TaobaoBaohaojiaTask, reportDir: string) {
  const activities = (task.reviewActivityResults || []).filter(
    (item) => item.uploadFile?.localPath || item.uploadFile?.fileBase64,
  );
  if (activities.length === 0) {
    throw new Error('没有可继续提交的待审核活动。');
  }

  const tempDir = path.join(reportDir, 'review-manifests');
  ensureDir(tempDir);

  const manifestActivities = activities.map((item, index) => {
    let uploadPath = `${item.uploadFile?.localPath || ''}`.trim();
    if (!uploadPath) {
      const fileName = item.uploadFile?.fileName || `${item.activityId || index + 1}_报名.xlsx`;
      uploadPath = path.join(tempDir, `${Date.now()}_${index}_${fileName}`);
      fs.writeFileSync(uploadPath, Buffer.from(item.uploadFile?.fileBase64 || '', 'base64'));
    }
    return {
      activityId: item.activityId,
      activityName: item.activityName,
      sourceTab: item.sourceTab || '未报名活动',
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
    throw new Error('没有可重跑的历史活动记录。');
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
          sourceTab: item.sourceTab || '未报名活动',
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

async function waitForChildCompletion(
  task: TaobaoBaohaojiaTask,
  runId: string,
  backendClient: BaohaojiaBackendClient,
) {
  const scriptPath = getScriptPath();
  if (!fs.existsSync(scriptPath)) {
    await postFailureAndExit(
      backendClient,
      task,
      runId,
      `桌面端执行失败：未找到爆好价自动化入口 ${scriptPath}`,
    );
    return;
  }

  const reportDir = getReportDir();
  ensureDir(reportDir);
  const reportPath = path.join(
    reportDir,
    `${task.action === 'continue_review' ? 'baohao_review_submit' : 'baohao_signup'}_${Date.now()}.json`,
  );
  const args = [
    'exec',
    'tsx',
    scriptPath,
    '--initial-stock',
    String(task.initialStock || 9999),
    '--report-path',
    reportPath,
  ];
  let manifestPath = '';
  if (task.action === 'continue_review') {
    manifestPath = writeReviewManifest(task, reportDir);
    args.push('--continue-manifest', manifestPath);
    args.push('--continue-action', 'continue_review');
    args.push('--signup-mode', task.signupMode || 'all');
  } else if (task.action === 'rerun_recorded') {
    manifestPath = writeRecordedActivityManifest(task, reportDir);
    args.push('--continue-manifest', manifestPath);
    args.push('--continue-action', 'rerun_recorded');
    args.push('--signup-mode', task.signupMode || 'all');
  } else {
    args.push('--review-mode', task.requiresManualReview ? 'manual' : 'auto');
    args.push('--signup-mode', task.signupMode || 'all');
  }

  await backendClient.appendRunLog(runId, {
    action: 'desktop-start',
    context: {
      action: task.action || 'execute',
      args,
      cwd: getProjectRoot(),
      requiresManualReview: task.requiresManualReview,
      signupMode: task.signupMode || 'all',
      reportDir,
      scriptPath,
      taskId: task.taskId,
    },
    message:
      task.action === 'continue_review'
        ? '桌面端开始继续执行爆好价审核通过任务。'
        : task.action === 'rerun_recorded'
          ? '桌面端开始重跑当前任务已记录的爆好价活动。'
        : '桌面端开始接管爆好价自动化执行。',
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

  await new Promise<void>((resolve) => {
    const child = spawn('pnpm', args, {
      cwd: getProjectRoot(),
      env: {
        ...process.env,
        FORCE_COLOR: '0',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let currentStage = 'desktop_executor';
    let failureReason = '';
    const handleLine = (line: string, level: 'error' | 'info') => {
      const trimmed = normalizeText(line);
      if (!trimmed) return;

      const inferredStage = inferStageFromLine(trimmed);
      if (inferredStage && inferredStage !== currentStage) {
        currentStage = inferredStage;
        void backendClient.updateRunStatus(runId, {
          currentStage,
          outputSummary: {
            lastLine: trimmed,
          },
          status: 'running',
        });
      }

      if (level === 'error') {
        failureReason = trimmed;
      }

      void backendClient.appendRunLog(runId, {
        action: level === 'error' ? 'stderr' : 'stdout',
        context: {
          taskId: task.taskId,
        },
        level,
        message: trimmed,
        stage: currentStage,
      });
    };

    readline.createInterface({ input: child.stdout! }).on('line', (line) => {
      handleLine(line, 'info');
    });

    readline.createInterface({ input: child.stderr! }).on('line', (line) => {
      handleLine(line, 'error');
    });

    child.on('error', async (error) => {
      failureReason = error.message;
      await postFailureAndExit(
        backendClient,
        task,
        runId,
        `桌面端执行进程启动失败：${error.message}`,
      );
      resolve();
    });

    child.on('close', async (code) => {
      try {
        if (reportPath && fs.existsSync(reportPath)) {
          const report = JSON.parse(
            fs.readFileSync(reportPath, 'utf-8'),
          ) as BaohaojiaSummaryReport;
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
            message: `桌面端执行已回写结果 ${reportPath}`,
            stage: 'generate_report',
          });
        } else {
          await postFailureAndExit(
            backendClient,
            task,
            runId,
            failureReason ||
              `桌面端执行失败：子进程退出码 ${code ?? 'unknown'}，且未产出结果文件。`,
          );
        }
      } catch (error) {
        await postFailureAndExit(
          backendClient,
          task,
          runId,
          `桌面端执行结果回写失败：${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        if (manifestPath && fs.existsSync(manifestPath)) {
          fs.unlinkSync(manifestPath);
        }
        resolve();
      }
    });
  });
}

async function startTaskExecution(task: TaobaoBaohaojiaTask) {
  const runId = normalizeText(task.runId);
  if (!runId) {
    return {
      success: false,
      message: '桌面端执行失败：缺少 runId。',
    };
  }
  if (RUNNING_TASKS.has(runId)) {
    return {
      success: true,
      message: '桌面端已在执行该爆好价任务，请稍后查看运行日志。',
    };
  }

  const backendClient = new BaohaojiaBackendClient(
    normalizeText(task.accessToken),
    resolveBackendBaseUrl(task.backendBaseUrl),
  );

  const execution = waitForChildCompletion(task, runId, backendClient)
    .catch(async (error) => {
      await postFailureAndExit(
        backendClient,
        task,
        runId,
        `桌面端执行发生异常：${error instanceof Error ? error.message : String(error)}`,
      );
    })
    .finally(() => {
      RUNNING_TASKS.delete(runId);
    });

  RUNNING_TASKS.set(runId, execution);
  void execution;

  return {
    success: true,
    message: '桌面端已开始执行爆好价任务。',
  };
}

export class TaobaoBaohaojiaTaskRunner {
  static async executeTask(task: TaobaoBaohaojiaTask) {
    return startTaskExecution(task);
  }
}
