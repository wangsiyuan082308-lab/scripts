import { merchantStorage, storeStorage } from '../../../shared/storage';
import type { WithdrawalExecutionResult, WithdrawalTask, WithdrawalTaskResult } from '../runner';

import {
  ensureAutomationRuntime,
  getAutomationRuntimePaths,
  loadEvolutionConfig,
  resolveAutomationConfig,
  resolveStorePaymentPassword,
} from './config';
import { closeBrowserSession, ensureBrowserAlive, launchBrowserSession, navigateAndEnsureLogin } from './browser';
import { createAutomationLogger, writeMetric, cleanOldAutomationLogs } from './logger';
import { RiskController } from './retry';
import { executeStoreWithdrawal } from './store';

/**
 * 根据成功/失败数量生成本次执行摘要。
 */
function buildSummary(successCount: number, failedCount: number, total: number) {
  if (total === 0) return '暂无执行记录';
  if (successCount === total) return `全部 ${total} 家门店提现成功`;
  if (failedCount === total) return `全部 ${total} 家门店提现失败`;
  return `${successCount} 家成功，${failedCount} 家失败`;
}

/**
 * 根据执行统计推导整体任务状态。
 */
function getStatusFromCounts(successCount: number, failedCount: number) {
  if (successCount > 0 && failedCount === 0) return 'success' as const;
  if (successCount > 0 && failedCount > 0) return 'partial_success' as const;
  return 'failed' as const;
}

/**
 * 根据任务中的商户 ID 解析商户配置。
 */
async function resolveMerchant(task: WithdrawalTask) {
  if (!task.merchantId) {
    return undefined;
  }
  const merchants = await merchantStorage.get({ role: 'super_admin' });
  return merchants.find((item) => item.id === task.merchantId);
}


async function resolveStoreMap(task: WithdrawalTask) {
  const stores = await storeStorage.get({ role: 'super_admin' });
  const scopedStores = task.merchantId
    ? stores.filter((item) => item.merchantId === task.merchantId)
    : stores;
  return new Map(
    scopedStores.map((item) => [String(item.storeId || item.id || '').trim(), item]),
  );
}

/**
 * 执行一整次提现会话。
 * 包括运行时初始化、浏览器登录校验、逐门店提现、风控退避与结果汇总。
 */
export async function executeWithdrawalSession(
  task: WithdrawalTask,
): Promise<WithdrawalExecutionResult> {
  const startedAt = Date.now();
  const sessionId = `${task.taskId}_${startedAt}`;
  const merchant = await resolveMerchant(task);
  const storeMap = await resolveStoreMap(task);
  const paths = getAutomationRuntimePaths(task.merchantId);
  await ensureAutomationRuntime(paths);
  cleanOldAutomationLogs(paths);

  const bootstrapLogger = createAutomationLogger('withdrawal-session', paths, undefined, {
    sessionId,
    taskId: task.taskId,
  });
  const evolution = await loadEvolutionConfig(paths);
  const config = resolveAutomationConfig(merchant, task.triggerMode, evolution);

  if (!config.enabled) {
    throw new Error('当前商户未启用饿了么自动提现');
  }

  const { context, page } = await launchBrowserSession(config, paths, bootstrapLogger);
  const risk = new RiskController(evolution, paths, bootstrapLogger);
  const results: WithdrawalTaskResult[] = [];

  try {
    await navigateAndEnsureLogin(page, config, task.triggerMode, bootstrapLogger);

    for (let index = 0; index < task.storeIds.length; index++) {
      const storeId = task.storeIds[index] || '';
      const storeName = task.storeNames[index] || storeId;

      if (!(await risk.cooldownIfNeeded())) {
        const executedAt = new Date().toISOString();
        results.push({
          executedAt,
          message: '连续触发风控，已停止本次执行，请人工处理后重试',
          status: 'failed',
          storeId,
          storeName,
        });
        continue;
      }

      try {
        await ensureBrowserAlive(page, config, bootstrapLogger);
        const storeRecord = storeMap.get(storeId);
        const paymentPassword = resolveStorePaymentPassword(storeRecord);

        if (!paymentPassword) {
          bootstrapLogger.child(storeName).warn('当前门店未配置饿了么提现密码，已跳过本次提现');
          results.push({
            executedAt: new Date().toISOString(),
            message: '当前门店未配置饿了么提现密码，已跳过本次提现',
            status: 'failed',
            storeId,
            storeName,
          });
          continue;
        }

        const storeConfig = {
          ...config,
          paymentPassword,
        };
        const storeResult = await executeStoreWithdrawal(page, {
          config: storeConfig,
          logger: bootstrapLogger.child(storeName),
          paths,
          storeId,
          storeName,
        });

        await risk.update(storeResult.blocked ? 'blocked' : storeResult.status === 'success' ? 'success' : 'fail');
        results.push({
          executedAt: new Date().toISOString(),
          message: storeResult.message,
          status: storeResult.status,
          storeId,
          storeName,
          withdrawAmount: storeResult.withdrawAmount,
        });
      } catch (error: any) {
        results.push({
          executedAt: new Date().toISOString(),
          message: error?.message || '提现执行失败',
          status: 'failed',
          storeId,
          storeName,
        });
      }
    }
  } finally {
    await closeBrowserSession(context, bootstrapLogger);
  }

  const successCount = results.filter((item) => item.status === 'success').length;
  const failedCount = results.length - successCount;
  const lastRunAt = new Date().toISOString();
  const finishedAt = new Date().toISOString();

  writeMetric(paths, 'session_summary', {
    blocked: results.filter((item) => item.message.includes('风控')).length,
    durationMs: Date.now() - startedAt,
    fail: failedCount,
    success: successCount,
    total: results.length,
  });

  return {
    failedCount,
    finishedAt,
    lastRunAt,
    results,
    startedAt: new Date(startedAt).toISOString(),
    status: getStatusFromCounts(successCount, failedCount),
    successCount,
    summary: buildSummary(successCount, failedCount, results.length),
  };
}
