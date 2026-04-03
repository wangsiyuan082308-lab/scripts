/**
 * Step 0: 清理补货清单
 * 
 * 独立运行: npx ts-node src/steps/step-clean.ts [--supplier 供应商]
 */
import { chromium, Page } from 'playwright';
import { PurchaseConfig, loadConfig, parseCLI } from '../lib/config';
import { log } from '../lib/utils';
import { StepResult } from '../lib/types-v4';
import { launchBrowser } from '../../lib/browser';
import { closeModals, ensureLogin, resetSearch, switchTo100PerPage, goNextPage, selectSupplier, clickQuery } from '../lib/page-helpers';

const AOIXIANG_TARGET_URL = 'https://saas-retail.ele.me/#/replenish/detail';

async function waitForCleanPageReady(page: Page): Promise<void> {
  for (let i = 0; i < 30; i++) {
    const hasSupplierLabel = await page.locator('.ant-form-item-label:has-text("供应商"), .ant-form-item-label:has-text("供应商名称")').count();
    const hasQueryButton = await page.locator('button:has-text("查 询"), button:has-text("查询")').count();
    if (hasSupplierLabel > 0 && hasQueryButton > 0) {
      return;
    }
    await page.waitForTimeout(1000);
  }

  throw new Error('补货清理页未加载完成：未检测到供应商筛选或查询按钮');
}

export async function stepClean(page: Page, config: PurchaseConfig): Promise<StepResult> {
  log('\n========== Step 0: 清理补货清单 (' + config.supplier + ') ==========');

  if (!config.cleanCartBefore) {
    log('  cleanCartBefore=false，跳过清理');
    return { step: 'clean', success: true, message: '跳过（配置关闭）' };
  }

  await ensureLogin(page, AOIXIANG_TARGET_URL, {
    maxWait: 180000,
    loginIndicators: ['login', 'passport', '欢迎登录'],
    log,
  });
  await waitForCleanPageReady(page);
  await closeModals(page);
  await resetSearch(page);

  // 按供应商筛选，只清理当前供应商的数据
  log('  按供应商筛选: ' + config.supplier);
  const hasSupplierMatch = await selectSupplier(page, config.supplier, { allowNoMatch: true });
  if (!hasSupplierMatch) {
    log('  当前供应商在补货单中无可选数据，跳过清理');
    return { step: 'clean', success: true, message: '当前供应商无补货数据，无需清理' };
  }
  await clickQuery(page);
  await switchTo100PerPage(page);

  // 检查是否有商品
  const itemCount = await page.evaluate(() => {
    const total = document.querySelector('.ant-pagination-total-text');
    const text = total?.textContent || '';
    const match = text.match(/共\s*(\d+)/);
    return match ? parseInt(match[1], 10) : 0;
  });

  if (itemCount === 0) {
    log('  补货清单为空，无需清理');
    return { step: 'clean', success: true, message: '补货清单为空' };
  }

  log(`  补货清单有 ${itemCount} 条商品，开始清理...`);

  let totalRemoved = 0;
  let pageNum = 1;

  while (true) {
    await closeModals(page);

    const currentPageRows = await page.locator('tbody tr').count();
    if (currentPageRows === 0) break;

    // 全选当前页
    const theadCb = page.locator('thead .ant-checkbox-input').first();
    if (!await theadCb.isVisible({ timeout: 3000 }).catch(() => false)) break;
    if (await theadCb.isDisabled().catch(() => true)) break; // 空表格 checkbox disabled
    if (!await theadCb.isChecked().catch(() => false)) {
      await theadCb.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(800);
    }

    // 点"移出补货单"
    const removeBtn = page.locator('button:has-text("移出补货单")').first();
    if (await removeBtn.isVisible().catch(() => false) && !await removeBtn.isDisabled().catch(() => true)) {
      await removeBtn.click();
      await page.waitForTimeout(1500);

      // 确认弹窗
      const confirmBtn = page.locator('.ant-modal:visible .ant-btn-primary, .ant-modal-confirm:visible .ant-btn-primary').first();
      if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await confirmBtn.click();
        await page.waitForTimeout(3000);
      }
      await closeModals(page);
      totalRemoved += currentPageRows;
      log(`  第${pageNum}页清理完成，本页移除 ${currentPageRows} 条，累计 ${totalRemoved} 条`);
    } else {
      break;
    }

    // 清理后页面会刷新，检查是否还有数据
    await page.waitForTimeout(2000);
    const remaining = await page.locator('tbody tr').count();
    if (remaining === 0) break;
    pageNum++;
    if (pageNum > 50) break; // 安全阀
  }

  log(`  ✅ 清理完成，共移除 ${totalRemoved} 条`);
  return { step: 'clean', success: true, message: `清理 ${totalRemoved} 条`, data: { removed: totalRemoved } };
}
