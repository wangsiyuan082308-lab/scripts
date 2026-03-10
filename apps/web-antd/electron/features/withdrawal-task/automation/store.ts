import type { Frame, Locator, Page } from 'playwright';

import type { ResolvedAutomationConfig } from './config';
import { getStoreAlias, loadCoords, loadEvolutionConfig, normalizeStoreName, resolveStoreTargetName, saveCoords, saveEvolutionConfig, type AutomationRuntimePaths } from './config';
import type { AutomationLogger } from './logger';
import { writeMetric } from './logger';
import { delay } from './browser';

export interface StoreExecutionInput {
  config: ResolvedAutomationConfig;
  logger: AutomationLogger;
  paths: AutomationRuntimePaths;
  storeId: string;
  storeName: string;
}

export interface StoreExecutionResult {
  blocked: boolean;
  message: string;
  status: 'failed' | 'success';
  withdrawAmount?: number;
}

function normalizeText(text: string) {
  return text.replace(/\s+/g, ' ').trim();
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function safeFileSegment(text: string) {
  return text.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function isProbablyCurrentStoreText(text: string, targetStoreName: string) {
  const normalized = normalizeComparableStoreText(text);
  const normalizedTargetStoreName = normalizeComparableStoreText(targetStoreName);
  if (!normalized) return false;
  return (
    normalized === normalizedTargetStoreName ||
    normalized.includes(normalizedTargetStoreName) ||
    normalizedTargetStoreName.includes(normalized)
  );
}

function normalizeComparableStoreText(text: string) {
  return normalizeStoreName(normalizeText(text));
}

function getStoreSearchCandidates(text: string) {
  const normalized = normalizeComparableStoreText(text);
  const alias = normalizeComparableStoreText(getStoreAlias(normalized));
  return Array.from(new Set([alias, normalized].filter(Boolean)));
}

function buildStoreNamePattern(text: string, exact = false) {
  const normalized = normalizeComparableStoreText(text);
  const escaped = escapeRegExp(normalized)
    .replace(/\\\(/g, '[\\(（]')
    .replace(/\\\)/g, '[\\)）]');
  return exact ? new RegExp(`^\\s*${escaped}\\s*$`) : new RegExp(escaped);
}

function buildStoreNamePatterns(text: string, exact = false) {
  return getStoreSearchCandidates(text).map((item) => buildStoreNamePattern(item, exact));
}

async function captureDebugSnapshot(
  page: Page,
  paths: AutomationRuntimePaths,
  targetStoreName: string,
  stage: string,
  logger: AutomationLogger,
) {
  const filename = `${Date.now()}_${safeFileSegment(targetStoreName)}_${safeFileSegment(stage)}.png`;
  try {
    await page.screenshot({ path: `${paths.debugDir}/${filename}`, fullPage: true });
    logger.info(`已保存调试截图：${filename}`);
  } catch (error: any) {
    logger.warn(`保存调试截图失败：${error?.message || 'unknown error'}`);
  }
}

function extractSuccessMessage(text: string) {
  const normalized = normalizeText(text);
  if (!normalized) return null;

  const patterns = [
    /提现申请已提交/,
    /提现成功/,
    /提交成功/,
    /申请成功/,
    /预计.*到账/,
    /等待处理/,
    /受理成功/,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) {
      return match[0];
    }
  }

  return null;
}

function extractAmount(text: string): null | number {
  const normalized = normalizeText(text);
  if (!normalized) return null;
  if (/暂无余额|无可提现|无余额/.test(normalized)) return 0;

  const contextual = normalized.match(
    /(?:账户可用总金额(?:（元）|\(元\))?|可提现金额|可提现|可用余额|余额)\D{0,30}(\d[0-9,]*\.?\d*)/,
  );
  if (contextual?.[1]) {
    const value = Number.parseFloat(contextual[1].replace(/,/g, ''));
    if (!Number.isNaN(value)) return value;
  }

  const currencies = normalized.match(/[¥￥]\s*(\d[0-9,]*\.?\d*)/g) || [];
  let max: null | number = null;
  for (const item of currencies) {
    const match = item.match(/(\d[0-9,]*\.?\d*)/);
    if (!match?.[1]) continue;
    const value = Number.parseFloat(match[1].replace(/,/g, ''));
    if (!Number.isNaN(value)) {
      max = max === null ? value : Math.max(max, value);
    }
  }
  return max;
}

async function detectWithdrawalSuccess(page: Page) {
  for (const ctx of getContexts(page)) {
    try {
      const successText = await firstVisible(
        [
          ctx.getByText(/提现申请已提交|提现成功|提交成功|申请成功|预计.*到账|等待处理|受理成功/),
          ctx.locator('.ant-message, .ant-notification, .el-message, .el-message-box, [role="alert"], [role="status"]'),
        ],
        2500,
      );
      if (!successText) continue;

      const text = normalizeText((await successText.textContent().catch(() => '')) || '');
      const message = extractSuccessMessage(text);
      if (message) {
        return message;
      }
    } catch {}
  }

  return null;
}

async function dismissSuccessPrompt(page: Page) {
  await clickFirstVisible(
    getContexts(page).flatMap((ctx) => [
      ctx.getByRole('button', { name: /知道了|我知道了|完成|关闭/ }),
      ctx.getByText(/知道了|我知道了|完成|关闭/),
    ]),
    1000,
  ).catch(() => undefined);
}

function getContexts(page: Page): Array<Frame | Page> {
  return [page, ...page.frames()];
}

async function firstVisible(locators: Locator[], timeout = 1000) {
  for (const locator of locators) {
    try {
      await locator.first().waitFor({ state: 'visible', timeout });
      return locator.first();
    } catch {}
  }
  return null;
}

async function pollVisibleLocator(
  locators: Locator[],
  totalTimeout = 1200,
  intervalMs = 120,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < totalTimeout) {
    for (const locator of locators) {
      try {
        const target = locator.first();
        if (await target.isVisible({ timeout: Math.min(intervalMs, 200) })) {
          return target;
        }
      } catch {}
    }
    await delay(intervalMs);
  }
  return null;
}

