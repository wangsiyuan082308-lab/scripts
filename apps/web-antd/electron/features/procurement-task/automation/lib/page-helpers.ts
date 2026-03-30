/**
 * 牵牛花页面操作工具函数
 *
 * 通用能力（ensureLogin、closeModals、switchToMaxPerPage、waitForPageReady、ensureDir）
 * 已提取到 shared-libs/，此处 re-export 并绑定牵牛花的 purchase-ant- 前缀。
 *
 * 反检测能力（人类化操作）已集成 @oby/stealth。
 *
 * 本文件只保留牵牛花专属逻辑：
 * - 弹窗检测与处理（detectAndHandleModal / dismissModal）
 * - 按钮 loading 等待（waitForButtonLoading）
 * - 供应商筛选（searchSupplier）
 * - URL 参数提取（getUrlParam）
 */
import { Locator, Page } from 'playwright';
import { log } from './utils';
import { executeOrderAction } from './order-actions';

// --- 从共享库 re-export，绑定牵牛花 purchase-ant- 前缀 ---

import { ensureDir } from '@oby/page-utils';
import {
  switchToMaxPerPage as _switchToMaxPerPage,
  waitForPageReady,
} from '@oby/page-utils';
import { ensureLogin as _ensureLogin } from '@oby/browser';

// --- 导入人类化操作 ---
import { human } from '@oby/stealth';

export { ensureDir, waitForPageReady };

// 便捷导出 human 工具
export { human };

/** 随机延迟（包装 human.pause） */
export async function randomDelay(min: number, max: number): Promise<void> {
  await human.pause(min, max);
}

/**
 * 关闭牵牛花页面弹窗（不按 Escape，避免预览页返回导航）
 *
 * 覆盖标准 purchase-ant-modal-wrap 和 purchase-compact--* CSS Modules 变体。
 * 兜底策略：点击按钮 → 点击关闭图标 → 强制移除 DOM。
 */
export async function closeModals(page: Page): Promise<void> {
  for (let i = 0; i < 5; i++) {
    const hasModal = await page.evaluate(() => {
      const modals = document.querySelectorAll('.purchase-ant-modal-wrap');
      for (const modal of Array.from(modals)) {
        const el = modal as HTMLElement;
        const style = window.getComputedStyle(el);
        if (style.display !== 'none' && el.style.display !== 'none') return true;
      }
      return false;
    });

    if (!hasModal) return;

    // 尝试点击关闭按钮（按优先级）
    let closed = false;
    for (const text of ['确定', '确认', '知道了', '关闭', '取消']) {
      const btn = page.locator('.purchase-ant-modal-wrap:visible button').filter({ hasText: text }).first();
      if (await btn.isVisible({ timeout: 300 }).catch(() => false)) {
        await btn.click({ force: true }).catch(() => {});
        await page.waitForTimeout(500);
        closed = true;
        break;
      }
    }

    // 尝试点击关闭图标
    if (!closed) {
      const closeIcon = page.locator('.purchase-ant-modal-wrap:visible .purchase-ant-modal-close').first();
      if (await closeIcon.isVisible({ timeout: 300 }).catch(() => false)) {
        await closeIcon.click({ force: true }).catch(() => {});
        await page.waitForTimeout(500);
        closed = true;
      }
    }

    // 都失败了 → 强制移除 DOM（绝不用 Escape）
    if (!closed) {
      await page.evaluate(() => {
        document.querySelectorAll('.purchase-ant-modal-wrap, .purchase-ant-modal-mask').forEach(el => {
          const style = window.getComputedStyle(el as HTMLElement);
          if (style.display !== 'none') el.remove();
        });
      });
      await page.waitForTimeout(300);
    }
  }
}

/** 切换牵牛花分页到最大条数（purchase-ant- 前缀） */
export async function switchToMaxPerPage(page: Page): Promise<void> {
  await _switchToMaxPerPage(page, 'purchase-ant-', log);
}

/**
 * 牵牛花 ensureLogin 封装
 *
 * 绑定牵牛花的登录页特征词（login / passport），透传 log 函数。
 * 调用方只需传 page + targetUrl + maxWait。
 */
export async function ensureLogin(page: Page, targetUrl: string, maxWait = 120000): Promise<void> {
  await _ensureLogin(page, targetUrl, { maxWait, log });
}

/** 从 URL 中提取指定查询参数的值 */
export function getUrlParam(url: string, param: string): string {
  const match = url.match(new RegExp('[?&]' + param + '=([^&]*)'));
  return match ? decodeURIComponent(match[1]) : '';
}

/** 弹窗按钮语义 */
export type ModalActionIntent = 'confirm' | 'cancel' | 'close' | 'destructive';

