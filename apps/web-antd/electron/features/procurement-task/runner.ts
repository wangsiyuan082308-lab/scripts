import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

type BackendRunStatus =
  | 'failed'
  | 'partial_success'
  | 'running'
  | 'succeeded'
  | 'waiting_retry';

export interface ProcurementTask {
  accessToken?: string;
  backendBaseUrl?: string;
  id?: string;
  maxItems?: number;
  platform: 'Aoxiang' | 'Qianniuhua';
  runId?: string;
  storeIds?: string[];
  storeNames?: string[];
  supplierId?: string;
  supplierIds: string[];
  supplierName?: string;
  supplierNames?: string[];
  taskId: string;
  taskName?: string;
}

interface BackendReportPayload {
  failedCount: number;
  itemCount: number;
  noStockCount: number;
  notifyStatus: string;
  orderCount: number;
  platform: 'Aoxiang' | 'Qianniuhua';
  report: Record<string, unknown>;
  status: BackendRunStatus;
  storeCount: number;
  successCount: number;
  supplierName: string;
  totalAmount: number;
}

interface QianniuhuaAutomationReport {
  date: string;
  durationMinutes: number;
  endTime: string;
  errorMessage: string;
  muteCompliance?: string;
  noStockSkuCount: number;
  noStockSkus: Array<Record<string, unknown>>;
  orderCount: number;
  outOrderId: string;
  planOrderId: string;
  platform: 'qianniuhua';
  startTime: string;
  steps: Array<Record<string, unknown>>;
  success: boolean;
  supplier: string;
  totalAmount: number;
  totalItems: number;
  totalRounds: number;
}

const DEFAULT_BACKEND_BASE_URL = 'http://127.0.0.1:3030';
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

function getProjectRoot() {
  return path.resolve(__dirname, '..', '..', '..');
}

function getQianniuhuaScriptPath() {
  return path.resolve(
    __dirname,
    'automation',
    'qianniuhua',
    'auto-purchase.ts',
  );
}

function getQianniuhuaReportDir() {
  return path.resolve(
    __dirname,
    'automation',
    'data',
    'reports',
  );
}

function pickSupplierName(task: ProcurementTask) {
  return (
    normalizeText(task.supplierName) ||
    task.supplierNames?.map((item) => normalizeText(item)).find(Boolean) ||
    normalizeText(task.supplierId) ||
    task.supplierIds.map((item) => normalizeText(item)).find(Boolean) ||
    ''
  );
}

function pickStoreNames(task: ProcurementTask) {
  const names = (task.storeNames || []).map((item) => normalizeText(item)).filter(Boolean);
  if (names.length > 0) {
    return names;
  }
  return (task.storeIds || []).map((item) => normalizeText(item)).filter(Boolean);
}

function buildUnsupportedMessage(task: ProcurementTask) {
  const supplier = pickSupplierName(task) || '未指定供应商';
  const stores = pickStoreNames(task);
  return [
    `采购任务 ${task.taskId} 未执行。`,
    `平台: ${task.platform}`,
    `供应商: ${supplier}`,
    `门店: ${stores.length > 0 ? stores.join('、') : '未指定门店'}`,
    '原因: 翱象桌面端真实执行链路尚未完整迁入当前仓库，当前先回写失败状态，避免任务长期停留在 running。',
  ].join(' ');
}

function inferStageFromLine(line: string) {
  if (/search-and-cart|Step 1/i.test(line)) return 'search_and_cart';
  if (/check-and-export-cart|Step 2/i.test(line)) return 'check_and_export_cart';
  if (/transform-excel|Step 3/i.test(line)) return 'transform_excel';
  if (/clean-cart|Step 4/i.test(line)) return 'clean_cart';
  if (/submit-order|Step 5/i.test(line)) return 'submit_order';
  if (/清理|stepClean|Step 0/i.test(line)) return 'clean_cart';
  if (/加入补货单|stepAdd|Step 1: add/i.test(line)) return 'add_to_cart';
  if (/创建采购单|stepOrder|Step 2: order/i.test(line)) return 'create_purchase_order';
  if (/检查状态|stepCheck|Step 3: check/i.test(line)) return 'check_order_status';
  if (/重试|stepRetry|waiting_retry/i.test(line)) return 'retry_without_no_stock_skus';
  if (/报告|汇总|report/i.test(line)) return 'generate_report';
  return 'desktop_executor';
}

