/**
 * Step 1: 补货建议 → 加入补货单
 *
 * 支持多选模式：一次性选择多个供应商和门店
 * 独立运行: npx ts-node src/steps/step-add.ts [--supplier 供应商1,供应商2,...]
 */
import { chromium, Page } from 'playwright';
import { PurchaseConfig, loadConfig, parseCLI } from '../lib/config';
import { log, failWithTag } from '../lib/utils';
import { StepAddAudit, StepAddStoreAudit, StepAddTabAudit, StepResult } from '../lib/types-v4';
import {
  closeModals, resetSearch, switchTo100PerPage, clickQuery,
  selectSupplier, selectStore, clearStoreFilter, getStoreList,
  clickTab, selectAllAndAdd, goNextPage, verifyTableSupplier,
  selectMultipleSuppliers, selectMultipleStores,
} from '../lib/page-helpers';

/** 按销售信息列排序（降序） */
async function sortBySalesInfo(page: Page): Promise<void> {
  await closeModals(page);
  
  // 尝试找到"销售信息"列头并点击排序
  const salesHeader = page.locator('th:has-text("销售信息"), .ant-table-column-title:has-text("销售信息")').first();
  
  if (await salesHeader.isVisible({ timeout: 3000 }).catch(() => false)) {
    // 点击列头触发排序
    await salesHeader.click();
    await page.waitForTimeout(1500);
    
    // 检查是否是降序（向下箭头激活），如果不是再点一次
    const sorterDown = page.locator('.ant-table-column-sorter-down.active, .anticon-caret-down.ant-table-column-sorter-full').first();
    if (!await sorterDown.isVisible({ timeout: 1000 }).catch(() => false)) {
      await salesHeader.click();
      await page.waitForTimeout(1500);
    }
    
    log('  ✅ 已按销量降序排序');
  } else {
    log('  ⚠️ 未找到"销售信息"列头，跳过排序');
  }
}

async function addFromTab(page: Page, tabIndex: number, excludeSkus: string[], maxPages: number, supplierName: string, allowedTabs: string[]): Promise<StepAddTabAudit> {
  const tabText = await clickTab(page, tabIndex);
  const tabName = tabText.trim();
  // 去掉Tab名称末尾的数字（如"售罄待补货 1" -> "售罄待补货"）
  const tabNameClean = tabName.replace(/\s*\d+$/, '').trim();
  log(`  Tab[${tabIndex}] "${tabText}"`);

  const isAllowed = allowedTabs.length === 0 || allowedTabs.some(t => t === tabName || t === tabNameClean);
  if (!isAllowed) {
    failWithTag('TAB_NOT_ALLOWED', `当前进入的是「${tabText}」，但规则只允许 ${allowedTabs.join(' / ')}`);
  }

  await switchTo100PerPage(page);
  await page.waitForTimeout(2000);
  await verifyTableSupplier(page, supplierName, { allowEmpty: true });

  let pageNum = 1, totalAdded = 0, totalCount = 0;

  while (true) {
    await verifyTableSupplier(page, supplierName, { allowEmpty: true });
    const result = await selectAllAndAdd(page, excludeSkus);
    totalAdded += result.added;
    totalCount += result.total;
    if (result.total > 0) {
      log(`    第${pageNum}页: ${result.added}/${result.total} ✅`);
    }

    if (maxPages > 0 && pageNum >= maxPages) break;
    if (!await goNextPage(page)) break;
    pageNum++;
  }

  log(`    Tab汇总[${tabName}]: 加入 ${totalAdded} 条 / 命中 ${totalCount} 条`);
  return { tabName, added: totalAdded, total: totalCount, isAllowed };
}

async function addForStore(
  page: Page,
  enabledTabs: PurchaseConfig['tabs'],
  excludeSkus: string[],
  maxPages: number,
  supplierName: string,
  allowedTabs: string[],
  storeName: string,
): Promise<StepAddStoreAudit> {
  const tabs: StepAddTabAudit[] = [];
  let totalAdded = 0;

  for (const tab of enabledTabs) {
    const result = await addFromTab(page, tab.index, excludeSkus, maxPages, supplierName, allowedTabs);
    tabs.push(result);
    totalAdded += result.added;
  }

  log(`  门店汇总 ${storeName}: 加入 ${totalAdded} 条`);
  return { storeName, totalAdded, tabs };
}

