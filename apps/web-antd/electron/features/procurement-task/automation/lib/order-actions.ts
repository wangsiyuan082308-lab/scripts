/**
 * 采购单统一操作函数
 *
 * 封装采购单列表页的所有批量操作：下单、关闭、付款等。
 * 调用方只需传入动作类型和筛选条件，内部处理导航、筛选、选择、执行、确认。
 */
import { Page } from 'playwright';
import { clickModalAction, closeModals, formatModalDiagnostics, getVisibleModal, waitForModalSettled, waitForPageReady } from './page-helpers';
import { log } from './utils';

/** 支持的操作类型 */
export type OrderActionType =
  | 'place-order'       // 批量下单 → 1688批量下单
  | 'close'             // 批量关闭
  | 'pay'               // 批量付款
  | 'mark-paid'         // 批量标记已付款
  | 'refresh-1688';     // 批量刷新1688订单状态

/** 操作参数 */
export interface OrderActionParams {
  action: OrderActionType;
  baseUrl: string;
  supplier?: string;      // 按供应商筛选（行文本包含）
  status?: string;        // 按状态筛选（如 '待下单'、'待付款'）
  orderNos?: string[];    // 指定订单号（不传则操作所有匹配的）
}

/** 操作结果 */
export interface OrderActionResult {
  success: boolean;
  affectedOrders: string[];
  message: string;
}

/** 动作 → 页面按钮文本映射 */
const ACTION_BUTTON_MAP: Record<OrderActionType, string> = {
  'place-order': '批量下单',
  'close': '批量关闭',
  'pay': '批量付款',
  'mark-paid': '批量标记已付款',
  'refresh-1688': '批量刷新1688订单状态',
};

/**
 * 执行采购单操作
 *
 * 1. 导航到采购单列表（如不在）
 * 2. 按状态筛选
 * 3. 全选（或按订单号勾选）
 * 4. 点击对应批量按钮
 * 5. 处理下拉菜单（如 place-order 需选 1688）
 * 6. 处理确认弹框
 */
export async function executeOrderAction(
  page: Page,
  params: OrderActionParams,
): Promise<OrderActionResult> {
  const { action, baseUrl, supplier, status, orderNos } = params;
  const actionLabel = ACTION_BUTTON_MAP[action];
  log('  [orderAction] ' + actionLabel + (supplier ? ' | 供应商: ' + supplier : '') + (status ? ' | 状态: ' + status : ''));

  // 1. 确保在采购单列表页
  await ensureOnOrderListPage(page, baseUrl);

  // 2. 按状态筛选
  if (status) {
    await filterByStatus(page, status);
  }

  // 3. 读取匹配的订单
  const matchedOrders = await getMatchingOrders(page, supplier, orderNos);
  if (matchedOrders.length === 0) {
    return { success: false, affectedOrders: [], message: '未找到匹配的订单' };
  }
  log('  匹配订单 (' + matchedOrders.length + '): ' + matchedOrders.map(o => o.orderNo).join(', '));

  // 4. 全选
  const selectAll = page.locator('table thead .purchase-ant-checkbox-input, table thead input[type="checkbox"]').first();
  if (await selectAll.isVisible({ timeout: 3000 }).catch(() => false)) {
    // 先确保未选中状态，再点击全选
    await selectAll.click();
    await waitForSelectionApplied(page);
    log('  已全选');
  }

  // 5. 执行动作
  if (action === 'place-order') {
    await doPlaceOrder(page);
  } else if (action === 'close') {
    await doBatchAction(page, '批量关闭');
  } else if (action === 'pay') {
    await doBatchAction(page, '批量付款');
  } else if (action === 'mark-paid') {
    await doBatchAction(page, '批量标记已付款');
  } else if (action === 'refresh-1688') {
    await doBatchAction(page, '批量刷新1688订单状态');
  }

  await closeModals(page);

  const orderNosStr = matchedOrders.map(o => o.orderNo);
  return {
    success: true,
    affectedOrders: orderNosStr,
    message: actionLabel + '完成，共 ' + orderNosStr.length + ' 个订单',
  };
}

// --- 内部函数 ---

/** 确保在采购单列表页 */
async function ensureOnOrderListPage(page: Page, baseUrl: string): Promise<void> {
  const url = page.url();
  if (url.includes('purchase-order/list') || url.includes('/purchase/order')) return;

  await page.goto(baseUrl + '/home.html#/purchase/purchase-order/list', {
    waitUntil: 'networkidle', timeout: 30000,
  }).catch(() => {});
  await waitForPageReady(page);
  await closeModals(page);
}

