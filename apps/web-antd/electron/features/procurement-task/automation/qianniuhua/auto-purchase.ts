/**
 * 牵牛花自动采购 v2 - 模块化编排器
 */
import { Page, BrowserContext } from 'playwright';
import { loadConfig, parseCLI, PurchaseConfig } from './lib/config';
import { saveContext, loadContext, createEmptyContext, validateContext, getFlowRunCount, incrementFlowRunCount } from './lib/context';
import { log, savePurchaseReport, initLogger, obs } from './lib/utils';
import { sendFeishuNotification, sendStoreNotification } from './lib/notify';
import { launchBrowser, saveCookies, getMuteComplianceStatus } from './lib/browser';
import { ensureLogin, waitForPageReady, closeModals } from './lib/page-helpers';
import { isDeadLoop } from './lib/task-center';
import { StepResult, StepContext, PurchaseReport, NoStockSku } from './lib/types-v2';

import { stepSearchAndCart } from './steps/step-search-and-cart';
import { stepCheckAndExportCart } from './steps/step-check-and-export-cart';
import { stepTransformExcel } from './steps/step-transform-excel';
import { stepCleanCart } from './steps/step-clean-cart';
import { stepSubmitOrder } from './steps/step-submit-order';

const STEP_MAP: Record<number, string> = {
  1: 'search-and-cart',
  2: 'check-and-export-cart',
  3: 'transform-excel',
  4: 'clean-cart',
  5: 'submit-order',
};

const NAME_TO_NUM: Record<string, number> = {};
for (const [num, name] of Object.entries(STEP_MAP)) {
  NAME_TO_NUM[name] = parseInt(num);
}

// --- Step dispatcher ---

async function runStep(
  stepNum: number,
  page: Page,
  config: PurchaseConfig,
  ctx: StepContext,
): Promise<StepResult> {
  switch (stepNum) {
    case 1: return stepSearchAndCart(page, config, ctx);
    case 2: return stepCheckAndExportCart(page, config, ctx);
    case 3: return stepTransformExcel(page, config, ctx);
    case 4: return stepCleanCart(page, config, ctx);
    case 5: return stepSubmitOrder(page, config, ctx);
    default:
      return { step: 'unknown', success: false, message: '未知步骤: ' + stepNum };
  }
}

// --- Parse step range ---

function parseStepRange(stepArg: string): number[] {
  // "5-7" -> [5, 6, 7]
  if (stepArg.includes('-')) {
    const [startStr, endStr] = stepArg.split('-');
    const start = parseStepNum(startStr.trim());
    const end = parseStepNum(endStr.trim());
    if (start <= 0 || end <= 0 || start > end) {
      throw new Error('无效步骤范围: ' + stepArg);
    }
    const steps: number[] = [];
    for (let i = start; i <= end; i++) steps.push(i);
    return steps;
  }
  // Single step
  const num = parseStepNum(stepArg);
  if (num <= 0) throw new Error('无效步骤: ' + stepArg);
  return [num];
}

function parseStepNum(s: string): number {
  const n = parseInt(s, 10);
  if (!isNaN(n) && n >= 1 && n <= 5) return n;
  if (NAME_TO_NUM[s]) return NAME_TO_NUM[s];
  return 0;
}

async function keepBrowserOpenForInspection(
  page: Page,
  context: BrowserContext,
  reason: string,
): Promise<void> {
  await saveCookies(context).catch(() => {});
  log('');
  log('[调试停留] ' + reason);
  log('[调试停留] 当前页面: ' + page.url());
  log('[调试停留] 已取消等待终端按键，直接保存现场后关闭浏览器');

  await saveCookies(context);
  await context.close();
}

// --- Main ---