async function firstVisibleInContexts(
  page: Page,
  factory: (ctx: Frame | Page) => Locator[],
  timeout = 1000,
) {
  for (const ctx of getContexts(page)) {
    const locator = await firstVisible(factory(ctx), timeout);
    if (locator) return locator;
  }
  return null;
}

async function isLocatorDisabled(locator: Locator) {
  try {
    return await locator.evaluate((el) => {
      const element = el as HTMLElement;
      const disabledSelf =
        element.hasAttribute('disabled') ||
        element.getAttribute('aria-disabled') === 'true' ||
        element.classList.contains('disabled') ||
        element.classList.contains('is-disabled') ||
        element.classList.contains('ant-btn-disabled');
      if (disabledSelf) return true;

      const clickableParent = element.closest(
        'button, [role="button"], a, .ant-btn, .el-button, .next-btn',
      ) as HTMLElement | null;
      if (!clickableParent) return false;

      return (
        clickableParent.hasAttribute('disabled') ||
        clickableParent.getAttribute('aria-disabled') === 'true' ||
        clickableParent.classList.contains('disabled') ||
        clickableParent.classList.contains('is-disabled') ||
        clickableParent.classList.contains('ant-btn-disabled')
      );
    });
  } catch {
    return false;
  }
}

async function clickLocator(locator: Locator, timeout = 1000) {
  if (await isLocatorDisabled(locator)) {
    return false;
  }
  try {
    await locator.click({ timeout });
    return true;
  } catch {
    try {
      await locator.scrollIntoViewIfNeeded();
      if (await isLocatorDisabled(locator)) {
        return false;
      }
      await locator.click({ timeout, force: true });
      return true;
    } catch {
      return false;
    }
  }
}

async function clickFirstVisible(locators: Locator[], timeout = 1000) {
  const locator = await firstVisible(locators, timeout);
  if (!locator) return false;
  return clickLocator(locator, timeout);
}

async function findDialogAction(page: Page, pattern: RegExp, timeout = 1500) {
  const dialogLocators = getContexts(page).flatMap((ctx) => [
    ctx.locator('.ant-modal, .ant-modal-confirm, .el-dialog, .el-message-box, [role="dialog"]')
      .filter({
        has: ctx.locator('button, a, span, div').filter({ hasText: pattern }),
      })
      .locator('button, a, span, div')
      .filter({ hasText: pattern }),
    ctx.getByRole('button', { name: pattern }),
    ctx.getByText(pattern),
  ]);

  return pollVisibleLocator(dialogLocators, timeout);
}

