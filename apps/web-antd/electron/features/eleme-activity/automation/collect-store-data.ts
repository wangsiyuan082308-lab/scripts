/**
 * 多门店经营数据采集脚本
 * 每天自动采集10家门店的核心经营数据
 * 
 * 流程：切换门店 → 导航到经营概览 → 提取实时+30日数据 → 存JSON
 * 预估耗时：10店 × 15秒/店 ≈ 2.5分钟
 */

import { chromium, Page, BrowserContext } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'node:child_process';

// ============================================================
// 配置
// ============================================================

const SHARED_DATA_DIR = path.join(__dirname, '..', '..', '..', '..', 'shared-data', 'eleme', 'store-data');
const LOG_DIR = path.join(__dirname, '..', 'logs');
const USER_DATA_DIR = path.join(__dirname, '..', 'user_data');

const DATA_OVERVIEW_URL = 'https://nr.ele.me/app/eleme-nr-bfe-newretail/common-next#/pc/dataSummaryPc/';

// 门店列表（连锁下所有门店）
const STORES = [
  { name: 'Oby便利超市(安吉店)', shortName: '安吉店' },
  { name: 'Oby便利超市(长兴店)', shortName: '长兴店' },
  { name: 'Oby便利超市(太仓店)', shortName: '太仓店' },
  { name: 'Oby便利超市(宁波店)', shortName: '宁波店' },
  { name: 'Oby便利超市(宜宾店)', shortName: '宜宾店' },
  { name: 'Oby便利超市(合肥店)', shortName: '合肥店' },
  { name: 'Oby便利超市(济阳店)', shortName: '济阳店' },
  { name: 'Oby便利超市(江北店)', shortName: '江北店' },
  { name: '0by便利超市(中山店)', shortName: '中山店' },
];

const today = new Date().toISOString().split('T')[0];
const LOG_FILE = path.join(LOG_DIR, `data_collection_${today.replace(/-/g, '')}.log`);

// ============================================================
// 日志
// ============================================================

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
if (!fs.existsSync(SHARED_DATA_DIR)) fs.mkdirSync(SHARED_DATA_DIR, { recursive: true });

function log(level: 'info' | 'warn' | 'error', msg: string, data?: any) {
  const ts = new Date().toISOString();
  const entry = { ts, level, msg, ...(data ? { data } : {}) };
  console.log(`[${ts}] [${level.toUpperCase()}] ${msg}${data ? ' ' + JSON.stringify(data) : ''}`);
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
}

// ============================================================
// 数据类型
// ============================================================

interface RealtimeData {
  gmv: number;
  estimated_revenue: number;
  valid_orders: number;
  lost_orders: number;
  customer_paid: number;
  avg_order_value: number;
}

interface Overview30d {
  gmv: number;
  net_revenue: number;
  valid_orders: number;
  avg_order_value: number;
  exposure: number;
  enter_rate: number;
  order_rate: number;
  deal_rate: number;
  rating: number;
  active_skus: number;
  [key: string]: number; // 允许额外字段
}

interface StoreData {
  name: string;
  shortName: string;
  collected_at: string;
  realtime: RealtimeData;
  overview_30d: Overview30d;
  raw_labels?: Record<string, string>; // 原始标签-值对，用于调试
}

interface DailyReport {
  date: string;
  collected_at: string;
  store_count: number;
  stores: StoreData[];
}

// ============================================================
// 账号切换
// ============================================================

async function switchToStore(page: Page, chainName: string, storeName: string): Promise<boolean> {
  log('info', `切换到门店: ${storeName}`);

  try {
    // 点击账号切换触发器
    await page.click('.account-switch .account-switch-trigger');
    await page.waitForTimeout(800);
    await page.waitForSelector('.account-switch-dropdown', { timeout: 5000 });

    // hover 连锁项展开子菜单
    const items = await page.$$('.cascade-menu-item');
    for (const item of items) {
      const text = await item.textContent();
      if (text?.includes(chainName)) {
        await item.hover();
        break;
      }
    }
    await page.waitForTimeout(800);

    // 点击目标门店
    const allItems = await page.$$('li');
    let clicked = false;
    for (const li of allItems) {
      const text = await li.textContent();
      if (text?.includes(storeName)) {
        await li.click();
        clicked = true;
        break;
      }
    }

    if (!clicked) {
      log('warn', `未找到门店: ${storeName}`);
      return false;
    }

    await page.waitForTimeout(3000);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // 验证
    const current = await page.evaluate(() => {
      const el = document.querySelector('.account-switch .current-account');
      return el?.textContent?.trim() || '';
    });

    const success = current.includes(storeName.replace(/[()（）]/g, '').substring(0, 6));
    log(success ? 'info' : 'warn', `切换${success ? '成功' : '失败'}: ${current}`);
    return success;
  } catch (err: any) {
    log('error', `切换门店异常: ${err?.message}`);
    return false;
  }
}