async function main() {
  const { overrides, step: stepArg, dryRun } = parseCLI();
  const config = loadConfig(overrides);
  initLogger();
  const dateStr = new Date().toLocaleDateString('zh-CN');
  const startTimeISO = new Date().toISOString();

  log('='.repeat(50));
  log('牵牛花自动采购 v2 (modular) - ' + config.supplier);
  log('日期: ' + dateStr);
  log('模式: ' + (dryRun ? 'DRY RUN' : stepArg ? '单步/范围 --step ' + stepArg : '完整流程'));
  log('='.repeat(50));

  if (dryRun) {
    log('配置: ' + JSON.stringify(config, null, 2));
    return;
  }

  // 全流程熔断：同一供应商同一天超过 N 次则终止
  const MAX_FLOW_RUNS = 5;
  if (!stepArg) {
    const runCount = getFlowRunCount(config.supplier);
    if (runCount >= MAX_FLOW_RUNS) {
      log('熔断: ' + config.supplier + ' 今日已运行 ' + runCount + ' 次完整流程，超过上限 ' + MAX_FLOW_RUNS + '，终止');
      obs('warn', '触发全流程熔断', {
        stage: 'flow.circuit-breaker',
        code: 'QNH_FLOW_CIRCUIT_BREAK',
        reason: `今日完整流程运行次数=${runCount}，超过上限=${MAX_FLOW_RUNS}`,
        retryable: false,
      }, { supplier: config.supplier, runCount, maxRuns: MAX_FLOW_RUNS });
      log('如需继续，请手动删除 data/context/circuit-breaker.json');
      return;
    }
    const newCount = incrementFlowRunCount(config.supplier);
    log('全流程运行计数: ' + newCount + '/' + MAX_FLOW_RUNS);
  }

  const { browser, context, page } = await launchBrowser();
  let shouldKeepOpenForInspection = false;
  let inspectionReason = '';

  // 登录并跳转到补货建议页，作为完整流程的起始页面
  const targetUrl = config.baseUrl + '/home.html#/purchase/replenishment/refer?fromTask=0';
  await ensureLogin(page, targetUrl, config.timeouts.loginWait);

  let ctx = loadContext() || createEmptyContext(config.supplier);
  ctx.supplier = config.supplier;
  ctx.stepResults = []; // 每次运行重置，避免历史累积

  // --- Single step or range mode ---
  if (stepArg) {
    const steps = parseStepRange(stepArg);
    log('运行步骤: ' + steps.map(n => n + '(' + STEP_MAP[n] + ')').join(', '));

    for (const stepNum of steps) {
      const err = validateContext(ctx, stepNum);
      if (err) {
        log('上下文校验失败: ' + err);
        shouldKeepOpenForInspection = true;
        inspectionReason = '步骤执行前上下文校验失败: ' + err;
        break;
      }

      log('\n--- Step ' + stepNum + ': ' + STEP_MAP[stepNum] + ' ---');
      const result = await runStep(stepNum, page, config, ctx);
      ctx.stepResults.push(result);
      saveContext(ctx);
      log('结果: ' + (result.success ? 'OK' : 'FAIL') + ' - ' + result.message);

      if (!result.success) {
        log('步骤失败，终止');
        shouldKeepOpenForInspection = true;
        inspectionReason = 'Step ' + stepNum + ' 失败: ' + result.message;
        break;
      }
    }

    if (shouldKeepOpenForInspection) {
      await keepBrowserOpenForInspection(page, context, inspectionReason);
    } else {
      await saveCookies(context);
      await context.close();
    }
    return;
  }

  // --- Full flow ---
  let purchaseSuccess = false;
  let totalRounds = 0;
  let allNoStockSkus: NoStockSku[] = [];
  let errorMessage = '';

  try {
    // Steps 1-3
    for (let stepNum = 1; stepNum <= 3; stepNum++) {
      log('\n--- Step ' + stepNum + ': ' + STEP_MAP[stepNum] + ' ---');
      const result = await runStep(stepNum, page, config, ctx);
      ctx.stepResults.push(result);
      saveContext(ctx);

      if (!result.success) {
        obs('error', '步骤执行失败', {
          stage: 'step.run',
          code: 'QNH_STEP_RUN_FAILED',
          reason: `step=${stepNum} message=${result.message}`,
          retryable: false,
        }, { stepNum, stepName: STEP_MAP[stepNum], supplier: config.supplier });
        throw new Error('Step ' + stepNum + ' 失败: ' + result.message);
      }
    }

    // Retry loop: step 4 (clean) + step 5 (submit)
    const maxRetries = config.retry.maxRetries;
    for (let round = 1; round <= maxRetries; round++) {
      totalRounds = round;
      ctx.round = round;
      log('\n--- 第 ' + round + ' 轮 ---');

      if (round > 1 && ctx.replenishListNo) {
        await page.goto(
          config.baseUrl + '/home.html#/purchase/replenish-dispatch/detail-list?replenishListNo=' + ctx.replenishListNo + '&replenishMode=1',
          { waitUntil: 'networkidle', timeout: 30000 },
        );
        await waitForPageReady(page);
        await closeModals(page);
      }

      // Step 4: clean cart
      log('\n--- Step 4: clean-cart ---');
      const cleanResult = await stepCleanCart(page, config, ctx);
      ctx.stepResults.push(cleanResult);
      saveContext(ctx);

      // Step 5: submit order
      if (!cleanResult.success) {
        errorMessage = 'Step 4 失败: ' + cleanResult.message;
        log('\n' + errorMessage);
        obs('error', 'Step 4 失败，终止进入建单', {
          stage: 'step.run',
          code: 'QNH_STEP4_CLEAN_FAILED',
          reason: errorMessage,
          retryable: false,
        }, { round, supplier: config.supplier, stepName: 'clean-cart' });
        break;
      }

      log('\n--- Step 5: submit-order ---');
      const submitResult = await stepSubmitOrder(page, config, ctx);
      ctx.stepResults.push(submitResult);
      saveContext(ctx);

      if (submitResult.success) {
        purchaseSuccess = true;
        log('\n第 ' + round + ' 轮完成，采购成功');
        break;
      }

      const noStockSkus: NoStockSku[] = submitResult.data?.noStockSkus || [];
      if (noStockSkus.length > 0) {
        if (isDeadLoop(ctx.prevRoundNoStockSkus, noStockSkus)) {
          errorMessage = '连续两轮相同SKU失败，终止重试（死循环检测）';
          log('\n' + errorMessage);
          obs('warn', '检测到死循环并终止重试', {
            stage: 'flow.main',
            code: 'QNH_FLOW_DEAD_LOOP_DETECTED',
            reason: `round=${round} noStockSkus重复`,
            retryable: false,
          }, { round, noStockSkuCount: noStockSkus.length, supplier: config.supplier });
          break;
        }

        ctx.prevRoundNoStockSkus = noStockSkus;
        ctx.noStockSkus = noStockSkus;
        allNoStockSkus = [...allNoStockSkus, ...noStockSkus];
        log('\n发现 ' + noStockSkus.length + ' 种无库存SKU');

        if (round < maxRetries) {
          log('准备第 ' + (round + 1) + ' 轮');
        }
      } else {
        errorMessage = '采购失败，无法确定原因';
        log('\n' + errorMessage);
        break;
      }
    }
  } catch (err: any) {
    errorMessage = err.message || String(err);
    log('\n错误: ' + errorMessage);
    shouldKeepOpenForInspection = true;
    inspectionReason = '主流程异常: ' + errorMessage;
    obs('error', '主流程异常', {
      stage: 'flow.main',
      code: 'QNH_FLOW_MAIN_EXCEPTION',
      reason: errorMessage,
      retryable: false,
    }, { supplier: config.supplier, totalRounds });
  }

  // --- Report ---
  const uniqueNoStock = Array.from(new Map(allNoStockSkus.map(s => [s.sku, s])).values());
  const endTimeISO = new Date().toISOString();
  const durationMinutes = Math.round((Date.now() - new Date(startTimeISO).getTime()) / 60000 * 10) / 10;

  // 从最后一次成功的 submit-order 提取金额和单数
  const lastSubmit = [...ctx.stepResults].reverse().find(s => s.step === 'submit-order' && s.success);
  const pendingOrders: any[] = lastSubmit?.data?.pendingOrders || [];
  const totalAmount = pendingOrders.reduce((sum: number, o: any) => {
    const amt = typeof o.amount === 'string' ? parseFloat(o.amount.replace(/,/g, '')) : (o.amount || 0);
    return sum + (isNaN(amt) ? 0 : amt);
  }, 0);
  const orderCount = pendingOrders.length;

  const report: PurchaseReport = {
    platform: 'qianniuhua',
    supplier: config.supplier,
    date: dateStr,
    startTime: startTimeISO,
    endTime: endTimeISO,
    durationMinutes,
    totalRounds,
    success: purchaseSuccess,
    planOrderId: ctx.planOrderId || '',
    outOrderId: ctx.outOrderId || '',
    totalAmount,
    orderCount,
    totalItems: ctx.totalItems || 0,
    noStockSkuCount: uniqueNoStock.length,
    noStockSkus: uniqueNoStock,
    errorMessage,
    muteCompliance: getMuteComplianceStatus(),
    steps: ctx.stepResults,
  };

  savePurchaseReport(report);
  if (!purchaseSuccess) {
    obs('warn', '采购报告记录失败结果', {
      stage: 'report.generate',
      code: 'QNH_REPORT_PURCHASE_FAILED',
      reason: errorMessage || '流程结束但结果为失败',
      retryable: false,
    }, {
      supplier: config.supplier,
      totalRounds,
      noStockSkuCount: uniqueNoStock.length,
    });
  }
  if (config.notification.webhook) {
    if ((purchaseSuccess && config.notification.onSuccess) || (!purchaseSuccess && config.notification.onFailure)) {
      await sendFeishuNotification(report, config.notification.webhook);
    }
  }

  // 门店群通知：采购成功且有订单数据时发送
  if (purchaseSuccess && config.notification.storeWebhook && pendingOrders.length > 0) {
    await sendStoreNotification(config.supplier, pendingOrders, config.notification.storeWebhook);
  }

  log('\n' + '='.repeat(50));
  log('供应商: ' + config.supplier);
  log('总轮次: ' + totalRounds);
  log('结果: ' + (purchaseSuccess ? '成功' : '失败'));
  log('静音合规: ' + getMuteComplianceStatus());
  if (ctx.outOrderId) log('1688订单: ' + ctx.outOrderId);
  if (uniqueNoStock.length) log('无库存SKU: ' + uniqueNoStock.length + '种');
  log('总耗时: ' + durationMinutes + '分钟');
  log('='.repeat(50));

  if (shouldKeepOpenForInspection) {
    await keepBrowserOpenForInspection(page, context, inspectionReason || '流程失败，等待人工检查');
  } else {
    await saveCookies(context);
    await context.close();
  }
}

main().catch(err => {
  log('致命错误: ' + err.message);
  process.exit(1);
});
