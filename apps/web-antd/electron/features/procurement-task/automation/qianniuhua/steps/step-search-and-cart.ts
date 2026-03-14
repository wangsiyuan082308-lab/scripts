/**
 * Step 1: 搜索供应商 → 加入补货清单 → 导出建议Excel → 进入补货清单页
 *
 * 合并原 step-export-advice + step-add-to-cart + step-go-to-cart
 * 独立运行: npx ts-node src/steps/step-search-and-cart.ts [--supplier 供应商]
 */
import { Page, Response } from 'playwright';
import { PurchaseConfig, loadConfig, parseCLI } from '../lib/config';
import { verifyTableRows, formatVerificationDiagnostics } from '../lib/supplier-verification';
import { StepResult, StepContext } from '../lib/types-v2';
import {
  clickModalAction,
  closeModals,
  getUrlParam,
  waitForModalSettled,
  waitForPageReady,
  searchSupplier,
  switchToMaxPerPage,
} from '../lib/page-helpers';
import { exportViaTaskCenter } from '../lib/task-center';
import { log } from '../lib/utils';
import { saveContext, loadContext, createEmptyContext } from '../lib/context';

interface TableVerificationResult {
  rowCount: number;
  mismatchedRows: string[];
  matchedRows: string[];
  ambiguousRows: string[];
  conflictingRows: string[];
  activeTab?: string;
}

interface CartSnapshot {
  url: string;
  rowCount: number;
  cartNos: string[];
  visibleTexts: string[];
  badgeTexts: string[];
  buttonTexts: string[];
  emptyHints: string[];
  toastTexts: string[];
  rowActionTexts: string[];
}

interface CartEntryCandidate {
  text: string;
  tag: string;
  className: string;
  clickable: boolean;
}

interface CartDetailFiltersSnapshot {
  labels: string[];
  placeholders: string[];
  selectedValues: string[];
  buttons: string[];
}

interface CartClearDiagnostics {
  rowCount: number;
  loadingVisible: boolean;
  confirmTexts: string[];
  buttonTexts: string[];
  emptyHints: string[];
  selectedValues: string[];
  rowActionTexts: string[];
  modalText?: string;
  modalButtonTexts?: string[];
  modalMatchedIntent?: string;
  modalClickedText?: string;
  modalContainerType?: string;
}

interface CartClearActionResult {
  strategy: 'bulk-clear' | 'bulk-remove' | 'row-action';
  triggerText: string;
}

function isCartClearAccepted(options: {
  initialRowCount: number;
  cleared: boolean;
  remainingRows: number;
  diagnostics: CartClearDiagnostics;
}): boolean {
  if (options.cleared || options.remainingRows === 0) {
    return true;
  }

  const hasClearButton = options.diagnostics.buttonTexts.some((text) => /清空商品清单|清空/.test(text));
  const hasRowActions = options.diagnostics.rowActionTexts.some((text) => /移出|删除/.test(text));
  const rowReduced = options.remainingRows < options.initialRowCount;

  return rowReduced && !hasClearButton && !hasRowActions;
}

interface CartMutationTrace {
  startedAt: number;
  listener?: (response: Response) => void | Promise<void>;
  responses: Array<{
    url: string;
    status: number;
    method: string;
    requestBody?: string;
    responseBody?: string;
  }>;
}

export async function stepSearchAndCart(
  page: Page, config: PurchaseConfig, ctx: StepContext,
): Promise<StepResult> {
  log('\n========== Step 1: 搜索 → 加购 → 导出 → 进入清单 ==========');

  try {
    ensureWorkflowRoute(page.url(), config, '当前页面');

    await preCleanSupplierCart(page, config, ctx.supplier);

    await closeModals(page);
    await page.goto(config.baseUrl + '/home.html#/purchase/replenishment/refer?fromTask=0', {
      waitUntil: 'networkidle', timeout: 30000,
    });
    await waitForPageReady(page);
    await closeModals(page);
    ensureWorkflowRoute(page.url(), config, '补货建议页');

    await assertAllowedActiveTab(page, config);
    await resetAndExpandFilters(page);

    await searchSupplier(page, ctx.supplier);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await closeModals(page);

    await applyRequiredSuggestionFilters(page, config);

    if (config.procurementRules.requireQueryAfterFilter) {
      await runQuery(page);
    }

    await switchToMaxPerPage(page);
    await page.waitForTimeout(2000);

    const searchVerification = await verifySupplierResults(page, config, ctx.supplier, '补货建议查询结果');
    ctx.validatedResultCount = searchVerification.rowCount;
    log('  筛选结果: ' + searchVerification.rowCount + ' 行');

    const cartMutation = startCartMutationTrace(page);
    await addToCart(page, config, ctx.supplier, cartMutation);
    await inspectCartEntryState(page);

    const filepath = await exportAdvice(page, config);
    ctx.adviceFile = filepath;

    await goToCart(page, config, ctx);
    if (!ctx.replenishListNo) {
      return {
        step: 'search-and-cart', success: false,
        message: '加购和导出成功，但无法找到活跃的补货清单',
      };
    }

    await switchToMaxPerPage(page);
    await page.waitForTimeout(2000);

    const cartVerification = await verifySupplierResults(page, config, ctx.supplier, '补货清单结果', {
      cartMode: true,
      enforceStatus: false,
    });
    ctx.validatedCartCount = cartVerification.rowCount;

    return {
      step: 'search-and-cart', success: true,
      message: '导出: ' + filepath + ', 清单: ' + ctx.replenishListNo + ', 校验结果行数: ' + cartVerification.rowCount,
    };
  } catch (e: any) {
    return { step: 'search-and-cart', success: false, message: e.message };
  }
}

