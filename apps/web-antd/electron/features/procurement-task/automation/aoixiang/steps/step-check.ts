/**
 * Step 3: 检查采购单状态
 * 
 * 去采购单列表页，分析所有采购单的状态
 * 独立运行: npx ts-node src/steps/step-check.ts
 */
import { chromium, Page } from 'playwright';
import { PurchaseConfig, loadConfig, parseCLI } from '../lib/config';
import { log } from '../lib/utils';
import { StepResult, FailedOrder, NO_STOCK_KEYWORDS, QUANTITY_KEYWORDS, MIXED_BATCH_KEYWORDS } from '../lib/types-v4';
import { closeModals } from '../lib/page-helpers';

/** 在采购单列表页筛选指定状态（Fusion Design 下拉框） */
async function filterByStatus(page: Page, statusText: string): Promise<void> {
  // 找到"采购单状态"标签旁的 select（Fusion Design: next-select）
  // 页面结构：label "采购单状态" 旁边是一个 next-select 下拉框
  const statusSelect = page.locator('.next-form-item:has(.next-form-item-label:has-text("采购单状态")) .next-select, .next-form-item:has(.next-form-item-label:has-text("状态")) .next-select').first();

  if (!await statusSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
    // 备用：找页面上所有 next-select，按位置猜测
    log('  未找到状态筛选框（标签匹配），尝试备用方式');
    return;
  }

  await statusSelect.click();
  await page.waitForTimeout(800);

  // 从下拉菜单选择目标状态
  const option = page.locator('.next-menu.next-select-menu .next-menu-item').filter({ hasText: statusText }).first();
  if (await option.isVisible({ timeout: 2000 }).catch(() => false)) {
    await option.click();
    log(`  已筛选状态: ${statusText}`);
    await page.waitForTimeout(1000);

    // 点击查询按钮
    const queryBtn = page.locator('button:has-text("查询"), button:has-text("搜索")').first();
    if (await queryBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await queryBtn.click();
      await page.waitForTimeout(3000);
    }
  } else {
    log(`  未找到状态选项: ${statusText}`);
    await page.keyboard.press('Escape').catch(() => {});
  }
}

/** 分类失败原因 */
function classifyFailure(reason: string): 'out_of_stock' | 'quantity_mismatch' | 'mixed_batch' | 'unknown' {
  if (NO_STOCK_KEYWORDS.some(kw => reason.includes(kw))) return 'out_of_stock';
  if (QUANTITY_KEYWORDS.some(kw => reason.includes(kw))) return 'quantity_mismatch';
  if (MIXED_BATCH_KEYWORDS.some(kw => reason.includes(kw))) return 'mixed_batch';
  return 'unknown';
}

export interface SuccessOrder {
  storeName: string;
  amount: number;
  account: string;
  orderId: string;
}

export interface CheckResult {
  successCount: number;
  failedCount: number;
  pendingCount: number;
  totalAmount: number;
  storeAmounts: Record<string, { count: number; amount: number }>;
  failedOrders: FailedOrder[];
  successOrders: SuccessOrder[];
  /** 按失败类型分组 */
  failuresByType: Record<string, FailedOrder[]>;
}

/** 切换 Fusion Design 分页到最大每页条数 */
async function switchToMaxPerPageFusion(page: Page): Promise<void> {
  // Fusion pagination has a select near "每页显示" text
  const selectTrigger = page.locator('.next-pagination .next-select').first();
  if (!await selectTrigger.isVisible({ timeout: 3000 }).catch(() => false)) {
    throw new Error('未找到 Fusion 分页选择器');
  }

  await selectTrigger.click();
  await page.waitForTimeout(800);

  // Pick the largest option from the dropdown menu
  const menuItems = page.locator('.next-menu.next-select-menu .next-menu-item');
  await menuItems.first().waitFor({ state: 'visible', timeout: 3000 });
  const count = await menuItems.count();
  if (count === 0) {
    await page.keyboard.press('Escape').catch(() => {});
    throw new Error('Fusion 分页下拉无选项');
  }

  // Click the last (largest) option
  await menuItems.nth(count - 1).click();
  log('  已切换到最大分页');
  await page.waitForTimeout(2000);
}

/** Fusion Design 翻到下一页，返回 false 表示无下一页 */
async function goNextPageFusion(page: Page): Promise<boolean> {
  const nextBtn = page.locator('.next-pagination .next-next').first();
  if (!await nextBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    return false;
  }

  // Check if disabled
  const isDisabled = await nextBtn.evaluate(
    el => el.classList.contains('next-btn-disabled') || el.hasAttribute('disabled')
  ).catch(() => true);
  if (isDisabled) return false;

  await nextBtn.click();
  await page.waitForTimeout(2000);
  return true;
}