async function findStrictDialogButton(page: Page, pattern: RegExp, timeout = 1500) {
  const dialogLocators = getContexts(page).flatMap((ctx) => [
    ctx.locator('.ant-modal, .ant-modal-confirm, .el-dialog, .el-message-box, [role="dialog"]')
      .locator('button, [role="button"], a, .ant-btn, .el-button, .next-btn')
      .filter({ hasText: pattern }),
    ctx.getByRole('button', { name: pattern }),
    ctx.locator('button, [role="button"], a, .ant-btn, .el-button, .next-btn').filter({ hasText: pattern }),
  ]);

  return pollVisibleLocator(dialogLocators, timeout);
}

async function hasPasswordInput(page: Page, timeout = 1200) {
  for (const ctx of getContexts(page)) {
    const passwordInput = await pollVisibleLocator(
      [
        ctx.locator('input[type="password"]'),
        ctx.getByPlaceholder(/支付密码|请输入密码/),
      ],
      timeout,
      120,
    );
    if (passwordInput) {
      return true;
    }
  }
  return false;
}

async function collectDialogTexts(page: Page) {
  const snapshots: string[] = [];
  for (const ctx of getContexts(page)) {
    try {
      const texts = await ctx
        .locator('.ant-modal, .ant-modal-confirm, .el-dialog, .el-message-box, [role="dialog"]')
        .evaluateAll((nodes) =>
          nodes
            .map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim())
            .filter(Boolean)
            .slice(0, 5),
        );
      if (texts.length > 0) {
        snapshots.push(...texts);
      }
    } catch {}
  }
  return snapshots;
}

async function waitForEnabledActionButton(
  ctx: Frame | Page,
  pattern: RegExp,
  timeout = 2500,
) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const candidates = [
      ctx.getByRole('button', { name: pattern }),
      ctx.locator('button, [role="button"], a, .ant-btn, .el-button, .next-btn').filter({
        hasText: pattern,
      }),
      ctx.getByText(pattern),
    ];

    for (const candidate of candidates) {
      try {
        const target = candidate.first();
        if (!(await target.isVisible({ timeout: 120 }))) continue;
        if (await isLocatorDisabled(target)) continue;
        return target;
      } catch {}
    }

    await delay(120);
  }

  return null;
}

async function waitForWithdrawAmountReady(ctx: Frame | Page, timeout = 2500) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    try {
      const amountInput = ctx.locator('input').first();
      const value = await amountInput.inputValue().catch(() => '');
      if (value && Number.parseFloat(value) > 0) {
        return true;
      }
    } catch {}

    const enabledSubmit = await waitForEnabledActionButton(ctx, /^提现$/, 180);
    if (enabledSubmit) {
      return true;
    }

    await delay(120);
  }

  return false;
}

async function maybeExpandFinanceMenu(page: Page) {
  return clickFirstVisible(
    [
      page.getByRole('menuitem', { name: /财务/ }),
      page.getByRole('button', { name: /财务/ }),
      page.locator('aside, nav, .ant-menu, .el-menu').locator('span, div, a').filter({ hasText: /财务/ }).first(),
    ],
    1500,
  );
}

async function isFinancePageReady(page: Page) {
  const indicator = await firstVisibleInContexts(
    page,
    (ctx) => [
      ctx.getByText(/账户可用总金额|可提现金额|全部提现|提现/),
      ctx.locator('.account__body__amount, [class*="amount"], [class*="money"], [class*="finance"]'),
    ],
    1200,
  );
  return !!indicator;
}

async function waitForWithdrawFlowPrompt(page: Page, timeout = 2500) {
  const locators = getContexts(page).flatMap((ctx) => [
    ctx.getByRole('button', { name: /全部提现/ }),
    ctx.getByText(/全部提现/),
    ctx.locator('input[type="password"]'),
    ctx.locator('.ant-modal, .ant-modal-confirm, .el-dialog, .el-message-box, [role="dialog"]'),
  ]);
  return pollVisibleLocator(locators, timeout);
}

async function waitForStoreDropdown(page: Page) {
  const dropdown = await firstVisibleInContexts(
    page,
    (ctx) => [
      ctx.locator('.ant-dropdown, .ant-select-dropdown, .el-dropdown-menu, [role="listbox"], ul[role="menu"]'),
      ctx.locator('input[placeholder*="搜索"], input[placeholder*="门店"], input[placeholder*="店铺"]'),
      ctx.locator('[role="option"], li, .ant-dropdown-menu-item, .el-dropdown-menu__item'),
    ],
    2500,
  );
  return !!dropdown;
}