// ============================================================
// 数据提取
// ============================================================

function parseNumber(text: string | null | undefined): number {
  if (!text) return 0;
  // 处理 "349,100" "39.60" "7.7%" "4.81" 等格式
  const cleaned = text.replace(/,/g, '').replace(/%$/, '').trim();
  const num = parseFloat(cleaned);
  return isNaN(num) ? 0 : num;
}

async function collectRealtimeData(page: Page): Promise<RealtimeData> {
  return page.evaluate(() => {
    const labels = ['gmv', 'estimated_revenue', 'valid_orders', 'lost_orders', 'customer_paid', 'avg_order_value'];
    const data: Record<string, number> = {};

    // 方法1: card-view-layout 卡片
    const cards = Array.from(document.querySelectorAll('.card-view-layout'));
    cards.forEach((card, i) => {
      if (i < labels.length) {
        const valEl = card.querySelector('.value, .chosen-value, [class*="value"]');
        const val = valEl?.textContent?.trim() || '0';
        data[labels[i]] = parseFloat(val.replace(/,/g, '') || '0');
      }
    });

    // 方法2: 如果方法1没拿到，尝试通过标签匹配
    if (Object.keys(data).length === 0) {
      const allCards = Array.from(document.querySelectorAll('[class*="card"], [class*="metric"], [class*="stat"]'));
      const labelMap: Record<string, string> = {
        '成交金额': 'gmv',
        '预计收入金额': 'estimated_revenue',
        '有效订单量': 'valid_orders',
        '流失订单量': 'lost_orders',
        '顾客实付金额': 'customer_paid',
        '笔单价': 'avg_order_value',
      };

      allCards.forEach(card => {
        const text = card.textContent || '';
        for (const [label, key] of Object.entries(labelMap)) {
          if (text.includes(label) && !data[key]) {
            const valMatch = text.match(new RegExp(label + '[\\s：:]*([\\d,.]+)'));
            if (valMatch) {
              data[key] = parseFloat(valMatch[1].replace(/,/g, ''));
            }
          }
        }
      });
    }

    return {
      gmv: data.gmv || 0,
      estimated_revenue: data.estimated_revenue || 0,
      valid_orders: data.valid_orders || 0,
      lost_orders: data.lost_orders || 0,
      customer_paid: data.customer_paid || 0,
      avg_order_value: data.avg_order_value || 0,
    };
  });
}

async function collectOverview30d(page: Page): Promise<{ overview: Overview30d; rawLabels: Record<string, string> }> {
  return page.evaluate(() => {
    const rawLabels: Record<string, string> = {};

    // 尝试多种选择器提取30日概览数据
    const selectors = [
      '.HomePage_card-view-item__kkHvi',
      '[class*="card-view-item"]',
      '[class*="overview"] [class*="item"]',
      '[class*="summary"] [class*="card"]',
    ];

    for (const sel of selectors) {
      const items = Array.from(document.querySelectorAll(sel));
      if (items.length > 0) {
        items.forEach(item => {
          const labelEl = item.querySelector('[class*="name"], .label, .title, [class*="label"]');
          const valueEl = item.querySelector('.value, [class*="value"], [class*="num"]');
          const label = labelEl?.textContent?.trim();
          const value = valueEl?.textContent?.trim();
          if (label && value) {
            rawLabels[label] = value;
          }
        });
        break;
      }
    }

    // 映射到标准字段
    const labelMap: Record<string, string> = {
      '成交金额': 'gmv',
      '净营业金额': 'net_revenue',
      '有效订单量': 'valid_orders',
      '笔单价': 'avg_order_value',
      '曝光人数': 'exposure',
      '进店转化率': 'enter_rate',
      '下单转化率': 'order_rate',
      '成交转化率': 'deal_rate',
      '用户评价分': 'rating',
      '动销商品量': 'active_skus',
    };

    const parseVal = (v: string): number => {
      const cleaned = v.replace(/,/g, '').replace(/%$/, '').replace(/万$/, '');
      let num = parseFloat(cleaned);
      if (isNaN(num)) return 0;
      if (v.includes('万')) num *= 10000;
      if (v.includes('%')) num /= 100;
      return num;
    };

    const data: Record<string, number> = {};
    for (const [label, value] of Object.entries(rawLabels)) {
      for (const [cn, key] of Object.entries(labelMap)) {
        if (label.includes(cn)) {
          data[key] = parseVal(value);
        }
      }
    }

    return {
      overview: {
        gmv: data.gmv || 0,
        net_revenue: data.net_revenue || 0,
        valid_orders: data.valid_orders || 0,
        avg_order_value: data.avg_order_value || 0,
        exposure: data.exposure || 0,
        enter_rate: data.enter_rate || 0,
        order_rate: data.order_rate || 0,
        deal_rate: data.deal_rate || 0,
        rating: data.rating || 0,
        active_skus: data.active_skus || 0,
      },
      rawLabels,
    };
  });
}

