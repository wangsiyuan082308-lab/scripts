import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Frame, Page } from 'playwright';
import { CONFIG, loadCoords, saveCoords } from './config';
import { createLogger, metrics } from './logger';
import { delay } from './browser';

const log = createLogger('store');

// --- 工具函数 ---

function extractAmountFromText(text: string): null | number {
  const normalized = text.replaceAll(/\s+/g, ' ').trim();
  if (!normalized) return null;
  if (/暂无余额|无可提现|无余额/.test(normalized)) return 0;

  const contextMatch = normalized.match(
    /(?:账户可用总金额(?:（元）|\(元\))?|可提现金额|可提现|可用余额|余额)\D{0,30}(\d[0-9,]*\.?\d*)/,
  );
  if (contextMatch?.[1]) {
    const n = Number.parseFloat(contextMatch[1].replaceAll(',', ''));
    if (!Number.isNaN(n)) return n;
  }

  const currencyRegex = /[¥￥]\s*(\d[0-9,]*\.?\d*)/g;
  let max: null | number = null;
  while (true) {
    const m = currencyRegex.exec(normalized);
    if (m === null) break;
    const n = Number.parseFloat(m[1].replaceAll(',', ''));
    if (!Number.isNaN(n)) max = max === null ? n : Math.max(max, n);
  }
  if (max !== null) return max;
  return null;
}

async function findAmountByLabel(frame: Frame, label: RegExp | string): Promise<null | number> {
  try {
    const locator = typeof label === 'string'
      ? frame.getByText(label, { exact: true }).first()
      : frame.getByText(label).first();

    if (!(await locator.isVisible({ timeout: 800 }))) return null;

    const candidates = await locator.evaluate((el) => {
      const results: string[] = [];
      const addText = (node: Element | null | undefined) => {
        if (!node) return;
        const t = (node.textContent ?? '').trim();
        if (t) results.push(t);
      };
      addText(el.nextElementSibling);
      addText(el.previousElementSibling);
      const parent = el.parentElement;
      addText(parent);
      const container = el.closest('div, section, li, tr, td') ?? parent;
      addText(container);
      if (container) {
        const valueLike = container.querySelector(
          '[class*="amount"], [class*="money"], [class*="num"], strong, b, em',
        );
        addText(valueLike);
      }
      return results;
    });

    for (const text of candidates) {
      const amount = extractAmountFromText(text);
      if (amount !== null) return amount;
    }
  } catch {}
  return null;
}

async function clickButton(
  ctx: Frame | Page,
  selectorOrText: RegExp | string,
  options: { isText?: boolean; timeout?: number } = {},
): Promise<boolean> {
  const { isText = true, timeout = 1000 } = options;

  try {
    const locator = isText
      ? ctx.locator('button, div, span, a').filter({ hasText: selectorOrText })
      : ctx.locator(selectorOrText as string);

    const count = await locator.count();
    if (count === 0) return false;

    for (let i = 0; i < count; i++) {
      const element = locator.nth(i);
      if (!(await element.isVisible())) continue;

      const isDeepVisible = await element.evaluate((el) => {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        let parent = el.parentElement;
        while (parent) {
          const parentStyle = window.getComputedStyle(parent);
          if (parentStyle.display === 'none' || parentStyle.visibility === 'hidden') return false;
          parent = parent.parentElement;
        }
        return true;
      });

      if (isDeepVisible) {
        try {
          await element.click({ timeout });
          return true;
        } catch {}
      }
    }
  } catch {}
  return false;
}

// --- 门店切换 ---