async function openStoreSwitcher(
  page: Page,
  paths: AutomationRuntimePaths,
  targetStoreName: string,
  logger: AutomationLogger,
) {
  logger.info(`正在尝试切换到门店：${targetStoreName}`);

  const triggerCandidates = [
    '.account-switch',
    '.shop-select',
    '.store-select',
    '.ant-dropdown-trigger',
    '.el-dropdown-link',
    '[class*="shop-select"]',
    '[class*="store-select"]',
    '[class*="account-switch"]',
    'header .ant-select',
    'header [class*="select"]',
    '.anticon-down',
    '.el-icon-arrow-down',
  ];

  for (const selector of triggerCandidates) {
    const trigger = await firstVisibleInContexts(
      page,
      (ctx) => [ctx.locator(selector).first()],
      700,
    );
    if (!trigger) continue;

    logger.info(`尝试点击切换按钮：${selector}`);
    if (!(await clickLocator(trigger, 1500))) {
      continue;
    }

    await delay(800);
    const dropdownVisible = await page.evaluate(() => {
      const candidates = document.querySelectorAll(
        '.ant-dropdown, .ant-select-dropdown, .el-dropdown-menu, [role="listbox"], ul[role="menu"], .account-switch-dropdown',
      );
      for (const element of candidates) {
        const style = window.getComputedStyle(element);
        if (style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0') {
          return true;
        }
      }
      return false;
    }).catch(() => false);

    if (dropdownVisible) {
      logger.info('下拉菜单已展开');
      return;
    }
  }

  const namedTrigger = await firstVisibleInContexts(
    page,
    (ctx) => [
      ctx.getByRole('button', { name: /门店|店铺|切换/ }),
      ctx.getByText(/门店|店铺|切换/),
      ctx.locator('header, .topbar, .navbar').locator('span, div, a').filter({ hasText: /门店|店铺/ }).first(),
    ],
    1200,
  );

  if (namedTrigger && (await clickLocator(namedTrigger, 1500))) {
    await delay(800);
    if (await waitForStoreDropdown(page)) {
      logger.info('已通过文本入口展开门店切换面板');
      return;
    }
  }

  await captureDebugSnapshot(page, paths, targetStoreName, 'store_switcher_missing', logger);
  throw new Error('未找到可用的门店切换入口');
}

async function searchStore(
  page: Page,
  targetStoreName: string,
  paths: AutomationRuntimePaths,
  logger: AutomationLogger,
) {
  const searchInput = await firstVisibleInContexts(
    page,
    (ctx) => [
      ctx.getByPlaceholder(/搜索|门店|店铺/),
      ctx.locator('input[placeholder*="搜索"]').first(),
      ctx.locator('input[placeholder*="门店"], input[placeholder*="店铺"]').first(),
      ctx.locator('.ant-select-dropdown input, .ant-dropdown input, .el-select-dropdown input').first(),
    ],
    1500,
  );

  if (searchInput) {
    const [alias, fullName] = getStoreSearchCandidates(targetStoreName);
    await searchInput.fill('');
    await searchInput.fill(alias || fullName || targetStoreName);
    logger.info(`已输入门店搜索词：${alias || fullName || targetStoreName}`);
    return;
  }

  logger.warn('未找到门店搜索框，尝试直接匹配门店选项');
  await captureDebugSnapshot(page, paths, targetStoreName, 'store_search_input_missing', logger);
}

async function collectVisibleStoreOptions(page: Page) {
  const snapshots: string[] = [];
  for (const ctx of getContexts(page)) {
    try {
      const texts = await ctx
        .locator('li, div[role="option"], .ant-dropdown-menu-item, .el-dropdown-menu__item')
        .evaluateAll((nodes) =>
          nodes
            .map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim())
            .filter(Boolean)
            .slice(0, 12),
        );
      if (texts.length > 0) {
        snapshots.push(...texts);
      }
    } catch {}
  }
  return snapshots;
}