async function resetAndExpandFilters(page: Page): Promise<void> {
  const resetBtn = page.locator('button').filter({ hasText: /重\s*置/ }).first();
  if (await resetBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await resetBtn.click();
    await page.waitForTimeout(2000);
    log('  已重置筛选条件');
  }

  const expandBtn = page.locator('button').filter({ hasText: '展开' }).first();
  if (await expandBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await expandBtn.click();
    await page.waitForTimeout(1000);
    log('  已展开筛选条件');
  }
}

async function runQuery(page: Page): Promise<void> {
  const queryBtn = page.locator('button').filter({ hasText: /查\s*询/ }).first();
  if (!await queryBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    throw new Error('强校验失败：要求筛选后必须查询，但未找到"查询"按钮');
  }
  await queryBtn.click();
  await page.waitForTimeout(5000);
  log('  已点击查询');
}

async function applyRequiredSuggestionFilters(page: Page, config: PurchaseConfig): Promise<void> {
  const filterNames = config.procurementRules.requiredSuggestionFilters || [];
  for (const filterName of filterNames) {
    const checkbox = page.getByRole('checkbox', { name: filterName });
    if (!await checkbox.isVisible({ timeout: 3000 }).catch(() => false)) {
      if (config.procurementRules.strict) {
        throw new Error('强校验失败：未找到必需筛选项 "' + filterName + '"');
      }
      log('  [弱校验] 未找到筛选项: ' + filterName);
      continue;
    }
    if (!(await checkbox.isChecked().catch(() => false))) {
      await checkbox.check({ timeout: 5000 });
      log('  已勾选"' + filterName + '"');
    }
  }

  const optionalFilters = ['可销天数低于到货天数'];
  for (const filterName of optionalFilters) {
    const checkbox = page.getByRole('checkbox', { name: filterName });
    if (await checkbox.isVisible({ timeout: 2000 }).catch(() => false)) {
      if (!(await checkbox.isChecked().catch(() => false))) {
        await checkbox.check({ timeout: 5000 });
        log('  已勾选"' + filterName + '"');
      }
    }
  }
}

async function verifySupplierResults(
  page: Page,
  config: PurchaseConfig,
  supplier: string,
  stage: string,
  options: { cartMode?: boolean; enforceStatus?: boolean } = {},
): Promise<TableVerificationResult> {
  const activeTab = await getActiveTab(page);

  if (config.procurementRules.allowedTabs.length > 0 && activeTab) {
    const allowed = config.procurementRules.allowedTabs.includes(activeTab);
    if (!allowed) {
      throw new Error(stage + ' 强校验失败：当前标签页为 [' + activeTab + ']，不在允许范围 [' + config.procurementRules.allowedTabs.join(', ') + ']');
    }
  }

  const verification = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('tbody tr'))
      .map((row) => ((row as HTMLElement).innerText || '').trim().replace(/\n/g, ' '))
      .filter((text) => Boolean(text));
  });

  const diagnostics = verifyTableRows({
    config,
    supplier,
    rows: verification,
    enforceStatus: options.enforceStatus ?? options.cartMode === true,
  });

  if (diagnostics.rowCount === 0) {
    throw new Error(stage + ' 为空，已按强校验停止，避免误采购');
  }

  if (config.procurementRules.requireResultVerification) {
    if (diagnostics.matchedRows.length === 0) {
      throw new Error(stage + ' 强校验失败：结果中未识别到目标供应商 [' + supplier + ']；' + formatVerificationDiagnostics(stage, diagnostics));
    }
    if (diagnostics.conflictingRows.length > 0 && config.procurementRules.stopOnSupplierMismatch) {
      throw new Error(stage + ' 强校验失败：发现 ' + diagnostics.conflictingRows.length + ' 行明确冲突数据，已停止；' + formatVerificationDiagnostics(stage, diagnostics));
    }
  }

  log('  ' + formatVerificationDiagnostics(stage, diagnostics));
  if (diagnostics.ambiguousRows.length > 0) {
    log('  [' + stage + '] 提示：发现 ' + diagnostics.ambiguousRows.length + ' 行信息不足，仅记录 warning');
  }

  return {
    rowCount: diagnostics.rowCount,
    mismatchedRows: [...diagnostics.ambiguousRows, ...diagnostics.conflictingRows].map((row) => row.text),
    matchedRows: diagnostics.matchedRows.map((row) => row.text),
    ambiguousRows: diagnostics.ambiguousRows.map((row) => row.text),
    conflictingRows: diagnostics.conflictingRows.map((row) => row.text),
    activeTab,
  };
}

