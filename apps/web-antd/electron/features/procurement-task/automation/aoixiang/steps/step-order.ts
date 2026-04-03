/**
 * Step 2: 补货单 → 创建采购单 → 生成单据（1688下单）
 * 
 * 独立运行: npx ts-node src/steps/step-order.ts [--supplier 供应商]
 */
import { chromium, Page } from 'playwright';
import { PurchaseConfig, ProcurementRules, loadConfig, parseCLI } from '../lib/config';
import { log, failWithTag } from '../lib/utils';
import { StepResult } from '../lib/types-v4';
import { closeModals, resetSearch, switchTo100PerPage, selectSupplier, clickQuery, verifyTableSupplier } from '../lib/page-helpers';

function requireRule(rules: ProcurementRules, key: keyof ProcurementRules, fallback = true): boolean {
  const value = rules[key];
  return typeof value === 'boolean' ? value : fallback;
}

async function verifyCartSupplierByRules(page: Page, supplierName: string, rules: ProcurementRules, allowEmpty: boolean): Promise<void> {
  if (!requireRule(rules, 'requireResultVerification', true)) return;
  await verifyTableSupplier(page, supplierName, {
    allowEmpty,
    sampleSize: rules.strict ? 5 : 3,
  });
}

/** 在补货单详情页筛选供应商（如果有的话） */
async function filterSupplierOnCart(page: Page, supplierName: string, rules: ProcurementRules) {
  await closeModals(page);
  
  // 检查是否有供应商筛选框
  const hasSupplierFilter = await page.locator('.ant-form-item-label:has-text("供应商"), .ant-form-item-label:has-text("供应商名称")').count().catch(() => 0);
  
  if (hasSupplierFilter > 0) {
    try {
      await selectSupplier(page, supplierName);
      if (requireRule(rules, 'requireQueryAfterFilter', true)) {
        await clickQuery(page);
      }
      await verifyCartSupplierByRules(page, supplierName, rules, true);
      log(`  ✅ 补货单页已筛选供应商: ${supplierName}`);
    } catch (e: any) {
      log(`  ⚠️ 供应商筛选失败: ${e.message}，继续执行...`);
    }
  } else {
    log(`  ℹ️ 补货单页无供应商筛选框，直接操作`);
  }
}

