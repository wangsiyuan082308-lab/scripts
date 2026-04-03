/**
 * 翱象补货建议查询 v3
 *
 * 通过拦截页面API响应获取数据，支持分页
 *
 * 用法：npx ts-node src/check-replenish.ts [--supplier 供应商名称]
 */

import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'node:url';
import { log } from './lib/utils';
import { loadConfig, parseCLI } from './lib/config';
import { launchBrowser } from '../lib/browser';
import { closeModals, ensureLogin, goNextPage, switchTo100PerPage } from './lib/page-helpers';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const today = new Date().toISOString().split('T')[0];

const DEFAULT_SUPPLIERS = ['集采-十月结晶', '集采-卫生巾'];
const AOIXIANG_TARGET_URL = 'https://saas-retail.ele.me/#/replenish/list';

function matchSupplier(name: string, target: string): boolean {
  const clean = (s: string) => s.replace(/[-_\s供应商]/g, '');
  return clean(name).includes(clean(target)) || clean(target).includes(clean(name));
}

async function main() {
  log('=== 翱象补货建议查询 v3 ===');

  const args = process.argv.slice(2);
  const supplierIdx = args.indexOf('--supplier');
  const targetSuppliers = supplierIdx >= 0 && args[supplierIdx + 1]
    ? [args[supplierIdx + 1]]
    : DEFAULT_SUPPLIERS;

  log(`目标供应商: ${targetSuppliers.join(', ')}`);

  const { overrides } = parseCLI();
  const config = loadConfig(overrides);
  const userDataDir = path.resolve(__dirname, '../', config.browser.userDataDir || './user_data');

  const { browser, context, page } = await launchBrowser({
    cdpPort: 18792,
    userDataDir,
    headless: config.browser.headless,
    log,
  });

  try {
    await ensureLogin(page, AOIXIANG_TARGET_URL, {
      maxWait: 180000,
      loginIndicators: ['login', 'passport', '欢迎登录'],
      log,
    });

    // 拦截所有补货建议API响应
    const allItems: any[] = [];
    let countData: any = {};

    page.on('response', async (resp) => {
      const url = resp.url();
      try {
        if (url.includes('/saas/chain/plan/replenish/advice/query')) {
          const body = await resp.json().catch(() => null);
          if (body?.data && Array.isArray(body.data)) {
            allItems.push(...body.data);
          }
        }
        if (url.includes('/saas/chain/plan/replenish/advice/count')) {
          const body = await resp.json().catch(() => null);
          if (body?.data) countData = body.data;
        }
      } catch {}
    });

    // 导航到补货建议
    log('导航到补货建议页面...');
    await page.goto(AOIXIANG_TARGET_URL, {
      waitUntil: 'networkidle',
      timeout: 30000,
    }).catch(() => {});
    await page.waitForTimeout(8000);

    await closeModals(page);
    await switchTo100PerPage(page);

    log(`首页获取 ${allItems.length} 条`);
    log(`统计: 动销售罄${countData.sellTotal || 0} | 售罄${countData.soldTotal || 0} | 建议补货${countData.recommondTotal || 0} | 无需${countData.needlessTotal || 0} | 停止${countData.stopTotal || 0}`);

    // 翻页获取更多数据（最多翻50页 = 1000条）
    for (let i = 0; i < 50; i++) {
      const prevCount = allItems.length;
      const hasNext = await goNextPage(page);
      if (!hasNext) break;
      await page.waitForTimeout(3000);
      if (allItems.length === prevCount) break;
      log(`第${i + 2}页: 累计 ${allItems.length} 条`);
    }

    log(`总计获取 ${allItems.length} 条补货建议`);

    // 按供应商分组
    const supplierGroups: Record<string, any[]> = {};
    for (const item of allItems) {
      const name = item.supplierName || '未知';
      if (!supplierGroups[name]) supplierGroups[name] = [];
      supplierGroups[name].push(item);
    }

    log(`\n供应商分布 (${Object.keys(supplierGroups).length} 个):`);
    const sorted = Object.entries(supplierGroups).sort((a, b) => b[1].length - a[1].length);
    for (const [name, items] of sorted) {
      const isTarget = targetSuppliers.some(t => matchSupplier(name, t));
      const marker = isTarget ? ' ⭐' : '';
      log(`  ${name}: ${items.length}个${marker}`);
    }

    // 生成目标供应商报告
    const reports: any[] = [];
    for (const target of targetSuppliers) {
      const matchedItems = allItems.filter(item =>
        matchSupplier(item.supplierName || '', target) && (item.replenishCount > 0 || item.tureReplenishCount > 0)
      );

      const report = {
        supplier: target,
        matchedSupplierName: matchedItems[0]?.supplierName || target,
        items: matchedItems.map((item: any) => ({
          skuCode: item.skuCode,
          skuName: item.skuName,
          barcode: item.barcode,
          storeName: item.buyerWarehouseName,
          storeCode: item.buyerWarehouseCode,
          supplierCode: item.supplierCode,
          purchasePrice: item.purchasePrice,
          suggestedQty: item.replenishCount || item.tureReplenishCount || 0,
          moq: Math.max(Number(item.beginAmount) || 1, Number(item.beginAmountForPurchase) || 1),
          moqDesc: item.beginAmountDesc || '',
          actualQty: Math.max(item.replenishCount || item.tureReplenishCount || 0, Math.max(Number(item.beginAmount) || 1, Number(item.beginAmountForPurchase) || 1)),
          dailySales: item.averageDailySales,
          inStock: item.availableInventoryCount,
          sellableDays: item.availableSaleDays,
          arrivalMethod: item.arrivalMethod,
        })),
        totalItems: matchedItems.length,
        totalQty: matchedItems.reduce((s: number, i: any) => s + (i.replenishCount || i.tureReplenishCount || 0), 0),
        totalAmount: matchedItems.reduce((s: number, i: any) => {
          const qty = i.replenishCount || i.tureReplenishCount || 0;
          return s + (i.purchasePrice * qty / 100);
        }, 0),
      };
      reports.push(report);

      log(`\n【${report.matchedSupplierName}】`);
      log(`  商品: ${report.totalItems}种 | 数量: ${report.totalQty}个 | 金额: ¥${report.totalAmount.toFixed(2)}`);

      if (report.items.length > 0) {
        const topItems = [...report.items]
          .sort((a: any, b: any) => (b.purchasePrice * b.suggestedQty) - (a.purchasePrice * a.suggestedQty))
          .slice(0, 10);
        log('  Top商品:');
        for (const item of topItems) {
          const amount = (item.purchasePrice * item.suggestedQty / 100).toFixed(2);
          log(`    ${item.skuName?.substring(0, 30)} × ${item.suggestedQty} = ¥${amount} (${item.storeName})`);
        }
      } else {
        log('  ✅ 暂无需要补货的商品');
      }
    }

    // 保存数据
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(path.join(DATA_DIR, `replenish_${today}.json`), JSON.stringify({
      reports,
      allItems: allItems.length,
      counts: countData,
      supplierGroups: Object.fromEntries(sorted.map(([k, v]) => [k, v.length])),
    }, null, 2));
    log(`\n数据已保存: data/replenish_${today}.json`);

    // 飞书消息格式
    const msgLines = [`📦 翱象补货建议 | ${today}`, `总计: ${allItems.length}条, 建议补货${countData.recommondTotal || 0}种`, ''];
    for (const r of reports) {
      msgLines.push(`【${r.matchedSupplierName}】`);
      msgLines.push(`商品: ${r.totalItems}种 | 数量: ${r.totalQty} | 金额: ¥${r.totalAmount.toFixed(2)}`);
      if (r.items.length > 0) {
        const top3 = [...r.items].sort((a: any, b: any) => (b.purchasePrice * b.suggestedQty) - (a.purchasePrice * a.suggestedQty)).slice(0, 3);
        for (const item of top3) {
          msgLines.push(`  • ${item.skuName?.substring(0, 20)} ×${item.suggestedQty} ¥${(item.purchasePrice * item.suggestedQty / 100).toFixed(0)}`);
        }
      }
      msgLines.push('');
    }
    console.log('\n=== FEISHU_MESSAGE ===');
    console.log(msgLines.join('\n'));
    console.log('=== END_MESSAGE ===');

  } finally {
    await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }

  log('完成！');
}

main().catch(e => {
  log(`❌ 错误: ${e.message}`);
  process.exit(1);
});
