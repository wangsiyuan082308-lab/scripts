import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { app } from 'electron';
import {
  findTaobaoMarketingTagSceneByTag,
  resolveTaobaoMarketingEntryScope,
} from '../../../src/features/taobao-marketing-tag/config';

import {
  appendLocalSuperBrandRunLog,
  isLocalSuperBrandRunId,
  saveLocalSuperBrandRunResult,
  updateLocalSuperBrandRunStatus,
} from './local-task-store';

type BackendRunStatus = 'failed' | 'partial_success' | 'queued' | 'running' | 'succeeded';
type ActivityResultStatus = 'failed' | 'partial_success' | 'succeeded';

export interface TaobaoSuperBrandTask {
  accessToken?: string;
  backendBaseUrl?: string;
  entryScope?: 'brand_activity' | 'unsigned_activity';
  marketingTag?: string;
  runId?: string;
  taskId: string;
  taskName?: string;
}

interface SuperBrandRunLogPayload {
  action: string;
  context?: Record<string, unknown>;
  level?: 'error' | 'info' | 'warning';
  message: string;
  stage: string;
}

interface SuperBrandActivityResultPayload {
  activityId: string;
  activityName: string;
  detailRoute?: string;
  marketingTag?: string;
  merchantRatio?: number;
  message: string;
  screenshot?: string;
  sourceTab?: '品牌活动' | '已报名活动' | '未报名活动';
  status: ActivityResultStatus;
  storeCount?: number;
  storeIds?: string[];
  storeNames?: string[];
}

interface SuperBrandRunResultPayload {
  activityResults: SuperBrandActivityResultPayload[];
  outputSummary: Record<string, unknown>;
  status: BackendRunStatus;
}

interface SuperBrandScriptResult {
  activityId?: string;
  activityName?: string;
  detailRoute?: string;
  marketingTag?: string;
  merchantRatio?: number;
  message: string;
  screenshot?: string;
  sourceTab?: '品牌活动' | '已报名活动' | '未报名活动';
  status?: ActivityResultStatus;
  storeCount?: number;
  storeIds?: string[];
  storeNames?: string[];
  success: boolean;
}

interface SuperBrandSummaryReport {
  actualStoreCount?: number;
  actualStoreIds?: string[];
  actualStoreNames?: string[];
  entryScope?: 'brand_activity' | 'unsigned_activity';
  failedCount?: number;
  foundCount?: number;
  marketingTag?: string;
  results: SuperBrandScriptResult[];
  successCount?: number;
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
    'signup-super-brand-task.ts',
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
  if (/打开活动页面|账号门禁|活动列表|目标frame/u.test(line)) return 'open_activity';
  if (/切换筛选|超级品牌红包|扫描|第 \d+\/\d+ 页/u.test(line)) return 'scan_activities';
  if (/进入详情页|优惠信息|商家出资/u.test(line)) return 'inspect_activity';
  if (/向导第1步|同意协议|下一步/u.test(line)) return 'confirm_rules';
  if (/向导第2步|门店|全选|确认弹窗/u.test(line)) return 'select_stores';
  if (/报名成功|报名失败|结果:/u.test(line)) return 'submit_signup';
  if (/汇总|结果已保存|报名完成/u.test(line)) return 'generate_report';
  return 'desktop_executor';
}

function mapScriptResultStatus(result: SuperBrandScriptResult): ActivityResultStatus {
  if (result.status === 'partial_success') return 'partial_success';
  if (result.success) return 'succeeded';
  return 'failed';
}

function mapSummaryToPayload(summary: SuperBrandSummaryReport): SuperBrandRunResultPayload {
  const scene = findTaobaoMarketingTagSceneByTag(summary.marketingTag);
  const activityResults = (summary.results || []).map((result, index) => ({
    activityId: result.activityId || `super_brand_activity_${index + 1}`,
    activityName: result.activityName || `超级品牌活动 ${index + 1}`,
    detailRoute: result.detailRoute,
    marketingTag: result.marketingTag || summary.marketingTag || scene.marketingTag,
    merchantRatio: result.merchantRatio,
    message: result.message,
    screenshot: result.screenshot,
    sourceTab: result.sourceTab,
    status: mapScriptResultStatus(result),
    storeCount: result.storeCount,
    storeIds: result.storeIds,
    storeNames: result.storeNames,
  }));

  const successCount =
    summary.successCount ?? activityResults.filter((item) => item.status === 'succeeded').length;
  const partialCount = activityResults.filter((item) => item.status === 'partial_success').length;
  const failedCount =
    summary.failedCount ?? activityResults.filter((item) => item.status === 'failed').length;

  const actualStoreNames =
    summary.actualStoreNames ||
    Array.from(
      new Set(
        activityResults.flatMap((item) => item.storeNames || []).filter((item) => normalizeText(item)),
      ),
    );
  const actualStoreIds =
    summary.actualStoreIds ||
    Array.from(
      new Set(
        activityResults.flatMap((item) => item.storeIds || []).filter((item) => normalizeText(item)),
      ),
    );

  const actualStoreCount =
    summary.actualStoreCount ??
    Math.max(0, ...activityResults.map((item) => Number(item.storeCount || 0)));

  const status: BackendRunStatus =
    failedCount === 0
      ? 'succeeded'
      : successCount === 0 && partialCount === 0
        ? 'failed'
        : 'partial_success';

  return {
    activityResults,
    outputSummary: {
      actualStoreCount,
      actualStoreIds,
      actualStoreNames,
      entryScope: resolveTaobaoMarketingEntryScope({
        marketingTag: summary.marketingTag || scene.marketingTag,
        requestedEntryScope: summary.entryScope,
        sceneKey: scene.key,
      }),
      failedCount,
      foundCount: summary.foundCount ?? activityResults.length,
      marketingTag: summary.marketingTag || scene.marketingTag,
      partialCount,
      successCount,
      timestamp: summary.timestamp,
    },
    status,
  };
}

