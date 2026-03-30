/**
 * 品牌专属券活动自动报名
 * 流程：活动列表→详情页→立即报名→选门店(穿梭框)→添加商品(品类匹配)→确认提交
 * 
 * 与超级品牌活动不同：
 * - 需要两次点击"立即报名"（列表页+详情页）
 * - 门店选择用穿梭框（Transfer组件），不是简单勾选
 * - 需要添加符合品类的商品
 * - 商家出资比例检查（阈值可配置，默认不限制）
 */

import { chromium, Page, BrowserContext, Frame } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

// ============================================================
// 日志系统
// ============================================================

const LOG_DIR = path.join(__dirname, '..', 'logs');
const DATA_DIR = path.join(__dirname, '..', 'data');

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
const LOG_FILE = path.join(LOG_DIR, `brand_coupon_${today}.log`);

function log(level: 'info' | 'warn' | 'error', msg: string, data?: any) {
  const ts = new Date().toISOString();
  const entry = { ts, level, msg, ...(data ? { data } : {}) };
  console.log(`[${ts}] [${level.toUpperCase()}] ${msg}${data ? ' ' + JSON.stringify(data) : ''}`);
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
}

// ============================================================
// 配置
// ============================================================

interface StoreConfig {
  name: string;
  storeId?: string;
  enable?: boolean;
}

interface BrandCouponConfig {
  stores: StoreConfig[];
  maxMerchantCostRatio: number; // 商家出资上限比例，默认1.0（不限制）
  dryRun: boolean;
  targetStores: string[]; // 要报名的门店名称列表
}

function loadConfig(): BrandCouponConfig {
  const configPath = path.join(__dirname, '..', 'config.json');
  try {
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const stores = (raw.stores || []).filter((s: any) => s.enable !== false);
    return {
      stores,
      maxMerchantCostRatio: raw.maxMerchantCostRatio || 1.0,
      dryRun: raw.autoSignup?.dryRun ?? true,
      targetStores: stores.map((s: any) => s.name),
    };
  } catch {
    log('warn', '读取config.json失败，使用默认配置');
    return {
      stores: [],
      maxMerchantCostRatio: 1.0,
      dryRun: true,
      targetStores: [],
    };
  }
}

// ============================================================
// 活动类型判断
// ============================================================

function isBrandCoupon(name: string, fullText: string): boolean {
  const combined = name + ' ' + fullText;
  return /专属券|专享券|品类红包|品类满减红包/.test(combined);
}

/**
 * 判断商家出资比例是否超标
 * 规则：商家出资 / (商家出资 + 平台补贴) > maxRatio 则跳过
 */
function isMerchantCostTooHigh(
  merchantCost: number,
  platformSubsidy: number,
  maxRatio: number
): boolean {
  const total = merchantCost + platformSubsidy;
  if (total <= 0) return false;
  const ratio = merchantCost / total;
  return ratio > maxRatio;
}

// ============================================================
// 核心报名流程
// ============================================================

interface SignupResult {
  activityName: string;
  success: boolean;
  message: string;
  storesSelected: number;
  screenshot?: string;
  skipped?: boolean;
  skipReason?: string;
}

async function findTargetFrame(page: Page): Promise<Frame> {
  const frames = page.frames();
  log('info', `找到${frames.length}个frames`);

  const priorities = [
    (url: string) => url.includes('ebai-zs-webapp'),
    (url: string) => url.includes('ms.ele.me') && !url.includes('xdomain-storage'),
  ];

  for (const matcher of priorities) {
    for (const frame of frames) {
      try {
        if (matcher(frame.url())) {
          const hasContent = await frame.evaluate(() => {
            return !!(
              document.querySelector('[class*="act-view"]') ||
              document.querySelector('[class*="activity"]') ||
              document.body?.innerText?.includes('报名')
            );
          }).catch(() => false);
          if (hasContent) {
            log('info', `目标frame: ${frame.url().substring(0, 80)}`);
            return frame;
          }
        }
      } catch { /* skip */ }
    }
  }

  log('warn', '未找到目标iframe，使用主页面');
  return page.mainFrame();
}

/**
 * 从活动列表页提取品牌专属券活动
 */