/** 按状态筛选 */
async function filterByStatus(page: Page, status: string): Promise<void> {
  // 展开筛选
  const expandBtn = page.locator('button:has-text("展开")').first();
  if (await expandBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await expandBtn.click();
    await waitForPageReady(page);
  }

  // 找状态 Select
  const statusLabel = page.locator('.purchase-ant-form-item-label, label').filter({ hasText: /^状态$/ }).first();
  if (!(await statusLabel.isVisible({ timeout: 3000 }).catch(() => false))) {
    log('  未找到"状态"标签，跳过筛选');
    return;
  }

  const formItem = statusLabel.locator('xpath=ancestor::*[contains(@class,"purchase-ant-form-item")]').first();
  const selectBox = formItem.locator('.purchase-ant-select-selector').first();
  if (!(await selectBox.isVisible({ timeout: 2000 }).catch(() => false))) {
    log('  未找到状态 Select');
    return;
  }

  await selectBox.click();
  await waitForStatusDropdownReady(page);

  const option = page.locator('.purchase-ant-select-dropdown:visible .purchase-ant-select-item')
    .filter({ hasText: status }).first();
  if (await option.isVisible({ timeout: 5000 }).catch(() => false)) {
    await option.click();
    log('  已选择状态: ' + status);
    await page.keyboard.press('Escape');
    await waitForModalSettled(page);
  } else {
    await page.keyboard.press('Escape');
    log('  状态选项 "' + status + '" 未找到');
    return;
  }

  // 点查询
  const searchBtn = page.locator('button').filter({ hasText: /查\s*询/ }).first();
  if (await searchBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await searchBtn.click();
    await waitForPageReady(page);
  }
  await waitForPageReady(page);
}

interface MatchedOrder {
  orderNo: string;
  amount: string;
  status: string;
  storeName: string;
}

async function waitForSelectionApplied(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const checked = document.querySelector('table thead input[type="checkbox"]:checked');
    const antChecked = document.querySelector('table thead .purchase-ant-checkbox-checked');
    return Boolean(checked || antChecked);
  }, { timeout: 3000 }).catch(() => {});
}

async function waitForDropdownVisible(page: Page): Promise<void> {
  const dropdown = page.locator('.purchase-roo-dropdown-menu:visible, .purchase-roo-drop-menu:visible');
  if (await dropdown.isVisible({ timeout: 3000 }).catch(() => false)) return;
  throw new Error('"批量下单"点击后未出现下拉菜单');
}

async function waitForStatusDropdownReady(page: Page): Promise<void> {
  const option = page.locator('.purchase-ant-select-dropdown:visible .purchase-ant-select-item').first();
  await option.isVisible({ timeout: 3000 }).catch(() => false);
}

/** 读取表格中匹配的订单 */
async function getMatchingOrders(
  page: Page, supplier?: string, orderNos?: string[],
): Promise<MatchedOrder[]> {
  return page.evaluate(({ supplier, orderNos }) => {
    const result: Array<{ orderNo: string; amount: string; status: string; storeName: string }> = [];
    const rows = document.querySelectorAll('table tbody tr');

    // 找门店列索引
    let storeColIdx = -1;
    const headerCells = document.querySelectorAll('table thead th, table thead td');
    for (let i = 0; i < headerCells.length; i++) {
      const ht = (headerCells[i] as HTMLElement).innerText.trim();
      if (ht.includes('门店') || ht.includes('仓') || ht.includes('收货方')) {
        storeColIdx = i;
        break;
      }
    }

    for (const row of Array.from(rows)) {
      const text = (row as HTMLElement).innerText;

      // 供应商过滤
      if (supplier && !text.includes(supplier)) continue;

      const cells = row.querySelectorAll('td');
      let orderNo = '', amount = '', status = '', storeName = '';

      // 门店
      if (storeColIdx >= 0 && storeColIdx < cells.length) {
        storeName = (cells[storeColIdx] as HTMLElement).innerText.trim();
      }

      // 状态
      for (const kw of ['待下单', '待付款', '待支付', '已下单', '已完成', '已关闭', '处理中']) {
        if (text.includes(kw)) { status = kw; break; }
      }

      for (const cell of Array.from(cells)) {
        const ct = (cell as HTMLElement).innerText.trim();
        if (!orderNo && /^CG-\d{8}-\d+$/.test(ct)) orderNo = ct;
        if (!amount && /[¥￥][\d,.]+/.test(ct)) amount = ct;
        if (!amount && /^\d[\d,]*\.\d{2}$/.test(ct) && parseFloat(ct.replace(/,/g, '')) > 0) amount = ct;
      }

      if (!orderNo) {
        const links = row.querySelectorAll('a');
        for (const link of Array.from(links)) {
          const lt = (link as HTMLElement).innerText.trim();
          if (/^CG-\d{8}-\d+$/.test(lt)) { orderNo = lt; break; }
        }
      }

      if (!orderNo) continue;

      // 指定订单号过滤
      if (orderNos && orderNos.length > 0 && !orderNos.includes(orderNo)) continue;

      result.push({ orderNo, amount, status, storeName });
    }
    return result;
  }, { supplier: supplier || '', orderNos: orderNos || [] });
}

