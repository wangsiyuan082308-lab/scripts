/**
 * 翱象自动采购 v4 — 主编排器
 *
 * 配置驱动、步骤解耦、每步可独立运行
 *
 * 用法:
 *   npx ts-node src/auto-purchase-v4.ts                          # 完整流程（读配置）
 *   npx ts-node src/auto-purchase-v4.ts --supplier "1688平台"    # 覆盖供应商
 *   npx ts-node src/auto-purchase-v4.ts --max-per-store 200      # 每店限制
 *   npx ts-node src/auto-purchase-v4.ts --step check             # 只检查状态
 *   npx ts-node src/auto-purchase-v4.ts --step retry             # 只处理失败
 *   npx ts-node src/auto-purchase-v4.ts --step clean             # 只清理补货单
 *   npx ts-node src/auto-purchase-v4.ts --step add               # 只加入补货单
 *   npx ts-node src/auto-purchase-v4.ts --step order             # 只创建采购单
 *   npx ts-node src/auto-purchase-v4.ts --dry-run                # 预览不执行
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { loadConfig, parseCLI, PurchaseConfig } from './lib/config';
import { log, setStartTime } from './lib/utils';
import { StepAddAudit, StepResult, PurchaseReport, REPORTS_DIR, DATA_DIR } from './lib/types-v4';
import { launchBrowser } from '../lib/browser';
import { ensureLogin } from './lib/page-helpers';
import { stepClean } from './steps/step-clean';
import { stepAdd } from './steps/step-add';
import { stepOrder } from './steps/step-order';
import { stepCheck, CheckResult } from './steps/step-check';
import { stepRetry } from './steps/step-retry';
import { sendWebhook, formatReport, formatStoreNotification } from './lib/notify';
import { acquireProcessLock, releaseProcessLock } from './lib/process-lock';
import { checkFrequency, recordPurchase } from './lib/frequency';

const START_TIME = Date.now();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
setStartTime(START_TIME);

// Signal handlers for graceful cleanup
process.on('SIGTERM', () => { releaseProcessLock(); process.exit(143); });
process.on('SIGINT', () => { releaseProcessLock(); process.exit(130); });
process.on('uncaughtException', (err) => { log(`未捕获异常: ${err}`); releaseProcessLock(); process.exit(1); });

const AOIXIANG_TARGET_URL = 'https://saas-retail.ele.me/#/replenish/detail';

function formatRuleSummary(config: PurchaseConfig): string[] {
  const summary = config.procurementRuleSummary;
  const matchedRule = summary.matchedSupplierRule
    ? `${summary.matchedSupplierRule.id || 'no-id'} / ${summary.matchedSupplierRule.name}`
    : '未命中';

  return [
    '最终生效规则摘要:',
    `  供应商输入: ${summary.supplierInput}`,
    `  规则命中: ${matchedRule}`,
    `  全局启用Tabs: ${summary.globalEnabledTabs.join(', ') || '无'}`,
    `  供应商allowedTabs: ${summary.supplierAllowedTabs.join(', ') || '未配置'}`,
    `  最终执行Tabs: ${summary.finalAllowedTabs.join(', ') || '无'}`,
    `  strict: ${summary.strict}`,
    `  requireQueryAfterFilter: ${summary.requireQueryAfterFilter}`,
    `  requireResultVerification: ${summary.requireResultVerification}`,
    `  requireNonEmptyCartBeforeOrder: ${summary.requireNonEmptyCartBeforeOrder}`,
    `  stopOnSupplierMismatch: ${summary.stopOnSupplierMismatch}`,
  ];
}

async function main() {
  const { overrides, step, dryRun } = parseCLI();
  const config = loadConfig(overrides);

  // 如果 CLI 传了 --max-per-store 且 config.stores 有通配符，应用到所有门店
  if (overrides.stores?.length === 1 && overrides.stores[0].name === '*') {
    const maxItems = overrides.stores[0].maxItems;
    if (config.stores.length > 0) {
      config.stores = config.stores.map(s => ({ ...s, maxItems }));
    } else {
      config.stores = [{ name: '*', code: '*', maxItems }];
    }
  }

  log('=== 翱象自动采购 v4 ===');
  log(`供应商: ${config.supplier}`);
  log(`门店: ${config.stores.length > 0 ? config.stores.map(s => `${s.name}(max:${s.maxItems})`).join(', ') : '全量'}`);
  log(`Tabs: ${config.tabs.filter(t => t.enabled).map(t => t.name).join(', ')}`);
  log(`清理补货单: ${config.cleanCartBefore}`);
  for (const line of formatRuleSummary(config)) {
    log(line);
  }
  if (step) log(`单步模式: ${step}`);
  if (dryRun) log(`⚠️ DRY RUN 模式`);

  if (!acquireProcessLock()) {
    log('另一个采购实例正在运行，退出');
    return;
  }

  if (dryRun) {
    log('\n配置预览:');
    log(JSON.stringify(config, null, 2));
    releaseProcessLock();
    return;
  }

  if (!dryRun && !step) {
    const freq = checkFrequency(config.supplier, 12);
    if (!freq.allowed) {
      log(`采购频率控制: ${config.supplier} 距上次采购仅 ${freq.hoursSince?.toFixed(1)} 小时（最小间隔 12h），跳过`);
      releaseProcessLock();
      return;
    }
  }

  // 使用共享浏览器管理器
  const userDataDir = path.resolve(__dirname, '../', config.browser.userDataDir || './user_data');
  const { browser, context, page } = await launchBrowser({
    cdpPort: 18792,
    userDataDir,
    headless: config.browser.headless,
    log,
  });

  // 确保登录
  try {
    await ensureLogin(page, AOIXIANG_TARGET_URL, {
      maxWait: 180000, // 3分钟等待手动登录
      loginIndicators: ['login', 'passport', '欢迎登录'],
      log,
    });
    
    // 额外检测：确认页面上有供应商选择器（真正进入采购页）
    log('检测页面是否加载完成...');
    let hasSupplier = false;
    for (let i = 0; i < 30; i++) { // 最多等待30秒
      const supplierLabel = await page.locator('.ant-form-item-label:has-text("供应商"), .ant-form-item-label:has-text("供应商名称")').count();
      if (supplierLabel > 0) {
        hasSupplier = true;
        log('✅ 页面加载完成，已进入补货建议页');
        break;
      }
      await page.waitForTimeout(1000);
    }
    if (!hasSupplier) {
      log('⚠️ 未检测到供应商选择器，可能需要手动登录');
      // 保持浏览器打开等待用户登录
      for (let i = 0; i < 60; i++) {
        const supplierLabel = await page.locator('.ant-form-item-label:has-text("供应商"), .ant-form-item-label:has-text("供应商名称")').count();
        if (supplierLabel > 0) {
          hasSupplier = true;
          log('✅ 检测到登录成功，继续执行');
          break;
        }
        await page.waitForTimeout(3000);
      }
      if (!hasSupplier) {
        throw new Error('登录超时：60秒内未检测到采购页面');
      }
    }
  } catch (e: any) {
    log(`❌ 登录超时: ${e.message}`);
    releaseProcessLock();
    await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    return;
  }

  const steps: StepResult[] = [];
  let planOrderId = '';
  let checkData: CheckResult | undefined;
  let stepAddAudit: StepAddAudit | undefined;

  try {
    // 单步模式
    if (step) {
      let result: StepResult;
      switch (step) {
        case 'clean':
          result = await stepClean(page, config);
          break;
        case 'add':
          result = await stepAdd(page, config);
          break;
        case 'order':
          result = await stepOrder(page, config);
          break;
        case 'check': {
          const r = await stepCheck(page, config);
          result = r;
          checkData = r.data;
          break;
        }
        case 'retry': {
          const checkR = await stepCheck(page, config);
          checkData = checkR.data;
          result = await stepRetry(page, config, checkData);
          break;
        }
        default:
          log(`❌ 未知步骤: ${step}`);
          log('可用步骤: clean, add, order, check, retry');
          releaseProcessLock();
          await context.close().catch(() => {});
          if (browser) await browser.close().catch(() => {});
          return;
      }
      if (result.step === 'add') {
        stepAddAudit = result.data?.audit;
      }
      steps.push(result);
      log(`\n结果: ${result.success ? '✅' : '❌'} ${result.message}`);
      releaseProcessLock();
      await context.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
      return;
    }

    // 完整流程
    // Step 0: 清理
    const cleanResult = await stepClean(page, config);
    steps.push(cleanResult);

    // Step 1: 加入补货单
    const addResult = await stepAdd(page, config);
    stepAddAudit = addResult.data?.audit;
    steps.push(addResult);

    if (!addResult.success) {
      log('\n❌ 加入补货单失败（' + addResult.message + '），跳过后续步骤');
    } else {
      // Step 2: 创建采购单
      const orderResult = await stepOrder(page, config);
      steps.push(orderResult);
      if (orderResult.data?.planOrderId) {
        planOrderId = orderResult.data.planOrderId;
      }

      if (!orderResult.success) {
        log('\n❌ 创建采购单失败，终止');
      } else {
        // Step 3: 检查状态
        const checkResult = await stepCheck(page, config, planOrderId);
        steps.push(checkResult);
        checkData = checkResult.data;

        // Step 4: 处理失败（如果有）
        if (!checkResult.success) {
          const retryResult = await stepRetry(page, config, checkData);
          steps.push(retryResult);
        }
      }
    }

    // 生成报告
    const now = new Date();
    const report: PurchaseReport = {
      platform: 'aoixiang',
      supplier: config.supplier,
      date: now.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }).replace(/\//g, '-'),
      startTime: new Date(START_TIME).toISOString(),
      endTime: now.toISOString(),
      durationMinutes: parseFloat(((Date.now() - START_TIME) / 60000).toFixed(1)),
      steps,
      planOrderId,
      totalItems: checkData ? checkData.successCount + checkData.failedCount + checkData.pendingCount : 0,
      successCount: checkData?.successCount ?? 0,
      failedCount: checkData?.failedCount ?? 0,
      failedOrders: checkData?.failedOrders || [],
      noStockSkus: [],
      errorMessage: steps.find(s => !s.success)?.message || '',
      stepAddAudit,
    };

    // 保存报告
    if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
    const ts = now.toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const reportFile = `${REPORTS_DIR}/report-v4-${ts}.json`;
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    log(`\n📊 报告: ${reportFile}`);

    // 记录采购完成时间
    recordPurchase(config.supplier);

    // 发送通知
    if (config.notification.webhook) {
      const shouldNotify = (report.failedCount === 0 && config.notification.onSuccess)
        || (report.failedCount > 0 && config.notification.onFailure);
      if (shouldNotify) {
        await sendWebhook(config.notification.webhook, formatReport(report));
      }
    }

    // 发送门店群通知（有成功订单时才发）
    if (config.notification.storeWebhook && checkData && checkData.successOrders?.length > 0) {
      await sendWebhook(
        config.notification.storeWebhook,
        formatStoreNotification(config.supplier, checkData.successOrders),
      );
    }

    // 最终汇总
    log(`\n${'='.repeat(50)}`);
    log('最终汇总');
    log(`${'='.repeat(50)}`);
    for (const s of steps) {
      log(`  ${s.success ? '✅' : '❌'} ${s.step}: ${s.message}`);
    }
    log(`  耗时: ${report.durationMinutes}分钟`);

  } catch (e: any) {
    log(`\n❌ 致命错误: ${e.message}`);
    steps.push({ step: 'fatal', success: false, message: e.message });
    // 失败时截图保存
    const screenshotPath = path.join(DATA_DIR, `error-${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    log(`📸 截图已保存: ${screenshotPath}`);
    // 保持浏览器打开30秒让用户看到
    log(`⏳ 浏览器将保持打开30秒，请查看页面状态...`);
    await page.waitForTimeout(30000);
  }

  releaseProcessLock();
  await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
}

main().catch(e => { log(`❌ ${e.message}`); process.exit(1); });
