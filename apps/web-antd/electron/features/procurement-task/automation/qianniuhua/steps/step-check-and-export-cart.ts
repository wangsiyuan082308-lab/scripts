/**
 * Step 2: 批量检查库存 + 导出补货清单Excel
 *
 * 独立运行: npx ts-node src/steps/step-check-and-export-cart.ts [--supplier 供应商]
 */
import { Page } from 'playwright';
import { PurchaseConfig, loadConfig, parseCLI } from '../lib/config';
import { StepResult, StepContext } from '../lib/types-v2';
import { closeModals, switchToMaxPerPage } from '../lib/page-helpers';
import { exportViaTaskCenter } from '../lib/task-center';
import { log } from '../lib/utils';
import { saveContext, loadContext, createEmptyContext } from '../lib/context';

export async function stepCheckAndExportCart(
  page: Page, config: PurchaseConfig, ctx: StepContext,
): Promise<StepResult> {
  log('\n========== Step 2: 批量检查库存 + 导出补货清单 ==========');

  try {
    await closeModals(page);
    await switchToMaxPerPage(page);
    await page.waitForTimeout(2000);

    log('  Step 2a: 点击"批量补货检查"');
    const batchCheckBtn = page.locator('button').filter({ hasText: /批量补货检查/ }).first();
    if (!await batchCheckBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      throw new Error('未找到"批量补货检查"按钮，请人工检查页面状态');
    }
    await batchCheckBtn.click();
    await page.waitForTimeout(1500);

    log('  Step 2b: 选择"检查全部商品"');
    await selectCheckOption(page);
    await waitForStockCheck(page, config.timeouts.stockCheckTimeout);

    await page.waitForTimeout(2000);

    const filepath = await attemptExport(page, config);
    ctx.cartFile = filepath;
    return { step: 'check-and-export-cart', success: true, message: '导出成功: ' + filepath };
  } catch (e: any) {
    return { step: 'check-and-export-cart', success: false, message: e.message };
  }
}
async function selectCheckOption(page: Page): Promise<void> {
  // 限定到可见下拉菜单范围
  const dropdownItems = page.locator(
    '.purchase-ant-dropdown:visible [role="menuitem"], ' +
    '.purchase-ant-dropdown-menu:visible li, ' +
    '.purchase-ant-dropdown:visible .purchase-ant-dropdown-menu-item',
  );

  const checkAllBtn = dropdownItems.filter({ hasText: /检查全部商品/ }).first();
  if (await checkAllBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await checkAllBtn.click();
    log('  已点击检查全部商品');
    return;
  }

  const checkFilterBtn = dropdownItems.filter({ hasText: /检查筛选结果/ }).first();
  if (await checkFilterBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await checkFilterBtn.click();
    log('  已点击检查筛选结果');
    return;
  }

  // 确认弹窗（部分场景直接弹确认框而非下拉菜单）
  const confirmBtn = page.locator('.purchase-ant-modal-wrap button')
    .filter({ hasText: /确[定认]/ }).first();
  if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await confirmBtn.click();
    log('  已确认批量检查');
    return;
  }

  throw new Error('未找到"检查全部商品"或"检查筛选结果"选项，下拉菜单可能未弹出');
}

async function waitForStockCheck(page: Page, timeout: number): Promise<void> {
  log('  等待库存检查完成（最多' + Math.round(timeout / 60000) + '分钟）...');

  // 先等 2 秒让检查状态出现
  await page.waitForTimeout(2000);

  try {
    await page.waitForFunction(() => {
      const text = document.body.innerText;
      const hasChecking = text.includes('检查中') || text.includes('检测中') || text.includes('查询中');
      const hasSpinner = document.querySelector('.purchase-ant-spin-spinning') !== null;
      return !hasChecking && !hasSpinner;
    }, { timeout });
    log('  库存检查完成');
  } catch {
    log('  库存检查超时（' + Math.round(timeout / 60000) + '分钟），继续导出当前状态');
  }

  // 检查完成后等 1 秒再导出
  await page.waitForTimeout(1000);
}
async function attemptExport(page: Page, config: PurchaseConfig): Promise<string> {
  const exportBtn = page.locator('button').filter({ hasText: /导\s*出/ }).first();
  if (!await exportBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    throw new Error('Step 2: 未找到导出按钮，补货清单可能为空');
  }

  // 等待按钮启用（检查完后可能有延迟）
  const enabled = await exportBtn.isEnabled({ timeout: 5000 }).catch(() => false);
  if (!enabled) {
    log('  导出按钮暂时禁用，刷新页面...');
    await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
    await closeModals(page);

    // 刷新后重新找按钮
    const retryBtn = page.locator('button').filter({ hasText: /导\s*出/ }).first();
    const retryEnabled = await retryBtn.isEnabled({ timeout: 10000 }).catch(() => false);
    if (!retryEnabled) {
      throw new Error('Step 2: 导出按钮仍然禁用，可能没有可导出的数据');
    }
  }

  await exportBtn.click();
  log('  已点击导出');
  await page.waitForTimeout(2000);
  await closeModals(page);

  // 通过任务中心API轮询下载
  const queryTypes = config.taskCenter.cartExportQueryTypes;
  for (const qt of queryTypes) {
    try {
      const filepath = await exportViaTaskCenter(
        page,
        async () => { /* 已经点过导出了 */ },
        qt,
        { exportPollInterval: config.timeouts.exportPollInterval, exportMaxWait: 60000 },
      );
      return filepath;
    } catch (e: any) {
      if (e.message.includes('导出超时')) {
        log('  queryType=' + qt + ' 无结果，尝试下一个...');
        continue;
      }
      throw e;
    }
  }
  throw new Error('Step 2: 所有queryType均无结果');
}

// 独立运行入口
if (require.main === module) {
  const { overrides } = parseCLI();
  const config = loadConfig(overrides);
  const ctx = loadContext() || createEmptyContext(config.supplier);

  (async () => {
    const { launchBrowser } = await import('../lib/browser');
    const { ensureLogin } = await import('../lib/page-helpers');

    const { context, page } = await launchBrowser();
    const targetUrl = ctx.replenishListNo
      ? config.baseUrl + '/home.html#/purchase/replenish-dispatch/detail-list?replenishListNo=' + ctx.replenishListNo + '&replenishMode=1'
      : config.baseUrl + '/home.html#/purchase/replenishment/refer?fromTask=0';
    await ensureLogin(page, targetUrl, config.timeouts.loginWait);

    try {
      const result = await stepCheckAndExportCart(page, config, ctx);
      log('\n结果: ' + JSON.stringify(result));
      if (result.success) saveContext(ctx);
    } finally {
      await context.close();
    }
  })().catch(e => { log('ERROR: ' + e.message); process.exit(1); });
}