export async function stepCheck(page: Page, config: PurchaseConfig, planOrderId?: string): Promise<StepResult & { data: CheckResult }> {
  log('\n========== Step 3: 检查采购单状态 ==========');

  // 导航到采购单列表
  const purchaseOrders: any[] = [];
  const handler = async (resp: any) => {
    try {
      const url = resp.url();
      if (url.includes('order/pageQuery') && !url.includes('planOrder') && !url.includes('Relation')) {
        const body = await resp.json().catch(() => null);
        if (body?.data && Array.isArray(body.data)) {
          purchaseOrders.push(...body.data);
        }
      }
    } catch {}
  };
  page.on('response', handler);

  await page.goto('https://saas-retail.ele.me/#/chain/order/purchase', {
    waitUntil: 'networkidle', timeout: 30000,
  }).catch(() => {});
  await page.waitForTimeout(8000);
  await closeModals(page);

  // 筛选"待支付"状态
  await filterByStatus(page, '待支付');

  // 清空筛选前收集到的脏数据，只保留筛选后的结果
  purchaseOrders.length = 0;
  await page.waitForTimeout(3000);

  // 切换到最大分页（Fusion Design）
  try {
    purchaseOrders.length = 0; // 切换分页也会触发请求，再清一次
    await switchToMaxPerPageFusion(page);
  } catch (e: any) {
    log(`  分页切换失败，使用默认分页: ${e.message}`);
  }
  await page.waitForTimeout(3000);

  // 翻页获取所有待支付订单
  let pageNum = 1;
  while (true) {
    const prevCount = purchaseOrders.length;
    const hasNext = await goNextPageFusion(page);
    if (!hasNext) break;
    pageNum++;
    log(`  第${pageNum}页: 累计 ${purchaseOrders.length} 条`);
    if (purchaseOrders.length === prevCount || pageNum >= 50) break;
  }

  page.removeListener('response', handler);
  log(`  获取到 ${purchaseOrders.length} 条待支付采购单（${pageNum}页）`);

  // 分析状态
  let successCount = 0, failedCount = 0, pendingCount = 0;
  const failedOrders: FailedOrder[] = [];
  const successOrders: SuccessOrder[] = [];
  const failuresByType: Record<string, FailedOrder[]> = {
    out_of_stock: [],
    quantity_mismatch: [],
    mixed_batch: [],
    unknown: [],
  };

  for (const o of purchaseOrders) {
    const status = o.status;
    const failReason = o.asyncFailureReason || '';
    const orderId = o.supplyOrderId || o.orderRelationId || '';

    // 如果指定了计划单号，只看关联的
    if (planOrderId && !JSON.stringify(o).includes(planOrderId)) continue;

    // status: 7/10 = 成功(待支付), 0 = 待下单, 6 = 处理中(通常失败), -1 = 已作废
    if (status === 7 || status === 10 || (o.outOrderId && !failReason)) {
      successCount++;
      successOrders.push({
        storeName: o.buyerWarehouseName || '未知门店',
        amount: o.totalPrice ? o.totalPrice / 100 : (o.outerOrderRealSumPrice ? o.outerOrderRealSumPrice / 100 : 0),
        account: o.supplyAccountName || o.outOrderId || '',
        orderId: o.supplyOrderId || o.orderRelationId || '',
      });
    } else if (status === 0) {
      pendingCount++;
      const fo: FailedOrder = {
        orderId,
        supplyOrderId: o.supplyOrderId,
        status,
        failReason: failReason || '待下单',
        skuCount: o.skuCount,
        amount: o.purchaseAmount ? o.purchaseAmount / 100 : undefined,
        storeName: o.buyerWarehouseName,
        storeCode: o.buyerWarehouseCode,
      };
      failedOrders.push(fo);
      failuresByType['unknown'].push(fo);
    } else if (failReason || status === 6 || status === -1) {
      failedCount++;
      const type = classifyFailure(failReason);
      const fo: FailedOrder = {
        orderId,
        supplyOrderId: o.supplyOrderId,
        status,
        failReason,
        skuCount: o.skuCount,
        amount: o.purchaseAmount ? o.purchaseAmount / 100 : undefined,
        storeName: o.buyerWarehouseName,
        storeCode: o.buyerWarehouseCode,
      };
      failedOrders.push(fo);
      failuresByType[type].push(fo);
    }
  }

  log(`\n  状态汇总:`);
  log(`    ✅ 成功(待支付): ${successCount}`);
  log(`    ⏳ 待下单: ${pendingCount}`);
  log(`    ❌ 失败: ${failedCount}`);
  if (failuresByType.out_of_stock.length > 0) log(`      无库存: ${failuresByType.out_of_stock.length}`);
  if (failuresByType.quantity_mismatch.length > 0) log(`      数量换算: ${failuresByType.quantity_mismatch.length}`);
  if (failuresByType.mixed_batch.length > 0) log(`      混批限制: ${failuresByType.mixed_batch.length}`);
  if (failuresByType.unknown.length > 0) log(`      其他/未知: ${failuresByType.unknown.length}`);

  // 打印失败详情
  for (const fo of failedOrders.slice(0, 20)) {
    log(`    ${fo.orderId}: ${fo.failReason.substring(0, 60)} (${fo.storeName || ''})`);
  }

  // 按门店汇总待支付金额
  const storeAmounts: Record<string, { count: number; amount: number }> = {};
  let totalAmount = 0;
  for (const o of successOrders) {
    const store = o.storeName || '未知门店';
    if (!storeAmounts[store]) storeAmounts[store] = { count: 0, amount: 0 };
    storeAmounts[store].count++;
    storeAmounts[store].amount += o.amount;
    totalAmount += o.amount;
  }

  log(`\n  待支付金额汇总:`);
  for (const [store, info] of Object.entries(storeAmounts)) {
    log(`    ${store}: ${info.count}单, ¥${info.amount.toFixed(2)}`);
  }
  log(`    合计: ${successCount}单, ¥${totalAmount.toFixed(2)}`);

  const data: CheckResult = { successCount, failedCount, pendingCount, totalAmount, storeAmounts, failedOrders, successOrders, failuresByType };
  const allOk = failedCount === 0 && pendingCount === 0;

  return {
    step: 'check',
    success: allOk,
    message: allOk
      ? `全部成功 (${successCount}单)`
      : `成功${successCount} 失败${failedCount} 待下单${pendingCount}`,
    data,
  };
}
