import { closeBrowser, launchBrowser, navigateAndLogin } from './automation/browser';
import { CONFIG } from './automation/config';
import { createLogger } from './automation/logger';
import { getDelayMultiplier, updateRiskLevel } from './automation/retry';
import { isCurrentStoreMatched } from './automation/store-rules.js';
import { handleWithdrawal, readCurrentStoreLabel, switchStore } from './automation/store';

type WithdrawalTaskStatus = 'failed' | 'partial_success' | 'success';
type WithdrawalStoreStatus = 'failed' | 'success';

export interface WithdrawalTask {
  createdAt?: string;
  failedCount?: number;
  id: string;
  results?: WithdrawalTaskResult[];
  status?: string;
  storeCount?: number;
  storeIds: string[];
  storeNames: string[];
  successCount?: number;
  taskId?: string;
  taskType?: string;
  triggerMode?: string;
  updatedAt?: string;
}

export interface WithdrawalTaskResult {
  executedAt: string;
  message: string;
  status: WithdrawalStoreStatus;
  storeId: string;
  storeName: string;
  withdrawAmount?: number;
}

export interface WithdrawalExecutionResult {
  failedCount: number;
  finishedAt: string;
  lastRunAt: string;
  results: WithdrawalTaskResult[];
  startedAt: string;
  status: WithdrawalTaskStatus;
  successCount: number;
  summary: string;
}

const log = createLogger('withdrawal');

async function hasReadyFinanceFrame(page: any) {
  for (const frame of page.frames()) {
    if (!frame.url().includes('accountFlow')) continue;
    const text = await frame.locator('body').innerText().catch(() => '');
    if (text.includes('账户总览') || text.includes('提现')) {
      return true;
    }
  }
  return false;
}

async function ensureFinanceRouteReady(page: any) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto(CONFIG.financeUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 120_000,
    }).catch(() => {});
    await page.waitForLoadState('networkidle', {
      timeout: 10_000,
    }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 5000));

    if (await hasReadyFinanceFrame(page)) {
      return true;
    }

    log.warn(`Finance route not ready on attempt ${attempt + 1}, retrying...`);
    await page.reload({
      waitUntil: 'domcontentloaded',
      timeout: 120_000,
    }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  return false;
}

function isDryRunEnabled() {
  const value = `${process.env.WITHDRAWAL_DRY_RUN || ''}`.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes';
}

function buildSummary(successCount: number, failedCount: number, total: number) {
  if (total === 0) return 'No stores were processed.';
  if (successCount === total) return `All ${total} stores completed successfully.`;
  if (failedCount === total) return `All ${total} stores failed.`;
  return `${successCount} stores succeeded, ${failedCount} stores failed.`;
}

function buildDryRunResult(
  task: WithdrawalTask,
  startedAt: number,
): WithdrawalExecutionResult {
  const executedAt = new Date().toISOString();
  const results: WithdrawalTaskResult[] = task.storeIds.map((storeId, index) => ({
    executedAt,
    message: 'Dry run: skipped real withdrawal flow',
    status: 'success',
    storeId,
    storeName: task.storeNames[index] || storeId,
  }));

  return {
    failedCount: 0,
    finishedAt: executedAt,
    lastRunAt: executedAt,
    results,
    startedAt: new Date(startedAt).toISOString(),
    status: 'success',
    successCount: results.length,
    summary: `Dry run complete. Checked ${results.length} stores without opening the withdrawal flow.`,
  };
}