export async function switchStore(page: Page, targetStore: string): Promise<void> {
  const storeLog = log.child(targetStore);
  storeLog.info(`正在尝试切换到门店: ${targetStore}...`);
  const switchStart = Date.now();

  const debugDir = path.join(process.cwd(), 'debug');
  if (!fs.existsSync(debugDir)) {
    try { fs.mkdirSync(debugDir, { recursive: true }); } catch {}
  }

  try {
    let dropdownOpened = false;

    const triggerSelectors = [
      '.account-switch', '.shop-select', '.store-select',
      '.ant-dropdown-trigger', '.el-dropdown-link',
      '[class*="shop-select"]', '[class*="store-select"]',
      'header .ant-select', '.anticon-down', '.el-icon-arrow-down',
    ];

    for (const selector of triggerSelectors) {
      try {
        const el = page.locator(selector).first();
        if (await el.isVisible({ timeout: 500 })) {
          storeLog.info(`尝试点击切换按钮: ${selector}`);
          await el.click();
          await delay(1000);

          const dropdownVisible = await page.evaluate(() => {
            const possibleDropdowns = document.querySelectorAll(
              '.ant-dropdown, .el-dropdown-menu, .ant-select-dropdown, ul[role="menu"], .account-switch-dropdown',
            );
            for (const d of possibleDropdowns) {
              const style = window.getComputedStyle(d);
              if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') return true;
            }
            return false;
          });

          if (dropdownVisible) {
            storeLog.info('下拉菜单已展开。');
            dropdownOpened = true;
            break;
          }
        }
      } catch {}
    }

    if (!dropdownOpened) {
      for (const store of CONFIG.targetStores) {
        try {
          const textEl = page.locator(`text=${store}`).first();
          if (await textEl.isVisible({ timeout: 500 })) {
            storeLog.info(`点击页面上的门店名称 "${store}" 作为切换按钮...`);
            await textEl.click();
            await delay(1000);
            dropdownOpened = true;
            break;
          }
        } catch {}
      }
    }

    storeLog.info(`正在查找目标门店选项: ${targetStore}`);

    try {
      const searchInput = page.getByPlaceholder(/搜索|门店|店铺/);
      if (await searchInput.isVisible({ timeout: 2000 })) {
        storeLog.info('找到搜索框，输入门店名称...');
        await searchInput.fill(targetStore);
        await delay(1000);
      }
    } catch {}

    try {
      const targetOption = page
        .locator('li, div[role="option"], .ant-dropdown-menu-item, .el-dropdown-menu__item')
        .filter({ hasText: targetStore })
        .first();

      if (await targetOption.isVisible({ timeout: 5000 })) {
        storeLog.info(`找到目标门店选项，点击切换...`);
        await targetOption.click();
        await delay(5000);
        storeLog.info(`已切换到: ${targetStore}`);
        metrics.storeSwitch(targetStore, true, Date.now() - switchStart);
        return;
      } else {
        storeLog.warn(`未找到目标门店选项: ${targetStore}`);
        storeLog.obs('WARN', '门店切换未命中目标选项', {
          stage: 'store.switch',
          code: 'EAW_ST_SWITCH_TARGET_NOT_FOUND',
          reason: '目标门店未在下拉中匹配到',
          retryable: true,
        });
      }
    } catch (error) {
      storeLog.warn('查找目标选项失败');
      storeLog.obs('WARN', '门店切换查找选项异常', {
        stage: 'store.switch',
        code: 'EAW_ST_SWITCH_LOCATE_ERROR',
        reason: error instanceof Error ? error.message : String(error),
        retryable: true,
      });
    }

    try {
      const currentStoreEl = page.locator('body').getByText(targetStore).first();
      if (await currentStoreEl.isVisible()) {
        storeLog.info(`页面上可见 "${targetStore}"，假定已在目标门店。`);
        metrics.storeSwitch(targetStore, true, Date.now() - switchStart);
        return;
      }
    } catch {}

    storeLog.error(`切换到门店 ${targetStore} 失败。`);
    storeLog.obs('ERROR', '门店切换失败', {
      stage: 'store.switch',
      code: 'EAW_ST_SWITCH_FAILED',
      reason: '尝试多个入口后仍未切换成功',
      retryable: true,
    });
    metrics.storeSwitch(targetStore, false, Date.now() - switchStart);
    await page.screenshot({ path: path.join(debugDir, `switch_failed_${targetStore}.png`) });
  } catch (error) {
    storeLog.error('切换门店过程中发生错误');
    storeLog.obs('ERROR', '门店切换异常', {
      stage: 'store.switch',
      code: 'EAW_ST_SWITCH_EXCEPTION',
      reason: error instanceof Error ? error.message : String(error),
      retryable: true,
    });
  }
}

// --- 导航到财务模块 ---