async function isStoreVisible(page: Page, targetStoreName: string) {
  const exactPatterns = buildStoreNamePatterns(targetStoreName, true);
  const fuzzyPatterns = buildStoreNamePatterns(targetStoreName);
  const currentStore = await firstVisibleInContexts(
    page,
    (ctx) => [
      ...exactPatterns.map((pattern) => ctx.getByText(pattern)),
      ...fuzzyPatterns.map((pattern) => ctx.getByText(pattern)),
      ...fuzzyPatterns.map((pattern) =>
        ctx.locator('header, .account-switch, .shop-select, .store-select, .topbar, .navbar').filter({ hasText: pattern }),
      ),
      ...fuzzyPatterns.map((pattern) =>
        ctx.locator('[title], [aria-label]').filter({ hasText: pattern }),
      ),
    ],
    1200,
  );

  if (currentStore) return true;

  try {
    const text = await page.locator('header, .topbar, .navbar').first().textContent().catch(() => '');
    return isProbablyCurrentStoreText(text || '', targetStoreName);
  } catch {
    return false;
  }
}

async function findStoreOption(page: Page, targetStoreName: string) {
  const exactNames = buildStoreNamePatterns(targetStoreName, true);
  const fuzzyNames = buildStoreNamePatterns(targetStoreName);

  return firstVisibleInContexts(
    page,
    (ctx) => {
      const locators: Locator[] = [];
      for (const exactName of exactNames) {
        locators.push(
          ctx.getByRole('option', { name: exactName }),
          ctx.locator('[role="option"], li, .ant-dropdown-menu-item, .el-dropdown-menu__item').filter({
            hasText: exactName,
          }),
          ctx.getByText(exactName),
          ctx.locator('[title]').filter({ hasText: exactName }),
        );
      }
      for (const fuzzyName of fuzzyNames) {
        locators.push(
          ctx.getByRole('option', { name: fuzzyName }),
          ctx.locator('[role="option"], li, .ant-dropdown-menu-item, .el-dropdown-menu__item').filter({
            hasText: fuzzyName,
          }),
          ctx.getByText(fuzzyName),
          ctx.locator('[title], [aria-label]').filter({ hasText: fuzzyName }),
        );
      }
      return locators;
    },
    5000,
  );
}

async function switchStore(
  page: Page,
  targetStoreName: string,
  paths: AutomationRuntimePaths,
  logger: AutomationLogger,
) {
  await openStoreSwitcher(page, paths, targetStoreName, logger);
  logger.info(`正在查找目标门店选项：${targetStoreName}`);
  await searchStore(page, targetStoreName, paths, logger);

  let option = await findStoreOption(page, targetStoreName);
  if (!option) {
    const candidates = await collectVisibleStoreOptions(page);
    if (candidates.length > 0) {
      logger.info(`当前可见门店候选 ${candidates.length} 个：${candidates.join(' | ')}`);
    } else {
      logger.warn('当前未采集到可见的门店候选项');
    }
    await delay(1200);
    option = await findStoreOption(page, targetStoreName);
  }

  if (!option) {
    await captureDebugSnapshot(page, paths, targetStoreName, 'store_option_missing', logger);
    throw new Error(`未找到门店选项：${targetStoreName}`);
  }

  if (!(await clickLocator(option, 3000))) {
    await captureDebugSnapshot(page, paths, targetStoreName, 'store_option_click_failed', logger);
    throw new Error(`门店选项点击失败：${targetStoreName}`);
  }
  logger.info(`找到目标门店选项，已点击切换：${targetStoreName}`);

  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  await delay(1500);

  if (!(await isStoreVisible(page, targetStoreName))) {
    await captureDebugSnapshot(page, paths, targetStoreName, 'store_visible_check_uncertain', logger);
    logger.warn(`未在页面头部明确识别到门店：${targetStoreName}，继续后续流程`);
  }
  logger.info(`已切换到门店：${targetStoreName}`);
}

async function navigateToFinance(
  page: Page,
  paths: AutomationRuntimePaths,
  targetStoreName: string,
  logger: AutomationLogger,
) {
  let clicked = await clickFirstVisible(
    [
      page.getByRole('link', { name: /财务/ }),
      page.getByRole('menuitem', { name: /财务/ }),
      page.getByRole('button', { name: /财务/ }),
      page.getByText(/^财务$/),
      page.locator('a, span, div').filter({ hasText: /^财务$/ }),
      page.locator('aside, nav, .ant-menu, .el-menu').locator('a, span, div').filter({ hasText: /财务/ }).first(),
    ],
    3000,
  );

  if (!clicked) {
    await maybeExpandFinanceMenu(page);
    clicked = await clickFirstVisible(
      [
        page.getByRole('link', { name: /财务/ }),
        page.getByRole('menuitem', { name: /财务/ }),
        page.getByRole('button', { name: /财务/ }),
        page.getByText(/^财务$/),
        page.locator('a, span, div').filter({ hasText: /^财务$/ }),
        page.locator('aside, nav, .ant-menu, .el-menu').locator('a, span, div').filter({ hasText: /财务/ }).first(),
      ],
      2000,
    );
  }

  if (!clicked) {
    await captureDebugSnapshot(page, paths, targetStoreName, 'finance_entry_missing', logger);
    throw new Error('未找到财务入口');
  }

  await page.waitForLoadState('networkidle', { timeout: 12_000 }).catch(() => undefined);
  await delay(500);

  if (!(await isFinancePageReady(page))) {
    logger.warn('已点击财务入口，但未识别到明确财务页特征');
    await captureDebugSnapshot(page, paths, targetStoreName, 'finance_page_uncertain', logger);
  }

  logger.info('已进入财务页面');
}