class SuperBrandBackendClient {
  constructor(
    private readonly accessToken: string,
    private readonly baseUrl: string,
  ) {}

  private isLocalRun(runId: string) {
    return isLocalSuperBrandRunId(runId) || !normalizeText(this.accessToken);
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

  async appendRunLog(runId: string, payload: SuperBrandRunLogPayload) {
    if (this.isLocalRun(runId)) {
      await appendLocalSuperBrandRunLog(runId, {
        action: payload.action,
        context: (payload.context || {}) as Record<string, any>,
        level: payload.level || 'info',
        message: payload.message,
        stage: payload.stage,
      });
      return;
    }
    await this.request(`/operation/taobao/super-brand/runs/${runId}/logs`, {
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
      await updateLocalSuperBrandRunStatus(runId, payload);
      return;
    }
    await this.request(`/operation/taobao/super-brand/runs/${runId}/status`, {
      body: JSON.stringify(payload),
      method: 'POST',
    });
  }

  async saveRunResult(runId: string, payload: SuperBrandRunResultPayload) {
    if (this.isLocalRun(runId)) {
      await saveLocalSuperBrandRunResult(runId, payload);
      return;
    }
    await this.request(`/operation/taobao/super-brand/runs/${runId}/result`, {
      body: JSON.stringify(payload),
      method: 'POST',
    });
  }
}

async function postFailureAndExit(
  backendClient: SuperBrandBackendClient,
  task: TaobaoSuperBrandTask,
  runId: string,
  reason: string,
) {
  const scene = findTaobaoMarketingTagSceneByTag(task.marketingTag);
  const resolvedMarketingTag = task.marketingTag || scene.marketingTag;
  const resolvedEntryScope = resolveTaobaoMarketingEntryScope({
    marketingTag: resolvedMarketingTag,
    requestedEntryScope: task.entryScope,
    sceneKey: scene.key,
  });
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
      entryScope: resolvedEntryScope,
      marketingTag: resolvedMarketingTag,
      taskName: task.taskName || '',
    },
    status: 'failed',
  });
}

async function waitForChildCompletion(
  task: TaobaoSuperBrandTask,
  runId: string,
  backendClient: SuperBrandBackendClient,
) {
  const scene = findTaobaoMarketingTagSceneByTag(task.marketingTag);
  const resolvedMarketingTag = task.marketingTag || scene.marketingTag;
  const resolvedEntryScope = resolveTaobaoMarketingEntryScope({
    marketingTag: resolvedMarketingTag,
    requestedEntryScope: task.entryScope,
    sceneKey: scene.key,
  });
  const scriptPath = getScriptPath();
  if (!fs.existsSync(scriptPath)) {
    await postFailureAndExit(
      backendClient,
      task,
      runId,
      `桌面端执行失败：未找到超级品牌红包自动化入口 ${scriptPath}`,
    );
    return;
  }

  const reportDir = getReportDir();
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }
  const reportPath = path.join(reportDir, `super_brand_signup_${Date.now()}.json`);
  const args = [
    'exec',
    'tsx',
    scriptPath,
    '--marketing-tag',
    resolvedMarketingTag,
    '--entry-scope',
    resolvedEntryScope,
    '--report-path',
    reportPath,
  ];

  await backendClient.appendRunLog(runId, {
    action: 'desktop-start',
    context: {
      args,
      cwd: getProjectRoot(),
      entryScope: resolvedEntryScope,
      marketingTag: resolvedMarketingTag,
      reportDir,
      scriptPath,
      taskId: task.taskId,
    },
    message: '桌面端开始接管超级品牌红包自动化执行。',
    stage: 'desktop_executor',
  });
  await backendClient.updateRunStatus(runId, {
    currentStage: 'desktop_executor',
    outputSummary: {
      entryScope: resolvedEntryScope,
      marketingTag: resolvedMarketingTag,
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
            entryScope: resolvedEntryScope,
            marketingTag: resolvedMarketingTag,
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
          const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8')) as SuperBrandSummaryReport;
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
        resolve();
      }
    });
  });
}

async function startTaskExecution(task: TaobaoSuperBrandTask) {
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
      message: '桌面端已在执行该超级品牌红包任务，请稍后查看运行日志。',
    };
  }

  const backendClient = new SuperBrandBackendClient(
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
    message: '桌面端已开始执行超级品牌红包任务。',
  };
}

export class TaobaoSuperBrandTaskRunner {
  static async executeTask(task: TaobaoSuperBrandTask) {
    return startTaskExecution(task);
  }
}