export async function navigateToFinance(page: Page): Promise<void> {
  log.info('正在导航到财务模块...');
  try {
    const financeLink = page.getByText('财务').first();
    await financeLink.click();
    await delay(2000);
    
    // 检查并关闭顶部通知横幅（系统升级通知）
    log.info('检查是否有通知横幅需要关闭...');
    const frames = page.frames();
    let foundNotification = false;
    for (const frame of frames) {
      try {
        const frameContent = await frame.locator('body').innerText().catch(() => '');
        if (frameContent.includes('致商户伙伴') || frameContent.includes('系统优化升级')) {
          log.info('发现系统通知横幅，尝试关闭...');
          foundNotification = true;
          // 尝试多种关闭方式
          // 1. 尝试点击关闭X按钮
          const closeSelectors = [
            '.ant-notification-close',
            '.notice-close',
            '[class*="close"]',
            'button[aria-label*="close"]',
            '.anticon-close',
            'span[aria-label*="close"]'
          ];
          let closed = false;
          for (const selector of closeSelectors) {
            try {
              const closeBtn = frame.locator(selector).first();
              if (await closeBtn.isVisible({ timeout: 1000 })) {
                await closeBtn.click();
                log.info(`通过 ${selector} 关闭通知横幅`);
                closed = true;
                await delay(500);
                break;
              }
            } catch {}
          }
          // 2. 尝试通过文本找关闭按钮
          if (!closed) {
            try {
              const closeByText = frame.locator('text=关闭, text=×, text=X').first();
              if (await closeByText.isVisible({ timeout: 1000 })) {
                await closeByText.click();
                log.info('通过文本"关闭"关闭通知横幅');
                closed = true;
                await delay(500);
              }
            } catch {}
          }
          // 3. 尝试点击通知区域外的位置
          if (!closed) {
            try {
              // 点击页面主体区域，可能关闭通知
              await frame.locator('body').click({ position: { x: 100, y: 300 } });
              log.info('点击通知外部区域');
              await delay(500);
            } catch {}
          }
          break;
        }
      } catch {}
    }
    
    // 等待通知消失
    await delay(1000);
  } catch (error) {
    log.error('点击财务模块失败');
    log.obs('ERROR', '财务模块导航失败', {
      stage: 'finance.navigate',
      code: 'EAW_FIN_NAV_CLICK_FAILED',
      reason: error instanceof Error ? error.message : String(error),
      retryable: true,
    });
    throw error;
  }
}

// --- 提现处理（支持多账户：主资金 + 网商云）---

interface AccountInfo {
  name: string;
  amount: number;
  element: any; // Locator
}