async function extractBrandCouponActivities(frame: Frame): Promise<Array<{
  name: string;
  merchantCost: number;
  platformSubsidy: number;
  threshold: number;
  daysToDeadline: number;
  status: string;
  category: string;
  index: number;
}>> {
  return frame.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.zs-act-view-v2'));
    const results: any[] = [];

    cards.forEach((card, index) => {
      const text = (card.textContent || '').replace(/\s+/g, ' ');

      // 只匹配品牌专属券类活动
      if (!/专属券|专享券|品类红包|品类满减红包/.test(text)) return;

      let name = '';
      const titleMatch = text.match(/【([^】]+)】\s*([^\n活动时间]+)/);
      if (titleMatch) {
        name = `[${titleMatch[1].trim()}]${titleMatch[2].trim()}`.replace(/\s+/g, ' ');
      } else {
        const bracketMatch = text.match(/【([^】]+)】/);
        name = bracketMatch ? `[${bracketMatch[1].trim()}]` : text.substring(0, 60).trim();
      }
      name = name.replace(/立即报名.*$/g, '').trim();
      if (name.length > 60) name = name.substring(0, 60) + '...';

      // 提取金额
      let platformSubsidy = 0, merchantCost = 0, threshold = 0;

      const subsidyMatch = text.match(/(?:淘宝闪购补|平台补贴?|补贴)\s*(\d+(?:\.\d+)?)\s*元?/);
      if (subsidyMatch) platformSubsidy = parseFloat(subsidyMatch[1]);

      const merchantMatch = text.match(/(?:商家承担|商家出资|商家补贴|商家)\s*(\d+(?:\.\d+)?)\s*元?/);
      if (merchantMatch) merchantCost = parseFloat(merchantMatch[1]);

      const thresholdMatch = text.match(/满\s*(\d+(?:\.\d+)?)\s*(?:元|减)/);
      if (thresholdMatch) threshold = parseFloat(thresholdMatch[1]);

      const deadlineMatch = text.match(/(\d+)\s*天后\s*报名截止/);
      const daysToDeadline = deadlineMatch ? parseInt(deadlineMatch[1]) : 999;

      // 品类
      const categoryMatch = text.match(/品类[：:]\s*([^\s,，]+)/);
      const category = categoryMatch ? categoryMatch[1] : '';

      const status = text.includes('已报名') ? 'signed_up' : text.includes('已结束') ? 'expired' : 'available';

      results.push({
        name, merchantCost, platformSubsidy, threshold,
        daysToDeadline, status, category, index,
      });
    });

    return results;
  });
}

/**
 * 点击活动卡片的"立即报名"按钮（进入详情页）
 */
async function clickSignupOnList(frame: Frame, activityIndex: number): Promise<boolean> {
  return frame.evaluate((idx: number) => {
    const cards = Array.from(document.querySelectorAll('.zs-act-view-v2'));
    const card = cards[idx];
    if (!card) return false;

    const btns = Array.from(card.querySelectorAll('button, a, [class*="btn"]'));
    for (const btn of btns) {
      const txt = (btn.textContent || '').trim();
      if (txt.includes('立即报名')) {
        (btn as HTMLElement).click();
        return true;
      }
    }
    return false;
  }, activityIndex);
}

/**
 * 在详情页点击"立即报名"（进入报名流程）
 */
async function clickSignupOnDetail(frame: Frame): Promise<boolean> {
  // 详情页的"立即报名"按钮通常在底部操作区
  return frame.evaluate(() => {
    // 优先找蓝色主按钮
    const btns = Array.from(document.querySelectorAll('button'));
    for (const btn of btns) {
      const txt = (btn.textContent || '').trim();
      const isPrimary = btn.classList.contains('ant-btn-primary') ||
        btn.className.includes('primary');
      if (txt.includes('立即报名') && isPrimary) {
        btn.click();
        return true;
      }
    }
    // 退而求其次，任何"立即报名"按钮
    for (const btn of btns) {
      if ((btn.textContent || '').trim().includes('立即报名')) {
        btn.click();
        return true;
      }
    }
    return false;
  });
}

/**
 * 第1步：选择门店（穿梭框）
 * 从左侧列表选择门店到右侧
 */