/** 弹窗信息（是否可见、文本内容、按钮列表） */
export interface ModalInfo {
  visible: boolean;
  text: string;
  buttons: string[];
  containerType?: 'modal' | 'popover' | 'dialog';
}

/** 结构化弹窗探测结果 */
export interface VisibleModalInfo extends ModalInfo {
  visible: true;
  containerType: 'modal' | 'popover' | 'dialog';
}

/** 弹窗动作结果 */
export interface ModalActionResult {
  handled: boolean;
  matchedIntent: ModalActionIntent;
  modalText: string;
  buttonTexts: string[];
  clickedText?: string;
  containerType?: 'modal' | 'popover' | 'dialog';
}

export interface UiSettledOptions {
  hiddenSelectors?: string[];
  visibleSelectors?: string[];
  timeout?: number;
  waitForNetworkIdle?: boolean;
}

const MODAL_CONTAINER_SELECTORS = [
  '.purchase-ant-modal-wrap:visible, .purchase-ant-modal:visible',
  '.purchase-ant-popover:visible',
  '[role="dialog"]:visible',
] as const;

const MODAL_BUTTON_TEXTS: Record<ModalActionIntent, RegExp[]> = {
  destructive: [/清\s*空/, /删\s*除/, /移\s*出/, /移\s*除/, /作\s*废/],
  confirm: [/确\s*定/, /确\s*认/, /知\s*道\s*了/, /继\s*续/, /提\s*交/],
  cancel: [/取\s*消/, /返\s*回/, /暂\s*不/, /稍\s*后/],
  close: [/关\s*闭/, /我\s*知\s*道\s*了/],
};

function normalizeModalText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function formatModalDiagnostics(input: {
  modalText: string;
  buttonTexts: string[];
  containerType?: string;
  matchedIntent?: string;
  clickedText?: string;
}): string {
  return JSON.stringify({
    modalText: input.modalText,
    buttonTexts: input.buttonTexts,
    containerType: input.containerType,
    matchedIntent: input.matchedIntent,
    clickedText: input.clickedText,
  });
}

function getContainerType(selector: string): 'modal' | 'popover' | 'dialog' {
  if (selector.includes('popover')) return 'popover';
  if (selector.includes('[role="dialog"]')) return 'dialog';
  return 'modal';
}

async function getVisibleModalContainer(page: Page): Promise<{ container: Locator; containerType: 'modal' | 'popover' | 'dialog' } | null> {
  for (const selector of MODAL_CONTAINER_SELECTORS) {
    const container = page.locator(selector).last();
    if (await container.isVisible({ timeout: 500 }).catch(() => false)) {
      return { container, containerType: getContainerType(selector) };
    }
  }
  return null;
}

async function getModalButtonTexts(container: Locator): Promise<string[]> {
  const roleButtons = container.getByRole('button');
  const count = await roleButtons.count().catch(() => 0);
  const texts: string[] = [];

  for (let i = 0; i < count; i++) {
    const text = normalizeModalText(await roleButtons.nth(i).innerText().catch(() => ''));
    if (text && !texts.includes(text)) texts.push(text);
  }

  if (texts.length > 0) return texts;

  return container.locator('button').evaluateAll((nodes) => {
    const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
    const results: string[] = [];
    for (const node of nodes) {
      const text = normalize((node as HTMLElement).innerText || node.textContent || '');
      if (text && !results.includes(text)) results.push(text);
    }
    return results;
  }).catch(() => [] as string[]);
}