async function collectStoreData(page: Page, store: typeof STORES[0]): Promise<StoreData> {
  log('info', `采集 ${store.name} 数据...`);

  // 导航到经营概览
  await page.goto(DATA_OVERVIEW_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // 提取实时数据
  const realtime = await collectRealtimeData(page);
  log('info', `实时数据: GMV=${realtime.gmv}, 订单=${realtime.valid_orders}, 客单价=${realtime.avg_order_value}`);

  // 提取30日概览
  const { overview, rawLabels } = await collectOverview30d(page);
  log('info', `30日概览: GMV=${overview.gmv}, 订单=${overview.valid_orders}, 评分=${overview.rating}`);

  return {
    name: store.name,
    shortName: store.shortName,
    collected_at: new Date().toISOString(),
    realtime,
    overview_30d: overview,
    raw_labels: rawLabels,
  };
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  log('info', '=== 多门店经营数据采集启动 ===');
  const startTime = Date.now();

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    channel: 'chrome',
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });

  const page = context.pages()[0] || await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const report: DailyReport = {
    date: today,
    collected_at: new Date().toISOString(),
    store_count: 0,
    stores: [],
  };

  try {
    // 先导航到饿了么后台，检查登录状态
    await page.goto(DATA_OVERVIEW_URL, { waitUntil: 'networkidle', timeout: 60000 });

    if (page.url().includes('login') || page.url().includes('sso')) {
      log('warn', '需要登录！等待手动登录...');
      try { execSync('say "请登录饿了么"', { stdio: 'ignore' }); } catch {}
      await page.waitForFunction(
        () => !window.location.href.includes('login') && !window.location.href.includes('sso'),
        null,
        { timeout: 300000 }
      );
      log('info', '登录成功');
      await page.waitForTimeout(2000);
    }

    // 逐店采集
    for (let i = 0; i < STORES.length; i++) {
      const store = STORES[i];
      log('info', `[${i + 1}/${STORES.length}] 采集 ${store.shortName}...`);

      try {
        // 切换到该门店
        const switched = await switchToStore(page, 'OBy24h便利', store.name);
        if (!switched) {
          log('warn', `跳过 ${store.shortName}：切换失败`);
          continue;
        }

        // 采集数据
        const data = await collectStoreData(page, store);
        report.stores.push(data);
        report.store_count++;

        log('info', `${store.shortName} 采集完成 ✅`);

        // 间隔避免限流
        if (i < STORES.length - 1) {
          await page.waitForTimeout(2000 + Math.random() * 1000);
        }
      } catch (err: any) {
        log('error', `${store.shortName} 采集失败: ${err?.message}`);
        const ssPath = path.join(LOG_DIR, `error_collect_${store.shortName}_${Date.now()}.png`);
        try { await page.screenshot({ path: ssPath, fullPage: true }); } catch {}
      }
    }

    // 保存结果
    const dailyFile = path.join(SHARED_DATA_DIR, `${today}.json`);
    const latestFile = path.join(SHARED_DATA_DIR, 'latest.json');

    fs.writeFileSync(dailyFile, JSON.stringify(report, null, 2), 'utf-8');
    fs.writeFileSync(latestFile, JSON.stringify(report, null, 2), 'utf-8');

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log('info', `采集完成: ${report.store_count}/${STORES.length} 门店, 耗时 ${elapsed}s`);
    log('info', `数据已保存: ${dailyFile}`);

    // 打印汇总
    console.log('\n');
    console.log('══════════════════════════════════════════');
    console.log(`  门店经营数据采集 | ${today}`);
    console.log('══════════════════════════════════════════');
    for (const s of report.stores) {
      console.log(`  📊 ${s.shortName}`);
      console.log(`     GMV: ¥${s.realtime.gmv.toFixed(2)} | 订单: ${s.realtime.valid_orders} | 客单价: ¥${s.realtime.avg_order_value.toFixed(2)}`);
    }
    console.log('──────────────────────────────────────────');
    const totalGmv = report.stores.reduce((sum, s) => sum + s.realtime.gmv, 0);
    const totalOrders = report.stores.reduce((sum, s) => sum + s.realtime.valid_orders, 0);
    console.log(`  合计: ¥${totalGmv.toFixed(2)} | ${totalOrders}单 | ${report.store_count}店`);
    console.log(`  耗时: ${elapsed}s`);
    console.log('══════════════════════════════════════════\n');

  } catch (err: any) {
    log('error', '执行失败', { error: err?.message, stack: err?.stack });
    throw err;
  } finally {
    await context.close();
    log('info', '=== 数据采集完成 ===');
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
