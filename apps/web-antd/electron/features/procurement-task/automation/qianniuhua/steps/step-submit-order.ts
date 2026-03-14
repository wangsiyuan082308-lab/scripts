/**
 * Step 5: 提交采购订单
 *
 * 流程：去补货 → 生成单据 → 确认二次弹框 → 采购单列表 → 搜索待下单
 *      → 批量确认下单 → 等1688处理 → 对比金额（异常则通知人员确认）
 */
import { Page, Response } from 'playwright';
import { PurchaseConfig, getSupplierAliases } from '../lib/config';
import { verifyTableRows, formatVerificationDiagnostics } from '../lib/supplier-verification';
import { StepResult, StepContext } from '../lib/types-v2';
import {
  clickModalAction,
  closeModals,
  formatModalDiagnostics,
  getVisibleModal,
  waitForButtonLoading,
  waitForModalSettled,
  waitForPageReady,
} from '../lib/page-helpers';
import { executeOrderAction } from '../lib/order-actions';
import { log } from '../lib/utils';
import { sendOrderConfirmNotification } from '../lib/notify';

interface PendingOrder {
  orderNo: string;
  amount: string;
  itemCount: string;
  storeName: string;
  status?: string;
}

interface CartApiTrace {
  url: string;
  status: number;
  method: string;
  requestBody?: string;
  responseBody?: string;
}

interface CartApiTraceContext {
  responses: CartApiTrace[];
  listener?: (response: Response) => void;
}

interface CartApiEvidence {
  matchedResponses: CartApiTrace[];
  itemCount: number;
  supplierHits: number;
  replenishListHits: number;
  hasNonEmptyList: boolean;
  hasTargetSupplierEvidence: boolean;
}

interface GoReplenishApiEvidence {
  matchedResponses: CartApiTrace[];
  previewNo?: string;
  replenishPreviewOrderNo?: string;
  routeHit: boolean;
}

interface SubmitModalDiagnostics {
  modalText: string;
  buttonTexts: string[];
  containerType?: string;
  matchedIntent?: string;
  clickedText?: string;
}

interface OrderAmountInfo {
  orderNo: string;
  qnhAmount: number;
  aliAmount: number;
  diff: number;
  diffPercent: number;
  abnormal: boolean;
}