function detectFailureReason(line: string) {
  if (/致命错误[:：]\s*(.+)/.test(line)) {
    return line.replace(/^.*致命错误[:：]\s*/u, '').trim();
  }
  if (/❌\s*(.+)/.test(line)) {
    return line.replace(/^.*❌\s*/u, '').trim();
  }
  return '';
}

function extractReportPath(line: string) {
  const matched = line.match(/报告(?:已保存)?[:：]\s*(.+\.json)\s*$/u);
  return matched?.[1] ? normalizeText(matched[1]) : '';
}

function mapQianniuhuaReportToBackendPayload(
  task: ProcurementTask,
  report: QianniuhuaAutomationReport,
): BackendReportPayload {
  const noStockCount = Number(report.noStockSkuCount || report.noStockSkus?.length || 0);
  const itemCount = Number(report.totalItems || 0);
  const successCount = Math.max(0, itemCount - noStockCount);
  const failedCount = report.success ? 0 : Math.max(noStockCount, itemCount > 0 ? itemCount - successCount : 1);
  const status: BackendRunStatus = report.success
    ? 'succeeded'
    : noStockCount > 0
      ? 'waiting_retry'
      : 'failed';

  return {
    failedCount,
    itemCount,
    noStockCount,
    notifyStatus: 'pending',
    orderCount: Number(report.orderCount || 0),
    platform: task.platform,
    report: report as unknown as Record<string, unknown>,
    status,
    storeCount: pickStoreNames(task).length,
    successCount,
    supplierName: pickSupplierName(task),
    totalAmount: Number(report.totalAmount || 0),
  };
}

class ProcurementBackendClient {
  constructor(
    private readonly accessToken: string,
    private readonly baseUrl: string,
  ) {}

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