async function detectRisk(page: Page) {
  for (const ctx of getContexts(page)) {
    const count = await ctx
      .locator('.nc_wrapper, .sm-slider-wrapper, iframe[src*="captcha"], iframe[src*="verify"], [class*="captcha"]')
      .count()
      .catch(() => 0);
    if (count > 0) {
      return true;
    }
  }
  return false;
}

async function detectWithdrawAmount(page: Page) {
  for (const ctx of getContexts(page)) {
    try {
      const exact = await firstVisible(
        [
          ctx.locator('.account__body__amount, [class*="amount"], [class*="money"]').first(),
          ctx.getByText(/账户可用总金额|可提现金额|可提现|可用余额|余额/),
        ],
        1000,
      );
      if (!exact) continue;
      const text = await exact.evaluate((el) => {
        const container = el.closest('div, section, li, tr, td') ?? el.parentElement ?? el;
        return container.textContent || '';
      });
      const amount = extractAmount(text);
      if (amount !== null) {
        return amount;
      }
    } catch {}
  }
  return null;
}

async function tryClickStoredCoordinates(
  page: Page,
  targetStoreName: string,
  paths: AutomationRuntimePaths,
  logger: AutomationLogger,
) {
  const coords = await loadCoords(paths);
  const candidates = coords[targetStoreName] || [];

  for (const point of candidates) {
    try {
      await page.mouse.click(point.x, point.y);
      const prompt = await waitForWithdrawFlowPrompt(page, 1500);
      if (prompt) {
        logger.info('历史坐标命中提现流程');
        return point;
      }
    } catch {}
  }

  return null;
}

async function clickWithdrawButton(
  page: Page,
  targetStoreName: string,
  paths: AutomationRuntimePaths,
  logger: AutomationLogger,
) {
  const storedPoint = await tryClickStoredCoordinates(page, targetStoreName, paths, logger);
  if (storedPoint) {
    return storedPoint;
  }

  const evolution = await loadEvolutionConfig(paths);
  const preferredText = normalizeText(evolution.actionHints?.withdrawEntryText || '');
  const candidateTexts = Array.from(
    new Set(
      [preferredText, '提现', '立即提现', '去提现', '申请提现', '发起提现'].filter(Boolean),
    ),
  );

  for (const ctx of getContexts(page)) {
    const candidates: Locator[] = [];
    for (const textCandidate of candidateTexts) {
      const pattern = new RegExp(`^${escapeRegExp(textCandidate)}$`);
      candidates.push(
        ctx.getByRole('button', { name: pattern }),
        ctx.getByText(pattern),
        ctx.locator('button, a, div, span').filter({ hasText: pattern }),
      );
    }

    for (const candidate of candidates) {
      const count = await candidate.count().catch(() => 0);
      if (count === 0) continue;

      for (let index = 0; index < count; index++) {
        const button = candidate.nth(index);
        const text = normalizeText((await button.textContent().catch(() => '')) || '');
        if (!text || text.includes('全部提现')) continue;

        const box = await button.boundingBox().catch(() => null);
        logger.info(`正在点击提现入口：${text}`);
        if (!(await clickLocator(button, 2000))) continue;

        const prompt = await waitForWithdrawFlowPrompt(page, 2500);
        if (prompt) {
          if (text !== preferredText) {
            evolution.actionHints = {
              ...(evolution.actionHints || {}),
              withdrawEntryText: text,
            };
            await saveEvolutionConfig(paths, evolution).catch(() => undefined);
          }
          logger.info(`提现入口点击成功，已进入后续确认流程：${text}`);
          return box ? { x: box.x + box.width / 2, y: box.y + box.height / 2 } : null;
        }

        logger.warn(`候选提现按钮点击后未出现弹窗：${text}`);
      }
    }
  }

  return null;
}

