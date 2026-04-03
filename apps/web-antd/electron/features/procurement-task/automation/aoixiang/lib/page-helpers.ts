/**
 * v4 页面操作工具集
 *
 * 通用能力（closeModals、switchToMaxPerPage、waitForPageReady）
 * 已提取到 shared-libs/page-utils，此处 re-export 并绑定翱象的 ant- 前缀。
 *
 * 反检测能力（人类化操作）已集成 @oby/stealth。
 *
 * 本文件只保留翱象专属逻辑：
 * - resetSearch、clickQuery（搜索操作）
 * - selectSupplier（供应商筛选）
 * - 门店树形选择器（expandTreeSelect / getStoreList / selectStore / clearStoreFilter）
 * - Tab 操作（getTabNames / clickTab）
 * - 全选加入补货单（selectAllAndAdd）
 * - 翻页（hasNextPage / goNextPage）
 */
import { Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { log } from './utils';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const human = {
  async click(page: Page, selector: string) {
    const locator = page.locator(selector).first();
    await locator.waitFor({ state: 'visible', timeout: 5000 });
    const box = await locator.boundingBox().catch(() => null);
    if (box) {
      await page.mouse.move(
        box.x + box.width / 2,
        box.y + box.height / 2,
        { steps: 8 },
      );
      await page.waitForTimeout(120);
    }
    await locator.click({ timeout: 5000 });
  },
  async pause(min: number, max: number) {
    const duration = Math.floor(Math.random() * Math.max(max - min, 1)) + min;
    await new Promise((resolve) => setTimeout(resolve, duration));
  },
};

export { human };

/** 随机延迟（包装 human.pause） */
export async function randomDelay(min: number, max: number): Promise<void> {
  await human.pause(min, max);
}

/** 等待页面就绪（表格或按钮出现）。 */
export async function waitForPageReady(page: Page, timeout = 15000): Promise<void> {
  await Promise.race([
    page.waitForSelector('table tbody tr', { timeout }).catch(() => {}),
    page.waitForSelector('button', { timeout }).catch(() => {}),
    page.waitForTimeout(timeout),
  ]);
  await page.waitForTimeout(2000);
}

/** 关闭翱象页面弹窗（ant- 前缀，默认值）。 */
export async function closeModals(page: Page): Promise<void> {
  for (let i = 0; i < 5; i++) {
    const hasModal = await page
      .locator('.ant-modal-wrap:visible, .ant-modal-confirm:visible')
      .first()
      .isVisible({ timeout: 300 })
      .catch(() => false);
    if (!hasModal) return;

    for (const sel of [
      '.ant-modal-confirm-btns .ant-btn-primary',
      '.ant-modal-close',
      'button:has-text("确定")',
      'button:has-text("知道了")',
    ]) {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 200 }).catch(() => false)) {
        await btn.click({ force: true }).catch(() => {});
        await page.waitForTimeout(500);
        break;
      }
    }
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);
  }
}

/** 切换翱象分页到最大条数（ant- 前缀，默认值） */
export async function switchTo100PerPage(page: Page): Promise<void> {
  const paginationSelect = page.locator('.ant-pagination .ant-select, .ant-pagination-options .ant-select').first();
  if (!await paginationSelect.isVisible({ timeout: 3000 }).catch(() => false)) {
    log('  ⚠️ 未找到分页选择器');
    return;
  }

  await paginationSelect.click();
  await page.waitForTimeout(1500);

  const result = await page.evaluate(() => {
    const dropdowns = document.querySelectorAll('.ant-select-dropdown');
    let targetDropdown: Element | null = null;

    for (const dropdown of Array.from(dropdowns)) {
      const style = window.getComputedStyle(dropdown);
      if (style.display !== 'none' && style.visibility !== 'hidden') {
        const items = dropdown.querySelectorAll('.ant-select-item');
        const nums: number[] = [];
        for (const item of Array.from(items)) {
          const text = (item as HTMLElement).innerText?.trim() || '';
          const num = Number.parseInt(text, 10);
          if (!Number.isNaN(num) && num > 0 && num <= 500) nums.push(num);
        }
        if (nums.length > 0) {
          targetDropdown = dropdown;
          break;
        }
      }
    }

    if (!targetDropdown) return { maxNum: 0, success: false };

    const items = targetDropdown.querySelectorAll('.ant-select-item');
    let maxItem: HTMLElement | null = null;
    let maxNum = 0;
    for (const item of Array.from(items)) {
      const text = (item as HTMLElement).innerText?.trim() || '';
      const num = Number.parseInt(text, 10);
      if (!Number.isNaN(num) && num > maxNum) {
        maxNum = num;
        maxItem = item as HTMLElement;
      }
    }

    if (!maxItem) return { maxNum: 0, success: false };
    maxItem.click();
    return { maxNum, success: true };
  });

  if (!result.success) {
    await page.keyboard.press('Escape').catch(() => {});
    log('  ⚠️ 未找到有效的分页选项');
    return;
  }

  await page.waitForTimeout(2000);
  log(`  已切换到 ${result.maxNum} 条/页`);
}