function getIntentPatterns(intent: ModalActionIntent, extraButtonTexts: string[] = []): RegExp[] {
  const extraPatterns = extraButtonTexts.map((text) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  return [...extraPatterns, ...MODAL_BUTTON_TEXTS[intent]];
}

async function clickMatchedButton(container: Locator, patterns: RegExp[]): Promise<string | undefined> {
  const roleButtons = container.getByRole('button');
  const roleCount = await roleButtons.count().catch(() => 0);
  for (let i = 0; i < roleCount; i++) {
    const button = roleButtons.nth(i);
    if (!await button.isVisible({ timeout: 300 }).catch(() => false)) continue;
    const text = normalizeModalText(await button.innerText().catch(() => ''));
    if (!text || !patterns.some((pattern) => pattern.test(text))) continue;
    await button.click({ timeout: 5000 });
    return text;
  }

  const buttons = container.locator('button');
  const buttonCount = await buttons.count().catch(() => 0);
  for (let i = 0; i < buttonCount; i++) {
    const button = buttons.nth(i);
    if (!await button.isVisible({ timeout: 300 }).catch(() => false)) continue;
    const text = normalizeModalText(await button.innerText().catch(() => ''));
    if (!text || !patterns.some((pattern) => pattern.test(text))) continue;
    await button.click({ timeout: 5000 });
    return text;
  }

  return undefined;
}

/** 读取当前可见弹窗的文本、按钮和容器类型，不执行点击 */
export async function getVisibleModal(page: Page): Promise<ModalInfo> {
  const modal = await getVisibleModalContainer(page);
  if (!modal) {
    return { visible: false, text: '', buttons: [] };
  }

  const text = normalizeModalText(await modal.container.innerText().catch(() => ''));
  const buttons = await getModalButtonTexts(modal.container);
  return {
    visible: true,
    text,
    buttons,
    containerType: modal.containerType,
  };
}

/** 兼容旧接口：仅检测可见弹窗信息 */
export async function detectAndHandleModal(page: Page): Promise<ModalInfo> {
  return getVisibleModal(page);
}

/** 按业务意图点击弹窗按钮，并等待弹窗与页面状态收敛 */
export async function clickModalAction(
  page: Page,
  intent: ModalActionIntent,
  options: { extraButtonTexts?: string[]; allowForceDismiss?: boolean } = {},
): Promise<ModalActionResult> {
  const modal = await getVisibleModalContainer(page);
  if (!modal) {
    return {
      handled: false,
      matchedIntent: intent,
      modalText: '',
      buttonTexts: [],
    };
  }

  const modalText = normalizeModalText(await modal.container.innerText().catch(() => ''));
  const buttonTexts = await getModalButtonTexts(modal.container);
  const clickedText = await clickMatchedButton(modal.container, getIntentPatterns(intent, options.extraButtonTexts));

  if (clickedText) {
    await waitForModalSettled(page);
    return {
      handled: true,
      matchedIntent: intent,
      modalText,
      buttonTexts,
      clickedText,
      containerType: modal.containerType,
    };
  }

  if (options.allowForceDismiss) {
    await dismissModal(page, options.extraButtonTexts?.[0] || '');
  }

  return {
    handled: false,
    matchedIntent: intent,
    modalText,
    buttonTexts,
    containerType: modal.containerType,
  };
}

/** 等待弹窗关闭、网络空闲和页面 loading 消退 */
export async function waitForModalSettled(page: Page): Promise<void> {
  await waitForUiSettled(page, {
    hiddenSelectors: Array.from(MODAL_CONTAINER_SELECTORS),
  });
}

/** 等待动作后的 UI 收敛（可选：等待某些元素出现/消失 + 网络空闲 + loading 消退） */
export async function waitForUiSettled(page: Page, options: UiSettledOptions = {}): Promise<void> {
  const {
    hiddenSelectors = [],
    visibleSelectors = [],
    timeout = 5000,
    waitForNetworkIdle = true,
  } = options;

  if (hiddenSelectors.length > 0) {
    await page.waitForFunction((selectors) => {
      return selectors.every((selector: string) => {
        return Array.from(document.querySelectorAll(selector)).every((node) => {
          const style = window.getComputedStyle(node as HTMLElement);
          return style.display === 'none' || style.visibility === 'hidden';
        });
      });
    }, hiddenSelectors, { timeout }).catch(() => {});
  }

  if (visibleSelectors.length > 0) {
    await page.waitForFunction((selectors) => {
      return selectors.every((selector: string) => {
        return Array.from(document.querySelectorAll(selector)).some((node) => {
          const style = window.getComputedStyle(node as HTMLElement);
          return style.display !== 'none' && style.visibility !== 'hidden';
        });
      });
    }, visibleSelectors, { timeout }).catch(() => {});
  }

  if (waitForNetworkIdle) {
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
  }

  await page.waitForFunction(() => {
    const selectors = [
      '.purchase-ant-spin-spinning',
      '.purchase-ant-table-placeholder .purchase-ant-spin-spinning',
      '.purchase-ant-spin-dot',
      '.purchase-ant-spin',
      '.purchase-ant-table-loading',
    ];
    return selectors.every((selector) => {
      return Array.from(document.querySelectorAll(selector)).every((node) => {
        const style = window.getComputedStyle(node as Element);
        return style.display === 'none' || style.visibility === 'hidden';
      });
    });
  }, { timeout }).catch(() => {});
}

/** 按指定文字处理弹窗，优先 locator 点击，找不到时可兜底移除 DOM */
export async function dismissModal(page: Page, buttonText: string): Promise<void> {
  const modal = await getVisibleModalContainer(page);
  if (!modal) return;

  if (buttonText) {
    const clickedText = await clickMatchedButton(modal.container, getIntentPatterns('destructive', [buttonText]));
    if (clickedText) {
      await waitForModalSettled(page);
      return;
    }
  }

  const closeButton = modal.container.locator('.purchase-ant-modal-close, [aria-label="Close"], [aria-label="关闭"]').first();
  if (await closeButton.isVisible({ timeout: 300 }).catch(() => false)) {
    await closeButton.click({ timeout: 5000 }).catch(() => {});
    await waitForModalSettled(page);
    return;
  }

  await page.evaluate(() => {
    document.querySelectorAll('.purchase-ant-modal-wrap, .purchase-ant-modal-mask, .purchase-ant-popover, [role="dialog"]').forEach(el => el.remove());
  });
}

/** 兼容旧接口：检测当前页面是否有可见弹窗，返回弹窗文本和按钮列表 */
export async function waitForButtonLoading(page: Page, buttonText: string, timeout = 30000): Promise<boolean> {
  const interval = 2000;
  for (let elapsed = 0; elapsed < timeout; elapsed += interval) {
    const loading = await page.evaluate((btnText: string) => {
      const buttons = document.querySelectorAll('button');
      for (const btn of Array.from(buttons)) {
        if ((btn as HTMLElement).innerText.includes(btnText)) {
          return btn.className.includes('loading');
        }
      }
      return false;
    }, buttonText);
    if (!loading) return true;
    await page.waitForTimeout(interval);
  }
  return false;
}

/**
 * 在补货建议页筛选供应商（点击下拉 → 清空 → 键入名称 → 选择匹配项）
 * 找不到供应商选择器或匹配选项时 throw，不静默跳过
 */
export async function searchSupplier(page: Page, supplier: string): Promise<void> {
  if (!supplier || !supplier.trim()) {
    throw new Error('未指定供应商名称，请通过 --supplier 参数或配置文件指定');
  }

  log('  筛选供应商: "' + supplier + '"');

  // 通过"供应商"标签定位对应的 Select 组件
  const clicked = await page.evaluate(() => {
    const labels = document.querySelectorAll('.purchase-ant-form-item-label');
    for (const label of Array.from(labels)) {
      if ((label as HTMLElement).innerText.trim() === '供应商') {
        const row = label.closest('.purchase-ant-form-item-row') || label.parentElement;
        if (!row) continue;
        // 同行可能有多个 Select（如供应商类型+供应商名称），名称是第二个
        const selects = row.querySelectorAll('.purchase-ant-select');
        const supplierSelect = selects.length >= 2 ? selects[1] : selects[0];
        if (supplierSelect) {
          const selector = supplierSelect.querySelector('.purchase-ant-select-selector');
          if (selector) {
            (selector as HTMLElement).click();
            return true;
          }
        }
      }
    }
    return false;
  });

  if (!clicked) {
    throw new Error('未找到供应商选择器，页面结构可能已变更');
  }
  log('  已打开供应商下拉');

  await page.waitForTimeout(1000);

  // 清空搜索框已有内容再输入（防止残留文字导致匹配失败）
  await page.keyboard.press('Meta+A');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(300);

  await page.keyboard.type(supplier, { delay: 100 });
  await page.waitForTimeout(3000);

  // 精确匹配
  const option = page.locator('.purchase-ant-select-dropdown .purchase-ant-select-item').filter({ hasText: supplier }).first();
  if (await option.isVisible({ timeout: 5000 }).catch(() => false)) {
    await option.click();
    await page.waitForTimeout(1000);
    log('  已选择供应商: ' + supplier);
    return;
  }

  // 模糊匹配兜底
  const allOptions = page.locator('.purchase-ant-select-dropdown .purchase-ant-select-item');
  const optCount = await allOptions.count();
  log('  精确匹配失败，尝试模糊匹配（下拉选项数: ' + optCount + '）');
  for (let i = 0; i < optCount; i++) {
    const text = await allOptions.nth(i).innerText().catch(() => '');
    log('    选项' + i + ': ' + text.trim());
    if (text.includes(supplier) || supplier.includes(text.trim())) {
      await allOptions.nth(i).click();
      await page.waitForTimeout(1000);
      log('  模糊匹配选择: ' + text.trim());
      return;
    }
  }

  // 都没匹配到 → 关闭下拉并报错
  await page.keyboard.press('Escape');
  throw new Error('供应商 "' + supplier + '" 在下拉列表中未找到，请确认名称是否正确');
}

/**
 * 关闭采购单列表中的待下单订单
 *
 * @param page - Playwright Page（需已登录）
 * @param baseUrl - 牵牛花基础 URL
 * @param options.supplier - 只关闭该供应商的订单（不传则关闭所有待下单）
 * @returns 关闭的订单号列表
 */
export async function closePendingOrders(
  page: Page,
  baseUrl: string,
  options: { supplier?: string } = {},
): Promise<string[]> {
  log('  [closePendingOrders] 关闭待下单订单' + (options.supplier ? '（供应商: ' + options.supplier + '）' : ''));
  const result = await executeOrderAction(page, {
    action: 'close',
    baseUrl,
    supplier: options.supplier,
    status: '待下单',
  });
  log('  [closePendingOrders] ' + result.message);
  return result.affectedOrders;
}