async function getActiveTab(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const active = document.querySelector('[role="tab"][aria-selected="true"], .purchase-ant-tabs-tab-active');
    return (active as HTMLElement | null)?.innerText?.trim() || undefined;
  });
}

async function assertAllowedActiveTab(page: Page, config: PurchaseConfig): Promise<void> {
  const activeTab = await getActiveTab(page);
  if (!activeTab || config.procurementRules.allowedTabs.length === 0) return;
  if (!config.procurementRules.allowedTabs.includes(activeTab)) {
    throw new Error('强校验失败：当前页签 [' + activeTab + '] 不在允许采购页签 [' + config.procurementRules.allowedTabs.join(', ') + ']');
  }
  log('  当前页签: ' + activeTab);
}

function ensureWorkflowRoute(url: string, config: PurchaseConfig, scene: string): void {
  if (!url) return;
  const routes = config.procurementRules.allowedWorkflowRoutes || [];
  if (routes.length === 0) return;
  const matched = routes.some(route => url.includes(route));
  if (!matched && config.procurementRules.strict) {
    throw new Error(scene + ' 不在允许流程路由中: ' + url);
  }
}

async function preCleanSupplierCart(
  page: Page, config: PurchaseConfig, supplier: string,
): Promise<void> {
  log('  [预清理] 清空补货清单后再采购 (' + supplier + ')');

  await page.goto(
    config.baseUrl + '/home.html#/purchase/replenish-dispatch/detail-list?replenishMode=1',
    { waitUntil: 'networkidle', timeout: 30000 },
  ).catch(() => {});
  await waitForPageReady(page);
  await closeModals(page);
  ensureWorkflowRoute(page.url(), config, '补货清单预清理页');
  await inspectCartDetailFilters(page, '预清理页');

  const cartLink = page.locator('a, td').filter({ hasText: /BHQD-/ }).first();
  if (await cartLink.isVisible({ timeout: 5000 }).catch(() => false)) {
    await cartLink.click();
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    await waitForPageReady(page);
    await closeModals(page);
  }

  const rowCount = await page.locator('tbody tr').count();
  if (rowCount === 0) {
    log('  [预清理] 当前补货清单为空，跳过');
    return;
  }

  const initialRowCount = rowCount;
  log('  [预清理] 当前补货清单有 ' + rowCount + ' 行，开始整单清空');
  await inspectCartDetailFilters(page, '预清理执行前');

  const selectAll = page.locator(
    'thead .purchase-ant-checkbox-input, thead input[type="checkbox"]',
  ).first();
  const selectAllVisible = await selectAll.isVisible({ timeout: 3000 }).catch(() => false);
  const selectAllEnabled = selectAllVisible
    ? await selectAll.isEnabled({ timeout: 1000 }).catch(() => false)
    : false;
  if (selectAllVisible && selectAllEnabled) {
    await selectAll.click();
    await page.waitForTimeout(1000);
    log('  [预清理] 已勾选表头全选');
  } else if (selectAllVisible) {
    log('  [预清理] 表头全选框不可用，跳过全选，继续尝试整单清空');
  }

  const action = await triggerCartClearAction(page);
  if (!action) {
    const diagnostics = await captureCartClearDiagnostics(page);
    log('  [预清理] 未找到移出/清空按钮，按当前无待清理项继续: ' + JSON.stringify(diagnostics));
    return;
  }
  log('  [预清理] 已执行清空策略: ' + action.strategy + ' -> ' + action.triggerText);

  const modalAction = await clickModalAction(page, 'destructive');
  if (!modalAction.handled) {
    const diagnostics = await captureCartClearDiagnostics(page, modalAction);
    throw new Error('预清理失败：弹窗存在但未匹配到破坏性按钮；' + JSON.stringify(diagnostics));
  }
  log('  [预清理] 已点击弹窗按钮: ' + (modalAction.clickedText || ''));

  const cleared = await waitForCartCleared(page);
  await closeModals(page);
  const remainingRows = await page.locator('tbody tr').count().catch(() => 0);
  const diagnostics = await captureCartClearDiagnostics(page);
  log('  [预清理] 清理后诊断: ' + JSON.stringify(diagnostics));

  const accepted = isCartClearAccepted({
    initialRowCount,
    cleared,
    remainingRows,
    diagnostics,
  });

  if (!accepted) {
    throw new Error('预清理失败：清空后仍有 ' + remainingRows + ' 行；' + JSON.stringify(diagnostics));
  }

  if (!cleared && remainingRows > 0) {
    log('  [预清理] 清空后行数由 ' + initialRowCount + ' 降至 ' + remainingRows + '，且页面已退出清空态，按业务成功继续');
    return;
  }

  log('  [预清理] 清理完成，剩余 0 行');
}