export async function stepSubmitOrder(
  page: Page,
  config: PurchaseConfig,
  ctx: StepContext,
): Promise<StepResult> {
  const stepName = 'submit-order';

  try {
    ensureWorkflowRoute(page.url(), config, '提交订单前');
    const beforeGenerateTime = new Date();

    if (ctx.confirmOnly) {
      log('  [submit] confirmOnly 模式，跳过生成单据');
      await page.goto(config.baseUrl + '/home.html#/purchase/purchase-order/list', {
        waitUntil: 'networkidle', timeout: 30000,
      }).catch(() => {});
      await waitForPageReady(page);
      await closeModals(page);
    } else {
      if (!ctx.replenishListNo) {
        throw new Error('强校验失败：缺少 replenishListNo，不能直接进入建单');
      }

      const cartUrl = config.baseUrl + '/home.html#/purchase/replenish-dispatch/detail-list?replenishListNo=' + ctx.replenishListNo + '&replenishMode=1';
      const currentUrl = page.url();
      if (!currentUrl.includes('detail-list') || !currentUrl.includes(ctx.replenishListNo)) {
        await page.goto(cartUrl, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
        await waitForPageReady(page);
        await closeModals(page);
      }

      ensureWorkflowRoute(page.url(), config, '补货清单建单前');
      const cartTrace = startCartApiTrace(page);
      await assertCartReadyForOrder(page, config, ctx, cartTrace);
      await flushCartApiTrace(page, cartTrace, '补货清单建单前校验');
      await goReplenish(page, ctx);
      await generateOrder(page, config);

      await page.waitForTimeout(3000);
      await waitForPageReady(page);
      await closeModals(page);

      const currentAfterGenerateUrl = page.url();
      if (!currentAfterGenerateUrl.includes('/purchase/order') && !currentAfterGenerateUrl.includes('purchase-order')) {
        log('  未自动跳转到采购单列表，手动导航');
        await page.goto(config.baseUrl + '/home.html#/purchase/purchase-order/list', {
          waitUntil: 'networkidle', timeout: 30000,
        }).catch(() => {});
        await waitForPageReady(page);
        await closeModals(page);
      }
    }

    ensureWorkflowRoute(page.url(), config, '采购单列表页');

    const orderPageInfo = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'))
        .map(b => b.textContent?.trim()).filter(t => t && t.length < 20);
      const tabs = Array.from(document.querySelectorAll('[role="tab"], .purchase-ant-tabs-tab'))
        .map(t => (t as HTMLElement).innerText.trim()).filter(t => t.length < 30);
      const rowCount = document.querySelectorAll('table tbody tr').length;
      return JSON.stringify({ url: location.hash.substring(0, 60), buttons: buttons.slice(0, 15), tabs, rowCount });
    });
    log('  采购单列表页信息: ' + orderPageInfo);

    const timeFilter = ctx.confirmOnly ? undefined : beforeGenerateTime;
    let generatedOrders: PendingOrder[] = [];
    for (let retry = 0; retry < 3; retry++) {
      generatedOrders = await searchPendingOrders(page, config, config.supplier, timeFilter, config.procurementRules.allowedOrderStatuses);
      if (generatedOrders.length > 0) break;
      if (retry < 2) {
        log('  未找到【已生成待下单】采购单，等待5秒后重试... (' + (retry + 1) + '/3)');
        await page.waitForTimeout(5000);
        await page.reload({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
        await waitForPageReady(page);
        await closeModals(page);
      }
    }

    const manualSubmittedOrders = await searchPendingOrders(
      page,
      config,
      config.supplier,
      timeFilter,
      config.procurementRules.allowedManualSubmittedStatuses,
    );

    log('  状态归类：已生成待下单=' + generatedOrders.length + '，已手动下单待付款=' + manualSubmittedOrders.length);

    if (generatedOrders.length === 0) {
      if (manualSubmittedOrders.length > 0) {
        log('  检测到采购单处于【已手动下单待付款】状态，该状态不计入生成阶段成功');
        manualSubmittedOrders.forEach((o, i) => {
          log('    [已手动下单待付款] ' + (i + 1) + '. ' + o.orderNo + ' | ' + o.amount + ' | ' + o.itemCount + '种 | ' + (o.storeName || '-') + ' | 状态:' + (o.status || '-'));
        });
      }
      return {
        step: stepName,
        success: false,
        message: manualSubmittedOrders.length > 0
          ? '未找到已生成待下单采购单（仅检测到待付款/待支付，属于手动下单后状态）'
          : '未找到已生成待下单采购单',
      };
    }

    assertOrderStatuses(generatedOrders, config.procurementRules.allowedOrderStatuses, '待下单采购单校验');

    const pendingOrders = generatedOrders;
    log('  找到 ' + pendingOrders.length + ' 个【已生成待下单】采购单');
    pendingOrders.forEach((o, i) => {
      log('    [已生成待下单] ' + (i + 1) + '. ' + o.orderNo + ' | ' + o.amount + ' | ' + o.itemCount + '种 | ' + (o.storeName || '-') + ' | 状态:' + (o.status || '-'));
    });

    const qnhTotalAmount = pendingOrders.reduce(
      (sum, o) => sum + (parseFloat(o.amount.replace(/[^0-9.]/g, '')) || 0),
      0,
    );
    ctx.totalAmount = qnhTotalAmount;
    ctx.totalItems = pendingOrders.reduce((sum, o) => sum + (parseInt(o.itemCount) || 0), 0);

    const actionResult = await executeOrderAction(page, {
      action: 'place-order',
      baseUrl: config.baseUrl,
      supplier: config.supplier,
      status: config.procurementRules.allowedOrderStatuses[0] || '待下单',
      orderNos: pendingOrders.map(order => order.orderNo).filter(Boolean),
    });
    if (!actionResult.success) {
      throw new Error('批量下单失败: ' + actionResult.message);
    }

    const waitSec = Math.round(config.timeouts.orderProcessWait / 1000);
    log('  等待 ' + waitSec + ' 秒让1688处理...');
    await page.waitForTimeout(config.timeouts.orderProcessWait);

    await page.reload({ waitUntil: 'networkidle', timeout: 30000 });
    await waitForPageReady(page);
    await closeModals(page);

    const amountInfos = await compareAmounts(page, pendingOrders, qnhTotalAmount);
    const abnormals = amountInfos.filter(a => a.abnormal);

    if (abnormals.length > 0) {
      log('  金额异常! ' + abnormals.length + ' 个订单需要人工确认');
      abnormals.forEach(a => {
        log('    单号' + a.orderNo + ': 牵牛花¥' + a.qnhAmount.toFixed(2) +
          ' vs 1688¥' + a.aliAmount.toFixed(2) +
          ' (差' + a.diffPercent.toFixed(0) + '%, ¥' + a.diff.toFixed(2) + ')');
      });

      if (config.notification.webhook) {
        await sendOrderConfirmNotification({
          supplier: config.supplier,
          orders: pendingOrders,
          abnormals,
          webhookUrl: config.notification.webhook,
        });
      }

      return {
        step: stepName,
        success: false,
        message: `金额异常，${abnormals.length} 个订单需人工确认（差异>50%或>¥100）`,
        data: { pendingOrders, abnormals },
      };
    }

    log('  金额正常，采购完成');
    return {
      step: stepName,
      success: true,
      message: `采购成功，${pendingOrders.length} 个订单已下单，总金额 ¥${qnhTotalAmount.toFixed(2)}`,
      data: { pendingOrders },
    };
  } catch (err: any) {
    return { step: stepName, success: false, message: err.message };
  }
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

async function assertCartReadyForOrder(
  page: Page,
  config: PurchaseConfig,
  ctx: StepContext,
  trace?: CartApiTraceContext,
): Promise<void> {
  const deadline = Date.now() + 45000;
  let hasReloaded = false;
  let lastCartCount = 0;
  let lastVerification: string[] = [];
  let lastEvidence: CartApiEvidence | null = null;
  let lastDiagnostics = verifyTableRows({
    config,
    supplier: ctx.supplier,
    rows: [],
    enforceStatus: false,
  });

  while (Date.now() < deadline) {
    await waitForPageReady(page);
    await closeModals(page);

    const cartCount = await page.locator('tbody tr').count().catch(() => 0);
    lastCartCount = cartCount;

    const verification = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('tbody tr'))
        .map((row) => ((row as HTMLElement).innerText || '').trim().replace(/\n/g, ' '))
        .filter((text) => Boolean(text));
    });
    lastVerification = verification;

    lastDiagnostics = verifyTableRows({
      config,
      supplier: ctx.supplier,
      rows: verification,
      enforceStatus: false,
    });

    if (trace) {
      lastEvidence = analyzeCartApiTrace(trace.responses, ctx.replenishListNo || '', ctx.supplier, config);
    }

    if (lastDiagnostics.matchedRows.length > 0) {
      break;
    }

    const apiHasTargetSupplier = Boolean(lastEvidence?.hasTargetSupplierEvidence);
    const apiHasAnyListData = Boolean(lastEvidence?.hasNonEmptyList);
    if (apiHasTargetSupplier) {
      log('  [补货清单建单前校验] DOM 未命中目标供应商，但接口已返回目标供应商数据，按接口真相继续');
      break;
    }

    if (config.procurementRules.requireNonEmptyCartBeforeOrder && cartCount === 0 && !apiHasAnyListData) {
      await page.waitForTimeout(500);
      continue;
    }

    const onlyPlaceholderRows = verification.length > 0 && verification.every((text) => /暂无内容|暂无数据|加载中/.test(text));
    if (onlyPlaceholderRows) {
      const evidenceSummary = lastEvidence
        ? 'apiItems=' + lastEvidence.itemCount + ', supplierHits=' + lastEvidence.supplierHits + ', listHits=' + lastEvidence.replenishListHits
        : 'apiItems=unknown';
      log('  [补货清单建单前校验] 表格仍在渲染，继续等待: ' + JSON.stringify(verification.slice(0, 3)) + ' | ' + evidenceSummary);
      if (!hasReloaded && Date.now() + 10000 >= deadline) {
        log('  [补货清单建单前校验] 页面长时间仅显示占位文案，尝试刷新详情页重取数据');
        await page.reload({ waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
        hasReloaded = true;
      }
      await page.waitForTimeout(800);
      continue;
    }

    if (verification.length === 0 && !apiHasAnyListData) {
      await page.waitForTimeout(500);
      continue;
    }

    if (verification.length === 0 && apiHasTargetSupplier) {
      log('  [补货清单建单前校验] DOM 暂无行，但接口已确认存在目标供应商商品');
      break;
    }

    break;
  }

  if (trace) {
    lastEvidence = analyzeCartApiTrace(trace.responses, ctx.replenishListNo || '', ctx.supplier, config);
  }

  const apiHasTargetSupplier = Boolean(lastEvidence?.hasTargetSupplierEvidence);
  const apiHasAnyListData = Boolean(lastEvidence?.hasNonEmptyList);

  if (config.procurementRules.requireNonEmptyCartBeforeOrder && lastCartCount === 0 && !apiHasAnyListData) {
    throw new Error('强校验失败：补货清单为空，禁止建单');
  }

  if (config.procurementRules.requireNonEmptyCartBeforeOrder && lastDiagnostics.matchedRows.length === 0 && !apiHasTargetSupplier) {
    throw new Error('强校验失败：补货清单中没有目标供应商商品；' + formatVerificationDiagnostics('补货清单建单前校验', lastDiagnostics));
  }

  if (lastDiagnostics.conflictingRows.length > 0 && config.procurementRules.stopOnSupplierMismatch && !apiHasTargetSupplier) {
    throw new Error('强校验失败：补货清单存在 ' + lastDiagnostics.conflictingRows.length + ' 行明确冲突商品，禁止建单；' + formatVerificationDiagnostics('补货清单建单前校验', lastDiagnostics));
  }

  ctx.validatedCartCount = Math.max(lastDiagnostics.matchedRows.length, lastEvidence?.supplierHits || 0);
  log('  ' + formatVerificationDiagnostics('补货清单建单前校验', lastDiagnostics));
  if (lastEvidence) {
    log('  [补货清单建单前校验][API] itemCount=' + lastEvidence.itemCount + ', supplierHits=' + lastEvidence.supplierHits + ', listHits=' + lastEvidence.replenishListHits);
  }
  if (lastDiagnostics.ambiguousRows.length > 0) {
    log('  [补货清单建单前校验] 提示：发现 ' + lastDiagnostics.ambiguousRows.length + ' 行信息不足，仅记录 warning');
  }
  if (apiHasTargetSupplier && lastDiagnostics.matchedRows.length === 0) {
    log('  [补货清单建单前校验] 采用接口校验结果放行');
  }
  log('  建单前清单校验通过，目标商品 ' + ctx.validatedCartCount + ' 行');
}

function startCartApiTrace(page: Page): CartApiTraceContext {
  const trace: CartApiTraceContext = {
    responses: [],
  };

  const listener = async (response: Response) => {
    const url = response.url();
    if (!url.includes('qnh.meituan.com')) return;
    if (!/\/api\//i.test(url)) return;
    if (!/replenish|dispatch|detail|cart|purchase|order/i.test(url)) return;

    const request = response.request();
    const method = request.method();
    let requestBody = request.postData() || '';
    if (requestBody.length > 500) requestBody = requestBody.slice(0, 500);

    let responseBody = '';
    const contentType = response.headers()['content-type'] || '';
    if (/json|text/i.test(contentType)) {
      responseBody = await response.text().catch(() => '');
      if (responseBody.length > 2000) responseBody = responseBody.slice(0, 2000);
    }

    trace.responses.push({
      url,
      status: response.status(),
      method,
      requestBody,
      responseBody,
    });

    if (trace.responses.length > 60) {
      trace.responses.shift();
    }
  };

  trace.listener = listener;
  page.on('response', listener);
  return trace;
}

async function flushCartApiTrace(page: Page, trace: CartApiTraceContext, stage: string): Promise<void> {
  if (trace.listener) {
    page.off('response', trace.listener);
  }

  await page.waitForTimeout(1000);
  const relevant = trace.responses
    .filter((item) => /replenish|dispatch|detail|cart|purchase/i.test(item.url + ' ' + (item.requestBody || '') + ' ' + (item.responseBody || '')))
    .slice(-10);

  if (relevant.length === 0) {
    log('  [' + stage + '] 未捕获到补货清单相关接口响应');
    return;
  }

  log('  [' + stage + '] 接口追踪: ' + JSON.stringify(relevant));
}

function analyzeCartApiTrace(
  responses: CartApiTrace[],
  replenishListNo: string,
  supplier: string,
  config: PurchaseConfig,
): CartApiEvidence {
  const aliases = getSupplierAliases(config, supplier).map(item => item.toLowerCase()).filter(Boolean);
  const matchedResponses = responses.filter((item) => {
    const haystack = (item.url + ' ' + (item.requestBody || '') + ' ' + (item.responseBody || '')).toLowerCase();
    if (replenishListNo && haystack.includes(replenishListNo.toLowerCase())) return true;
    return /replenish|dispatch|detail|cart|purchase/i.test(item.url);
  });

  let itemCount = 0;
  let supplierHits = 0;
  let replenishListHits = 0;

  for (const item of matchedResponses) {
    const haystack = (item.url + ' ' + (item.requestBody || '') + ' ' + (item.responseBody || '')).toLowerCase();
    if (replenishListNo && haystack.includes(replenishListNo.toLowerCase())) {
      replenishListHits += 1;
    }
    if (aliases.some(alias => haystack.includes(alias))) {
      supplierHits += 1;
    }

    const body = item.responseBody || '';
    const itemMatches = body.match(/sku|spu|itemName|goodsName|commodityName|productName|supplierName|replenishListNo/gi);
    if (itemMatches) {
      itemCount += itemMatches.length;
    }
  }

  return {
    matchedResponses,
    itemCount,
    supplierHits,
    replenishListHits,
    hasNonEmptyList: itemCount > 0 || replenishListHits > 0,
    hasTargetSupplierEvidence: supplierHits > 0,
  };
}

function analyzeGoReplenishTrace(responses: CartApiTrace[]): GoReplenishApiEvidence {
  const matchedResponses = responses.filter((item) => {
    const haystack = item.url + ' ' + (item.requestBody || '') + ' ' + (item.responseBody || '');
    return /previewNo|replenishPreviewOrderNo|order-splitting-preview|preview/i.test(haystack);
  });

  let previewNo = '';
  let replenishPreviewOrderNo = '';
  let routeHit = false;

  for (const item of matchedResponses) {
    const haystack = item.url + ' ' + (item.requestBody || '') + ' ' + (item.responseBody || '');
    const previewMatch = haystack.match(/previewNo["'=:\s]+([A-Za-z0-9_-]+)/i);
    if (!previewNo && previewMatch?.[1]) {
      previewNo = previewMatch[1];
    }

    const orderMatch = haystack.match(/replenishPreviewOrderNo["'=:\s]+([A-Za-z0-9_-]+)/i);
    if (!replenishPreviewOrderNo && orderMatch?.[1]) {
      replenishPreviewOrderNo = orderMatch[1];
    }

    if (/order-splitting-preview/i.test(haystack)) {
      routeHit = true;
    }
  }

  return {
    matchedResponses,
    previewNo: previewNo || undefined,
    replenishPreviewOrderNo: replenishPreviewOrderNo || undefined,
    routeHit,
  };
}

function buildPreviewUrl(currentUrl: string, ctx: StepContext, apiEvidence: GoReplenishApiEvidence): string {
  const base = currentUrl.split('#')[0] + '#/purchase/replenish-dispatch/order-splitting-preview';
  const params: string[] = [];
  const previewNo = ctx.previewNo || apiEvidence.previewNo;
  if (previewNo) params.push('previewNo=' + encodeURIComponent(previewNo));
  if (ctx.replenishListNo) params.push('replenishListNo=' + encodeURIComponent(ctx.replenishListNo));
  if (apiEvidence.replenishPreviewOrderNo) params.push('replenishPreviewOrderNo=' + encodeURIComponent(apiEvidence.replenishPreviewOrderNo));
  params.push('replenishMode=1');
  return base + '?' + params.join('&');
}

function getUrlParam(url: string, key: string): string {
  const normalized = url.replace('#/', '');
  const queryIndex = normalized.indexOf('?');
  if (queryIndex < 0) return '';
  const query = normalized.slice(queryIndex + 1);
  const params = new URLSearchParams(query);
  return params.get(key) || '';
}

async function collectGoReplenishPageInfo(page: Page): Promise<string> {
  return page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'))
      .map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim())
      .filter((text) => Boolean(text) && text.length < 20)
      .slice(0, 15);
    const links = Array.from(document.querySelectorAll('a'))
      .map((a) => (a.textContent || '').replace(/\s+/g, ' ').trim())
      .filter((text) => Boolean(text) && text.length < 20)
      .slice(0, 15);
    const text = (document.body.innerText || '').replace(/\s+/g, ' ').trim();
    return JSON.stringify({ route: location.hash.substring(0, 160), buttons, links, text: text.substring(0, 300) });
  }).catch(() => '{}');
}

function assertOrderStatuses(orders: PendingOrder[], allowedStatuses: string[], stage: string): void {
  if (orders.length === 0) {
    throw new Error(stage + ' 失败：未找到任何订单');
  }
  const invalidOrders = orders.filter(order => !order.status || !allowedStatuses.includes(order.status));
  if (invalidOrders.length > 0) {
    throw new Error(stage + ' 失败：发现状态不合法订单 ' + invalidOrders.map(order => order.orderNo + ':' + (order.status || '-')).join(', '));
  }
}

async function handleSubmitFlowModal(page: Page, stage: string): Promise<SubmitModalDiagnostics | null> {
  const modal = await getVisibleModal(page);
  if (!modal.visible) return null;

  log('  [' + stage + '] 检测到弹窗: ' + modal.text.substring(0, 80));
  log('  [' + stage + '] 按钮列表: ' + JSON.stringify(modal.buttons));

  if (modal.buttons.some((button) => button.includes('继续提交'))) {
    const action = await clickModalAction(page, 'confirm', { extraButtonTexts: ['继续提交'] });
    if (!action.handled) {
      throw new Error('[' + stage + '] 弹窗存在但无法点击继续提交；' + formatModalDiagnostics({
        modalText: modal.text,
        buttonTexts: modal.buttons,
        containerType: modal.containerType,
        matchedIntent: 'confirm',
      }));
    }
    log('  [' + stage + '] 已点击继续提交');
    return {
      modalText: action.modalText,
      buttonTexts: action.buttonTexts,
      containerType: action.containerType,
      matchedIntent: action.matchedIntent,
      clickedText: action.clickedText,
    };
  }

  const destructiveAction = await clickModalAction(page, 'destructive');
  if (destructiveAction.handled) {
    log('  [' + stage + '] 已点击破坏性按钮: ' + (destructiveAction.clickedText || ''));
    return {
      modalText: destructiveAction.modalText,
      buttonTexts: destructiveAction.buttonTexts,
      containerType: destructiveAction.containerType,
      matchedIntent: destructiveAction.matchedIntent,
      clickedText: destructiveAction.clickedText,
    };
  }

  const confirmAction = await clickModalAction(page, 'confirm');
  if (confirmAction.handled) {
    log('  [' + stage + '] 已点击确认按钮: ' + (confirmAction.clickedText || ''));
    return {
      modalText: confirmAction.modalText,
      buttonTexts: confirmAction.buttonTexts,
      containerType: confirmAction.containerType,
      matchedIntent: confirmAction.matchedIntent,
      clickedText: confirmAction.clickedText,
    };
  }

  if (modal.buttons.length > 0) {
    throw new Error('[' + stage + '] 弹窗存在但无可匹配按钮；' + formatModalDiagnostics({
      modalText: modal.text,
      buttonTexts: modal.buttons,
      containerType: modal.containerType,
    }));
  }

  throw new Error('[' + stage + '] 弹窗存在但未识别到按钮；' + formatModalDiagnostics({
    modalText: modal.text,
    buttonTexts: modal.buttons,
    containerType: modal.containerType,
  }));
}

async function goReplenish(page: Page, ctx: StepContext): Promise<void> {
  log('  [submit] 点击"去补货"进入预览页');
  await closeModals(page);

  const getRoute = (url: string) => (url.split('#')[1] || '').split('?')[0];
  const isPreviewReady = async () => {
    const generateBtn = page.locator('button').filter({ hasText: /生成单据|生成采购单|确认生成/ }).first();
    if (await generateBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      return true;
    }

    const pageInfo = await page.evaluate(() => {
      const text = (document.body.innerText || '').replace(/\s+/g, ' ');
      return {
        hasPreview: text.includes('预览') || text.includes('汇总'),
        hasGenerate: text.includes('生成单据') || text.includes('生成采购单') || text.includes('确认生成'),
        snippet: text.substring(0, 200),
      };
    }).catch(() => ({ hasPreview: false, hasGenerate: false, snippet: '' }));

    return pageInfo.hasPreview || pageInfo.hasGenerate;
  };

  if (await isPreviewReady()) {
    const currentUrl = page.url();
    ctx.previewNo = getUrlParam(currentUrl, 'previewNo');
    log('  已在预览页，跳过去补货点击');
    log('  预览编号: ' + (ctx.previewNo || '无'));
    return;
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    await closeModals(page);

    const goBtn = page.locator('button').filter({ hasText: /去补货|提交|生成预览/ }).first();
    if (!(await goBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
      if (await isPreviewReady()) {
        const currentUrl = page.url();
        ctx.previewNo = getUrlParam(currentUrl, 'previewNo');
        log('  未找到"去补货"按钮，但已在预览页');
        log('  预览编号: ' + (ctx.previewNo || '无'));
        return;
      }

      const pageInfo = await collectGoReplenishPageInfo(page);
      throw new Error('未找到"去补货"按钮，且不在预览页，请人工检查页面状态；page=' + pageInfo);
    }

    const routeBefore = getRoute(page.url());
    const trace = startCartApiTrace(page);
    await goBtn.click({ timeout: 5000 });
    log('  已点击"去补货"，等待响应...');

    await waitForButtonLoading(page, '去补货').catch(() => false);
    await waitForModalSettled(page);
    await handleSubmitFlowModal(page, '去补货后').catch(async (error) => {
      const modal = await getVisibleModal(page);
      throw new Error(String(error instanceof Error ? error.message : error) + '；当前URL=' + page.url() + '；弹窗=' + JSON.stringify(modal));
    });

    let enteredPreview = false;
    for (let w = 0; w < 30; w++) {
      const currentUrl = page.url();
      const currentRoute = getRoute(currentUrl);
      if (currentRoute !== routeBefore) {
        log('  路由已跳转: ' + currentRoute);
      }

      const apiEvidence = analyzeGoReplenishTrace(trace.responses);
      if (apiEvidence.previewNo && !ctx.previewNo) {
        ctx.previewNo = apiEvidence.previewNo;
        log('  [去补货][API] 捕获 previewNo: ' + apiEvidence.previewNo);
      }
      if (apiEvidence.replenishPreviewOrderNo) {
        log('  [去补货][API] 捕获 replenishPreviewOrderNo: ' + apiEvidence.replenishPreviewOrderNo);
      }
      if ((apiEvidence.previewNo || apiEvidence.routeHit) && currentRoute.includes('/purchase/replenish-dispatch/detail-list')) {
        const targetUrl = buildPreviewUrl(currentUrl, ctx, apiEvidence);
        log('  [去补货] 接口已返回预览参数但页面未自动跳转，手动进入预览页: ' + targetUrl.split('#')[1]);
        await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
        await waitForPageReady(page);
        await closeModals(page);
      }

      if (await isPreviewReady()) {
        enteredPreview = true;
        break;
      }

      const modal = await getVisibleModal(page);
      if (modal.visible) {
        await handleSubmitFlowModal(page, '去补货等待中');
        continue;
      }

      await page.waitForTimeout(2000);
    }

    await flushCartApiTrace(page, trace, '去补货点击后');

    if (enteredPreview) {
      await waitForPageReady(page);
      await closeModals(page);
      const currentUrl = page.url();
      const apiEvidence = analyzeGoReplenishTrace(trace.responses);
      ctx.previewNo = getUrlParam(currentUrl, 'previewNo') || ctx.previewNo || apiEvidence.previewNo;
      log('  去补货后URL: ' + currentUrl.split('#')[1]?.substring(0, 120));
      log('  预览编号: ' + (ctx.previewNo || '无'));
      return;
    }

    const pageInfo = await collectGoReplenishPageInfo(page);
    const apiEvidence = analyzeGoReplenishTrace(trace.responses);
    log('  第' + (attempt + 1) + '次尝试未跳转到预览页；page=' + pageInfo + '；api=' + JSON.stringify(apiEvidence));
  }

  throw new Error('点击"去补货"后未进入预览页');
}

async function generateOrder(page: Page, config: PurchaseConfig): Promise<void> {
  log('  [submit] 生成单据');

  await page.waitForFunction(() => {
    return !document.body.innerText.includes('加载中') && document.querySelector('.purchase-ant-spin-spinning') === null;
  }, { timeout: 30000 }).catch(() => {});
  await waitForModalSettled(page);

  const pageInfo = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'))
      .map(b => b.textContent?.trim()).filter(t => t && t.length < 20);
    return JSON.stringify({
      url: location.hash,
      buttons: buttons.slice(0, 20),
      text: document.body.innerText.substring(0, 200),
    });
  });
  log('  页面信息: ' + pageInfo);

  const generateBtn = page.locator('button').filter({ hasText: /生成单据|生成采购单|确认生成/ }).first();
  if (!(await generateBtn.isVisible({ timeout: 15000 }).catch(() => false))) {
    throw new Error('未找到"生成单据"按钮');
  }

  const beforeGenerate = new Date();
  await generateBtn.click();
  log('  已点击"生成单据"');

  await waitForModalSettled(page);
  await handleSubmitFlowModal(page, '生成单据后');

  await closeModals(page);
  await waitForOrderGenerationTask(page, beforeGenerate, config);

  await waitForPageReady(page);
  await closeModals(page);
  log('  单据生成完成');
}

async function waitForOrderGenerationTask(
  page: Page, beforeGenerate: Date, config: PurchaseConfig,
): Promise<void> {
  log('  [submit] 轮询任务状态，等待采购单生成...');

  const maxWait = 120000;
  const pollInterval = config.timeouts.exportPollInterval || 5000;
  const startTime = Date.now();

  const today = new Date();
  const startDate = new Date(today.getTime() - 7 * 86400000);
  const fmtDate = (d: Date) => d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0');
  const fmtDateCompact = (d: Date) => d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');

  const pollBody = {
    queryType: '',
    date: [fmtDate(startDate), fmtDate(today)],
    pageSize: 20,
    startTime: fmtDateCompact(startDate),
    endTime: fmtDateCompact(today),
    page: 1,
    taskMode: '',
  };

  while (Date.now() - startTime < maxWait) {
    await page.waitForTimeout(pollInterval);

    const result = await page.evaluate(async (body) => {
      try {
        const resp = await fetch('/api/v1/task/queryTasks?yodaReady=h5&csecplatform=4&csecversion=4.2.0', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        return await resp.json();
      } catch (e: any) {
        return { code: -1, msg: e.message };
      }
    }, pollBody);

    if (result.code !== 0 || !result.data?.list?.length) {
      log('  任务查询: 无结果，继续等待...');
      continue;
    }

    const beforeTime = beforeGenerate.getTime();
    let targetTask = result.data.list.find((t: any) => {
      const taskTime = new Date(t.opTime.replace(/\./g, '-')).getTime();
      return taskTime >= beforeTime;
    });

    if (!targetTask) {
      targetTask = result.data.list[0];
    }

    const state = targetTask.executingState;
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    if (state === '已完成') {
      log('  采购单生成任务完成 (taskId=' + targetTask.taskId + ', ' + elapsed + '秒)');
      return;
    }

    if (state === '失败' || state === '已失败' || state === '处理失败') {
      const reason = targetTask.taskResult || targetTask.handleResult || '未知原因';
      throw new Error('采购单生成任务失败 (taskId=' + targetTask.taskId + '): ' + reason);
    }

    log('  任务 ' + targetTask.taskId + ' 状态: ' + state + ' (' + elapsed + 's)');
  }

  log('  采购单生成任务轮询超时（2分钟），继续尝试查找采购单');
}

async function searchPendingOrders(
  page: Page,
  config: PurchaseConfig,
  supplierName?: string,
  afterTime?: Date,
  allowedStatuses: string[] = ['待下单', '未下单', '待付款', '待支付'],
): Promise<PendingOrder[]> {
  log('  [submit] 搜索采购单（状态: ' + allowedStatuses.join('/') + '）' + (supplierName ? '（供应商: ' + supplierName + '）' : ''));
  await closeModals(page);

  const debugInfo = await page.evaluate(() => {
    const rows = document.querySelectorAll('table tbody tr');
    const samples = Array.from(rows).slice(0, 3).map((row) => {
      const cells = Array.from(row.querySelectorAll('td'))
        .map(c => (c as HTMLElement).innerText.trim().replace(/\n/g, ' ').substring(0, 40));
      return cells.join(' | ');
    });
    const statuses = new Set<string>();
    for (const row of Array.from(rows)) {
      const text = (row as HTMLElement).innerText;
      for (const kw of ['待下单', '待付款', '待支付', '已下单', '已完成', '已关闭', '处理中', '未下单']) {
        if (text.includes(kw)) statuses.add(kw);
      }
    }
    return { rowCount: rows.length, samples, statuses: Array.from(statuses) };
  });
  log('  表格调试: ' + JSON.stringify(debugInfo));

  const expandBtn = page.locator('button:has-text("展开")').first();
  if (await expandBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await expandBtn.click();
    await page.waitForTimeout(1500);
    log('  已展开筛选条件');
  }

  const statusLabel = page.locator('.purchase-ant-form-item-label, label, .purchase-ant-col.purchase-ant-form-item-label').filter({ hasText: /^状态$|采购单状态/ }).first();
  if (await statusLabel.isVisible({ timeout: 3000 }).catch(() => false)) {
    const formItem = statusLabel.locator('xpath=ancestor::*[contains(@class,"purchase-ant-form-item")]').first();
    const selectBox = formItem.locator('.purchase-ant-select-selector').first();
    if (await selectBox.isVisible({ timeout: 2000 }).catch(() => false)) {
      await selectBox.click();
      await page.waitForTimeout(1000);

      const statusCandidates = ['待下单', '未下单', '待付款', '待支付']
        .filter(st => allowedStatuses.includes(st));
      let selectedText = '';
      let option = page.locator('.purchase-ant-select-dropdown:visible .purchase-ant-select-item').first();
      for (const status of statusCandidates) {
        const candidate = page.locator('.purchase-ant-select-dropdown:visible .purchase-ant-select-item')
          .filter({ hasText: status }).first();
        if (await candidate.isVisible({ timeout: 1000 }).catch(() => false)) {
          option = candidate;
          selectedText = status;
          break;
        }
      }
      if (await option.isVisible({ timeout: 5000 }).catch(() => false)) {
        const selectedLabel = (await option.innerText().catch(() => '')).trim() || selectedText || statusCandidates[0] || '未指定状态';
        await option.click();
        log('  已选择状态: ' + selectedLabel);
        await page.waitForTimeout(1000);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        const searchBtn = page.locator('button').filter({ hasText: /查\s*询/ }).first();
        if (await searchBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await searchBtn.click();
          await page.waitForTimeout(3000);
        }
      } else {
        const options = await page.locator('.purchase-ant-select-dropdown:visible .purchase-ant-select-item')
          .allInnerTexts().catch(() => [] as string[]);
        log('  下拉选项: ' + JSON.stringify(options.slice(0, 10)));
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
      }
    } else {
      log('  未找到状态 Select 组件');
    }
  } else {
    log('  未找到"状态"标签');
  }

  await waitForPageReady(page);

  const supplierAliases = supplierName ? getSupplierAliases(config, supplierName) : [];
  const afterTimeISO = afterTime ? afterTime.toISOString() : '';
  const result = await page.evaluate(({ filterSuppliers, afterTimeISO, allowedStatuses }) => {
    const result: Array<{ orderNo: string; amount: string; itemCount: string; storeName: string; status: string }> = [];

    let storeColIdx = -1;
    let createInfoColIdx = -1;
    const headerCells = document.querySelectorAll('table thead th, table thead td');
    for (let i = 0; i < headerCells.length; i++) {
      const ht = (headerCells[i] as HTMLElement).innerText.trim();
      if (ht.includes('门店') || ht.includes('仓') || ht.includes('收货方')) storeColIdx = i;
      if (ht.includes('创建信息') || ht.includes('创建时间')) createInfoColIdx = i;
    }

    const rows = document.querySelectorAll('table tbody tr');
    for (const row of Array.from(rows)) {
      const text = (row as HTMLElement).innerText;
      const matchedStatuses = ['待下单', '未下单', '待付款', '待支付'].filter(st => text.includes(st));
      const isPending = matchedStatuses.some(st => allowedStatuses.includes(st));
      const actionBtns = row.querySelectorAll('button, a');
      let hasOrderBtn = false;
      for (const btn of Array.from(actionBtns)) {
        const bt = (btn as HTMLElement).innerText.trim();
        if (bt === '下单' || bt === '确认下单') { hasOrderBtn = true; break; }
      }
      if (!isPending && !hasOrderBtn) continue;

      if (filterSuppliers && filterSuppliers.length > 0) {
        const lowerText = text.toLowerCase();
        if (!filterSuppliers.some((keyword: string) => keyword && lowerText.includes(keyword.toLowerCase()))) continue;
      }

      if (afterTimeISO && createInfoColIdx >= 0) {
        const cells = row.querySelectorAll('td');
        if (createInfoColIdx < cells.length) {
          const createText = (cells[createInfoColIdx] as HTMLElement).innerText.trim();
          const timeMatch = createText.match(/(\d{4}[./-]\d{1,2}[./-]\d{1,2}\s+\d{1,2}:\d{1,2}(?::\d{1,2})?)/);
          if (timeMatch) {
            const createTime = new Date(timeMatch[1].replace(/[./]/g, '-'));
            const afterDate = new Date(afterTimeISO);
            if (createTime < afterDate) continue;
          }
        }
      }

      const cells = row.querySelectorAll('td');
      let orderNo = '', amount = '', itemCount = '', storeName = '', status = '';

      if (storeColIdx >= 0 && storeColIdx < cells.length) {
        storeName = (cells[storeColIdx] as HTMLElement).innerText.trim();
      }

      for (const cell of Array.from(cells)) {
        const ct = (cell as HTMLElement).innerText.trim();
        if (!orderNo && /^CG-\d{8}-\d+$/.test(ct)) orderNo = ct;
        if (!orderNo && /^\d{8,}$/.test(ct.replace(/\s/g, ''))) orderNo = ct.replace(/\s/g, '');
        if (!amount && /[¥￥][\d,.]+/.test(ct)) amount = ct;
        if (!amount && /^\d[\d,]*\.\d{2}$/.test(ct) && parseFloat(ct.replace(/,/g, '')) > 0) amount = ct;
        const m = ct.match(/(\d+)\s*种/);
        if (!itemCount && m) itemCount = m[1];
        if (!itemCount && /^\d{1,4}$/.test(ct) && parseInt(ct) > 0 && parseInt(ct) < 1000) itemCount = ct;
        if (!status && (ct.includes('待下单') || ct.includes('未下单'))) status = ct.includes('未下单') ? '未下单' : '待下单';
        else if (!status && (ct.includes('待付款') || ct.includes('待支付'))) status = ct.includes('待支付') ? '待支付' : '待付款';
      }
      if (!orderNo) {
        const links = row.querySelectorAll('a');
        for (const link of Array.from(links)) {
          const href = (link as HTMLAnchorElement).href || '';
          const m = href.match(/orderNo=(CG-[\d-]+|\d+)/);
          if (m) { orderNo = m[1]; break; }
          const lt = (link as HTMLElement).innerText.trim();
          if (/^CG-\d{8}-\d+$/.test(lt)) { orderNo = lt; break; }
          if (/^\d{8,}$/.test(lt)) { orderNo = lt; break; }
        }
      }

      if (orderNo || amount) result.push({ orderNo, amount, itemCount, storeName, status });
    }
    return result;
  }, { filterSuppliers: supplierAliases, afterTimeISO, allowedStatuses });

  const invalidOrders = result.filter(order => !order.status || !allowedStatuses.includes(order.status));
  if (invalidOrders.length > 0 && config.procurementRules.stopOnSupplierMismatch) {
    throw new Error('采购单搜索强校验失败：存在不在允许状态内的订单 ' + invalidOrders.map(order => order.orderNo + ':' + (order.status || '-')).join(', '));
  }

  return result;
}

async function compareAmounts(
  page: Page,
  originalOrders: PendingOrder[],
  qnhTotalAmount: number,
): Promise<OrderAmountInfo[]> {
  log('  [submit] 对比下单金额');
  log('  原始待下单金额合计: ¥' + qnhTotalAmount.toFixed(2) + '，订单数: ' + originalOrders.length);

  const rows = await page.evaluate(() => {
    const result: Array<{ orderNo: string; qnhAmount: string; aliAmount: string; status: string }> = [];
    const trs = document.querySelectorAll('table tbody tr');
    for (const row of Array.from(trs)) {
      const cells = row.querySelectorAll('td');
      let orderNo = '', status = '';
      const amounts: string[] = [];

      for (const cell of Array.from(cells)) {
        const ct = (cell as HTMLElement).innerText.trim();
        if (!orderNo && /^CG-\d{8}-\d+$/.test(ct)) orderNo = ct;
        if (!orderNo && /^\d{8,}$/.test(ct.replace(/\s/g, ''))) orderNo = ct.replace(/\s/g, '');
        if (/[¥￥][\d,.]+/.test(ct)) amounts.push(ct);
        else if (/^\d[\d,]*\.\d{2}$/.test(ct) && parseFloat(ct.replace(/,/g, '')) > 0) amounts.push(ct);
        if (ct.includes('待支付') || ct.includes('待付款')) status = '待支付';
        else if (ct.includes('处理中')) status = '处理中';
        else if (ct.includes('待下单')) status = '待下单';
      }

      if (!orderNo) {
        const links = row.querySelectorAll('a');
        for (const link of Array.from(links)) {
          const lt = (link as HTMLElement).innerText.trim();
          if (/^CG-\d{8}-\d+$/.test(lt)) { orderNo = lt; break; }
          if (/^\d{8,}$/.test(lt)) { orderNo = lt; break; }
        }
      }

      if (orderNo) {
        result.push({
          orderNo,
          qnhAmount: amounts[0] || '0',
          aliAmount: amounts.length > 1 ? amounts[1] : amounts[0] || '0',
          status,
        });
      }
    }
    return result;
  });

  const infos: OrderAmountInfo[] = [];
  for (const row of rows) {
    const qnh = parseFloat(row.qnhAmount.replace(/[^0-9.]/g, '')) || 0;
    const ali = parseFloat(row.aliAmount.replace(/[^0-9.]/g, '')) || 0;
    const diff = Math.abs(ali - qnh);
    const diffPercent = qnh > 0 ? (diff / qnh) * 100 : 0;
    const abnormal = diffPercent > 50 || diff > 100;

    infos.push({ orderNo: row.orderNo, qnhAmount: qnh, aliAmount: ali, diff, diffPercent, abnormal });
    log('    ' + row.orderNo + ': 牵牛花¥' + qnh.toFixed(2) + ' / 1688¥' + ali.toFixed(2) + (abnormal ? ' ⚠️异常' : ' ✓'));
  }

  return infos;
}

if (require.main === module) {
  (async () => {
    const { loadConfig, parseCLI } = await import('../lib/config');
    const { launchBrowser } = await import('../lib/browser');
    const { ensureLogin } = await import('../lib/page-helpers');
    const { loadContext, createEmptyContext } = await import('../lib/context');

    const { overrides } = parseCLI();
    const config = loadConfig(overrides);
    const searchOnly = process.argv.includes('--search-only');
    const confirmOnly = process.argv.includes('--confirm-only');
    const { context, page } = await launchBrowser();

    const ctx = loadContext() || createEmptyContext(config.supplier);

    if (searchOnly) {
      const listUrl = config.baseUrl + '/home.html#/purchase/purchase-order/list';
      await ensureLogin(page, listUrl);
      log('[search-only] 测试 searchPendingOrders...');
      const orders = await searchPendingOrders(page, config, config.supplier, undefined, config.procurementRules.allowedOrderStatuses);
      log('Result: ' + JSON.stringify({ found: orders.length, orders }));
    } else {
      if (confirmOnly) {
        ctx.confirmOnly = true;
        log('[confirm-only] 跳过生成单据，直接下单');
      }
      const targetUrl = confirmOnly
        ? config.baseUrl + '/home.html#/purchase/purchase-order/list'
        : ctx.replenishListNo
          ? config.baseUrl + '/home.html#/purchase/replenish-dispatch/detail-list?replenishListNo=' + ctx.replenishListNo + '&replenishMode=1'
          : config.baseUrl + '/home.html#/purchase/order';
      await ensureLogin(page, targetUrl);
      const result = await stepSubmitOrder(page, config, ctx);
      log('Result: ' + JSON.stringify(result));
    }
    await context.close();
  })().catch(err => { console.error(err); process.exit(1); });
}