/** 通用登录保障：进入目标页，如果被重定向到登录页则等待手动登录。 */
export async function ensureLogin(
  page: Page,
  targetUrl: string,
  options?: {
    maxWait?: number;
    loginIndicators?: string[];
    pollInterval?: number;
    log?: (msg: string) => void;
  },
): Promise<void> {
  const maxWait = options?.maxWait ?? 120000;
  const indicators = options?.loginIndicators ?? ['login', 'passport'];
  const pollInterval = options?.pollInterval ?? 3000;
  const logger = options?.log || log;

  const isLoggedIn = (url: string) => !indicators.some((kw) => url.includes(kw));

  const navigateToTarget = async (reason: string) => {
    try {
      logger(`跳转目标页(${reason})...`);
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger(`跳转目标页超时，继续检测页面状态: ${message}`);
    }
    await page.waitForTimeout(3000);
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
  };

  await navigateToTarget('初始进入');

  if (isLoggedIn(page.url())) {
    logger('已登录');
    return;
  }

  logger('未登录，等待手动登录...');
  for (let elapsed = 0; elapsed < maxWait; elapsed += pollInterval) {
    await page.waitForTimeout(pollInterval);
    if (isLoggedIn(page.url())) {
      logger('已登录');
      await page.waitForTimeout(1000);
      await navigateToTarget('登录后回跳');
      return;
    }
  }

  throw new Error('登录超时，请手动登录');
}

/** Fusion Design 分页切换到最大每页数（用于采购单列表页等 next-* 组件） */
export async function switchToMaxPerPageFusion(page: Page): Promise<void> {
  const selectTrigger = page.locator('.next-pagination .next-select').first();
  if (!await selectTrigger.isVisible({ timeout: 3000 }).catch(() => false)) {
    log('未找到 Fusion 分页选择器，跳过');
    return;
  }

  await selectTrigger.click();
  await page.waitForTimeout(800);

  const menuItems = page.locator('.next-menu.next-select-menu .next-menu-item');
  await menuItems.first().waitFor({ state: 'visible', timeout: 3000 });
  const count = await menuItems.count();
  if (count === 0) {
    await page.keyboard.press('Escape').catch(() => {});
    return;
  }

  await menuItems.nth(count - 1).click();
  await page.waitForTimeout(2000);
  log('Fusion 分页已切换到最大每页数');
}

// --- 翱象专属：搜索操作 ---

/** 点击"重置"按钮清空搜索条件（人类化） */
export async function resetSearch(page: Page) {
  await closeModals(page);
  const btn = page.locator('button:has-text("重 置"), button:has-text("重置")').first();
  if (await btn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await closeModals(page);
    // 使用人类化点击
    await human.click(page, 'button:has-text("重 置"), button:has-text("重置")').catch(async () => {
      await closeModals(page);
      await btn.click({ force: true }).catch(() => {});
    });
    await human.pause(1500, 2500);
  }
}

/** 点击"查询"按钮（人类化） */
export async function clickQuery(page: Page) {
  const attemptLogs: string[] = [];
  const beforeTotal = await page.locator('.ant-pagination-total-text').first().textContent().catch(() => '');

  const selectors = [
    'button:has-text("查 询")',
    'button:has-text("查询")',
    '.ant-form button.ant-btn-primary',
    '.ant-row button.ant-btn-primary',
  ];

  for (const selector of selectors) {
    const button = page.locator(selector).first();
    const visible = await button.isVisible({ timeout: 1200 }).catch(() => false);
    if (!visible) {
      attemptLogs.push(`${selector} -> not visible`);
      continue;
    }

    try {
      await human.click(page, selector);
      await human.pause(3000, 6000);
      const afterTotal = await page.locator('.ant-pagination-total-text').first().textContent().catch(() => '');
      log(`  ✅ 已点击查询${beforeTotal || afterTotal ? `（结果: ${afterTotal || beforeTotal}）` : ''}`);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attemptLogs.push(`${selector} -> human click failed: ${message}`);
      try {
        await button.click({ timeout: 3000, force: true });
        await human.pause(3000, 6000);
        const afterTotal = await page.locator('.ant-pagination-total-text').first().textContent().catch(() => '');
        log(`  ✅ 已点击查询${beforeTotal || afterTotal ? `（结果: ${afterTotal || beforeTotal}）` : ''}`);
        return;
      } catch (fallbackError) {
        const fallbackMessage = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        attemptLogs.push(`${selector} -> force click failed: ${fallbackMessage}`);
      }
    }
  }

  const fallbackClicked = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button, .ant-btn'));
    for (const candidate of buttons) {
      const text = (candidate as HTMLElement).innerText?.replace(/\s+/g, '') || '';
      if (!text.includes('查询')) continue;
      const element = candidate as HTMLElement;
      if (element.offsetParent === null) continue;
      element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return true;
    }
    return false;
  });

  if (fallbackClicked) {
    await human.pause(3000, 6000);
    const afterTotal = await page.locator('.ant-pagination-total-text').first().textContent().catch(() => '');
    log(`  ✅ 已点击查询${beforeTotal || afterTotal ? `（结果: ${afterTotal || beforeTotal}）` : ''}`);
    return;
  }

  attemptLogs.push('page.evaluate fallback -> no visible query button');
  throw new Error(`未找到"查询"按钮，无法确认筛选已生效。尝试记录: ${attemptLogs.join(' | ')}`);
}