async function submitPasswordIfNeeded(
  page: Page,
  paths: AutomationRuntimePaths,
  password: string | undefined,
  logger: AutomationLogger,
) {
  const evolution = await loadEvolutionConfig(paths);
  const preferredSubmitText = normalizeText(evolution.actionHints?.confirmSubmitText || '');
  const submitTexts = Array.from(
    new Set(
      [preferredSubmitText, '提现', '确定', '确认', '提交', '完成'].filter(Boolean),
    ),
  );

  for (const ctx of getContexts(page)) {
    const passwordInput = await firstVisible(
      [
        ctx.locator('input[type="password"]'),
        ctx.getByPlaceholder(/支付密码|请输入密码/),
      ],
      2000,
    );

    if (!passwordInput) {
      continue;
    }
    if (!password) {
      throw new Error('商户未配置提现支付密码');
    }

    await passwordInput.fill(password);
    let clickedText = '';
    for (const submitText of submitTexts) {
      const exactPattern = new RegExp(`^${escapeRegExp(submitText)}$`);
      const clicked = await clickFirstVisible(
        [
          ctx.getByRole('button', { name: exactPattern }),
          ctx.getByText(exactPattern),
          ctx.locator('button, [role="button"], a, .ant-btn, .el-button, .next-btn').filter({
            hasText: exactPattern,
          }),
        ],
        800,
      );
      if (clicked) {
        clickedText = submitText;
        break;
      }
    }

    if (clickedText && clickedText !== preferredSubmitText) {
      evolution.actionHints = {
        ...(evolution.actionHints || {}),
        confirmSubmitText: clickedText,
      };
      await saveEvolutionConfig(paths, evolution).catch(() => undefined);
    }
    logger.info('已提交支付密码');
    return true;
  }

  return false;
}

async function waitForWithdrawalOutcome(page: Page, timeout = 5000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const successMessage = await detectWithdrawalSuccess(page);
    if (successMessage) {
      return { success: successMessage };
    }

    if (await detectRisk(page)) {
      return { blocked: true };
    }

    await delay(500);
  }

  return {};
}

async function confirmWithdrawal(
  page: Page,
  paths: AutomationRuntimePaths,
  password: string | undefined,
  logger: AutomationLogger,
) {
  logger.info('正在处理提现金额弹窗');

  for (const ctx of getContexts(page)) {
    const allWithdrawBtn = await pollVisibleLocator(
      [
        ctx.getByText(/^全部提现$/),
        ctx.locator('button, [role="button"], a, .ant-btn, .el-button, .next-btn').filter({
          hasText: /^全部提现$/,
        }),
      ],
      1800,
      120,
    );

    if (!allWithdrawBtn) {
      continue;
    }

    for (let attempt = 1; attempt <= 5; attempt++) {
      logger.info(`已找到“全部提现”入口，准备回填金额（第 ${attempt} 次）`);
      if (!(await clickLocator(allWithdrawBtn, 2000))) {
        logger.warn(`“全部提现”入口点击失败（第 ${attempt} 次）`);
        await delay(400);
        continue;
      }

      logger.info(`“全部提现”入口点击成功，等待金额回填完成（第 ${attempt} 次）`);
      if (!(await waitForWithdrawAmountReady(ctx, 2500))) {
        logger.warn(`点击“全部提现”后金额未成功回填（第 ${attempt} 次）`);
        await delay(500);
        continue;
      }

      logger.info(`提现金额已回填，准备点击底部“提现”按钮（第 ${attempt} 次）`);
      const submitButton = await waitForEnabledActionButton(ctx, /^提现$/, 1500);
      if (!submitButton) {
        logger.warn(`未找到可点击的底部“提现”按钮（第 ${attempt} 次）`);
        await delay(500);
        continue;
      }

      if (!(await clickLocator(submitButton, 2000))) {
        logger.warn(`底部“提现”按钮点击失败（第 ${attempt} 次）`);
        await delay(500);
        continue;
      }

      logger.info(`底部“提现”按钮已点击（第 ${attempt} 次）`);

      const passwordReady = await hasPasswordInput(page, 1500);
      if (!passwordReady) {
        logger.warn(`点击底部“提现”后未进入密码输入流程（第 ${attempt} 次）`);
        await delay(500);
        continue;
      }

      const submitted = await submitPasswordIfNeeded(page, paths, password, logger);
      if (!submitted) {
        logger.warn(`未检测到密码输入框或密码提交流程未完成（第 ${attempt} 次）`);
        await delay(500);
        continue;
      }

      logger.info('已确认全部提现');
      return true;
    }

    logger.warn('提现金额弹窗流程已重试 5 次，当前门店仍未完成确认');
    return false;
  }

  const dialogTexts = await collectDialogTexts(page);
  if (dialogTexts.length > 0) {
    logger.warn(`未找到提现金额弹窗中的“全部提现”入口，当前弹窗内容：${dialogTexts.join(' | ')}`);
  } else {
    logger.warn('未找到提现金额弹窗中的“全部提现”入口，当前也未检测到明确弹窗内容');
  }
  return false;
}