export async function stepOrder(page: Page, config: PurchaseConfig): Promise<StepResult> {
  log('\n========== Step 2: 创建采购单 ==========');

  const rules = config.procurementRules;

  await page.goto('https://saas-retail.ele.me/#/replenish/detail', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(5000);
  await closeModals(page);
  
  // 等待页面加载完成，检测供应商选择器
  log('  等待补货单页面加载...');
  let hasSupplier = false;
  for (let i = 0; i < 30; i++) {
    const supplierLabel = await page.locator('.ant-form-item-label:has-text("供应商"), .ant-form-item-label:has-text("供应商名称")').count();
    if (supplierLabel > 0) {
      hasSupplier = true;
      log('  ✅ 页面加载完成');
      break;
    }
    await page.waitForTimeout(1000);
  }
  if (!hasSupplier) {
    log('  ⚠️ 未检测到供应商选择器，尝试继续...');
  }
  
  await resetSearch(page);
  await filterSupplierOnCart(page, config.supplier, rules);
  await switchTo100PerPage(page);
  await page.waitForTimeout(2000);

  if (requireRule(rules, 'requireNonEmptyCartBeforeOrder', true)) {
    await verifyCartSupplierByRules(page, config.supplier, rules, false);
  } else {
    await verifyCartSupplierByRules(page, config.supplier, rules, true);
  }

  // 全选
  const theadCb = page.locator('thead .ant-checkbox-input').first();
  if (await theadCb.isVisible({ timeout: 3000 }).catch(() => false)) {
    if (!await theadCb.isChecked().catch(() => false)) {
      await theadCb.click();
      await page.waitForTimeout(500);
    }
    log('  已全选');
  }

  // 拦截API获取计划单号
  let planOrderId = '';
  const responseHandler = async (resp: any) => {
    try {
      const url = resp.url();
      if (url.includes('/createReplenishOrder')) {
        const body = await resp.json().catch(() => null);
        log(`  🎯 createReplenishOrder → ${body?.success ? '✅' : '❌'} ${body?.data || ''}`);
      }
      if (url.includes('planOrder/pageQuery') && !url.includes('Relation')) {
        const body = await resp.json().catch(() => null);
        if (body?.data?.[0] && !planOrderId) {
          planOrderId = body.data[0].orderRelationId;
        }
      }
    } catch {}
  };
  page.on('response', responseHandler);

  // 点"创建采购单"
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1000);
  const createBtns = await page.locator('button:has-text("创建采购单")').all();
  let clicked = false;
  for (const btn of createBtns) {
    if (await btn.isVisible().catch(() => false) && !await btn.isDisabled().catch(() => true)) {
      await btn.scrollIntoViewIfNeeded().catch(() => {});
      await btn.click();
      clicked = true;
      log('  ✅ 已点击"创建采购单"');
      break;
    }
  }

  if (!clicked) {
    page.removeListener('response', responseHandler);
    failWithTag('CREATE_ORDER_BUTTON_MISSING', '未找到"创建采购单"按钮');
  }

  // 等待"生成单据"按钮出现
  try {
    await page.locator('button:has-text("生成单据")').first().waitFor({ state: 'visible', timeout: 30000 });
  } catch {
    page.removeListener('response', responseHandler);
    failWithTag('GENERATE_DOC_TIMEOUT', '等待"生成单据"超时');
  }

  log('  ✅ 点击"生成单据"...');
  await page.locator('button:has-text("生成单据")').first().click();
  await page.waitForTimeout(3000);

  // 选择"创建采购单并创建外部订单" + 确认
  for (let i = 0; i < 5; i++) {
    const radio = page.locator('text=创建采购单并创建外部订单').first();
    if (await radio.isVisible({ timeout: 2000 }).catch(() => false)) {
      await radio.click();
      log('  ✅ 选择"创建采购单并创建外部订单"');
      await page.waitForTimeout(1000);
    }
    const okBtn = page.locator('.ant-modal:visible .ant-btn-primary, .ant-modal-confirm:visible .ant-btn-primary').first();
    if (await okBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await okBtn.click();
      log('  ✅ 已确认');
      await page.waitForTimeout(3000);
    }
  }

  log('  等待30秒处理...');
  await page.waitForTimeout(30000);
  page.removeListener('response', responseHandler);

  // 如果没拿到计划单号，去列表页获取
  if (!planOrderId) {
    log('  从计划单列表获取订单号...');
    const listHandler = async (resp: any) => {
      try {
        if (resp.url().includes('planOrder/pageQuery') && !resp.url().includes('Relation')) {
          const body = await resp.json().catch(() => null);
          if (body?.data) {
            const fiveMinAgo = Date.now() - 5 * 60 * 1000;
            for (const o of body.data) {
              if (o.createTime > fiveMinAgo && !planOrderId) {
                planOrderId = o.orderRelationId;
                log(`  📊 找到新订单: ${planOrderId}`);
              }
            }
            if (!planOrderId && body.data[0]) {
              planOrderId = body.data[0].orderRelationId;
            }
          }
        }
      } catch {}
    };
    page.on('response', listHandler);
    await page.goto('https://saas-retail.ele.me/#/plan/order/list', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(10000);
    page.removeListener('response', listHandler);
  }

  if (planOrderId) {
    log(`  ✅ 计划单号: ${planOrderId}`);
    return { step: 'order', success: true, message: `计划单 ${planOrderId}`, data: { planOrderId } };
  }

  failWithTag('PLAN_ORDER_ID_MISSING', '未获取到计划单号');
}