async function selectStores(
  frame: Frame,
  page: Page,
  targetStores: string[]
): Promise<number> {
  log('info', `选择门店，目标: ${targetStores.join(', ')}`);

  let selectedCount = 0;

  for (const storeName of targetStores) {
    try {
      // 在左侧穿梭框中搜索门店
      const searchInput = await frame.$('input[placeholder*="搜索门店"], input[placeholder*="门店名称"]');
      if (searchInput) {
        await searchInput.fill('');
        await searchInput.fill(storeName);
        await page.waitForTimeout(500);
      }

      // 点击匹配的门店项
      const clicked = await frame.evaluate((name: string) => {
        // 穿梭框左侧的门店列表
        const items = Array.from(document.querySelectorAll(
          '.ant-transfer-list-content-item, ' +
          '.ant-transfer-list .ant-checkbox-wrapper, ' +
          'tr, li'
        ));
        for (const item of items) {
          const text = (item.textContent || '').trim();
          if (text.includes(name)) {
            // 点击复选框或整行
            const checkbox = item.querySelector('input[type="checkbox"], .ant-checkbox');
            if (checkbox) {
              (checkbox as HTMLElement).click();
              return true;
            }
            (item as HTMLElement).click();
            return true;
          }
        }
        return false;
      }, storeName);

      if (clicked) {
        selectedCount++;
        log('info', `已选择门店: ${storeName}`);
      } else {
        log('warn', `未找到门店: ${storeName}`);
      }

      await page.waitForTimeout(300);
    } catch (err: any) {
      log('warn', `选择门店失败: ${storeName}`, { err: err?.message });
    }
  }

  // 清空搜索框
  const searchInput = await frame.$('input[placeholder*="搜索门店"], input[placeholder*="门店名称"]');
  if (searchInput) {
    await searchInput.fill('');
    await page.waitForTimeout(300);
  }

  log('info', `门店选择完成: ${selectedCount}/${targetStores.length}`);
  return selectedCount;
}

/**
 * 点击"下一步"按钮
 */
async function clickNextStep(frame: Frame, page: Page): Promise<boolean> {
  const clicked = await frame.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    for (const btn of btns) {
      const txt = (btn.textContent || '').trim();
      if (txt === '下一步' || txt.includes('下一步')) {
        if (!btn.disabled) {
          btn.click();
          return true;
        }
      }
    }
    return false;
  });

  if (clicked) {
    await page.waitForTimeout(2000);
    log('info', '已点击下一步');
  }
  return clicked;
}

/**
 * 第2步：添加商品
 * 品牌专属券需要添加符合品类的商品
 * 注意：这一步比较复杂，可能需要搜索商品并添加
 */
async function addProducts(
  frame: Frame,
  page: Page,
  category: string
): Promise<boolean> {
  log('info', `添加商品，品类: ${category || '未知'}`);

  // 检查是否有"添加商品"按钮
  const hasAddBtn = await frame.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, a'));
    return btns.some(btn => {
      const txt = (btn.textContent || '').trim();
      return txt.includes('添加商品') || txt.includes('选择商品');
    });
  });

  if (!hasAddBtn) {
    // 有些活动可能不需要添加商品（如纯红包类）
    log('info', '未找到添加商品按钮，可能不需要添加商品');
    return true;
  }

  // TODO: 商品添加逻辑
  // 这部分需要根据实际页面结构完善：
  // 1. 点击"添加商品"按钮
  // 2. 在弹窗中搜索/选择符合品类的商品
  // 3. 确认添加
  // 
  // 当前先记录日志，后续根据爬虫采集的商品选择页面DOM完善
  log('warn', '商品添加功能待完善，需要爬虫采集商品选择页面DOM');
  return false;
}

/**
 * 点击"确认提交"
 */
async function clickConfirmSubmit(frame: Frame, page: Page): Promise<boolean> {
  const clicked = await frame.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    for (const btn of btns) {
      const txt = (btn.textContent || '').trim();
      if (txt.includes('确认提交') || txt.includes('提交报名')) {
        if (!btn.disabled) {
          btn.click();
          return true;
        }
      }
    }
    return false;
  });

  if (clicked) {
    await page.waitForTimeout(3000);
    log('info', '已点击确认提交');
  }
  return clicked;
}

/**
 * 返回活动列表页
 */
async function navigateBackToList(page: Page): Promise<void> {
  const activityUrl = 'https://nr.ele.me/app/eleme-nr-bfe-newretail/common-next#/pc/platformActivitiesPc/';
  await page.goto(activityUrl, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);
}

// ============================================================
// 主流程
// ============================================================

