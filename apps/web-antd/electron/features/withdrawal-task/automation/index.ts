/* eslint-disable no-console */
import process from 'node:process';
import { CONFIG, evolutionConfig, saveEvolutionConfig } from './config';
import { launchBrowser, navigateAndLogin, closeBrowser, ensureBrowserAlive, delay } from './browser';
import { createLogger, cleanOldLogs, metrics } from './logger';
import { switchStore, navigateToFinance, handleWithdrawal } from './store';
import { retryWithBackoff, updateRiskLevel, cooldownIfNeeded, getDelayMultiplier, getRiskLevel, RiskLevel } from './retry';

const log = createLogger('main');

async function main() {
  cleanOldLogs();
  const sessionStart = Date.now();

  const { context, page } = await launchBrowser();
  await navigateAndLogin(page);

  const results: { store: string; status: string; retries: number }[] = [];

  for (const storeName of CONFIG.targetStores) {
    log.info(`\n=== 开始处理门店: ${storeName} ===`);

    // 风控冷却检查
    const canContinue = await cooldownIfNeeded();
    if (!canContinue) {
      log.error(`风控 LEVEL3 生效，跳过门店 ${storeName}`);
      results.push({ store: storeName, status: 'blocked', retries: 0 });
      continue;
    }

    let storeResult = 'fail';
    let retryCount = 0;

    try {
      storeResult = await retryWithBackoff(
        async () => {
          await ensureBrowserAlive(page);
          await switchStore(page, storeName);
          await navigateToFinance(page);

          const result = await handleWithdrawal(page, storeName);

          if (result === 'blocked') {
            updateRiskLevel('blocked');
            metrics.riskControl(getRiskLevel(), 'withdrawal_blocked', 'retry');
            throw new Error('风控拦截');
          }

          return result;
        },
        storeName,
        {
          maxRetries: 3,
          baseDelayMs: CONFIG.baseWaitTime * getDelayMultiplier(),
          maxDelayMs: 60_000,
        },
      );

      updateRiskLevel(storeResult as 'success' | 'fail');
    } catch (error) {
      log.error(`门店 ${storeName} 最终失败: ${error}`);
      log.obs('ERROR', '门店处理最终失败', {
        stage: 'main.run',
        code: 'EAW_MAIN_STORE_FINAL_FAIL',
        reason: error instanceof Error ? error.message : String(error),
        retryable: false,
      }, { store: storeName });
      storeResult = getRiskLevel() >= RiskLevel.LEVEL2 ? 'blocked' : 'fail';
      retryCount = 3;
    }

    results.push({ store: storeName, status: storeResult, retries: retryCount });
    log.info(`=== 门店 ${storeName} 处理完毕 (${storeResult}) ===`);

    // 门店间等待（受风控等级影响）
    await delay(CONFIG.baseWaitTime * getDelayMultiplier());
  }

  // 执行摘要
  log.info('\n========== 执行摘要 ==========');
  for (const r of results) {
    const icon = r.status === 'success' ? '✅' : r.status === 'blocked' ? '⚠️' : '❌';
    const retryInfo = r.retries > 0 ? ` (重试${r.retries}次)` : '';
    log.info(`${icon} ${r.store}: ${r.status}${retryInfo}`);
  }
  const successCount = results.filter(r => r.status === 'success').length;
  const failCount = results.filter(r => r.status !== 'success').length;
  const blockedCount = results.filter(r => r.status === 'blocked').length;
  log.info(`总计: ${results.length}个门店, 成功${successCount}, 失败${failCount}`);
  log.info(`风控等级: ${RiskLevel[getRiskLevel()]}`);
  log.info('================================');

  // 写入摘要埋点
  metrics.sessionSummary(results.length, successCount, failCount - blockedCount, blockedCount, Date.now() - sessionStart);

  await closeBrowser(context);

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  log.error(`主程序异常: ${err}`);
  process.exit(1);
});
