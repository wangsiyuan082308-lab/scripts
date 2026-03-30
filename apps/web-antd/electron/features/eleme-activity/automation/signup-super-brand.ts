/**
 * 超级品牌活动自动报名
 * 只处理"超级品牌"类活动 - 直接点击报名，不需要UPC
 */

import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'node:child_process';

// ============================================================
// 日志系统
// ============================================================

const LOG_DIR = path.join(__dirname, '..', 'logs');
const DATA_DIR = path.join(__dirname, '..', 'data');

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
const LOG_FILE = path.join(LOG_DIR, `super_brand_${today}.log`);

function log(level: 'info' | 'warn' | 'error', msg: string, data?: any) {
  const ts = new Date().toISOString();
  const entry = { ts, level, msg, ...(data ? { data } : {}) };
  const line = JSON.stringify(entry);
  console.log(`[${ts}] [${level.toUpperCase()}] ${msg}${data ? ' ' + JSON.stringify(data) : ''}`);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

// ============================================================
// 活动类型识别
// ============================================================

type ActivityType = 'super_brand' | 'brand_coupon' | 'flash_sale' | 'other';

function classifyActivity(name: string, fullText: string): ActivityType {
  const combined = name + ' ' + fullText;
  if (combined.includes('超级品牌')) return 'super_brand';
  if (/专属券|专享券|品类红包/.test(combined)) return 'brand_coupon';
  if (/闪购567|限时抢购|爆好价|爆涨红包/.test(combined)) return 'flash_sale';
  return 'other';
}

function isChainAccountOnly(text: string): boolean {
  return /请使用连锁账号报名|连锁账号报名/.test(text);
}

async function ensureMainAccount(page: any) {
  // 硬性门禁：活动报名必须在"杭州货百盈*"总账号下执行
  const pageText = await page.locator('body').innerText().catch(() => '');
  const inMainAccount = /杭州货百盈/.test(pageText);
  if (inMainAccount) {
    log('info', '账号门禁通过：当前为"杭州货百盈"总账号');
    return;
  }
  
  // 不在总账号，尝试切换
  log('info', '当前非"杭州货百盈"总账号，尝试自动切换...');
  
  try {
    // 点击账号切换触发器
    await page.click('.account-switch .account-switch-trigger');
    await page.waitForTimeout(800);
    await page.waitForSelector('.account-switch-dropdown', { timeout: 5000 });
    
    // 找到杭州货百盈并点击
    const items = await page.$$('.cascade-menu-item, .account-switch-dropdown li, [class*="menu-item"]');
    for (const item of items) {
      const text = await item.textContent();
      if (text?.includes('杭州货百盈')) {
        log('info', `找到目标账号: ${text.substring(0, 30)}`);
        await item.click();
        await page.waitForTimeout(3000);
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        
        // 验证切换结果
        const newPageText = await page.locator('body').innerText().catch(() => '');
        if (/杭州货百盈/.test(newPageText)) {
          log('info', '账号切换成功：已切换到"杭州货百盈"总账号');
          return;
        }
        break;
      }
    }
    
    // 切换失败
    throw new Error('账号切换失败：未找到"杭州货百盈"账号项');
  } catch (err: any) {
    throw new Error(`账号门禁未通过：${err?.message || '切换失败'}`);
  }
}

// ============================================================
// 主流程
// ============================================================

interface SignupResult {
  name: string;
  type: ActivityType;
  success: boolean;
  message: string;
  screenshot?: string;
}

async function main() {
  log('info', '=== 超级品牌活动自动报名启动 ===');

  const userDataDir = path.join(__dirname, '..', 'user_data');
  const activityUrl = 'https://nr.ele.me/app/eleme-nr-bfe-newretail/common-next#/pc/platformActivitiesPc/';

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
    log('info', '打开活动页面...');
    await page.goto(activityUrl, { waitUntil: 'networkidle', timeout: 60000 });

    // 2. 检测登录
    if (page.url().includes('login') || page.url().includes('sso')) {
      log('warn', '需要登录，等待手动登录（最多5分钟）...');
      try { execSync('say "请登录饿了么"', { stdio: 'ignore' }); } catch {}
      await page.waitForFunction(
        () => !window.location.href.includes('login') && !window.location.href.includes('sso'),
        { timeout: 300000 }
      );
      log('info', '登录成功');
      await page.waitForTimeout(3000);
    }

    // 3. 账号门禁（必须总账号）
    await ensureMainAccount(page);
    log('info', '账号门禁通过：当前为"杭州货百盈"总账号');

    // 4. 等待页面加载
    log('info', '等待活动列表加载...');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(5000);

    // 4. 找到目标 frame
    const frames = page.frames();
    let targetFrame = page.mainFrame();
    for (const f of frames) {
      try {
        const url = f.url();
        if (url.includes('ms.ele.me') || url.includes('ebai-zs-webapp')) {
          targetFrame = f;
          log('info', `找到目标frame: ${url.substring(0, 80)}`);
          break;
        }
      } catch {}
    }

    // 5. 等待活动卡片渲染
    log('info', '等待活动卡片加载...');
    try {
      await targetFrame.waitForSelector('.zs-act-view-v2', { timeout: 30000 });
      log('info', '活动卡片已加载');
    } catch {
      log('warn', '等待活动卡片超时，尝试继续...');
      await page.waitForTimeout(5000);
    }

    // 6. 先切到：品牌活动 -> 未报名活动 -> 超级品牌红包（含计数）
    log('info', '切换筛选：品牌活动 -> 未报名活动 -> 超级品牌红包...');
    try {
      const brandTab = targetFrame.getByText(/品牌活动/).first();
      if (await brandTab.count() > 0) {
        await brandTab.click();
        await page.waitForTimeout(2500);
      }

      const unsignedTab = targetFrame.getByText(/未报名活动/).first();
      if (await unsignedTab.count() > 0) {
        await unsignedTab.click();
        await page.waitForTimeout(2500);
      }

      // 关键：可能显示为"超级品牌红包 (8)"
      const sbFilter = targetFrame.getByText(/超级品牌红包\s*\(?\d*\)?/).first();
      if (await sbFilter.count() > 0) {
        await sbFilter.click();
        await page.waitForTimeout(3000);
        log('info', '已切换到"未报名活动 / 超级品牌红包"视图');
      } else {
        log('warn', '未找到"超级品牌红包(计数)"筛选，继续当前视图扫描');
      }
    } catch (e: any) {
      log('warn', `筛选切换失败，继续当前视图: ${e?.message || e}`);
    }

    // 7. 获取总页数
    log('info', '开始扫描所有页面...');

    const totalPages = await targetFrame.evaluate(() => {
      const pag = document.querySelector('.ant-pagination');
      if (!pag) return 1;
      let max = 1;
      pag.querySelectorAll('li').forEach(li => {
        const n = parseInt(li.textContent?.trim() || '');
        if (!isNaN(n)) max = Math.max(max, n);
      });
      return max;
    });

    log('info', `共 ${totalPages} 页`);

    let superBrandCount = 0;
    let totalScanned = 0;
    const processedIds = new Set<string>(); // 跟踪已处理的活动，避免重复

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      log('info', `--- 第 ${pageNum}/${totalPages} 页 ---`);

      // 在当前页循环处理，每次重新扫描（修复索引偏移问题）
      while (true) {
        // 每次重新扫描当前页的卡片（获取最新索引）
        const cards = await targetFrame.evaluate(() => {
          return Array.from(document.querySelectorAll('.zs-act-view-v2')).map((card, i) => {
            const text = (card.textContent || '').replace(/\s+/g, ' ');
            const id = text.substring(0, 120); // 用前120字作为唯一标识
            let name = '';
            const m = text.match(/【([^】]+)】\s*([^\n活动时间]*)/);
            if (m) name = `[${m[1].trim()}]${m[2].trim()}`;
            else name = text.substring(0, 60).trim();
            name = name.replace(/立即报名.*$|报名截止.*$/g, '').trim();
            if (name.length > 80) name = name.substring(0, 80) + '...';
            const status = text.includes('已报名') ? 'signed_up' : text.includes('已结束') ? 'expired' : 'available';
            const hasSignupBtn = Array.from(card.querySelectorAll('button, a, span')).some(
              el => (el.textContent || '').trim() === '立即报名'
            );
            return { index: i, name, fullText: text.substring(0, 500), status, id, hasSignupBtn };
          });
        });

        // 首次扫描记录总数
        if (pageNum === 1 && totalScanned === 0) totalScanned = cards.length;
        else if (totalScanned === 0) totalScanned += cards.length;

        // 找第一个未处理的超级品牌活动
        const target = cards.find(c => {
          const type = classifyActivity(c.name, c.fullText);
          return type === 'super_brand' && c.status === 'available' && c.hasSignupBtn && !processedIds.has(c.id);
        });

        if (!target) {
          log('info', `本页无更多未处理的超级品牌活动`);
          break; // 当前页处理完毕，翻到下一页
        }

        const type: ActivityType = 'super_brand';
        processedIds.add(target.id);
        superBrandCount++;
        log('info', `[超级品牌] ${target.name} (状态: ${target.status})`);

        // 规则校验：连锁账号专属活动（普通门店账号不可报）
        if (isChainAccountOnly(target.fullText)) {
          const reason = '活动要求连锁账号报名，当前账号不可报';
          log('warn', `  → ${reason}`);
          results.push({ name: target.name, type, success: false, message: reason });
          await page.waitForTimeout(1200);
          continue;
        }

        // 步骤1: 点击卡片上的"立即报名"进入详情页（使用最新索引）
        log('info', `  → 进入详情页...`);
        const cardBtn = targetFrame.locator('.zs-act-view-v2').nth(target.index).locator('text=立即报名');
        if (await cardBtn.count() === 0) {
          log('warn', `  → 未找到报名按钮`);
          results.push({ name: target.name, type, success: false, message: '未找到报名按钮' });
          continue; // 继续while循环，重新扫描
        }
        await cardBtn.first().click();
        await page.waitForTimeout(5000);

        // 步骤2: 在详情页提取商家出资比例
        const detailText = await targetFrame.evaluate(() => document.body.innerText);

        let totalDiscount = 0;
        let platformSubsidy = 0;
        const tierMatch = detailText.match(/满\s*(\d+)\s*减\s*(\d+(?:\.\d+)?)\s*元.*?(?:淘宝闪购|平台)补(?:贴)?\s*(\d+(?:\.\d+)?)\s*元/);
        if (tierMatch) {
          totalDiscount = parseFloat(tierMatch[2]);
          platformSubsidy = parseFloat(tierMatch[3]);
        }
        const merchantCost = totalDiscount - platformSubsidy;
        const merchantRatio = totalDiscount > 0 ? Math.round((merchantCost / totalDiscount) * 1000) / 1000 : 0;

        log('info', `  → 优惠信息: 总减${totalDiscount}元, 平台补${platformSubsidy}元, 商家出${merchantCost}元 (${(merchantRatio * 100).toFixed(1)}%)`);

        // 步骤3: 商家出资比例校验（商家承担>=60%则跳过）
        if (merchantRatio >= 0.6) {
          const reason = `商家出资 ${(merchantRatio * 100).toFixed(1)}%（>=60%），按规则跳过报名`;
          log('warn', `  → ${reason}`);
          results.push({ name: target.name, type, success: false, message: reason });

          // 返回活动列表页
          log('info', `  → 返回活动列表...`);
          const breadcrumb = targetFrame.locator('text=平台活动').first();
          if (await breadcrumb.count() > 0) {
            await breadcrumb.click();
            await page.waitForTimeout(3000);
          } else {
            await page.goto(activityUrl, { waitUntil: 'networkidle', timeout: 60000 });
            await page.waitForTimeout(3000);
          }

          // 重新找到目标frame（页面可能刷新了）
          for (const f of page.frames()) {
            try {
              if (f.url().includes('ms.ele.me') || f.url().includes('ebai-zs-webapp')) {
                targetFrame = f;
                break;
              }
            } catch {}
          }

          // 翻回当前页（页数可能变化）
          if (pageNum > 1) {
            log('info', `  → 翻回第 ${pageNum} 页...`);
            const currentTotalPages = await targetFrame.evaluate(() => {
              const pag = document.querySelector('.ant-pagination');
              if (!pag) return 1;
              let max = 1;
              pag.querySelectorAll('li').forEach(li => {
                const n = parseInt(li.textContent?.trim() || '');
                if (!isNaN(n)) max = Math.max(max, n);
              });
              return max;
            });
            const targetPage = Math.min(pageNum, currentTotalPages);
            for (let p = 2; p <= targetPage; p++) {
              await targetFrame.evaluate((pn: number) => {
                document.querySelector('.ant-pagination')?.querySelectorAll('li').forEach(li => {
                  if (li.textContent?.trim() === String(pn) && !li.classList.contains('ant-pagination-disabled'))
                    (li as HTMLElement).click();
                });
              }, p);
              await page.waitForTimeout(3000);
            }
          }

          // 继续处理下一个活动
          await page.waitForTimeout(1500);
          continue;
        }

        log('info', `  → 商家出资 ${(merchantRatio * 100).toFixed(1)}%，符合规则，继续报名...`);
        {
          // 步骤4: 点击详情页的"立即报名"大按钮
          // 监听新页面（可能在新标签页打开）
          const newPagePromise = context.waitForEvent('page', { timeout: 10000 }).catch(() => null);
          const detailSignupBtn = targetFrame.locator('button.ant-btn-primary.ant-btn-lg:has-text("立即报名")');
          if (await detailSignupBtn.count() > 0) {
            await detailSignupBtn.first().click();
          } else {
            const fallbackBtn = targetFrame.locator('button:has-text("立即报名")');
            if (await fallbackBtn.count() > 0) {
              await fallbackBtn.first().click();
            }
          }

          // 检查是否打开了新页面
          const newPage = await newPagePromise;
          if (newPage) {
            log('info', `  → 报名在新标签页打开: ${newPage.url().substring(0, 80)}`);
            await newPage.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
            await newPage.waitForTimeout(3000);
            // 切换到新页面继续操作
            // 注意：后续操作需要在新页面上进行
          } else {
            // 没有新页面，在当前页面等待
            try {
              await page.waitForTimeout(5000);
            } catch {
              log('warn', `  → 页面可能已导航，尝试恢复...`);
              await new Promise(r => setTimeout(r, 5000));
            }
          }

          // 步骤5: 报名向导 - 第1步：确认规则
          log('info', `  → 向导第1步：确认规则...`);
          const agreeCheckbox = targetFrame.locator('input[type="checkbox"]');
          if (await agreeCheckbox.count() > 0) {
            const isChecked = await agreeCheckbox.first().isChecked().catch(() => false);
            if (!isChecked) {
              await agreeCheckbox.first().click();
              log('info', `  → 已勾选同意协议`);
              await page.waitForTimeout(1000);
            }
          }

          const nextStepBtn = targetFrame.locator('button.ant-btn-primary.ant-btn-lg:has-text("下一步")');
          if (await nextStepBtn.count() > 0) {
            await nextStepBtn.first().click();
            log('info', `  → 已点击"下一步"`);
            await page.waitForTimeout(5000);
          } else {
            log('warn', `  → 未找到"下一步"按钮`);
          }

          // 步骤6: 报名向导 - 第2步：选择门店
          log('info', `  → 向导第2步：选择门店...`);
          const selectAllCheckbox = targetFrame.locator('text=全选').first();
          if (await selectAllCheckbox.count() > 0) {
            await selectAllCheckbox.click();
            log('info', `  → 已点击"全选"门店`);
            await page.waitForTimeout(1000);
          } else {
            const storeCheckboxes = targetFrame.locator('.ant-checkbox-input, .ant-checkbox');
            const checkboxCount = await storeCheckboxes.count();
            if (checkboxCount > 0) {
              log('info', `  → 找到 ${checkboxCount} 个门店选项，逐个勾选...`);
              for (let i = 0; i < checkboxCount; i++) {
                const isChecked = await storeCheckboxes.nth(i).isChecked().catch(() => false);
                if (!isChecked) {
                  await storeCheckboxes.nth(i).click().catch(() => {});
                  await page.waitForTimeout(300);
                }
              }
            }
          }

          // 点击提交按钮
          const step2Btn = targetFrame.locator('button.ant-btn-primary.ant-btn-lg');
          if (await step2Btn.count() > 0) {
            const btnText = await step2Btn.first().textContent() || '';
            await step2Btn.first().click();
            log('info', `  → 已点击"${btnText.trim()}"`);
            await page.waitForTimeout(5000);
          }

          // 处理可能的确认弹窗
          const confirmBtn = targetFrame.locator('.ant-modal .ant-btn-primary');
          if (await confirmBtn.count() > 0) {
            await confirmBtn.first().click();
            log('info', `  → 确认弹窗已点击`);
            await page.waitForTimeout(2000);
          }

          // 截图
          const ssName = `signup_super_brand_${superBrandCount}_${Date.now()}.png`;
          const ssPath = path.join(LOG_DIR, ssName);
          await page.screenshot({ path: ssPath, fullPage: false });

          // 检查结果
          const resultText = await targetFrame.evaluate(() => document.body.innerText.substring(0, 3000));
          let msg = '已操作，待确认';
          if (resultText.includes('报名成功') || resultText.includes('已报名') || resultText.includes('报名完成')) msg = '报名成功';
          else if (resultText.includes('报名失败')) msg = '报名失败';
          log('info', `  → 结果: ${msg}`);
          results.push({ name: target.name, type, success: msg !== '报名失败', message: msg, screenshot: ssName });
        }

        // 返回活动列表页
        log('info', `  → 返回活动列表...`);
        const breadcrumb = targetFrame.locator('text=平台活动').first();
        if (await breadcrumb.count() > 0) {
          await breadcrumb.click();
          await page.waitForTimeout(3000);
        } else {
          await page.goto(activityUrl, { waitUntil: 'networkidle', timeout: 60000 });
          await page.waitForTimeout(3000);
        }

        // 重新找到目标frame（页面可能刷新了）
        for (const f of page.frames()) {
          try {
            if (f.url().includes('ms.ele.me') || f.url().includes('ebai-zs-webapp')) {
              targetFrame = f;
              break;
            }
          } catch {}
        }

        // 翻回当前页（报名成功后活动消失，页数可能减少，需要检查）
        if (pageNum > 1) {
          log('info', `  → 翻回第 ${pageNum} 页...`);
          const currentTotalPages = await targetFrame.evaluate(() => {
            const pag = document.querySelector('.ant-pagination');
            if (!pag) return 1;
            let max = 1;
            pag.querySelectorAll('li').forEach(li => {
              const n = parseInt(li.textContent?.trim() || '');
              if (!isNaN(n)) max = Math.max(max, n);
            });
            return max;
          });
          // 如果当前页超过了总页数，调整到最后一页
          const targetPage = Math.min(pageNum, currentTotalPages);
          for (let p = 2; p <= targetPage; p++) {
            await targetFrame.evaluate((pn: number) => {
              document.querySelector('.ant-pagination')?.querySelectorAll('li').forEach(li => {
                if (li.textContent?.trim() === String(pn) && !li.classList.contains('ant-pagination-disabled'))
                  (li as HTMLElement).click();
              });
            }, p);
            await page.waitForTimeout(3000);
          }
        }

        // 间隔避免限流
        await page.waitForTimeout(2000);
      } // end while

      // 翻页
      if (pageNum < totalPages) {
        const nextPage = pageNum + 1;
        log('info', `翻到第 ${nextPage} 页...`);
        await targetFrame.evaluate((pn: number) => {
          const pag = document.querySelector('.ant-pagination');
          if (!pag) return;
          pag.querySelectorAll('li').forEach(li => {
            if (li.textContent?.trim() === String(pn) && !li.classList.contains('ant-pagination-disabled')) {
              (li as HTMLElement).click();
            }
          });
        }, nextPage);
        await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(5000);
      }
    } // end for pageNum

    // === 第二轮：扫描"品牌活动"tab ===
    log('info', '=== 切换到"品牌活动"tab扫描 ===');
    try {
      await page.goto(activityUrl, { waitUntil: 'networkidle', timeout: 60000 });
      await page.waitForTimeout(5000);
      for (const f of page.frames()) {
        try { if (f.url().includes('ms.ele.me') || f.url().includes('ebai-zs-webapp')) { targetFrame = f; break; } } catch {}
      }
      await targetFrame.waitForSelector('.zs-act-view-v2', { timeout: 30000 }).catch(() => {});

      // 点击"品牌活动"tab
      const brandTab = targetFrame.locator('text=品牌活动').first();
      if (await brandTab.count() > 0) {
        await brandTab.click();
        log('info', '已切换到"品牌活动"tab');
        await page.waitForTimeout(5000);
        await targetFrame.waitForSelector('.zs-act-view-v2', { timeout: 30000 }).catch(() => {});

        // 点击"超级品牌红包"筛选
        const sbFilter = targetFrame.locator('text=超级品牌红包').first();
        if (await sbFilter.count() > 0) {
          await sbFilter.click();
          log('info', '已点击"超级品牌红包"筛选');
          await page.waitForTimeout(5000);
          await targetFrame.waitForSelector('.zs-act-view-v2', { timeout: 30000 }).catch(() => {});
        }

        // 扫描品牌活动tab的所有页
        const brandPages = await targetFrame.evaluate(() => {
          const pag = document.querySelector('.ant-pagination');
          if (!pag) return 1;
          let max = 1;
          pag.querySelectorAll('li').forEach(li => { const n = parseInt(li.textContent?.trim() || ''); if (!isNaN(n)) max = Math.max(max, n); });
          return max;
        });
        log('info', `品牌活动tab共 ${brandPages} 页`);

        for (let bp = 1; bp <= brandPages; bp++) {
          log('info', `--- 品牌活动 第 ${bp}/${brandPages} 页 ---`);
          // 列出所有活动（不报名，先记录）
          const cards = await targetFrame.evaluate(() => {
            return Array.from(document.querySelectorAll('.zs-act-view-v2')).map((card, i) => {
              const text = (card.textContent || '').replace(/\s+/g, ' ');
              let name = text.substring(0, 80).trim();
              const status = text.includes('已报名') ? 'signed_up' : text.includes('已结束') ? 'expired' : 'available';
              const hasSignupBtn = Array.from(card.querySelectorAll('button, a, span')).some(el => (el.textContent || '').trim() === '立即报名');
              return { index: i, name, status, hasSignupBtn, fullText: text.substring(0, 300) };
            });
          });
          for (const c of cards) {
            const isSB = c.fullText.includes('超级品牌');
            log('info', `  ${isSB ? '🔴' : '⚪'} [${c.status}] ${c.name} ${c.hasSignupBtn ? '(可报名)' : ''}`);
          }
          // 翻页
          if (bp < brandPages) {
            await targetFrame.evaluate((pn: number) => {
              document.querySelector('.ant-pagination')?.querySelectorAll('li').forEach(li => {
                if (li.textContent?.trim() === String(pn) && !li.classList.contains('ant-pagination-disabled')) (li as HTMLElement).click();
              });
            }, bp + 1);
            await page.waitForTimeout(5000);
          }
        }
      } else {
        log('warn', '未找到"品牌活动"tab');
      }
    } catch (err: any) {
      log('warn', `品牌活动tab扫描失败: ${err?.message}`);
    }

    // 7. 输出汇总
    const succeeded = results.filter(r => r.success && r.message !== '已报名');
    const alreadySigned = results.filter(r => r.message === '已报名');
    const failed = results.filter(r => !r.success);

    const summary = {
      timestamp: new Date().toISOString(),
      totalScanned,
      superBrandFound: superBrandCount,
      newSignups: succeeded.length,
      alreadySigned: alreadySigned.length,
      failed: failed.length,
      results,
    };

    // 保存结果
    const resultFile = path.join(DATA_DIR, `super_brand_signup_${today}.json`);
    fs.writeFileSync(resultFile, JSON.stringify(summary, null, 2), 'utf-8');

    log('info', '=== 报名汇总 ===');
    log('info', `扫描活动总数: ${totalScanned}`);
    log('info', `超级品牌活动: ${superBrandCount} 个`);
    log('info', `新报名成功: ${succeeded.length} 个`);
    log('info', `已报名(跳过): ${alreadySigned.length} 个`);
    log('info', `失败: ${failed.length} 个`);

    if (failed.length > 0) {
      log('warn', '失败详情:', failed.map(f => ({ name: f.name, reason: f.message })));
    }

    log('info', `结果已保存: ${resultFile}`);
    log('info', `日志文件: ${LOG_FILE}`);

    // 打印可读汇总到控制台
    console.log('\n');
    console.log('══════════════════════════════════════════');
    console.log(`  超级品牌活动报名结果 | ${new Date().toISOString().split('T')[0]}`);
    console.log('══════════════════════════════════════════');
    for (const r of results) {
      const icon = r.message === '已报名' ? '⏭️' : r.success ? '✅' : '❌';
      console.log(`  ${icon} ${r.name}`);
      console.log(`     ${r.message}`);
    }
    console.log('──────────────────────────────────────────');
    console.log(`  ✅ 新报名: ${succeeded.length}  ⏭️ 已报名: ${alreadySigned.length}  ❌ 失败: ${failed.length}`);
    console.log('══════════════════════════════════════════\n');

  } catch (err: any) {
    log('error', '执行失败', { error: err?.message, stack: err?.stack });
    const ssPath = path.join(LOG_DIR, `error_super_brand_${Date.now()}.png`);
    try { await page.screenshot({ path: ssPath, fullPage: true }); } catch {}
    throw err;
  } finally {
    await context.close();
    log('info', '=== 超级品牌活动报名完成 ===');
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