  async appendRunLog(
    runId: string,
    payload: {
      action: string;
      context?: Record<string, unknown>;
      level?: string;
      message: string;
      stage: string;
    },
  ) {
    await this.request(`/procurement/runs/${runId}/logs`, {
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
    await this.request(`/procurement/runs/${runId}/status`, {
      body: JSON.stringify(payload),
      method: 'POST',
    });
  }

  async saveRunReport(runId: string, payload: BackendReportPayload) {
    await this.request(`/procurement/runs/${runId}/report`, {
      body: JSON.stringify(payload),
      method: 'POST',
    });
  }
}

async function postFailureAndExit(
  backendClient: ProcurementBackendClient,
  task: ProcurementTask,
  runId: string,
  reason: string,
) {
  await backendClient.appendRunLog(runId, {
    action: 'desktop-executor',
    context: {
      platform: task.platform,
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
      platform: task.platform,
      taskName: task.taskName || '',
    },
    status: 'failed',
  });
}

async function waitForChildCompletion(
  task: ProcurementTask,
  runId: string,
  backendClient: ProcurementBackendClient,
) {
  const supplierName = pickSupplierName(task);
  const storeNames = pickStoreNames(task);

  if (!supplierName) {
    await postFailureAndExit(
      backendClient,
      task,
      runId,
      '桌面端执行失败：未识别到供应商名称，无法生成自动化执行参数。',
    );
    return;
  }

  if (task.platform === 'Aoxiang') {
    await postFailureAndExit(
      backendClient,
      task,
      runId,
      buildUnsupportedMessage(task),
    );
    return;
  }

  const scriptPath = getQianniuhuaScriptPath();
  if (!fs.existsSync(scriptPath)) {
    await postFailureAndExit(
      backendClient,
      task,
      runId,
      `桌面端执行失败：未找到牵牛花自动化入口 ${scriptPath}`,
    );
    return;
  }

  const args = ['exec', 'tsx', scriptPath, '--supplier', supplierName];
  for (const storeName of storeNames) {
    args.push('--store', storeName);
  }
  if (task.maxItems && task.maxItems > 0) {
    args.push('--max-items', String(task.maxItems));
  }

  const reportDir = getQianniuhuaReportDir();
  const reportCandidatesBefore = fs.existsSync(reportDir)
    ? new Set(fs.readdirSync(reportDir))
    : new Set<string>();

  await backendClient.appendRunLog(runId, {
    action: 'desktop-start',
    context: {
      args,
      platform: task.platform,
      storeNames,
      supplierName,
    },
    message: '桌面端开始接管采购任务执行。',
    stage: 'desktop_executor',
  });
  await backendClient.updateRunStatus(runId, {
    currentStage: 'desktop_executor',
    outputSummary: {
      desktopHost: 'electron',
      storeNames,
      supplierName,
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
    let reportPath = '';

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

      const detectedReason = detectFailureReason(trimmed);
      if (detectedReason) {
        failureReason = detectedReason;
      }

      const detectedReportPath = extractReportPath(trimmed);
      if (detectedReportPath) {
        reportPath = detectedReportPath;
      }

      void backendClient.appendRunLog(runId, {
        action: level === 'error' ? 'stderr' : 'stdout',
        context: {
          platform: task.platform,
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
        if (!reportPath && fs.existsSync(reportDir)) {
          const newest = fs
            .readdirSync(reportDir)
            .filter((file) => file.endsWith('.json') && !reportCandidatesBefore.has(file))
            .sort()
            .pop();
          if (newest) {
            reportPath = path.join(reportDir, newest);
          }
        }

        if (reportPath && fs.existsSync(reportPath)) {
          const report = JSON.parse(
            fs.readFileSync(reportPath, 'utf-8'),
          ) as QianniuhuaAutomationReport;
          await backendClient.saveRunReport(
            runId,
            mapQianniuhuaReportToBackendPayload(task, report),
          );
          await backendClient.appendRunLog(runId, {
            action: 'desktop-report',
            context: {
              reportPath,
            },
            message: `桌面端执行已回写报告 ${reportPath}`,
            stage: 'generate_report',
          });
        } else {
          await postFailureAndExit(
            backendClient,
            task,
            runId,
            failureReason ||
              `桌面端执行失败：子进程退出码 ${code ?? 'unknown'}，且未产出报告文件。`,
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

async function startTaskExecution(task: ProcurementTask) {
  const runId = normalizeText(task.runId);
  const accessToken = normalizeText(task.accessToken);
  if (!runId) {
    return {
      success: false,
      message: '桌面端执行失败：缺少 runId。',
    };
  }
  if (!accessToken) {
    return {
      success: false,
      message: '桌面端执行失败：缺少访问令牌，无法回写采购运行状态。',
    };
  }
  if (RUNNING_TASKS.has(runId)) {
    return {
      success: true,
      message: '桌面端已在执行该采购任务，请稍后查看运行日志。',
    };
  }

  const backendClient = new ProcurementBackendClient(
    accessToken,
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

  return {
    success: true,
    message:
      task.platform === 'Qianniuhua'
        ? '桌面端已开始接管牵牛花采购任务，运行日志会持续回写到采购中心。'
        : '桌面端已接管任务，并会把不支持原因回写到采购中心。',
  };
}

export { inferStageFromLine, mapQianniuhuaReportToBackendPayload };

export const ProcurementTaskRunner = {
  async executeTask(task: ProcurementTask) {
    return startTaskExecution(task);
  },
};