export async function stepAdd(page: Page, config: PurchaseConfig, excludeSkus: string[] = []): Promise<StepResult> {
  log('\n========== Step 1: 加入补货单 ==========');
  
  // 每次只采购1个供应商
  const supplierList = config.supplier.split(',').map(s => s.trim()).filter(Boolean);
  const singleSupplier = supplierList[0]; // 只取第一个
  log(`  供应商: ${singleSupplier}`);
  if (excludeSkus.length > 0) log(`  排除SKU: ${excludeSkus.length}种`);
  
  // 判断是否是 1688 渠道供应商（根据配置的 channel 字段，不靠名称猜）
  const is1688Platform = config.procurementRuleSummary?.supplierChannel === '1688';
  const stores = config.stores.filter(s => s.name && s.name !== '*');
  
  if (is1688Platform && stores.length > 0) {
    log(`  🔄 1688平台模式：按门店逐个采购`);
    return await stepAddByStore(page, config, singleSupplier, stores, excludeSkus);
  }
  
  // 其他供应商：全部门店一起采购
  log(`  门店: 全部（不筛选）`);
  return await stepAddAllStores(page, config, singleSupplier, excludeSkus);
}

/** 1688平台：按门店逐个采购 */
async function stepAddByStore(
  page: Page, 
  config: PurchaseConfig, 
  supplier: string, 
  stores: { name: string; code: string; maxItems: number }[],
  excludeSkus: string[]
): Promise<StepResult> {
  const allStoreResults: { storeName: string; tabName: string; added: number; total: number }[] = [];
  let grandTotal = 0;
  
  for (const store of stores) {
    log(`\n  --- 门店: ${store.name} ---`);
    
    await page.goto('https://saas-retail.ele.me/#/replenish/list', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(5000);
    await closeModals(page);
    await resetSearch(page);

    // 选择供应商
    await selectSupplier(page, supplier);

    // 选择门店
    await selectStore(page, store.name);
    await clickQuery(page);
    
    // 按销量排序
    if (config.procurementRules.sortBySales) {
      log('    按销量排序...');
      await sortBySalesInfo(page);
    }
    
    // 加入补货单
    const enabledTabs = config.tabs.filter(t => t.enabled);
    const allowedTabs = config.procurementRules.allowedTabs || enabledTabs.map(t => t.name);
    
    for (const tab of enabledTabs) {
      const tabText = await clickTab(page, tab.index);
      const tabName = tabText.trim().replace(/\s*\d+$/, '').trim();
      
      const isAllowed = allowedTabs.length === 0 || allowedTabs.some(t => t === tabName);
      if (!isAllowed) continue;
      
      await switchTo100PerPage(page);
      await page.waitForTimeout(2000);
      
      let tabAdded = 0;
      while (true) {
        // 检查是否已达到门店最大限制
        const storeAdded = allStoreResults
          .filter(r => r.storeName === store.name)
          .reduce((sum, r) => sum + r.added, 0) + tabAdded;
        if (store.maxItems > 0 && storeAdded >= store.maxItems) {
          log(`    已达到门店上限 ${store.maxItems}，停止`);
          break;
        }

        const result = await selectAllAndAdd(page, excludeSkus);
        tabAdded += result.added;
        if (result.total > 0) {
          log(`    ${tabName}: 加入 ${result.added} 条`);
        }
        if (!await goNextPage(page)) break;
      }

      allStoreResults.push({ storeName: store.name, tabName, added: tabAdded, total: tabAdded });
      grandTotal += tabAdded;
    }

    const storeTotal = allStoreResults
      .filter(r => r.storeName === store.name)
      .reduce((sum, r) => sum + r.added, 0);
    log(`    门店汇总: ${store.name} 加入 ${storeTotal} 条`);
  }
  
  const audit: StepAddAudit = {
    stores: [{ storeName: '1688平台分店采购', totalAdded: grandTotal, tabs: allStoreResults.map(r => ({ tabName: `${r.storeName}-${r.tabName}`, added: r.added, total: r.total, isAllowed: true })) }],
    grandTotalAdded: grandTotal,
    enabledTabs: config.tabs.filter(t => t.enabled).map(t => t.name),
    allowedTabs: config.procurementRules.allowedTabs || [],
  };
  
  log(`\n  ✅ Step 1 完成: 共加入 ${grandTotal} 条`);
  return grandTotal === 0 
    ? { step: 'add', success: false, message: '未加入任何商品', data: { added: 0, audit } }
    : { step: 'add', success: true, message: `加入 ${grandTotal} 条`, data: { added: grandTotal, audit } };
}

/** 其他供应商：全部门店一起采购 */
async function stepAddAllStores(
  page: Page, 
  config: PurchaseConfig, 
  supplier: string, 
  excludeSkus: string[]
): Promise<StepResult> {
  await page.goto('https://saas-retail.ele.me/#/replenish/list', { waitUntil: 'networkidle', timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(5000);
  await closeModals(page);
  await resetSearch(page);

  // 选择单个供应商
  await selectSupplier(page, supplier);
  await clickQuery(page);
  
  // 按销量排序（如果配置启用）
  if (config.procurementRules.sortBySales) {
    log('  按销量排序...');
    await sortBySalesInfo(page);
  }
  
  // 不选择门店，使用默认的全部门店

  const enabledTabs = config.tabs.filter(t => t.enabled);
  const enabledTabNames = enabledTabs.map(t => t.name);
  const allowedTabs = config.procurementRules.allowedTabs || enabledTabNames;
  
  let grandTotal = 0;
  const tabResults: { tabName: string; added: number; total: number }[] = [];

  // 遍历Tab，全选加入补货单
  for (const tab of enabledTabs) {
    const tabText = await clickTab(page, tab.index);
    const tabName = tabText.trim().replace(/\s*\d+$/, '').trim();
    log(`\n  Tab[${tab.index}] "${tabText}"`);
    
    const isAllowed = allowedTabs.length === 0 || allowedTabs.some(t => t === tabName || t === tabText.trim());
    if (!isAllowed) {
      log(`    ⚠️ Tab不在允许列表，跳过`);
      continue;
    }

    await switchTo100PerPage(page);
    await page.waitForTimeout(2000);
    
    let tabTotal = 0;
    let tabAdded = 0;
    let pageNum = 1;

    while (true) {
      const result = await selectAllAndAdd(page, excludeSkus);
      tabAdded += result.added;
      tabTotal += result.total;
      if (result.total > 0) {
        log(`    第${pageNum}页: 加入 ${result.added}/${result.total} 条`);
      }
      if (!await goNextPage(page)) break;
      pageNum++;
    }

    tabResults.push({ tabName, added: tabAdded, total: tabTotal });
    grandTotal += tabAdded;
    log(`    Tab汇总: 加入 ${tabAdded} 条`);
  }

  const audit: StepAddAudit = {
    stores: [{ storeName: '全部门店', totalAdded: grandTotal, tabs: tabResults.map(t => ({ tabName: t.tabName, added: t.added, total: t.total, isAllowed: true })) }],
    grandTotalAdded: grandTotal,
    enabledTabs: enabledTabNames,
    allowedTabs,
  };

  log(`\n  ✅ Step 1 完成: 共加入 ${grandTotal} 条`);
  for (const t of tabResults) {
    log(`    - ${t.tabName}: ${t.added} 条`);
  }
  
  if (grandTotal === 0) {
    return { step: 'add', success: false, message: '未加入任何商品', data: { added: 0, audit } };
  }
  return { step: 'add', success: true, message: `加入 ${grandTotal} 条`, data: { added: grandTotal, audit } };
}
