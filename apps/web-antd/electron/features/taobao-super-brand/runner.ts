import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

import {
  findTaobaoMarketingTagSceneByTag,
  resolveTaobaoMarketingEntryScope,
} from '../../../src/features/taobao-marketing-tag/config';
import {
  runSuperBrandSignup,
  type RuntimeOptions as SuperBrandRuntimeOptions,
  type SuperBrandAutomationLogEntry,
} from '../eleme-activity/automation/signup-super-brand-task';
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
  sourceTab?: string;
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
  sourceTab?: string;
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
  if (normalized.includes('frame') || normalized.includes('account')) return 'open_activity';
  if (normalized.includes('scan') || normalized.includes('page')) return 'scan_activities';
  if (normalized.includes('detail') || normalized.includes('ratio')) return 'inspect_activity';
  if (normalized.includes('next') || normalized.includes('agree')) return 'confirm_rules';
  if (normalized.includes('store')) return 'select_stores';
  if (normalized.includes('submit') || normalized.includes('success') || normalized.includes('failed')) {
    return 'submit_signup';
  }
  if (normalized.includes('report') || normalized.includes('summary')) return 'generate_report';
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
    activityName: result.activityName || `瓒呯骇鍝佺墝娲诲姩 ${index + 1}`,
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

async function waitForTaskCompletion(
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
  const runtimeBaseDir = getRuntimeBaseDir();
  const reportDir = getReportDir();
  const reportPath = path.join(reportDir, `super_brand_signup_${Date.now()}.json`);

  await backendClient.appendRunLog(runId, {
    action: 'desktop-start',
    context: {
      entryScope: resolvedEntryScope,
      executionMode: 'in_process',
      marketingTag: resolvedMarketingTag,
      reportDir,
      runtimeBaseDir,
      taskId: task.taskId,
    },
    message: '妗岄潰绔紑濮嬫帴绠¤秴绾у搧鐗岀孩鍖呰嚜鍔ㄥ寲鎵ц銆?',
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

  let currentStage = 'desktop_executor';
  let failureReason = '';

  const handleAutomationLog = (entry: SuperBrandAutomationLogEntry) => {
    const message = buildLogMessage(entry);
    if (!message) return;

    const inferredStage = inferStageFromLine(message);
    if (inferredStage && inferredStage !== currentStage) {
      currentStage = inferredStage;
      void backendClient.updateRunStatus(runId, {
        currentStage,
        outputSummary: {
          entryScope: resolvedEntryScope,
          lastLine: message,
          marketingTag: resolvedMarketingTag,
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
    const runtimeOptions: SuperBrandRuntimeOptions = {
      entryScope: resolvedEntryScope,
      marketingTag: resolvedMarketingTag,
      onLog: handleAutomationLog,
      reportPath,
      runtimeBaseDir,
    };

    await runSuperBrandSignup(runtimeOptions);

    if (fs.existsSync(reportPath)) {
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
  }
}

async function startTaskExecution(task: TaobaoSuperBrandTask) {
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
      message: '妗岄潰绔凡鍦ㄦ墽琛岃瓒呯骇鍝佺墝绾㈠寘浠诲姟锛岃绋嶅悗鏌ョ湅杩愯鏃ュ織銆?',
    };
  }

  const backendClient = new SuperBrandBackendClient(
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
    message: '妗岄潰绔凡寮€濮嬫墽琛岃秴绾у搧鐗岀孩鍖呬换鍔°€?',
  };
}

export class TaobaoSuperBrandTaskRunner {
  static async executeTask(task: TaobaoSuperBrandTask) {
    return startTaskExecution(task);
  }
}