export async function executeWithdrawalSession(
  task: WithdrawalTask,
): Promise<WithdrawalExecutionResult> {
  const startedAt = Date.now();
  const results: WithdrawalTaskResult[] = [];

  log.info('=== Withdrawal automation start ===');
  log.info(`Stores: ${task.storeNames.join(', ')}`);

  if (isDryRunEnabled()) {
    log.info('Dry run enabled. Skipping browser launch and withdrawal actions.');
    return buildDryRunResult(task, startedAt);
  }

  try {
    const { context, page } = await launchBrowser();
    await navigateAndLogin(page);

    for (let i = 0; i < task.storeIds.length; i++) {
      const storeId = task.storeIds[i];
      const storeName = task.storeNames[i] || storeId;

      log.info(`Processing store: ${storeName}`);

      try {
        const currentStoreBeforeSwitch = await readCurrentStoreLabel(page);
        if (currentStoreBeforeSwitch) {
          log.info(`Current store before switch: ${currentStoreBeforeSwitch}`);
        }
        await switchStore(page, storeName);
        const currentStoreAfterSwitch = await readCurrentStoreLabel(page);
        if (currentStoreAfterSwitch) {
          log.info(`Current store after switch: ${currentStoreAfterSwitch}`);
        }
        if (!isCurrentStoreMatched(currentStoreAfterSwitch, storeName)) {
          throw new Error(`Store switch verification failed: expected ${storeName}, got ${currentStoreAfterSwitch || 'unknown'}`);
        }
        await ensureFinanceRouteReady(page);
        const currentStoreBeforeWithdrawal = await readCurrentStoreLabel(page);
        if (currentStoreBeforeWithdrawal) {
          log.info(`Current store before withdrawal: ${currentStoreBeforeWithdrawal}`);
        }
        if (!isCurrentStoreMatched(currentStoreBeforeWithdrawal, storeName)) {
          throw new Error(`Store context changed before withdrawal: expected ${storeName}, got ${currentStoreBeforeWithdrawal || 'unknown'}`);
        }

        const result = await handleWithdrawal(page, storeName);

        let status: WithdrawalStoreStatus = 'failed';
        let message = '';
        let withdrawAmount: number | undefined;

        if (result === 'success') {
          status = 'success';
          message = 'Withdrawal succeeded';
          updateRiskLevel('success');
        } else if (result === 'blocked') {
          status = 'failed';
          message = 'Blocked by risk control';
          updateRiskLevel('blocked');
        } else {
          status = 'failed';
          message = 'Withdrawal failed';
          updateRiskLevel('fail');
        }

        results.push({
          executedAt: new Date().toISOString(),
          message,
          status,
          storeId,
          storeName,
          withdrawAmount,
        });

        log.info(`Store ${storeName}: ${status}`);
      } catch (error: any) {
        results.push({
          executedAt: new Date().toISOString(),
          message: error?.message || 'Execution failed',
          status: 'failed',
          storeId,
          storeName,
        });
        log.error(`Store ${storeName} failed: ${error?.message || error}`);
      }

      await new Promise((resolve) =>
        setTimeout(resolve, CONFIG.baseWaitTime * getDelayMultiplier()),
      );
    }

    await closeBrowser(context);
  } catch (error: any) {
    log.error(`Withdrawal session failed: ${error?.message || error}`);

    if (results.length === 0) {
      for (let i = 0; i < task.storeIds.length; i++) {
        results.push({
          executedAt: new Date().toISOString(),
          message: error?.message || 'Session failed',
          status: 'failed',
          storeId: task.storeIds[i],
          storeName: task.storeNames[i] || task.storeIds[i],
        });
      }
    }
  }

  const successCount = results.filter((item) => item.status === 'success').length;
  const failedCount = results.length - successCount;
  const finishedAt = new Date().toISOString();
  const status: WithdrawalTaskStatus =
    successCount > 0 && failedCount === 0
      ? 'success'
      : successCount > 0
        ? 'partial_success'
        : 'failed';

  log.info('=== Withdrawal automation summary ===');
  log.info(`Success: ${successCount}, Failed: ${failedCount}`);

  return {
    failedCount,
    finishedAt,
    lastRunAt: finishedAt,
    results,
    startedAt: new Date(startedAt).toISOString(),
    status,
    successCount,
    summary: buildSummary(successCount, failedCount, results.length),
  };
}

export const executeWithdrawalSessionViaBridge = executeWithdrawalSession;
