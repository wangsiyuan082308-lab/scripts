/**
 * Step 4: 处理失败采购单
 * 
 * 按失败类型分别处理：
 * - 待下单(pending): 全选 → 重新下单
 * - 数量换算: 作废 → 后续重新走流程（调整数量）
 * - 无库存: 作废
 * - 混批限制: 作废
 * 
 * 独立运行: npx ts-node src/steps/step-retry.ts
 */
import { chromium, Page } from 'playwright';
import { PurchaseConfig, loadConfig, parseCLI } from '../lib/config';
import { log } from '../lib/utils';
import { StepResult, FailedOrder } from '../lib/types-v4';
import { closeModals, switchToMaxPerPageFusion, goNextPage } from '../lib/page-helpers';
import { CheckResult } from './step-check';

/** 在采购单列表页，全选待下单的 → 点下单 */
async function retryPendingOrders(page: Page): Promise<number> {
  log('\n  --- 处理待下单采购单 ---');

  // 全选
  const theadCb = page.locator('thead .ant-checkbox-input').first();
  if (await theadCb.isVisible({ timeout: 3000 }).catch(() => false)) {
    if (!await theadCb.isChecked().catch(() => false)) {
      await theadCb.click();
      await page.waitForTimeout(1000);
    }
  }

  // 找"下单"按钮
  const orderBtns = await page.locator('button:has-text("下单"), a:has-text("下单")').all();
  for (const btn of orderBtns) {
    const text = await btn.textContent().catch(() => '');
    if (text?.includes('批量') || text?.trim() === '下单') {
      if (await btn.isVisible().catch(() => false) && !await btn.isDisabled().catch(() => true)) {
        await btn.click();
        log('  ✅ 已点击"下单"');
        await page.waitForTimeout(3000);

        // 确认弹窗
        for (let i = 0; i < 3; i++) {
          const confirmBtn = page.locator('.ant-modal:visible .ant-btn-primary').first();
          if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
            await confirmBtn.click();
            await page.waitForTimeout(3000);
          }
        }
        await closeModals(page);
        log('  等待30秒处理...');
        await page.waitForTimeout(30000);
        return 1;
      }
    }
  }

  log('  ⚠️ 未找到可用的"下单"按钮');
  return 0;
}

/** 作废指定的采购单（按 orderId 精确匹配） */
async function voidOrders(page: Page, orderIds: string[]): Promise<number> {
  if (orderIds.length === 0) return 0;
  log('\n  --- 作废 ' + orderIds.length + ' 个失败采购单: ' + orderIds.slice(0, 5).join(', ') + (orderIds.length > 5 ? '...' : '') + ' ---');

  let voided = 0;
  let pageNum = 1;

  while (true) {
    await closeModals(page);

    // 在当前页按 orderId 精确匹配，找到对应行的"作废"链接
    const voidResult = await page.evaluate((ids: string[]) => {
      const rows = Array.from(document.querySelectorAll('tbody tr'));
      for (const row of rows) {
        const text = (row as HTMLElement).innerText || '';
        // 检查该行是否包含目标 orderId
        const matched = ids.some(id => text.includes(id));
        if (!matched) continue;
        // 确认是失败/待下单状态
        if (!(text.includes('待下单') || text.includes('下单失败'))) continue;
        const links = row.querySelectorAll('a');
        for (const link of Array.from(links)) {
          if ((link as HTMLElement).textContent?.trim() === '作废') {
            (link as HTMLElement).click();
            return true;
          }
        }
      }
      return false;
    }, orderIds);

    if (!voidResult) {
      // 当前页没有可作废的了，翻页
      if (await goNextPage(page)) {
        pageNum++;
        continue;
      }
      break;
    }

    // 确认弹窗
    await page.waitForTimeout(1500);
    const confirmBtn = page.locator('.ant-modal:visible .ant-btn-primary, .ant-modal-confirm:visible .ant-btn-primary').first();
    if (await confirmBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await confirmBtn.click();
      await page.waitForTimeout(2000);
    }
    await closeModals(page);

    voided++;
    if (voided % 10 === 0) log('    已作废 ' + voided + ' 条');
    await page.waitForTimeout(1000);

    // 安全阀：不超过目标数量
    if (voided >= orderIds.length) break;
    if (voided >= 200) break;
  }

  log('  已作废 ' + voided + ' 条');
  return voided;
}

export async function stepRetry(page: Page, config: PurchaseConfig, checkResult?: CheckResult): Promise<StepResult> {
  log('\n========== Step 4: 处理失败采购单 ==========');

  if (!checkResult || (checkResult.failedCount === 0 && checkResult.pendingCount === 0)) {
    log('  无失败采购单，跳过');
    return { step: 'retry', success: true, message: '无需处理' };
  }

  // 确保在采购单列表页
  await page.goto('https://saas-retail.ele.me/#/chain/order/purchase', {
    waitUntil: 'networkidle', timeout: 30000,
  }).catch(() => {});
  await page.waitForTimeout(8000);
  await closeModals(page);
  await switchToMaxPerPageFusion(page);

  const actions: string[] = [];

  // 1. 待下单的 → 重新下单
  if (checkResult.pendingCount > 0) {
    const retried = await retryPendingOrders(page);
    if (retried > 0) actions.push(`重新下单${checkResult.pendingCount}个`);
  }

  // 2. 失败的 → 按策略处理
  const { failuresByType } = checkResult;

  // 数量换算问题
  if (failuresByType.quantity_mismatch.length > 0) {
    if (config.failedOrderHandling.quantityMismatch === 'adjust') {
      log(`  数量换算问题 ${failuresByType.quantity_mismatch.length} 个 → 作废后重新下单（调整数量）`);
      const ids = failuresByType.quantity_mismatch.map(o => o.orderId);
      const voided = await voidOrders(page, ids);
      actions.push(`数量换算作废${voided}个`);
    } else {
      actions.push(`数量换算跳过${failuresByType.quantity_mismatch.length}个`);
    }
  }

  // 混批限制
  if (failuresByType.mixed_batch.length > 0) {
    log(`  混批限制 ${failuresByType.mixed_batch.length} 个 → 作废`);
    const ids = failuresByType.mixed_batch.map(o => o.orderId);
    const voided = await voidOrders(page, ids);
    actions.push(`混批作废${voided}个`);
  }

  // 无库存
  if (failuresByType.out_of_stock.length > 0) {
    log(`  无库存 ${failuresByType.out_of_stock.length} 个 → 作废`);
    const ids = failuresByType.out_of_stock.map(o => o.orderId);
    const voided = await voidOrders(page, ids);
    actions.push(`无库存作废${voided}个`);
  }

  // 未知失败
  if (failuresByType.unknown.length > 0) {
    log(`  未知失败 ${failuresByType.unknown.length} 个 → 记录`);
    for (const fo of failuresByType.unknown.slice(0, 5)) {
      log(`    ${fo.orderId}: ${fo.failReason.substring(0, 60)}`);
    }
    actions.push(`未知${failuresByType.unknown.length}个(已记录)`);
  }

  const msg = actions.join(', ') || '无操作';
  log(`\n  Step 4 完成: ${msg}`);
  return { step: 'retry', success: true, message: msg };
}