async function triggerCartClearAction(page: Page): Promise<CartClearActionResult | null> {
  const clearBtn = page.locator('button').filter({ hasText: /清空商品清单|清空/ }).first();
  if (await clearBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    const triggerText = (await clearBtn.innerText().catch(() => '清空商品清单')).replace(/\s+/g, ' ').trim();
    await clearBtn.click();
    return { strategy: 'bulk-clear', triggerText };
  }

  const removeBtn = page.locator('button').filter({ hasText: /移出|删除/ }).first();
  if (await removeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    const triggerText = (await removeBtn.innerText().catch(() => '移出')).replace(/\s+/g, ' ').trim();
    await removeBtn.click();
    return { strategy: 'bulk-remove', triggerText };
  }

  const rowActionBtn = page.locator('tbody tr button, tbody tr [role="button"], tbody tr a').filter({ hasText: /移出|删除/ }).first();
  if (await rowActionBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    const triggerText = (await rowActionBtn.innerText().catch(() => '移出')).replace(/\s+/g, ' ').trim();
    await rowActionBtn.click();
    return { strategy: 'row-action', triggerText };
  }

  return null;
}

async function waitForCartCleared(page: Page): Promise<boolean> {
  const rowLocator = page.locator('tbody tr');
  const emptyHintLocator = page.locator('text=/暂无数据|暂无商品|暂无结果|空空如也|没有商品|无商品|未查询到数据/').first();

  for (let i = 0; i < 8; i++) {
    await waitForModalSettled(page);

    const rowCount = await rowLocator.count().catch(() => 0);
    const hasEmptyHint = await emptyHintLocator.isVisible({ timeout: 500 }).catch(() => false);
    const loadingVisible = await isCartListLoading(page);
    log('  [预清理] 等待清空结果: rowCount=' + rowCount + ', loading=' + loadingVisible + ', emptyHint=' + hasEmptyHint);

    if (rowCount === 0 || hasEmptyHint) {
      return true;
    }

    if (!loadingVisible) {
      const settledRows = await rowLocator.count().catch(() => 0);
      if (settledRows !== rowCount) {
        continue;
      }
    }
  }

  return false;
}

async function isCartListLoading(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const selectors = [
      '.purchase-ant-spin-spinning',
      '.purchase-ant-table-placeholder .purchase-ant-spin-spinning',
      '.purchase-ant-spin-dot',
      '.purchase-ant-spin',
      '.purchase-ant-table-loading',
    ];

    return selectors.some((selector) => {
      return Array.from(document.querySelectorAll(selector)).some((node) => {
        const style = window.getComputedStyle(node as Element);
        return style.display !== 'none' && style.visibility !== 'hidden';
      });
    });
  }).catch(() => false);
}