async function main() {
  log('info', '=== 品牌专属券自动报名启动 ===');

  const config = loadConfig();
  log('info', '配置', {
    storeCount: config.stores.length,
    maxMerchantCostRatio: config.maxMerchantCostRatio,
    dryRun: config.dryRun,
  });

  const userDataDir = path.join(__dirname, '..', 'user_data');
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });

  const page = context.pages()[0] || await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const results: SignupResult[] = [];

  try {
    // 1. 打开活动页面
    const activityUrl = 'https://nr.ele.me/app/eleme-nr-bfe-newretail/common-next#/pc/platformActivitiesPc/';
    log('info', '打开活动页面...');
    await page.goto(activityUrl, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(5000);

    // 2. 找到目标frame
    const frame = await findTargetFrame(page);

    // 3. 提取品牌专属券活动（遍历所有页）
    let allActivities: Awaited<ReturnType<typeof extractBrandCouponActivities>> = [];
    let currentPage = 1;

    // 获取总页数
    const totalPages = await frame.evaluate(() => {
      const pagination = document.querySelector('.ant-pagination');
      if (!pagination) return 1;
      let max = 1;
      pagination.querySelectorAll('li').forEach(li => {
        const num = parseInt(li.textContent?.trim() || '');
        if (!isNaN(num)) max = Math.max(max, num);
      });
      return max;
    });

    log('info', `共${totalPages}页`);

    while (currentPage <= totalPages) {
      const pageActivities = await extractBrandCouponActivities(frame);
      // 调整index为全局index
      const offset = allActivities.length;
      pageActivities.forEach(a => { a.index += offset; });
      allActivities.push(...pageActivities);

      if (currentPage < totalPages) {
        await frame.evaluate((nextPage: number) => {
          const pagination = document.querySelector('.ant-pagination');
          if (!pagination) return;
          pagination.querySelectorAll('li').forEach(li => {
            if (li.textContent?.trim() === String(nextPage)) {
              (li as HTMLElement).click();
            }
          });
        }, currentPage + 1);
        await page.waitForTimeout(3000);
      }
      currentPage++;
    }

    log('info', `找到${allActivities.length}个品牌专属券活动`);

    // 4. 过滤：跳过已报名、已过期、商家出资过高的
    const available = allActivities.filter(a => {
      if (a.status !== 'available') {
        log('info', `跳过 [${a.status}]: ${a.name}`);
        return false;
      }
      if (isMerchantCostTooHigh(a.merchantCost, a.platformSubsidy, config.maxMerchantCostRatio)) {
        const ratio = a.merchantCost / (a.merchantCost + a.platformSubsidy);
        log('info', `跳过 [商家出资${(ratio * 100).toFixed(0)}%>${(config.maxMerchantCostRatio * 100).toFixed(0)}%]: ${a.name}`);
        results.push({
          activityName: a.name,
          success: false,
          message: `商家出资比例${(ratio * 100).toFixed(0)}%超标`,
          storesSelected: 0,
          skipped: true,
          skipReason: 'merchant_cost_too_high',
        });
        return false;
      }
      return true;
    });

    log('info', `可报名活动: ${available.length}个`);

    if (config.dryRun) {
      log('info', '=== DRY RUN 模式 ===');
      for (const act of available) {
        log('info', `[DRY RUN] 将报名: ${act.name} (商家¥${act.merchantCost}, 平台¥${act.platformSubsidy}, 品类:${act.category})`);
        results.push({
          activityName: act.name,
          success: true,
          message: 'DRY RUN - 未实际报名',
          storesSelected: 0,
        });
      }
    } else {
      // 5. 逐个报名
      // 需要回到第1页重新开始
      await navigateBackToList(page);
      await page.waitForTimeout(3000);
      const freshFrame = await findTargetFrame(page);

      for (let i = 0; i < available.length; i++) {
        const activity = available[i];
        log('info', `\n--- 报名 [${i + 1}/${available.length}]: ${activity.name} ---`);

        try {
          // 5a. 点击活动卡片的"立即报名"→进入详情页
          const clickedList = await clickSignupOnList(freshFrame, activity.index);
          if (!clickedList) {
            results.push({ activityName: activity.name, success: false, message: '未找到列表页报名按钮', storesSelected: 0 });
            continue;
          }
          await page.waitForTimeout(3000);

          // 5b. 在详情页点击"立即报名"→进入报名流程
          const detailFrame = await findTargetFrame(page);
          const clickedDetail = await clickSignupOnDetail(detailFrame);
          if (!clickedDetail) {
            results.push({ activityName: activity.name, success: false, message: '未找到详情页报名按钮', storesSelected: 0 });
            await navigateBackToList(page);
            continue;
          }
          await page.waitForTimeout(3000);

          // 5c. 第1步：选择门店
          const signupFrame = await findTargetFrame(page);
          const storeNames = config.targetStores;
          const selectedCount = await selectStores(signupFrame, page, storeNames);

          if (selectedCount === 0) {
            results.push({ activityName: activity.name, success: false, message: '未能选择任何门店', storesSelected: 0 });
            await navigateBackToList(page);
            continue;
          }

          // 5d. 点击下一步
          const nextClicked = await clickNextStep(signupFrame, page);
          if (!nextClicked) {
            results.push({ activityName: activity.name, success: false, message: '下一步按钮不可点击', storesSelected: selectedCount });
            await navigateBackToList(page);
            continue;
          }

          // 5e. 第2步：添加商品
          const productsAdded = await addProducts(signupFrame, page, activity.category);
          if (!productsAdded) {
            log('warn', `商品添加未完成: ${activity.name}，跳过提交`);
            results.push({
              activityName: activity.name,
              success: false,
              message: '商品添加未完成（功能待完善）',
              storesSelected: selectedCount,
            });
            await navigateBackToList(page);
            continue;
          }

          // 5f. 确认提交
          const submitted = await clickConfirmSubmit(signupFrame, page);

          // 截图
          const ssPath = path.join(LOG_DIR, `brand_coupon_${i}_${Date.now()}.png`);
          await page.screenshot({ path: ssPath, fullPage: false });

          results.push({
            activityName: activity.name,
            success: submitted,
            message: submitted ? '报名成功' : '提交按钮不可点击',
            storesSelected: selectedCount,
            screenshot: ssPath,
          });

          // 返回列表页继续下一个
          await navigateBackToList(page);
          await page.waitForTimeout(2000);

        } catch (err: any) {
          log('error', `报名异常: ${activity.name}`, { err: err?.message });
          const ssPath = path.join(LOG_DIR, `brand_coupon_error_${i}_${Date.now()}.png`);
          try { await page.screenshot({ path: ssPath, fullPage: true }); } catch {}
          results.push({
            activityName: activity.name,
            success: false,
            message: err?.message || '未知错误',
            storesSelected: 0,
            screenshot: ssPath,
          });
          // 尝试回到列表页
          try { await navigateBackToList(page); } catch {}
        }
      }
    }

    // 6. 保存结果
    const resultFile = path.join(DATA_DIR, `brand_coupon_results_${today}.json`);
    fs.writeFileSync(resultFile, JSON.stringify(results, null, 2), 'utf-8');

    // 7. 打印汇总
    const succeeded = results.filter(r => r.success && !r.skipped);
    const failed = results.filter(r => !r.success && !r.skipped);
    const skipped = results.filter(r => r.skipped);

    console.log('\n');
    console.log('══════════════════════════════════════════');
    console.log(`  品牌专属券报名结果 | ${new Date().toISOString().split('T')[0]}`);
    console.log('══════════════════════════════════════════');
    for (const r of results) {
      const icon = r.skipped ? '⏭️' : r.success ? '✅' : '❌';
      console.log(`  ${icon} ${r.activityName}`);
      console.log(`     ${r.message}${r.storesSelected > 0 ? ` (${r.storesSelected}店)` : ''}`);
    }
    console.log('──────────────────────────────────────────');
    console.log(`  ✅ 成功: ${succeeded.length}  ⏭️ 跳过: ${skipped.length}  ❌ 失败: ${failed.length}`);
    console.log('══════════════════════════════════════════\n');

    log('info', '报名汇总', {
      total: results.length,
      succeeded: succeeded.length,
      failed: failed.length,
      skipped: skipped.length,
    });

  } catch (err: any) {
    log('error', '执行失败', { error: err?.message, stack: err?.stack });
    const ssPath = path.join(LOG_DIR, `error_brand_coupon_${Date.now()}.png`);
    try { await page.screenshot({ path: ssPath, fullPage: true }); } catch {}
    throw err;
  } finally {
    await context.close();
    log('info', '=== 品牌专属券报名完成 ===');
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