export async function handleWithdrawal(
  page: Page,
  storeName: string,
): Promise<'blocked' | 'fail' | 'success'> {
  const storeLog = log.child(storeName);
  storeLog.info('正在寻找账户总览及提现按钮...');

  // 风控检测
  if ((await page.locator('.nc_wrapper, .sm-slider-wrapper, iframe[src*="captcha"]').count()) > 0) {
    storeLog.warn('发现滑块验证码，暂停操作！');
    storeLog.obs('WARN', '检测到验证码风控', {
      stage: 'withdrawal.handle',
      code: 'EAW_WD_CAPTCHA_BLOCKED',
      reason: '页面存在验证码组件',
      retryable: true,
    });
    metrics.riskControl(1, 'captcha_detected', 'blocked');
    metrics.withdrawalAttempt(storeName, null, 'blocked', '滑块验证码');
    return 'blocked';
  }

  // ===== 多账户检测 =====
  storeLog.info('【多账户扫描】检测所有账户（主资金、网商云）...');
  const accounts: AccountInfo[] = [];
  
  for (const frame of page.frames()) {
    try {
      // 方法1: 通过账户名称定位，然后找同一行的余额和提现按钮
      const accountNames = ['主资金账户', '网商云资金账户', '网商云账户'];
      
      for (const accName of accountNames) {
        const accLocator = frame.getByText(new RegExp(accName), { exact: false });
        const count = await accLocator.count();
        
        for (let i = 0; i < count; i++) {
          try {
            const accElement = accLocator.nth(i);
            if (!await accElement.isVisible()) continue;
            
            // 找到账户名称后，在同一个父容器内查找余额
            const container = accElement.locator('xpath=ancestor::*[local-name()="div" or local-name()="tr"][1]');
            const containerText = await container.innerText().catch(() => '');
            
            // 提取余额（数字格式，可能带逗号）
            const amountMatch = containerText.match(/(\d[0-9,]*\.?\d*)/);
            if (amountMatch) {
              const amount = Number.parseFloat(amountMatch[1].replaceAll(',', ''));
              if (!Number.isNaN(amount) && amount >= 0) {
                // 标准化账户名称
                const normalizedName = accName.includes('主资金') ? '主资金账户' : '网商云账户';
                
                accounts.push({ 
                  name: normalizedName, 
                  amount, 
                  element: accElement 
                });
                storeLog.info(`【多账户】发现 ${normalizedName}: ¥${amount}`);
              }
            }
          } catch {}
        }
      }
    } catch {}
  }

  // 如果没找到多账户，用旧逻辑
  if (accounts.length === 0) {
    storeLog.info('【多账户】未检测到明确账户结构，使用旧逻辑...');
    return await handleWithdrawalSingle(page, storeName, storeLog);
  }

  // 去重：同一账户名称+金额的只保留一个
  const uniqueAccounts: AccountInfo[] = [];
  const seen = new Set<string>();
  for (const acc of accounts) {
    const key = `${acc.name}_${acc.amount}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniqueAccounts.push(acc);
    } else {
      storeLog.info(`【去重】跳过重复账户: ${acc.name} (¥${acc.amount})`);
    }
  }
  
  storeLog.info(`【多账户】共发现 ${uniqueAccounts.length} 个唯一账户`);

  // ===== 对每个账户执行提现 =====
  let successCount = 0;
  for (const account of uniqueAccounts) {
    storeLog.info(`\n【处理账户】${account.name} (余额: ¥${account.amount})`);
    
    if (account.amount <= CONFIG.minWithdrawAmount) {
      storeLog.info(`【跳过】${account.name} 余额 ¥${account.amount} ≤ 阈值 ¥${CONFIG.minWithdrawAmount}`);
      successCount++; // 余额不足也算成功
      continue;
    }

    // 找到该账户对应的提现按钮
    const withdrawResult = await clickWithdrawForAccount(page, account, storeLog, storeName);
    if (withdrawResult) {
      successCount++;
      storeLog.info(`✅ ${account.name} 提现成功`);
    } else {
      storeLog.warn(`⚠️ ${account.name} 提现失败`);
    }
    
    await delay(2000); // 账户间等待
  }

  if (successCount === accounts.length) {
    storeLog.info(`✅ 所有 ${accounts.length} 个账户处理完成`);
    return 'success';
  } else if (successCount > 0) {
    storeLog.info(`⚠️ ${successCount}/${accounts.length} 个账户成功`);
    return 'success';
  }
  return 'fail';
}

// 点击账户对应的提现按钮
async function clickWithdrawForAccount(
  page: Page,
  account: AccountInfo,
  storeLog: ReturnType<typeof log.child>,
  storeName: string
): Promise<boolean> {
  try {
    // 不刷新页面，直接定位
    
    // 关闭可能的通知
    try {
      const frames = page.frames();
      for (const frame of frames) {
        const closeBtn = frame.locator('[class*="close"]').first();
        if (await closeBtn.isVisible({ timeout: 1000 })) {
          await closeBtn.click();
          await delay(500);
          break;
        }
      }
    } catch {}

    // 方法1: 使用业务上下文定位（推荐）
    // 找到账户名称，然后在同一行/容器内找提现按钮
    const accountLocator = page.getByText(account.name).first();
    if (await accountLocator.isVisible({ timeout: 3000 })) {
      storeLog.info(`【定位】找到账户: ${account.name}`);
      
      // 在账户元素附近找提现按钮
      const withdrawBtn = accountLocator.locator('xpath=..//button[contains(text(),"提现")] | ..//*[contains(text(),"提现")]').first();
      if (await withdrawBtn.isVisible({ timeout: 2000 })) {
        storeLog.info(`【点击】${account.name} 的提现按钮`);
        await withdrawBtn.click();
        await delay(2000);
        
        // 检查弹窗是否出现
        const mainFrame = page.mainFrame();
        const popupContent = await mainFrame.locator('body').innerText().catch(() => '');
        if (popupContent.includes('全部提现') || popupContent.includes('提现金额')) {
          return await handleWithdrawalPopupWithLog(page, mainFrame, storeLog, storeName, account.amount);
        }
      }
    }

    // 方法2: 在账户元素附近找提现按钮（兜底）
    const accountElement = account.element;
    
    // 方法1: 在账户容器内找提现按钮
    const withdrawBtn = await accountElement.evaluateHandle((node: Element) => {
      // 向上找到账户容器
      let container = node.closest('.account__item, .account-card, [class*="account"]') || node.parentElement?.parentElement;
      if (container) {
        const btn = container.querySelector('button, [class*="btn"]') as HTMLElement;
        if (btn && btn.textContent?.includes('提现')) {
          return btn;
        }
        // 找所有提现相关元素
        const allBtns = container.querySelectorAll('*');
        for (const el of allBtns) {
          if (el.textContent?.trim() === '提现') {
            return el as HTMLElement;
          }
        }
      }
      return null;
    });

    if (withdrawBtn && withdrawBtn.asElement()) {
      storeLog.info(`【点击】${account.name} 的提现按钮`);
      await withdrawBtn.asElement()!.click();
      await delay(1500);
      
      // 处理提现弹窗
      return await handleWithdrawalPopupWithLog(page, page.mainFrame(), storeLog, storeName, account.amount);
    }
  } catch (err) {
    storeLog.warn(`查找账户提现按钮失败: ${err}`);
  }

  // 方法2: 全页面扫描提现按钮（兜底）- 根据账户名称定位正确的按钮
  storeLog.info(`【兜底】扫描页面提现按钮（目标: ${account.name}）...`);
  const frames = page.frames();
  
  for (const frame of frames) {
    try {
      // 尝试多种金额格式匹配
      const amountFormats = [
        account.amount.toFixed(2),                    // "2928.03"
        account.amount.toLocaleString('zh-CN'),      // "2,928.03"
        account.amount.toLocaleString(),             // "2,928.03"
        `¥${account.amount.toFixed(2)}`,             // "¥2928.03"
        `¥${account.amount.toLocaleString()}`,       // "¥2,928.03"
      ];
      
      for (const amountText of amountFormats) {
        try {
          const amountLocator = frame.getByText(amountText, { exact: false }).first();
          
          if (await amountLocator.isVisible({ timeout: 1000 })) {
            storeLog.info(`【定位】找到金额 ${amountText}`);
            
            // 在金额元素的父容器内找提现按钮
            const parentContainer = amountLocator.locator('xpath=ancestor::*[local-name()="div" or local-name()="tr" or local-name()="section"][1]');
            const withdrawBtn = parentContainer.getByText('提现', { exact: true }).first();
            
            if (await withdrawBtn.isVisible({ timeout: 1000 })) {
              storeLog.info(`【点击】${account.name} 的提现按钮`);
              await withdrawBtn.click();
              await delay(1500);
              
              // 处理提现弹窗
              return await handleWithdrawalPopupWithLog(page, frame, storeLog, storeName, account.amount);
            }
          }
        } catch {}
      }
    } catch {}
  }

  // 方法3: 简化逻辑 - 找到所有提现按钮，点击第一个可见的
  storeLog.info(`【简化】查找页面上的提现按钮...`);
  for (const frame of frames) {
    try {
      // 获取所有包含"提现"文字的元素
      const allElements = await frame.locator('*:has-text("提现")').all();
      storeLog.info(`【调试】frame 中找到 ${allElements.length} 个包含"提现"的元素`);
      
      for (const el of allElements) {
        try {
          const text = await el.textContent();
          // 只匹配纯"提现"按钮，不匹配"全部提现"等
          if (text?.trim() === '提现' && await el.isVisible()) {
            storeLog.info(`【点击】找到提现按钮，正在点击...`);
            await el.click();
            await delay(2000);
            
            // 处理提现弹窗
            return await handleWithdrawalPopupWithLog(page, frame, storeLog, storeName, account.amount);
          }
        } catch {}
      }
    } catch {}
  }

  storeLog.warn(`【失败】无法找到 ${account.name} 的提现按钮`);
  return false;
}

// 单账户提现（旧逻辑，作为兜底）
async function handleWithdrawalSingle(
  page: Page,
  storeName: string,
  storeLog: ReturnType<typeof log.child>
): Promise<'blocked' | 'fail' | 'success'> {
  // 变量声明
  let detectedAmount: null | number = null;
  let stopSearching = false;

  for (const frame of page.frames()) {
    if (stopSearching) break;
    try {
      const amountEl = frame.locator('.account__body__amount').first();
      if ((await amountEl.count()) > 0) {
        const amountText = await amountEl.innerText();
        const n = Number.parseFloat(amountText.trim().replaceAll(',', ''));
        if (!Number.isNaN(n)) {
          storeLog.info(`检测到账户可用余额(account__body__amount): ${n}`);
          detectedAmount = detectedAmount === null ? n : Math.max(detectedAmount, n);
          stopSearching = true;
          break;
        }
      }

      const totalAmount =
        (await findAmountByLabel(frame, '账户可用总金额（元）')) ??
        (await findAmountByLabel(frame, '账户可用总金额(元)')) ??
        (await findAmountByLabel(frame, /账户可用总金额/));

      if (totalAmount !== null) {
        storeLog.info(`检测到账户可用总金额: ${totalAmount}`);
        detectedAmount = detectedAmount === null ? totalAmount : Math.max(detectedAmount, totalAmount);
        stopSearching = true;
        break;
      }

      const balanceLabels = await frame.getByText(/可提现金额|可提现|可用余额|余额/).all();
      for (const label of balanceLabels) {
        if (await label.isVisible()) {
          const text = await label.evaluate((el) => {
            const container = el.closest('div, section, li, tr') ?? el.parentElement;
            return (container?.textContent ?? el.textContent ?? '').trim();
          });
          const amount = extractAmountFromText(text);
          if (amount !== null) {
            storeLog.info(`检测到可提现相关金额: ${amount}`);
            detectedAmount = detectedAmount === null ? amount : Math.max(detectedAmount, amount);
            if (detectedAmount > CONFIG.minWithdrawAmount) {
              stopSearching = true;
              break;
            }
          }
        }
      }
    } catch {}
  }

  if (detectedAmount !== null && detectedAmount <= CONFIG.minWithdrawAmount) {
    storeLog.info(`可提现金额 ${detectedAmount} ≤ 阈值 ${CONFIG.minWithdrawAmount}，跳过提现。`);
    metrics.balanceCheck(storeName, detectedAmount);
    metrics.withdrawalAttempt(storeName, detectedAmount, 'skipped', '余额不足');
    return 'success';
  }

  if (detectedAmount !== null) {
    storeLog.info(`可提现金额 ${detectedAmount} > 阈值，继续执行提现...`);
    metrics.balanceCheck(storeName, detectedAmount);  } else {
    storeLog.info('未精确识别到余额数值，将尝试点击提现按钮以确认...');
  }

  // 坐标逻辑
  const allCoords = loadCoords();
  const storeCoords = allCoords[storeName] || [];
  let historyCoordsWorked = false;

  if (storeCoords.length > 0) {
    storeLog.info(`发现历史坐标记录，尝试点击...`);
    for (const coord of storeCoords) {
      await page.mouse.click(coord.x, coord.y);
      await delay(1000);
      const handled = await handleWithdrawalPopup(page, page.frames()[0], true);
      if (handled) {
        await handleWithdrawalPopup(page, page.frames()[0]);
        historyCoordsWorked = true;
      }
    }
    if (historyCoordsWorked) {
      storeLog.info('历史坐标提现成功！');
      metrics.withdrawalAttempt(storeName, detectedAmount, 'success', '历史坐标');
    } else {
      storeLog.warn('所有历史坐标均未生效，启动全页面深度扫描...');
    }
  }

  // 全页面扫描 - 提现流程固化
  await page.waitForTimeout(3000);
  const frames = page.frames();
  let withdrawalSuccess = false; // 真正的提现成功标志
  const newCoords: { x: number; y: number }[] = [];

  // 步骤1: 找到并点击"提现"按钮
  storeLog.info('【步骤1】扫描页面寻找"提现"按钮...');
  for (const frame of frames) {
    try {
      const withdrawBtn = frame.getByText('提现');
      const count = await withdrawBtn.count();
      if (count > 0) {
        const buttons = await withdrawBtn.all();
        for (const btn of buttons) {
          if ((await btn.isVisible()) && (await btn.isEnabled())) {
            const box = await btn.boundingBox();
            if (box) {
              newCoords.push({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
            }
            storeLog.info('【步骤1】找到"提现"按钮，正在点击...');
            await btn.click();
            await delay(2000); // 增加等待时间
            
            // 截图诊断
            const screenshotPath = `logs/withdrawal_popup_${storeName}_${Date.now()}.png`;
            await page.screenshot({ path: screenshotPath, fullPage: true });
            storeLog.info(`【诊断】弹窗截图已保存: ${screenshotPath}`);

            // 步骤2-4: 处理提现弹窗（核心流程）
            const popupResult = await handleWithdrawalPopupWithLog(page, frame, storeLog, storeName, detectedAmount);
            if (popupResult) {
              withdrawalSuccess = true;
            }
            break;
          }
        }
      }
    } catch (err) {
      storeLog.warn(`扫描异常: ${err}`);
    }
  }

  // 更新坐标（Self-Healing）
  if (newCoords.length > 0) {
    if (JSON.stringify(newCoords) !== JSON.stringify(storeCoords)) {
      storeLog.info('检测到坐标漂移，正在自我修复...');
      allCoords[storeName] = newCoords;
      saveCoords(allCoords);
      storeLog.info('已更新并保存最新提现按钮坐标。');
    }
  }

  // 最终结果判定
  if (!withdrawalSuccess) {
    storeLog.warn('⚠️ 提现流程未完成，可能弹窗处理失败或余额已为0');
    storeLog.obs('WARN', '提现流程未完全成功', {
      stage: 'withdrawal.handle',
      code: 'EAW_WD_POPUP_NOT_HANDLED',
      reason: '弹窗处理失败或未检测到弹窗',
      retryable: true,
    });
    metrics.withdrawalAttempt(storeName, detectedAmount, 'fail', '弹窗处理失败');
    return 'fail';
  }

  storeLog.info('✅ 提现流程全部完成！');
  metrics.withdrawalAttempt(storeName, detectedAmount, 'success', '完整流程');
  return 'success';
}

// --- 弹窗处理（带详细日志，流程固化）---

/**
 * 提现弹窗处理 - 流程固化版本
 * 
 * 流程步骤：
 * 1. 检测并点击"全部提现"按钮
 * 2. 检测并点击确认按钮（确定/确认/提现）
 * 3. 检测密码输入框并输入密码
 * 4. 点击最终确认按钮
 * 5. 检测成功提示（"知道了"）
 * 
 * 每一步都有日志记录，便于追踪问题
 */
async function handleWithdrawalPopupWithLog(
  page: Page, 
  frame: Frame, 
  storeLog: ReturnType<typeof log.child>,
  storeName: string,
  detectedAmount: number | null
): Promise<boolean> {
  const locatorProviders = [frame, page];
  let currentStep = 1;
  const totalSteps = 5;

  // ===== 步骤1: 检测并点击提现相关按钮 =====
  storeLog.info(`【步骤${currentStep}/${totalSteps}】检测提现按钮...`);
  
  // 截图诊断
  try {
    const screenshotPath = `logs/popup_${storeName}_${Date.now()}.png`;
    await page.screenshot({ path: screenshotPath, fullPage: true });
    storeLog.info(`【诊断】弹窗截图: ${screenshotPath}`);
  } catch {}
  
  // 检查所有frames
  const allFrames = page.frames();
  storeLog.info(`【调试】检测到 ${allFrames.length} 个frames`);
  
  // 尝试多种按钮文案
  const withdrawButtonTexts = [
    '全部提现', '确认提现', '立即提现', '提现全部', '提现', '确认', '确定'
  ];
  
  let allWithdrawBtnFound = false;
  let foundButtonText = '';
  
  // 遍历所有frames查找按钮
  for (const currentFrame of allFrames) {
    if (allWithdrawBtnFound) break;
    for (const btnText of withdrawButtonTexts) {
      if (allWithdrawBtnFound) break;
      try {
        const btn = currentFrame.getByText(btnText, { exact: false });
        if (await btn.isVisible({ timeout: 2000 })) {
          storeLog.info(`【步骤${currentStep}/${totalSteps}】✅ 在frame中找到按钮"${btnText}"，正在点击...`);
          await btn.click();
          await delay(1500);
          allWithdrawBtnFound = true;
          foundButtonText = btnText;
          break;
        }
      } catch (err) {
        // 继续尝试下一个
      }
    }
  }

  if (!allWithdrawBtnFound) {
    // 输出每个frame中的可见元素
    storeLog.warn(`【步骤${currentStep}/${totalSteps}】⚠️ 未找到提现按钮，正在分析所有frames...`);
    for (let i = 0; i < allFrames.length; i++) {
      try {
        const frame = allFrames[i];
        const allText = await frame.locator('body').innerText().catch(() => '');
        storeLog.info(`【调试】Frame ${i} 内容片段: ${allText.substring(0, 200)}...`);
      } catch {}
    }
    return false;
  }

  currentStep++;

  // ===== 步骤2: 检测并点击确认按钮 =====
  storeLog.info(`【步骤${currentStep}/${totalSteps}】检测确认按钮（确定/确认/提现）...`);
  const confirmBtnRegex = /^确定$|^确认$|^提现$/;
  let confirmClicked = false;

  for (const provider of locatorProviders) {
    try {
      const clicked = await clickButton(provider, confirmBtnRegex, { timeout: 3000 });
      if (clicked) {
        storeLog.info(`【步骤${currentStep}/${totalSteps}】✅ 已点击确认按钮`);
        confirmClicked = true;
        await delay(1000);
        break;
      }
    } catch {}
  }

  if (!confirmClicked) {
    storeLog.warn(`【步骤${currentStep}/${totalSteps}】⚠️ 未找到确认按钮`);
  }

  currentStep++;

  // ===== 步骤3: 检测密码输入框并输入密码 =====
  storeLog.info(`【步骤${currentStep}/${totalSteps}】检测密码输入框...`);
  const passwordSelector = 'input[type="password"]';
  let targetContext: Frame | Page | null = null;

  for (let i = 0; i < 5; i++) {
    try {
      if (await page.locator(passwordSelector).first().isVisible({ timeout: 1000 })) {
        targetContext = page;
        break;
      }
      if (await frame.locator(passwordSelector).first().isVisible({ timeout: 1000 })) {
        targetContext = frame;
        break;
      }
    } catch {}
    await delay(500);
  }

  if (!targetContext) {
    storeLog.warn(`【步骤${currentStep}/${totalSteps}】⚠️ 未检测到密码输入框，可能无需密码或已过期`);
    return false;
  }

  storeLog.info(`【步骤${currentStep}/${totalSteps}】✅ 找到密码输入框，正在输入密码...`);
  const passwordInput = targetContext.locator(passwordSelector).first();
  await passwordInput.fill(CONFIG.password);
  await delay(500);
  storeLog.info(`【步骤${currentStep}/${totalSteps}】✅ 密码已输入`);

  currentStep++;

  // ===== 步骤4: 点击最终确认按钮 =====
  storeLog.info(`【步骤${currentStep}/${totalSteps}】点击最终确认按钮...`);
  let finalConfirmClicked = false;

  for (const provider of locatorProviders) {
    try {
      const clicked = await clickButton(provider, confirmBtnRegex, { timeout: 3000 });
      if (clicked) {
        storeLog.info(`【步骤${currentStep}/${totalSteps}】✅ 已点击最终确认按钮`);
        finalConfirmClicked = true;
        await delay(2000);
        break;
      }
    } catch {}
  }

  if (!finalConfirmClicked) {
    storeLog.warn(`【步骤${currentStep}/${totalSteps}】⚠️ 未找到最终确认按钮`);
    // 尝试按回车提交
    await page.keyboard.press('Enter');
    await delay(1000);
  }

  currentStep++;

  // ===== 步骤5: 检测成功提示 =====
  storeLog.info(`【步骤${currentStep}/${totalSteps}】检测提现成功提示...`);
  const gotItRegex = /^知道了$/;
  let successDetected = false;

  for (let i = 0; i < 5; i++) {
    for (const provider of locatorProviders) {
      try {
        if (await clickButton(provider, gotItRegex, { timeout: 1000 })) {
          storeLog.info(`【步骤${currentStep}/${totalSteps}】✅ 检测到"知道了"按钮，提现成功！`);
          successDetected = true;
          break;
        }
      } catch {}
    }
    if (successDetected) break;
    await delay(500);
  }

  if (!successDetected) {
    storeLog.warn(`【步骤${currentStep}/${totalSteps}】⚠️ 未检测到成功提示，但流程已完成`);
    // 保存截图用于调试
    const screenshotPath = path.join(process.cwd(), 'logs', 'screenshots', `${storeName}_${Date.now()}.png`);
    try {
      await page.screenshot({ path: screenshotPath });
      storeLog.info(`已保存截图: ${screenshotPath}`);
    } catch {}
  }

  // 记录完整流程结果
  storeLog.obs('INFO', '提现流程完成', {
    stage: 'withdrawal.handle',
    code: 'EAW_WD_POPUP_COMPLETE',
    reason: `步骤完成: 全部提现(${allWithdrawBtnFound}) → 确认(${confirmClicked}) → 密码(✓) → 最终确认(${finalConfirmClicked}) → 成功提示(${successDetected})`,
    retryable: false,
  });

  return true;
}

// --- 原始弹窗处理函数（保留兼容）---

async function handleWithdrawalPopup(page: Page, frame: Frame, onlyCheck = false): Promise<boolean> {
  const locatorProviders = [frame, page];
  let popupHandled = false;

  for (const provider of locatorProviders) {
    try {
      const allWithdrawBtn = provider.getByText('全部提现');
      if (await allWithdrawBtn.isVisible({ timeout: 2000 })) {
        if (onlyCheck) return true;

        log.info('发现"全部提现"按钮，正在点击...');
        await allWithdrawBtn.click();
        await delay(1500);

        const confirmBtnRegex = /^确定$|^确认$|^提现$/;
        let clicked = await clickButton(page, confirmBtnRegex);
        if (!clicked) clicked = await clickButton(frame, confirmBtnRegex);

        if (clicked) {
          log.info('已点击确认按钮，等待密码弹窗...');
          await delay(1000);
          await handlePasswordPopup(page, frame);
          popupHandled = true;
          log.info('✅ 弹窗处理完成！');
          break;
        } else {
          const passwordInput = page.locator('input[type="password"]').or(frame.locator('input[type="password"]'));
          if (await passwordInput.isVisible()) {
            log.info('检测到密码输入框，正在处理...');
            await handlePasswordPopup(page, frame);
            popupHandled = true;
            log.info('✅ 密码处理完成！');
            break;
          }
        }
      }
    } catch (err) {
      log.warn(`弹窗处理异常: ${err}`);
    }
  }

  if (!popupHandled) {
    log.warn('⚠️ 未检测到弹窗或弹窗处理失败');
    try { await page.keyboard.press('Escape'); } catch {}
  }
  return popupHandled;
}

async function handlePasswordPopup(page: Page, frame: Frame): Promise<void> {
  const passwordSelector = 'input[type="password"]';
  let targetContext: Frame | null | Page = null;

  try {
    for (let i = 0; i < 5; i++) {
      if (await page.locator(passwordSelector).first().isVisible()) { targetContext = page; break; }
      if (await frame.locator(passwordSelector).first().isVisible()) { targetContext = frame; break; }
      await delay(1000);
    }

    if (targetContext) {
      const passwordInput = targetContext.locator(passwordSelector).first();
      await passwordInput.fill(CONFIG.password);
      await delay(500);

      const confirmBtnRegex = /^确定$|^确认$|^提现$/;
      if (await clickButton(targetContext, confirmBtnRegex)) {
        await delay(2000);
        const gotItRegex = /^知道了$/;
        for (let i = 0; i < 5; i++) {
          if (await clickButton(page, gotItRegex)) break;
          if (await clickButton(frame, gotItRegex)) break;
          await delay(500);
        }
      }
    }
  } catch (error) {
    log.error('处理密码弹窗出错');
  }
}