async function captureCartClearDiagnostics(
  page: Page,
  modalAction?: {
    modalText?: string;
    buttonTexts?: string[];
    matchedIntent?: string;
    clickedText?: string;
    containerType?: string;
  },
): Promise<CartClearDiagnostics> {
  const filters = await captureCartDetailFilters(page);
  const snapshot = await captureCartSnapshot(page);
  const loadingVisible = await isCartListLoading(page);
  const confirmTexts = await page.locator(
    '.purchase-ant-modal button, .purchase-ant-popover button, [role="dialog"] button',
  ).evaluateAll((nodes) => {
    return nodes
      .map((node) => ((node as HTMLElement).innerText || node.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 8);
  }).catch(() => [] as string[]);

  return {
    rowCount: snapshot.rowCount,
    loadingVisible,
    confirmTexts,
    buttonTexts: filters.buttons,
    emptyHints: snapshot.emptyHints,
    selectedValues: filters.selectedValues,
    rowActionTexts: snapshot.rowActionTexts,
    modalText: modalAction?.modalText,
    modalButtonTexts: modalAction?.buttonTexts,
    modalMatchedIntent: modalAction?.matchedIntent,
    modalClickedText: modalAction?.clickedText,
    modalContainerType: modalAction?.containerType,
  };
}

async function addToCart(page: Page, config: PurchaseConfig, supplier: string, trace?: CartMutationTrace): Promise<void> {
  log('  [加购] 加入补货清单');
  await closeModals(page);

  await verifySupplierResults(page, config, supplier, '加购前结果归属校验');

  const maxItems = config.maxItems;
  const needSelect = maxItems > 0 && maxItems < 500;

  if (needSelect) {
    log('  maxItems=' + maxItems + '，先全选再走"已选商品"路径');
    const selectAll = page.locator(
      'table thead .purchase-ant-checkbox-input, table thead input[type="checkbox"]',
    ).first();
    if (await selectAll.isVisible({ timeout: 5000 }).catch(() => false)) {
      await selectAll.click();
      await page.waitForTimeout(1000);
      log('  已全选勾选');
    }
  }

  const addBtn = page.locator('button').filter({ hasText: '加入补货清单' }).first();
  if (!await addBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    throw new Error('未找到"加入补货清单"按钮');
  }
  await addBtn.click();
  await page.waitForTimeout(1500);
  log('  已点击"加入补货清单"下拉');

  const menuItems = page.locator(
    '.purchase-ant-dropdown:visible [role="menuitem"], ' +
    '.purchase-ant-dropdown-menu:visible li, ' +
    '[role="menu"]:visible [role="menuitem"]',
  );
  await page.waitForTimeout(1000);

  const menuTexts = await menuItems.evaluateAll((nodes) => {
    return nodes
      .map((node) => (node.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }).catch(() => [] as string[]);
  if (menuTexts.length > 0) {
    log('  下拉选项: ' + menuTexts.join(' | '));
  }

  if (needSelect) {
    const selectedOption = menuItems.filter({ hasText: /已选商品/ }).first();
    if (!await selectedOption.isVisible({ timeout: 5000 }).catch(() => false)) {
      throw new Error('下拉菜单中未找到"已选商品"选项' + (menuTexts.length > 0 ? '，实际选项: ' + menuTexts.join(' | ') : ''));
    }
    await selectedOption.click();
    await page.waitForTimeout(3000);
    log('  已选择"已选商品"');
  } else {
    let searchResultOption = menuItems.filter({ hasText: /搜索结果/ }).first();
    if (!await searchResultOption.isVisible({ timeout: 5000 }).catch(() => false)) {
      searchResultOption = menuItems.filter({ hasText: /前500/ }).first();
    }
    if (!await searchResultOption.isVisible({ timeout: 3000 }).catch(() => false)) {
      throw new Error('下拉菜单中未找到"搜索结果"选项' + (menuTexts.length > 0 ? '，实际选项: ' + menuTexts.join(' | ') : ''));
    }
    const optionText = await searchResultOption.innerText().catch(() => '');
    await searchResultOption.click();
    await page.waitForTimeout(3000);
    log('  已选择: ' + optionText.trim());
  }

  await closeModals(page);
  if (trace) {
    await flushCartMutationTrace(page, trace, '加入补货清单后');
  }
  await logCartActionFeedback(page, '加入补货清单后');
  log('  加入补货清单完成');
}

async function flushCartMutationTrace(page: Page, trace: CartMutationTrace, stage: string): Promise<void> {
  if (trace.listener) {
    page.off('response', trace.listener);
  }

  const startedAt = trace.startedAt;
  await page.waitForTimeout(2000);

  const relevant = trace.responses
    .filter((item) => /replenish|dispatch|cart|购物车|补货清单|queryTasks/i.test(item.url + ' ' + (item.requestBody || '') + ' ' + (item.responseBody || '')))
    .slice(-8);

  if (relevant.length === 0) {
    log('  [' + stage + '] 未捕获到补货清单相关接口响应');
    return;
  }

  log('  [' + stage + '] 接口追踪(开始于 ' + new Date(startedAt).toISOString() + '): ' + JSON.stringify(relevant));
}

function startCartMutationTrace(page: Page): CartMutationTrace {
  const trace: CartMutationTrace = {
    startedAt: Date.now(),
    responses: [],
  };

  const listener = async (response: Response) => {
    const url = response.url();
    if (!/api|replenish|dispatch|task/i.test(url)) return;

    const request = response.request();
    const method = request.method();
    let requestBody = request.postData() || '';
    if (requestBody.length > 400) requestBody = requestBody.slice(0, 400);

    let responseBody = '';
    const contentType = response.headers()['content-type'] || '';
    if (/json|text/i.test(contentType)) {
      responseBody = await response.text().catch(() => '');
      if (responseBody.length > 800) responseBody = responseBody.slice(0, 800);
    }

    trace.responses.push({
      url,
      status: response.status(),
      method,
      requestBody,
      responseBody,
    });

    if (trace.responses.length > 40) {
      trace.responses.shift();
    }
  };

  trace.listener = listener;
  page.on('response', listener);
  return trace;
}

async function logCartActionFeedback(page: Page, stage: string): Promise<void> {
  const snapshot = await captureCartSnapshot(page);
  log('  [' + stage + '] 页面快照: ' + JSON.stringify({
    url: snapshot.url,
    rowCount: snapshot.rowCount,
    cartNos: snapshot.cartNos,
    badgeTexts: snapshot.badgeTexts,
    buttonTexts: snapshot.buttonTexts,
    emptyHints: snapshot.emptyHints,
    toastTexts: snapshot.toastTexts,
  }));
}

async function inspectCartEntryState(page: Page): Promise<void> {
  const snapshot = await captureCartSnapshot(page);
  const hasCartEntry = snapshot.cartNos.length > 0 || snapshot.badgeTexts.some((text) => text.includes('补货清单'));
  const hasEmptyHint = snapshot.emptyHints.length > 0;

  log('  [清单入口诊断] ' + JSON.stringify({
    url: snapshot.url,
    rowCount: snapshot.rowCount,
    hasCartEntry,
    hasEmptyHint,
    cartNos: snapshot.cartNos,
    emptyHints: snapshot.emptyHints,
    badgeTexts: snapshot.badgeTexts,
    rowActionTexts: snapshot.rowActionTexts,
    toastTexts: snapshot.toastTexts,
  }));
}

async function inspectCartDetailFilters(page: Page, stage: string): Promise<void> {
  const filters = await captureCartDetailFilters(page);
  if (filters.labels.length === 0 && filters.placeholders.length === 0 && filters.selectedValues.length === 0) {
    log('  [' + stage + '] 未识别到清单详情筛选区');
    return;
  }

  log('  [' + stage + '] 清单筛选诊断: ' + JSON.stringify(filters));
}

async function captureCartDetailFilters(page: Page): Promise<CartDetailFiltersSnapshot> {
  return page.evaluate(() => {
    const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
    const unique = (items: string[], text: string, max = 12) => {
      const value = normalize(text);
      if (!value || items.includes(value) || items.length >= max) return;
      items.push(value);
    };

    const labels: string[] = [];
    const placeholders: string[] = [];
    const selectedValues: string[] = [];
    const buttons: string[] = [];

    const formItemLabels = Array.from(document.querySelectorAll('.purchase-ant-form-item-label')) as HTMLElement[];
    formItemLabels.forEach((node) => unique(labels, node.innerText || node.textContent || '', 20));

    const inputs = Array.from(document.querySelectorAll('input, textarea, .purchase-ant-select-selector')) as HTMLElement[];
    for (const node of inputs) {
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      unique(placeholders, node.getAttribute('placeholder') || '', 20);
      unique(selectedValues, node.textContent || '', 20);
      unique(selectedValues, (node as HTMLInputElement).value || '', 20);
    }

    const buttonNodes = Array.from(document.querySelectorAll('button')) as HTMLElement[];
    buttonNodes.forEach((node) => unique(buttons, node.innerText || node.textContent || '', 20));

    return { labels, placeholders, selectedValues, buttons };
  });
}

async function captureCartSnapshot(page: Page): Promise<CartSnapshot> {
  return page.evaluate(() => {
    const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
    const pushUnique = (items: string[], text: string, max = 8) => {
      const normalized = normalize(text);
      if (!normalized || items.includes(normalized) || items.length >= max) return;
      items.push(normalized);
    };

    const visibleTexts: string[] = [];
    const badgeTexts: string[] = [];
    const buttonTexts: string[] = [];
    const emptyHints: string[] = [];
    const toastTexts: string[] = [];
    const rowActionTexts: string[] = [];
    const cartNos: string[] = [];

    const allNodes = Array.from(document.querySelectorAll('body *')) as HTMLElement[];
    for (const node of allNodes) {
      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const text = normalize(node.innerText || node.textContent || '');
      if (!text) continue;

      if (node.matches('button')) pushUnique(buttonTexts, text, 12);
      if (node.matches('tbody tr button, tbody tr [role="button"], tbody tr a') && /移出|删除/.test(text)) {
        pushUnique(rowActionTexts, text, 12);
      }
      if (node.className && String(node.className).includes('badge')) pushUnique(badgeTexts, text, 12);
      if (/BHQD-/.test(text)) pushUnique(cartNos, text, 8);
      if (/加入成功|添加成功|成功加入|已加入|加入补货清单/.test(text)) pushUnique(toastTexts, text, 8);
      if (/暂无数据|暂无商品|暂无结果|空空如也|没有商品|无商品|未查询到数据/.test(text)) pushUnique(emptyHints, text, 8);
      if (visibleTexts.length < 12) pushUnique(visibleTexts, text, 12);
    }

    const rowCount = document.querySelectorAll('tbody tr').length;
    return {
      url: location.hash || location.href,
      rowCount,
      cartNos,
      visibleTexts,
      badgeTexts,
      buttonTexts,
      emptyHints,
      toastTexts,
      rowActionTexts,
    };
  });
}

async function captureCartEntryCandidates(page: Page): Promise<CartEntryCandidate[]> {
  return page.evaluate(() => {
    const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
    const nodes = Array.from(document.querySelectorAll('button, a, span, div')) as HTMLElement[];
    const candidates: CartEntryCandidate[] = [];

    for (const node of nodes) {
      const text = normalize(node.innerText || node.textContent || '');
      if (!/补货清单/.test(text)) continue;
      if (/加入补货清单|从补货清单移除/.test(text)) continue;

      const style = window.getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const rect = node.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;

      const clickable =
        node.tagName === 'BUTTON'
        || node.tagName === 'A'
        || node.getAttribute('role') === 'button'
        || typeof node.onclick === 'function'
        || node.closest('button, a, [role="button"]') !== null;

      const className = String(node.className || '').replace(/\s+/g, ' ').trim();
      const summary = {
        text,
        tag: node.tagName.toLowerCase(),
        className,
        clickable,
      };

      if (!candidates.some((item) => item.text === summary.text && item.tag === summary.tag && item.className === summary.className)) {
        candidates.push(summary);
      }

      if (candidates.length >= 12) break;
    }

    return candidates;
  });
}

async function clickCurrentCartEntry(page: Page): Promise<string> {
  const candidateLocators = [
    page.locator('button, a').filter({ hasText: /^补货清单\s*(\d+|99\+)$/ }).first(),
    page.locator('[role="button"]').filter({ hasText: /^补货清单\s*(\d+|99\+)$/ }).first(),
    page.locator('.purchase-ant-badge').filter({ hasText: /补货清单\s*(\d+|99\+)/ }).first(),
    page.locator('button, a, span, div').filter({ hasText: /^补货清单$/ }).first(),
  ];

  for (const locator of candidateLocators) {
    if (!await locator.isVisible({ timeout: 1000 }).catch(() => false)) continue;

    const target = await locator.evaluateHandle((node) => {
      const pickClickable = (element: HTMLElement | null): HTMLElement | null => {
        let current: HTMLElement | null = element;
        while (current) {
          const role = current.getAttribute('role');
          if (current.tagName === 'BUTTON' || current.tagName === 'A' || role === 'button' || typeof current.onclick === 'function') {
            return current;
          }
          current = current.parentElement;
        }
        return element;
      };
      return pickClickable(node as HTMLElement);
    }).catch(() => null as any);

    if (!target) continue;

    const element = target.asElement();
    if (!element) continue;

    const entryText = await element.innerText().catch(() => '').then((text) => text.replace(/\s+/g, ' ').trim());
    await element.click({ timeout: 5000 }).catch(async () => {
      await locator.click({ timeout: 5000 });
    });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
    return entryText || '补货清单';
  }

  return '';
}

async function exportAdvice(page: Page, config: PurchaseConfig): Promise<string> {
  log('  [导出] 导出建议Excel');

  const exportBtn = page.locator('button').filter({ hasText: /导\s*出/ }).first();
  if (!await exportBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    throw new Error('未找到导出按钮');
  }
  if (!await exportBtn.isEnabled({ timeout: 3000 }).catch(() => false)) {
    throw new Error('导出按钮处于禁用状态');
  }

  const filepath = await exportViaTaskCenter(
    page,
    async () => {
      await exportBtn.click();
      log('  已点击导出按钮');
    },
    config.taskCenter.adviceExportQueryType,
    { exportPollInterval: config.timeouts.exportPollInterval, exportMaxWait: config.timeouts.exportMaxWait },
  );

  log('  导出成功: ' + filepath);
  return filepath;
}

async function goToCart(page: Page, config: PurchaseConfig, ctx: StepContext): Promise<void> {
  log('  [清单] 进入补货清单页');
  await closeModals(page);
  await logCartActionFeedback(page, '进入补货清单前');

  const entryCandidates = await captureCartEntryCandidates(page);
  if (entryCandidates.length > 0) {
    log('  [清单] 候选入口: ' + entryCandidates.map((item) => {
      const parts = [item.text, item.tag];
      if (item.clickable) parts.push('clickable');
      if (item.className) parts.push(item.className);
      return parts.join(' | ');
    }).join(' || '));
  }

  const clickedEntryText = await clickCurrentCartEntry(page);
  if (clickedEntryText) {
    log('  已点击优先入口: ' + clickedEntryText);
  } else {
    const cartBtn = page.locator('button[class*="commonAddToReplenishList"]').first();
    if (await cartBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await cartBtn.click();
      await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
      log('  已点击"补货清单"');
    } else {
      const badgeBtn = page.locator('span.purchase-ant-badge').filter({ hasText: '补货清单' }).first();
      if (await badgeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await badgeBtn.click();
        await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        log('  已点击"补货清单"(badge)');
      } else {
        log('  未找到"补货清单"按钮');
      }
    }
  }

  await waitForPageReady(page);
  await closeModals(page);
  ensureWorkflowRoute(page.url(), config, '进入补货清单');
  await logCartActionFeedback(page, '进入补货清单后');

  let replenishListNo = getUrlParam(page.url(), 'replenishListNo');
  await inspectCartDetailFilters(page, '进入补货清单后');

  if (!replenishListNo) {
    log('  补货清单编号为空，尝试从列表页选择最新清单');

    const snapshot = await captureCartSnapshot(page);
    log('  当前页面: ' + JSON.stringify({
      url: snapshot.url,
      rows: snapshot.rowCount,
      cartNos: snapshot.cartNos,
      emptyHints: snapshot.emptyHints,
      badgeTexts: snapshot.badgeTexts,
    }));

    const cartLink = page.locator('a, td').filter({ hasText: /BHQD-/ }).first();
    if (await cartLink.isVisible({ timeout: 5000 }).catch(() => false)) {
      await cartLink.click();
      await page.waitForTimeout(3000);
      await waitForPageReady(page);
      replenishListNo = getUrlParam(page.url(), 'replenishListNo');
      if (replenishListNo) log('  从列表选择了清单: ' + replenishListNo);
    }

    if (!replenishListNo) {
      const cartPageUrl = config.baseUrl + '/home.html#/purchase/replenish-dispatch/detail-list?replenishMode=1';
      await page.goto(cartPageUrl, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
      await waitForPageReady(page);
      await closeModals(page);
      await logCartActionFeedback(page, '直接导航补货清单页后');
      replenishListNo = getUrlParam(page.url(), 'replenishListNo');
      if (replenishListNo) log('  直接导航获取清单: ' + replenishListNo);
    }
  }

  if (replenishListNo) {
    try {
      await verifySupplierResults(page, config, ctx.supplier, '补货清单初次定位校验', {
        cartMode: true,
        enforceStatus: false,
      });
    } catch (error: any) {
      const snapshot = await captureCartSnapshot(page);
      log('  [清单] 初次进入的补货清单与目标供应商不一致，尝试重新定位: ' + error.message);
      log('  [清单] 不一致时页面快照: ' + JSON.stringify({
        url: snapshot.url,
        rowCount: snapshot.rowCount,
        cartNos: snapshot.cartNos,
        emptyHints: snapshot.emptyHints,
        toastTexts: snapshot.toastTexts,
        visibleTexts: snapshot.visibleTexts.slice(0, 6),
      }));
      const recoveredListNo = await recoverSupplierCart(page, config, ctx.supplier);
      if (recoveredListNo) {
        replenishListNo = recoveredListNo;
        log('  [清单] 已重新定位到供应商清单: ' + recoveredListNo);
      }
    }
  }

  log('  补货清单编号: ' + (replenishListNo || '(空)'));
  ctx.replenishListNo = replenishListNo;
}

async function recoverSupplierCart(page: Page, config: PurchaseConfig, supplier: string): Promise<string> {
  const cartPageUrl = config.baseUrl + '/home.html#/purchase/replenish-dispatch/detail-list?replenishMode=1';
  await page.goto(cartPageUrl, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await waitForPageReady(page);
  await closeModals(page);
  ensureWorkflowRoute(page.url(), config, '补货清单恢复定位');

  try {
    await searchSupplier(page, supplier);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await closeModals(page);
    if (config.procurementRules.requireQueryAfterFilter) {
      await runQuery(page);
    }
    await switchToMaxPerPage(page);
    await page.waitForTimeout(2000);
  } catch (error: any) {
    log('  [清单恢复] 当前页不支持按供应商筛选: ' + error.message);
  }

  let replenishListNo = getUrlParam(page.url(), 'replenishListNo');
  if (replenishListNo) {
    try {
      await verifySupplierResults(page, config, supplier, '补货清单恢复校验', {
        cartMode: true,
        enforceStatus: false,
      });
      return replenishListNo;
    } catch (error: any) {
      log('  [清单恢复] 当前详情页仍不匹配目标供应商: ' + error.message);
    }
  }

  const snapshot = await captureCartSnapshot(page);
  await inspectCartDetailFilters(page, '清单恢复页');
  log('  [清单恢复] 页面信息: ' + JSON.stringify({
    url: snapshot.url,
    rows: snapshot.visibleTexts.slice(0, 5),
    cartNos: snapshot.cartNos,
    emptyHints: snapshot.emptyHints,
    toastTexts: snapshot.toastTexts,
  }));

  const cartLink = page.locator('a, td').filter({ hasText: /BHQD-/ }).first();
  if (!await cartLink.isVisible({ timeout: 5000 }).catch(() => false)) {
    return '';
  }

  await cartLink.click();
  await page.waitForTimeout(3000);
  await waitForPageReady(page);
  await closeModals(page);
  replenishListNo = getUrlParam(page.url(), 'replenishListNo');
  return replenishListNo;
}

if (require.main === module) {
  const { overrides } = parseCLI();
  const config = loadConfig(overrides);
  const ctx = loadContext() || createEmptyContext(config.supplier);

  (async () => {
    const { launchBrowser } = await import('../lib/browser');
    const { ensureLogin } = await import('../lib/page-helpers');

    const { context, page } = await launchBrowser();
    const targetUrl = config.baseUrl + '/home.html#/purchase/replenishment/refer?fromTask=0';
    await ensureLogin(page, targetUrl, config.timeouts.loginWait);

    try {
      const result = await stepSearchAndCart(page, config, ctx);
      log('\n结果: ' + JSON.stringify(result));
      if (result.success) saveContext(ctx);
    } finally {
      await context.close();
    }
  })().catch(e => { log('ERROR: ' + e.message); process.exit(1); });
}