// --- 翱象专属：供应商筛选 ---

// 渠道前缀列表（用于语义解析）
const CHANNEL_PREFIXES = ['集采', '长兴', '安吉', '济阳', '杭州', '全国', '山东'];
// 核心关键词权重（越靠前权重越高）
const KEYWORD_PRIORITY = ['计生', '卫生巾', '十月结晶', '舒客', '鲨鱼菲特', '物选'];
const SUPPLIERS_CONFIG_PATH = path.join(__dirname, '..', '..', 'config', 'suppliers.json');

interface SupplierAliasConfig {
  id?: string;
  name: string;
  aliases?: string[];
  channel?: string;
  enabled?: boolean;
}

interface SupplierAliasFile {
  suppliers?: SupplierAliasConfig[];
}

function normalizeSupplierText(input: string): string {
  return input
    .replace(/[（）()]/g, '')
    .replace(/供应商/g, '')
    .replace(/逻辑/g, '')
    .replace(/有限公司/g, '')
    .replace(/管理/g, '')
    .replace(/集采/g, '集采')
    .replace(/[\s\-_]/g, '')
    .trim()
    .toLowerCase();
}

let supplierAliasCache: SupplierAliasConfig[] | null = null;

function loadSupplierAliases(): SupplierAliasConfig[] {
  if (supplierAliasCache) return supplierAliasCache;
  try {
    const raw = fs.readFileSync(SUPPLIERS_CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as SupplierAliasFile;
    supplierAliasCache = (parsed.suppliers || []).filter(s => s.enabled !== false);
  } catch (error) {
    supplierAliasCache = [];
  }
  return supplierAliasCache;
}

function getAliasCandidates(input: string): string[] {
  const normalized = normalizeSupplierText(input);
  const aliases = new Set<string>([input.trim()]);

  for (const supplier of loadSupplierAliases()) {
    const nameNorm = normalizeSupplierText(supplier.name);
    const aliasList = [supplier.name, ...(supplier.aliases || [])];
    const normalizedAliasList = aliasList.map(normalizeSupplierText);
    if (normalizedAliasList.some(a => a && (a === normalized || a.includes(normalized) || normalized.includes(a)))) {
      for (const alias of aliasList) {
        if (alias?.trim()) aliases.add(alias.trim());
      }
    }
    if (nameNorm && (normalized.includes(nameNorm) || nameNorm.includes(normalized))) {
      aliases.add(supplier.name.trim());
    }
  }

  return Array.from(aliases);
}

function optionMatchesStrictly(optionText: string, supplierName: string, parsed: { searchTerms: string[], channelHint?: string, original: string }): boolean {
  const optionNorm = normalizeSupplierText(optionText);
  if (!optionNorm) return false;

  const channelNorm = parsed.channelHint ? normalizeSupplierText(parsed.channelHint) : '';
  const aliasCandidates = getAliasCandidates(supplierName)
    .map(normalizeSupplierText)
    .filter(Boolean)
    .filter(alias => alias.length >= 2);

  const aliasMatch = aliasCandidates.some(alias => optionNorm.includes(alias) || alias.includes(optionNorm));
  if (aliasMatch) {
    if (!channelNorm) return true;
    return optionNorm.includes(channelNorm) || aliasCandidates.some(alias => alias.includes(channelNorm) && optionNorm.includes(alias));
  }

  const keywordTerms = parsed.searchTerms
    .map(normalizeSupplierText)
    .filter(Boolean)
    .filter(term => !CHANNEL_PREFIXES.map(normalizeSupplierText).includes(term));

  const requiredKeywords = keywordTerms.filter(term => term.length >= 2);
  if (requiredKeywords.length > 0 && requiredKeywords.every(term => optionNorm.includes(term))) {
    if (!parsed.channelHint) return true;
    return optionNorm.includes(channelNorm);
  }

  return false;
}

/**
 * 智能解析用户输入的供应商名称
 * 返回：{ searchTerms: string[], channelHint?: string }
 */
function parseSupplierInput(input: string): { searchTerms: string[], channelHint?: string, original: string } {
  const original = input.trim();
  let channelHint: string | undefined;
  let coreKeywords: string[] = [];

  for (const prefix of CHANNEL_PREFIXES) {
    if (original.startsWith(prefix) || original.includes(prefix)) {
      channelHint = prefix;
      break;
    }
  }

  const remaining = channelHint
    ? original.replace(channelHint, '').replace(/[-_\s]/g, '')
    : original;

  for (const kw of KEYWORD_PRIORITY) {
    if (remaining.includes(kw) || original.includes(kw)) {
      coreKeywords.push(kw);
    }
  }

  if (coreKeywords.length === 0 && remaining.length > 0) {
    coreKeywords.push(remaining);
  }

  const searchTerms: string[] = [];
  const aliasCandidates = getAliasCandidates(original)
    .filter(Boolean)
    .map(item => item.trim())
    .filter(Boolean);

  const preciseTerms = aliasCandidates
    .filter(item => !/供应商/.test(item))
    .sort((a, b) => b.length - a.length);

  if (!searchTerms.includes(original)) {
    searchTerms.push(original);
  }

  if (channelHint && coreKeywords.length > 0) {
    for (const term of [
      `${channelHint}-${coreKeywords[0]}`,
      `${channelHint}${coreKeywords[0]}`,
      `${channelHint}_${coreKeywords[0]}`,
      `${channelHint}-${coreKeywords[0]}供应商`,
    ]) {
      if (!searchTerms.includes(term)) {
        searchTerms.push(term);
      }
    }
  }

  for (const term of preciseTerms) {
    if (!searchTerms.includes(term)) {
      searchTerms.push(term);
    }
  }

  for (const kw of coreKeywords) {
    if (!searchTerms.includes(kw)) {
      searchTerms.push(kw);
    }
  }

  for (const alias of aliasCandidates) {
    if (!searchTerms.includes(alias)) {
      searchTerms.push(alias);
    }
  }

  return { searchTerms, channelHint, original };
}

async function openSupplierDropdown(page: Page): Promise<void> {
  await closeModals(page);

  const attemptLogs: string[] = [];

  const waitForDropdown = async (source: string): Promise<boolean> => {
    const opened = await page.locator('.ant-select-dropdown:visible, .ant-select-selection-search-input:focus').first()
      .waitFor({ state: 'visible', timeout: 2000 })
      .then(() => true)
      .catch(() => false);
    attemptLogs.push(`${source} -> dropdown ${opened ? 'opened' : 'not visible'}`);
    return opened;
  };

  const tryClickLocator = async (selector: string, source: string): Promise<boolean> => {
    const target = page.locator(selector).first();
    const visible = await target.isVisible({ timeout: 800 }).catch(() => false);
    if (!visible) {
      attemptLogs.push(`${source} -> target not visible`);
      return false;
    }

    try {
      await target.click({ timeout: 3000 });
      attemptLogs.push(`${source} -> clicked target`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attemptLogs.push(`${source} -> target click failed: ${message}`);
    }

    if (await waitForDropdown(source)) return true;

    const parentSelect = target.locator('xpath=ancestor-or-self::*[contains(@class, "ant-select")]').first();
    const parentVisible = await parentSelect.isVisible({ timeout: 500 }).catch(() => false);
    if (!parentVisible) {
      attemptLogs.push(`${source} -> parent ant-select not visible`);
      return false;
    }

    try {
      await parentSelect.click({ timeout: 3000 });
      attemptLogs.push(`${source} -> clicked parent ant-select`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      attemptLogs.push(`${source} -> parent click failed: ${message}`);
    }

    return waitForDropdown(`${source} (parent)`);
  };

  const directSelectors = [
    { selector: '.ant-form-item:has(.ant-form-item-label:has-text("供应商")) .ant-select', label: 'form-item supplier select' },
    { selector: '.ant-form-item:has(.ant-form-item-label:has-text("供应商名称")) .ant-select', label: 'form-item supplier-name select' },
    { selector: '.ant-row:has(.ant-form-item-label:has-text("供应商")) .ant-select', label: 'row supplier select' },
    { selector: '.ant-select:has-text("请输入供应商名称")', label: 'select with placeholder text' },
    { selector: '.ant-select-selector:has-text("请输入供应商名称")', label: 'selector with placeholder text' },
    { selector: '.ant-select input[placeholder*="供应商"]', label: 'input placeholder supplier inside select' },
    { selector: 'input[placeholder*="供应商"]', label: 'input placeholder supplier' },
    { selector: 'input[aria-label*="供应商"]', label: 'input aria-label supplier' },
  ];

  for (const item of directSelectors) {
    if (await tryClickLocator(item.selector, item.label)) {
      return;
    }
  }

  const fallback = await page.evaluate(() => {
    const textHints = ['供应商', '供应商名称', '请输入供应商名称'];
    const clickableSelectors = [
      '.ant-select-selector',
      '.ant-select',
      'input[placeholder*="供应商"]',
      'input[aria-label*="供应商"]',
    ];

    const isVisible = (el: Element | null): el is HTMLElement => {
      return !!el && el instanceof HTMLElement && el.offsetParent !== null;
    };

    const tryClick = (el: Element | null): boolean => {
      if (!isVisible(el)) return false;
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return true;
    };

    const roots = Array.from(document.querySelectorAll('.ant-form-item, .ant-row, .ant-col'));
    for (const root of roots) {
      const text = (root as HTMLElement).innerText || '';
      if (!textHints.some(hint => text.includes(hint))) continue;

      for (const selector of clickableSelectors) {
        const trigger = root.querySelector(selector);
        if (tryClick(trigger)) {
          return `fallback form root -> ${selector}`;
        }
      }
    }

    const directCandidates = Array.from(document.querySelectorAll('.ant-select, .ant-select-selector, input[placeholder*="供应商"], input[aria-label*="供应商"]'));
    for (const candidate of directCandidates) {
      const placeholder = (candidate as HTMLInputElement).placeholder || '';
      const ariaLabel = candidate.getAttribute('aria-label') || '';
      const text = (candidate as HTMLElement).innerText || '';
      if ([placeholder, ariaLabel, text].some(value => textHints.some(hint => value.includes(hint)))) {
        if (tryClick(candidate)) {
          return `fallback direct candidate -> ${(candidate as HTMLElement).className || candidate.tagName.toLowerCase()}`;
        }
        const parentSelect = candidate.closest('.ant-select, .ant-select-selector');
        if (tryClick(parentSelect)) {
          return `fallback parent select -> ${(parentSelect as HTMLElement).className || parentSelect?.tagName.toLowerCase() || 'unknown'}`;
        }
      }
    }

    return '';
  });

  if (fallback) {
    attemptLogs.push(fallback);
    if (await waitForDropdown('page.evaluate fallback')) {
      return;
    }
  } else {
    attemptLogs.push('page.evaluate fallback -> no candidate clicked');
  }

  throw new Error(`未找到供应商选择器，页面结构可能已变更或未登录。尝试记录: ${attemptLogs.join(' | ')}`);
}


/**
 * 计算两个字符串的相似度分数 (0-1)
 */
function similarity(a: string, b: string): number {
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();
  
  if (aLower === bLower) return 1;
  if (aLower.includes(bLower) || bLower.includes(aLower)) return 0.8;
  
  // 简单的重叠字符计算
  let overlap = 0;
  const shorter = aLower.length < bLower.length ? aLower : bLower;
  const longer = aLower.length < bLower.length ? bLower : aLower;
  
  for (let i = 0; i < shorter.length; i++) {
    if (longer.includes(shorter.substring(i, i + 1))) overlap++;
  }
  
  return overlap / longer.length;
}

/**
 * 在页面筛选供应商（语义增强版）
 * 支持：
 * - 精确匹配
 * - 模糊匹配
 * - 语义解析（渠道前缀 + 核心关键词）
 */
export async function selectSupplier(page: Page, supplierName: string, options?: { allowNoMatch?: boolean }): Promise<boolean> {
  if (!supplierName || !supplierName.trim()) {
    throw new Error('未指定供应商名称，请通过 --supplier 参数或配置文件指定');
  }

  const allowNoMatch = options?.allowNoMatch ?? false;
  const parsed = parseSupplierInput(supplierName);
  log('  筛选供应商: "' + supplierName + '"');
  if (parsed.channelHint) {
    log('  → 渠道: ' + parsed.channelHint + ', 搜索词: ' + parsed.searchTerms.join(', '));
  }

  await openSupplierDropdown(page);

  for (let idx = 0; idx < parsed.searchTerms.length; idx++) {
    const searchTerm = parsed.searchTerms[idx];
    log('  尝试搜索: "' + searchTerm + '"');

    const si = page.locator('.ant-select-dropdown:visible input, .ant-select-selection-search-input:focus').first();
    await si.waitFor({ state: 'visible', timeout: 5000 });
    await si.fill('');
    await si.fill(searchTerm);

    const allOptions = page.locator('.ant-select-dropdown:visible .ant-select-item-option');
    await allOptions.first().waitFor({ state: 'visible', timeout: 2500 }).catch(() => {});
    const optCount = await allOptions.count();

    if (optCount === 0) {
      log('  无匹配选项，尝试下一个搜索词');
      continue;
    }

    log('  找到 ' + optCount + ' 个选项');

    const optionTexts: string[] = [];
    for (let i = 0; i < optCount; i++) {
      optionTexts.push((await allOptions.nth(i).innerText().catch(() => '')).trim());
    }

    if (optCount === 1) {
      const onlyText = optionTexts[0] || '';
      if (optionMatchesStrictly(onlyText, supplierName, parsed)) {
        await allOptions.first().click();
        await page.keyboard.press('Escape').catch(() => {});
        log('  ✅ 唯一候选，已选择: ' + onlyText);
        return true;
      }
      await page.keyboard.press('Escape').catch(() => {});
      throw new Error(`供应商 "${supplierName}" 只有一个下拉候选，但不符合严格匹配：${onlyText}`);
    }

    const strictMatches = optionTexts
      .map((text, i) => ({ text, idx: i }))
      .filter(item => optionMatchesStrictly(item.text, supplierName, parsed));

    if (strictMatches.length === 1) {
      await allOptions.nth(strictMatches[0].idx).click();
      await page.keyboard.press('Escape').catch(() => {});
      log('  ✅ 严格匹配: ' + strictMatches[0].text);
      return true;
    }

    if (strictMatches.length > 1) {
      const candidateText = strictMatches.map(item => item.text).join(' | ');
      await page.keyboard.press('Escape').catch(() => {});
      throw new Error(`供应商 "${supplierName}" 匹配到多个候选：${candidateText}。按规则直接中断，避免误下单。`);
    }

    log('  多候选但无严格匹配，尝试下一个搜索词');
  }

  await page.keyboard.press('Escape').catch(() => {});
  if (allowNoMatch) {
    log('  ℹ️ 供应商下拉无匹配数据，视为当前没有可清理的补货数据');
    return false;
  }
  throw new Error('供应商 "' + supplierName + '" 在下拉列表中未找到唯一可用候选。\n尝试过的搜索词: ' + parsed.searchTerms.join(', '));
}

/**
 * 选择多个供应商（一次性多选）
 * 打开下拉框，搜索并勾选所有匹配的供应商
 */
export async function selectMultipleSuppliers(page: Page, supplierNames: string[]): Promise<number> {
  if (supplierNames.length === 0) return 0;
  
  log(`  选择多个供应商: ${supplierNames.join(', ')}`);
  
  await openSupplierDropdown(page);
  let selectedCount = 0;
  
  for (const supplierName of supplierNames) {
    const parsed = parseSupplierInput(supplierName);
    
    for (const searchTerm of parsed.searchTerms) {
      const si = page.locator('.ant-select-dropdown:visible input, .ant-select-selection-search-input:focus').first();
      await si.waitFor({ state: 'visible', timeout: 5000 });
      await si.fill('');
      await si.fill(searchTerm);
      
      const allOptions = page.locator('.ant-select-dropdown:visible .ant-select-item-option');
      await allOptions.first().waitFor({ state: 'visible', timeout: 2500 }).catch(() => {});
      const optCount = await allOptions.count();
      
      if (optCount === 0) continue;
      
      // 遍历所有选项，勾选匹配的（多选模式，勾选checkbox）
      for (let i = 0; i < optCount; i++) {
        const optText = await allOptions.nth(i).innerText().catch(() => '');
        if (optionMatchesStrictly(optText.trim(), supplierName, parsed)) {
          // 检查是否已选中
          const isChecked = await allOptions.nth(i).locator('.ant-select-item-option-state').isVisible().catch(() => false);
          if (!isChecked) {
            await allOptions.nth(i).click();
            selectedCount++;
            log(`    ✅ 已勾选: ${optText.trim()}`);
          }
          break;
        }
      }
      break; // 找到匹配的就跳出搜索词循环
    }
  }
  
  await page.keyboard.press('Escape').catch(() => {});
  log(`  ✅ 共勾选 ${selectedCount} 个供应商`);
  return selectedCount;
}

/** 在表格结果中校验当前页是否属于目标供应商 */
export async function verifyTableSupplier(page: Page, supplierName: string, options?: { allowEmpty?: boolean; sampleSize?: number }): Promise<{ ok: boolean; rowCount: number; matchedRows: number; sampledRows: string[] }> {
  const allowEmpty = options?.allowEmpty ?? false;
  const sampleSize = options?.sampleSize ?? 5;
  const parsed = parseSupplierInput(supplierName);

  await closeModals(page);
  await page.waitForTimeout(1000);

  const rows = await page.locator('tbody tr').allInnerTexts().catch(() => [] as string[]);
  const normalizedRows = rows.map(r => r.replace(/\s+/g, ' ').trim()).filter(Boolean);

  // 检查是否为"暂无数据"等空状态提示
  const emptyIndicators = ['暂无数据', '暂无记录', '没有数据', '无数据', '空'];
  const isEmptyState = normalizedRows.length === 1 && emptyIndicators.some(ind => normalizedRows[0].includes(ind));
  
  if (normalizedRows.length === 0 || isEmptyState) {
    if (allowEmpty) {
      log(`  ℹ️ 当前列表为空，视为通过（supplier=${supplierName}）`);
      return { ok: true, rowCount: 0, matchedRows: 0, sampledRows: [] };
    }
    throw new Error(`供应商校验失败：当前列表为空，无法确认结果是否属于「${supplierName}」`);
  }

  const sampledRows = normalizedRows.slice(0, sampleSize);
  const matchedRows = sampledRows.filter(text => optionMatchesStrictly(text, supplierName, parsed)).length;
  const ok = matchedRows === sampledRows.length;

  if (!ok) {
    throw new Error(
      `供应商校验失败：当前结果中仅 ${matchedRows}/${sampledRows.length} 行看起来属于「${supplierName}」，已停止避免误下单。样本=${sampledRows.join(' || ')}`,
    );
  }

  log(`  ✅ 供应商结果校验通过: ${matchedRows}/${sampledRows.length} 行命中「${supplierName}」`);
  return { ok: true, rowCount: normalizedRows.length, matchedRows, sampledRows };
}


/** 展开门店树形选择器的所有折叠节点 */
export async function expandTreeSelect(page: Page) {
  const treeSelect = page.locator('.ant-tree-select').first();
  if (!await treeSelect.isVisible({ timeout: 3000 }).catch(() => false)) return false;
  await treeSelect.locator('.ant-select-selector').click();
  await page.waitForTimeout(2000);
  for (let i = 0; i < 10; i++) {
    const closedSwitchers = page.locator('.ant-select-tree-switcher_close');
    const count = await closedSwitchers.count();
    if (count === 0) break;
    for (let j = 0; j < count; j++) {
      await closedSwitchers.nth(j).click().catch(() => {});
      await page.waitForTimeout(300);
    }
    await page.waitForTimeout(500);
  }
  return true;
}

/** 获取门店列表（展开树形选择器后读取所有门店名称） */
export async function getStoreList(page: Page): Promise<string[]> {
  await closeModals(page);
  if (!await expandTreeSelect(page)) return [];
  const stores = await page.evaluate(() => {
    const titles = document.querySelectorAll('.ant-select-tree-title');
    return Array.from(titles)
      .map(t => (t as HTMLElement).textContent?.trim() || '')
      .filter(t => t && (t.includes('店') || t.includes('仓') || t.includes('Oby')));
  });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  return stores;
}

/** 在树形选择器中勾选指定门店 */
export async function selectStore(page: Page, storeName: string): Promise<boolean> {
  await closeModals(page);
  if (!await expandTreeSelect(page)) return false;
  const checked = await page.evaluate((name: string) => {
    const titles = document.querySelectorAll('.ant-select-tree-title');
    for (const title of Array.from(titles)) {
      if ((title as HTMLElement).textContent?.trim() === name) {
        const treeNode = title.closest('.ant-select-tree-treenode');
        if (treeNode) {
          const cb = treeNode.querySelector('.ant-select-tree-checkbox');
          if (cb) { (cb as HTMLElement).click(); return true; }
          (title as HTMLElement).click();
          return true;
        }
      }
    }
    return false;
  }, storeName);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  return !!checked;
}

/** 在树形选择器中勾选多个门店（一次性多选） */
export async function selectMultipleStores(page: Page, storeNames: string[]): Promise<number> {
  if (storeNames.length === 0) return 0;
  await closeModals(page);
  if (!await expandTreeSelect(page)) return 0;
  
  const selectedCount = await page.evaluate((names: string[]) => {
    let count = 0;
    const titles = document.querySelectorAll('.ant-select-tree-title');
    for (const title of Array.from(titles)) {
      const text = (title as HTMLElement).textContent?.trim() || '';
      // 匹配：完全匹配或包含关系
      const matched = names.some(n => text === n || text.includes(n) || n.includes(text));
      if (matched) {
        const treeNode = title.closest('.ant-select-tree-treenode');
        if (treeNode) {
          const cb = treeNode.querySelector('.ant-select-tree-checkbox');
          if (cb && !cb.classList.contains('ant-select-tree-checkbox-checked')) {
            (cb as HTMLElement).click();
            count++;
          }
        }
      }
    }
    return count;
  }, storeNames);
  
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  log(`  ✅ 已勾选 ${selectedCount} 个门店: ${storeNames.join(', ')}`);
  return selectedCount;
}

/** 清除门店筛选 */
export async function clearStoreFilter(page: Page) {
  const clearBtn = page.locator('.ant-tree-select .ant-select-clear').first();
  if (await clearBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
    await clearBtn.click();
    await page.waitForTimeout(1000);
  }
}

// --- 翱象专属：Tab 操作 ---

/** 获取所有 Tab 名称 */
export async function getTabNames(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.ant-tabs-tab-btn')).map(t => (t as HTMLElement).innerText?.trim())
  );
}

/** 点击指定索引的 Tab（用索引不用文本，避免"售罄待补货"匹配歧义，人类化） */
export async function clickTab(page: Page, tabIndex: number): Promise<string> {
  await closeModals(page);
  const selector = `.ant-tabs-tab-btn:nth-child(${tabIndex + 1})`;
  const tabBtn = page.locator('.ant-tabs-tab-btn').nth(tabIndex);
  const text = await tabBtn.textContent().catch(() => '');
  
  // 使用人类化点击
  await human.click(page, selector).catch(async () => {
    // fallback 到普通点击
    await tabBtn.click();
  });
  
  await randomDelay(2500, 4000);
  return text || '';
}

// --- 翱象专属：全选 + 加入补货单 ---

/** 全选当前页商品并点击"加入补货单"，可排除指定 SKU（严格验证版）
 * 
 * 流程：
 * 1. 读取当前页商品数量
 * 2. 全选
 * 3. 点击加入补货单
 * 4. 等待API响应并验证结果
 * 5. 返回成功加入的数量
 */
export async function selectAllAndAdd(page: Page, excludeSkus: string[] = []): Promise<{ added: number; total: number }> {
  await closeModals(page);
  
  // 1. 读取当前页商品数量
  const totalOnPage = await page.locator('tbody tr').count().catch(() => 0);
  if (totalOnPage === 0) {
    return { added: 0, total: 0 };
  }
  
  // 检查是否有"暂无数据"等空状态
  const firstRowText = await page.locator('tbody tr').first().innerText().catch(() => '');
  if (firstRowText.includes('暂无数据') || firstRowText.includes('暂无记录')) {
    return { added: 0, total: 0 };
  }
  
  log(`    当前页有 ${totalOnPage} 条商品`);
  
  // 2. 全选
  const cb = page.locator('thead .ant-checkbox-input').first();
  if (!await cb.isVisible({ timeout: 3000 }).catch(() => false)) {
    return { added: 0, total: 0 };
  }
  
  const wasChecked = await cb.isChecked().catch(() => false);
  if (!wasChecked) {
    await closeModals(page);
    try { 
      await cb.click({ timeout: 5000 }); 
    } catch {
      await closeModals(page);
      await cb.click({ force: true }).catch(() => {});
    }
    await page.waitForTimeout(800);
  }
  
  // 3. 排除指定SKU
  if (excludeSkus.length > 0) {
    await page.evaluate((skus: string[]) => {
      const rows = Array.from(document.querySelectorAll('tbody tr'));
      for (const row of rows) {
        const text = (row as HTMLElement).innerText || '';
        if (skus.some(sku => text.includes(sku))) {
          const cb = row.querySelector('.ant-checkbox-input') as HTMLInputElement;
          if (cb?.checked) cb.click();
        }
      }
    }, excludeSkus);
    await page.waitForTimeout(500);
  }
  
  await closeModals(page);
  
  // 4. 点击加入补货单，等待API响应
  const addBtn = page.locator('button:has-text("加入补货单")').first();
  if (!await addBtn.isVisible().catch(() => false)) {
    log('    ⚠️ 未找到"加入补货单"按钮');
    return { added: 0, total: 0 };
  }
  
  if (await addBtn.isDisabled().catch(() => true)) {
    log('    ⚠️ "加入补货单"按钮已禁用');
    return { added: 0, total: 0 };
  }
  
  try {
    // 设置响应监听，等待 batchAdd API 返回
    let apiResult: { successCount: number; totalCount: number; success: boolean } | null = null;
    
    // 数据量大时API响应慢，增加超时到60秒
    const responsePromise = page.waitForResponse(
      r => r.url().includes('batchAdd') || r.url().includes('add'),
      { timeout: 60000 }
    );
    
    await addBtn.click();
    log('    已点击"加入补货单"，等待API响应...');
    
    const resp = await responsePromise;
    const body = await resp.json().catch(() => null);
    
    if (body?.data) {
      apiResult = {
        successCount: body.data.successCount || 0,
        totalCount: body.data.totalCount || 0,
        success: body.data.success !== false && body.success !== false
      };
      log(`    API返回: 成功 ${apiResult.successCount}/${apiResult.totalCount}`);
    } else if (body?.success === false) {
      log(`    ⚠️ API返回失败: ${body.message || JSON.stringify(body)}`);
      apiResult = { successCount: 0, totalCount: 0, success: false };
    } else {
      log(`    ⚠️ API返回格式异常: ${JSON.stringify(body).substring(0, 200)}`);
      apiResult = { successCount: 0, totalCount: 0, success: false };
    }
    
    await page.waitForTimeout(2000);
    await closeModals(page);
    
    return { 
      added: apiResult?.successCount || 0, 
      total: apiResult?.totalCount || 0 
    };
    
  } catch (e: any) {
    log(`    ❌ 加入补货单失败: ${e.message}`);
    await page.waitForTimeout(2000);
    await closeModals(page);
    return { added: 0, total: 0 };
  }
}

// --- 翱象专属：翻页 ---

/** 检查是否有下一页 */
export async function hasNextPage(page: Page): Promise<boolean> {
  const next = page.locator('.ant-pagination-next:not(.ant-pagination-disabled)').first();
  return next.isVisible({ timeout: 2000 }).catch(() => false);
}

/** 翻到下一页（人类化） */
export async function goNextPage(page: Page): Promise<boolean> {
  const next = page.locator('.ant-pagination-next:not(.ant-pagination-disabled)').first();
  if (!await next.isVisible({ timeout: 2000 }).catch(() => false)) return false;

  const getActivePageText = async (): Promise<string> => {
    return page.locator('.ant-pagination-item-active').first().textContent().catch(() => '');
  };

  const beforePage = (await getActivePageText())?.trim() || '';
  await closeModals(page);

  await human.click(page, '.ant-pagination-next:not(.ant-pagination-disabled)').catch(async () => {
    await next.click({ force: true }).catch(() => {});
  });

  try {
    await page.waitForFunction(
      (prevPage) => {
        const current = document.querySelector('.ant-pagination-item-active');
        const text = current?.textContent?.trim() || '';
        return text !== '' && text !== prevPage;
      },
      beforePage,
      { timeout: 5000 },
    );
  } catch {
    const afterPage = (await getActivePageText())?.trim() || '';
    if (!afterPage || afterPage === beforePage) {
      log(`  ⚠️ 翻页后页码未变化（仍为 ${beforePage || '未知'}），停止继续翻页`);
      return false;
    }
  }

  await human.pause(1500, 3000);
  return true;
}