/** 批量下单：点击"批量下单" → 下拉菜单选"1688批量下单" → 确认 */
async function doPlaceOrder(page: Page): Promise<void> {
  // "批量下单"是 purchase-roo-btn 组件，内含 <span>批量下单 </span><i>图标</i>
  // Playwright locator 匹配不到，用 evaluate 直接点击
  const clicked = await page.evaluate(() => {
    const buttons = document.querySelectorAll('button');
    for (const btn of Array.from(buttons)) {
      const spans = btn.querySelectorAll(':scope > span > span');
      for (const span of Array.from(spans)) {
        if (span.textContent?.trim() === '批量下单') {
          (btn as HTMLElement).click();
          return true;
        }
      }
    }
    return false;
  });

  if (!clicked) {
    const allBtns = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button'))
        .map(b => b.textContent?.trim()).filter(t => t && t.length > 0 && t.length < 30),
    );
    throw new Error('未找到"批量下单"按钮，当前按钮: ' + JSON.stringify(allBtns));
  }

  log('  已点击"批量下单"');
  await waitForDropdownVisible(page);

  // 下拉菜单: purchase-roo-dropdown-menu
  const dropdown = page.locator('.purchase-roo-dropdown-menu:visible, .purchase-roo-drop-menu:visible');
  if (!(await dropdown.isVisible({ timeout: 3000 }).catch(() => false))) {
    throw new Error('"批量下单"点击后未出现下拉菜单');
  }

  const menuItems = await dropdown.locator('li').allInnerTexts().catch(() => [] as string[]);
  log('  下拉菜单选项: ' + JSON.stringify(menuItems));

  const ali1688Option = dropdown.locator('li').filter({ hasText: /1688/ }).first();
  if (!(await ali1688Option.isVisible({ timeout: 2000 }).catch(() => false))) {
    await page.keyboard.press('Escape');
    throw new Error('下拉菜单中未找到1688选项，当前选项: ' + JSON.stringify(menuItems));
  }

  await ali1688Option.click();
  log('  已选择"1688批量下单"');
  await waitForModalSettled(page);

  await handleConfirmDialog(page);
}

/** 通用批量操作：点击按钮 → 确认弹框 */
async function doBatchAction(page: Page, buttonText: string): Promise<void> {
  const btn = page.locator('button').filter({ hasText: buttonText }).first();
  if (!(await btn.isVisible({ timeout: 5000 }).catch(() => false))) {
    throw new Error('未找到"' + buttonText + '"按钮');
  }

  await btn.click();
  log('  已点击"' + buttonText + '"');
  await waitForModalSettled(page);

  await handleConfirmDialog(page);
}

/** 处理确认弹框 */
async function handleConfirmDialog(page: Page): Promise<void> {
  const modal = await getVisibleModal(page);
  if (!modal.visible) {
    await waitForModalSettled(page);
    return;
  }

  log('  弹窗: ' + modal.text.substring(0, 80));
  log('  按钮列表: ' + JSON.stringify(modal.buttons));

  const confirmAction = await clickModalAction(page, 'confirm');
  if (confirmAction.handled) {
    log('  已确认: ' + (confirmAction.clickedText || ''));
    return;
  }

  const destructiveAction = await clickModalAction(page, 'destructive');
  if (destructiveAction.handled) {
    log('  已点击破坏性按钮: ' + (destructiveAction.clickedText || ''));
    return;
  }

  throw new Error('批量操作确认弹窗存在但按钮不匹配；' + formatModalDiagnostics({
    modalText: modal.text,
    buttonTexts: modal.buttons,
    containerType: modal.containerType,
    matchedIntent: 'confirm',
  }));
}