async function persistCoordinateIfNeeded(
  targetStoreName: string,
  point: null | { x: number; y: number },
  paths: AutomationRuntimePaths,
) {
  if (!point) return;
  const coords = await loadCoords(paths);
  coords[targetStoreName] = [point];
  await saveCoords(paths, coords);
}

export async function executeStoreWithdrawal(
  page: Page,
  input: StoreExecutionInput,
): Promise<StoreExecutionResult> {
  const { config, logger, paths, storeId, storeName } = input;
  const targetStoreName = resolveStoreTargetName(storeId, storeName, config);
  const storeLogger = logger.child(targetStoreName);

  await switchStore(page, targetStoreName, paths, storeLogger);
  writeMetric(paths, 'store_switch', { store: targetStoreName, success: true });

  await navigateToFinance(page, paths, targetStoreName, storeLogger);

  if (await detectRisk(page)) {
    await captureDebugSnapshot(page, paths, targetStoreName, 'risk_detected_before_submit', storeLogger);
    writeMetric(paths, 'risk_control', { action: 'blocked', store: targetStoreName, trigger: 'captcha' });
    return {
      blocked: true,
      message: '检测到验证码或风控校验，请人工处理后重试',
      status: 'failed',
    };
  }

  const amount = await detectWithdrawAmount(page);
  writeMetric(paths, 'balance_check', { amount, store: targetStoreName });

  if (typeof amount === 'number' && amount <= config.minWithdrawAmount) {
    return {
      blocked: false,
      message: `可提现金额 ${amount.toFixed(2)} 不高于阈值，已跳过`,
      status: 'success',
      withdrawAmount: amount,
    };
  }

  const point = await clickWithdrawButton(page, targetStoreName, paths, storeLogger);
  if (!point) {
    await captureDebugSnapshot(page, paths, targetStoreName, 'withdraw_button_missing', storeLogger);
    return {
      blocked: false,
      message: '未找到可点击的提现按钮，请检查页面状态',
      status: 'failed',
    };
  }

  await persistCoordinateIfNeeded(targetStoreName, point, paths);

  const confirmed = await confirmWithdrawal(page, paths, config.paymentPassword, storeLogger);
  if (!confirmed) {
    await captureDebugSnapshot(page, paths, targetStoreName, 'confirm_dialog_missing', storeLogger);
    return {
      blocked: false,
      message: '已点击提现，但未检测到确认弹窗',
      status: 'failed',
    };
  }

  const outcome = await waitForWithdrawalOutcome(page, 6000);
  if (outcome.blocked) {
    await captureDebugSnapshot(page, paths, targetStoreName, 'risk_detected_after_submit', storeLogger);
    return {
      blocked: true,
      message: '提现过程中触发风控，请人工处理后重试',
      status: 'failed',
    };
  }

  if (outcome.success) {
    await dismissSuccessPrompt(page);
    return {
      blocked: false,
      message: amount
        ? `${outcome.success}，金额约 ¥${amount.toFixed(2)}`
        : outcome.success,
      status: 'success',
      withdrawAmount: amount ?? undefined,
    };
  }

  await captureDebugSnapshot(page, paths, targetStoreName, 'success_feedback_missing', storeLogger);
  return {
    blocked: false,
    message: amount ? `提现已提交，金额约 ¥${amount.toFixed(2)}，但未识别到明确成功提示` : '提现已提交，但未识别到明确成功提示',
    status: 'failed',
    withdrawAmount: amount ?? undefined,
  };
}
