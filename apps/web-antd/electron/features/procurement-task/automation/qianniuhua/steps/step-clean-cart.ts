/**
 * Step 4: 清空补货清单 + 上传处理后的 Excel
 *
 * 流程：清空现有清单 → 等待页面清空 → 上传 Step 3 生成的采购计划 Excel
 * 注意：批量补货检查在 Step 2 已完成，Step 3 的 Excel 已过滤未通过商品，无需再检查
 */
import * as path from 'path';
import { Page, Response } from 'playwright';
import { PurchaseConfig } from '../lib/config';
import { StepResult, StepContext } from '../lib/types-v2';
import {
  clickModalAction,
  closeModals,
  formatModalDiagnostics,
  getVisibleModal,
  waitForModalSettled,
  waitForPageReady,
  waitForUiSettled,
} from '../lib/page-helpers';
import { log } from '../lib/utils';
import { isCliEntry } from '../../../../../utils/is-main-module';

const DRAWER_SELECTORS = [
  '.purchase-ant-drawer',
  '.purchase-ant-drawer-content-wrapper',
  '.purchase-ant-drawer-mask',
];

interface Step4ModalDiagnostics {
  modalText: string;
  buttonTexts: string[];
  containerType?: string;
  matchedIntent?: string;
  clickedText?: string;
}

interface UploadApiTrace {
  url: string;
  status: number;
  method: string;
  requestBody?: string;
  responseBody?: string;
}

interface UploadApiTraceContext {
  responses: UploadApiTrace[];
  listener?: (response: Response) => void;
}

export async function stepCleanCart(
  page: Page,
  config: PurchaseConfig,
  ctx: StepContext,
): Promise<StepResult> {
  const stepName = 'clean-cart';

  try {
    if (!ctx.planFile) {
      return { step: stepName, success: false, message: '缺少 planFile（来自 Step 3）' };
    }

    if (ctx.replenishListNo) {
      const cartUrl = config.baseUrl + '/home.html#/purchase/replenish-dispatch/detail-list?replenishListNo=' + ctx.replenishListNo + '&replenishMode=1';
      await page.goto(cartUrl, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
      await waitForPageReady(page);
      await closeModals(page);
    }

    const cleared = await clearCart(page);
    if (!cleared) {
      return { step: stepName, success: false, message: '清空补货清单失败' };
    }

    const uploaded = await uploadExcel(page, ctx.planFile);
    if (!uploaded) {
      return { step: stepName, success: false, message: '上传 Excel 失败' };
    }

    await refreshReplenishListNoAfterUpload(page, ctx);

    return { step: stepName, success: true, message: '已清空清单并上传处理后的 Excel' };
  } catch (err: any) {
    return { step: stepName, success: false, message: err.message };
  }
}

async function clearCart(page: Page): Promise<boolean> {
  log('  [clean] 清空补货清单');
  await closeModals(page);

  const clearAction = await triggerCartClearAction(page);
  if (!clearAction) {
    log('  未找到"清空"按钮，按当前无需清空处理，直接进入上传');
    return true;
  }

  log('  已触发清空操作: ' + clearAction);

  const clearModal = await handleModalStage(page, {
    stage: '清空确认',
    preferredActions: [
      { intent: 'destructive', label: 'destructive' },
      { intent: 'confirm', label: 'confirm' },
    ],
    requireModal: true,
    timeout: 8000,
  });
  log('  [清空确认] 已处理弹窗: ' + formatModalDiagnostics(clearModal));

  await waitForCartCleared(page);
  await closeModals(page);
  log('  补货清单已清空');
  return true;
}

async function isCartReadyForUpload(page: Page): Promise<boolean> {
  const importBtnVisible = await page.locator('button').filter({ hasText: /Excel导入|导入商品|上传|导入/ }).first()
    .isVisible({ timeout: 500 }).catch(() => false);
  if (!importBtnVisible) return false;

  const clearBtnVisible = await page.locator('button').filter({ hasText: /清空商品清单|清空/ }).first()
    .isVisible({ timeout: 500 }).catch(() => false);
  const removeBtnVisible = await page.locator('button').filter({ hasText: /移出|删除/ }).first()
    .isVisible({ timeout: 500 }).catch(() => false);
  const rowActionVisible = await page.locator('tbody tr button, tbody tr [role="button"], tbody tr a').filter({ hasText: /移出|删除/ }).first()
    .isVisible({ timeout: 500 }).catch(() => false);

  return !clearBtnVisible && !removeBtnVisible && !rowActionVisible;
}

async function uploadExcel(page: Page, filePath: string): Promise<boolean> {
  log('  [clean] 上传 Excel: ' + path.basename(filePath));
  await closeModals(page);
  const trace = startUploadApiTrace(page);

  const importBtn = page.locator('button').filter({ hasText: /Excel导入|导入商品|上传|导入/ }).first();
  if (!(await importBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
    stopUploadApiTrace(page, trace);
    log('  未找到"Excel导入商品"按钮');
    return false;
  }

  await importBtn.click();
  log('  已点击导入按钮，等待抽屉打开');
  await waitForDrawerOpened(page);

  const fileInput = await waitForFileInput(page);
  await fileInput.setInputFiles(filePath);
  log('  文件已选择');
  await waitForUiSettled(page, {
    visibleSelectors: DRAWER_SELECTORS,
    timeout: 5000,
    waitForNetworkIdle: false,
  });

  const submitBtn = page.locator('.purchase-ant-drawer:visible button, .purchase-ant-drawer-content-wrapper:visible button, [role="dialog"] button')
    .filter({ hasText: /提\s*交|确\s*定|确\s*认/ }).first();
  if (!(await submitBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
    throw new Error('[上传提交] 未找到抽屉提交按钮');
  }

  await submitBtn.click();
  log('  已点击抽屉提交按钮');
  await waitForModalSettled(page);

  const submitModal = await handleModalStage(page, {
    stage: '上传提交确认',
    preferredActions: [
      { intent: 'confirm', extraButtonTexts: ['提交', '确认', '导入完成'], label: 'confirm' },
      { intent: 'close', label: 'close' },
    ],
    requireModal: false,
    timeout: 6000,
  });
  if (submitModal) {
    log('  [上传提交确认] 已处理弹窗: ' + formatModalDiagnostics(submitModal));
  }

  const submitStageAlreadyCompleted = Boolean(
    submitModal && /已完成导入|成功\s*\d+\s*条|失败\s*\d+\s*条/.test(submitModal.modalText),
  );
  if (submitStageAlreadyCompleted) {
    await waitForModalSettled(page);
  }

  const completionState = submitStageAlreadyCompleted
    ? 'drawer-closed'
    : await waitForUploadCompletionState(page);
  if (completionState === 'modal') {
    const resultModal = await handleModalStage(page, {
      stage: '上传结果确认',
      preferredActions: [
        { intent: 'confirm', extraButtonTexts: ['导入完成', '知道了', '完成'], label: 'confirm' },
        { intent: 'close', label: 'close' },
      ],
      requireModal: true,
      timeout: 8000,
    });
    log('  [上传结果确认] 已处理弹窗: ' + formatModalDiagnostics(resultModal));
  }

  await waitForDrawerClosed(page);
  await waitForPageReady(page);
  await closeModals(page);
  await flushUploadApiTrace(page, trace, '上传 Excel');
  log('  Excel 上传完成');
  return true;
}

async function handleModalStage(
  page: Page,
  options: {
    stage: string;
    preferredActions: Array<{
      intent: 'confirm' | 'close' | 'destructive';
      extraButtonTexts?: string[];
      label: string;
    }>;
    requireModal: boolean;
    timeout: number;
  },
): Promise<Step4ModalDiagnostics | null> {
  const modal = await waitForModalProbe(page, options.timeout);
  if (!modal) {
    if (options.requireModal) {
      throw new Error('[' + options.stage + '] 触发动作后未出现预期弹窗；' + formatModalDiagnostics({
        modalText: '',
        buttonTexts: [],
      }));
    }
    return null;
  }

  log('  [' + options.stage + '] 检测到弹窗: ' + modal.text.substring(0, 80));
  log('  [' + options.stage + '] 按钮列表: ' + JSON.stringify(modal.buttons));

  for (const actionOption of options.preferredActions) {
    const action = await clickModalAction(page, actionOption.intent, {
      extraButtonTexts: actionOption.extraButtonTexts,
    });
    if (action.handled) {
      return {
        modalText: action.modalText,
        buttonTexts: action.buttonTexts,
        containerType: action.containerType,
        matchedIntent: action.matchedIntent,
        clickedText: action.clickedText,
      };
    }
  }

  throw new Error('[' + options.stage + '] 弹窗存在但按钮不匹配；' + formatModalDiagnostics({
    modalText: modal.text,
    buttonTexts: modal.buttons,
    containerType: modal.containerType,
  }));
}

async function waitForModalProbe(page: Page, timeout: number): Promise<Awaited<ReturnType<typeof getVisibleModal>> | null> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const modal = await getVisibleModal(page);
    if (modal.visible) return modal;
    await page.waitForTimeout(300);
  }
  return null;
}

async function triggerCartClearAction(page: Page): Promise<string | null> {
  const clearBtn = page.locator('button').filter({ hasText: /清空商品清单|清空/ }).first();
  if (await clearBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    const text = (await clearBtn.innerText().catch(() => '清空商品清单')).replace(/\s+/g, ' ').trim();
    await clearBtn.click();
    return text;
  }

  const removeBtn = page.locator('button').filter({ hasText: /移出|删除/ }).first();
  if (await removeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    const text = (await removeBtn.innerText().catch(() => '移出')).replace(/\s+/g, ' ').trim();
    await removeBtn.click();
    return text;
  }

  const rowActionBtn = page.locator('tbody tr button, tbody tr [role="button"], tbody tr a').filter({ hasText: /移出|删除/ }).first();
  if (await rowActionBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    const text = (await rowActionBtn.innerText().catch(() => '移出')).replace(/\s+/g, ' ').trim();
    await rowActionBtn.click();
    return text;
  }

  return null;
}

async function waitForDrawerOpened(page: Page): Promise<void> {
  await waitForUiSettled(page, {
    visibleSelectors: DRAWER_SELECTORS,
    timeout: 8000,
    waitForNetworkIdle: false,
  });

  if (!(await isDrawerVisible(page))) {
    throw new Error('[上传抽屉] 点击导入后抽屉未打开');
  }
}

async function waitForDrawerClosed(page: Page): Promise<void> {
  await waitForUiSettled(page, {
    hiddenSelectors: DRAWER_SELECTORS,
    timeout: 10000,
  });

  if (await isDrawerVisible(page)) {
    const modal = await getVisibleModal(page);
    throw new Error('[上传结果确认] 按钮匹配到了但点击后页面未收敛；' + formatModalDiagnostics({
      modalText: modal.visible ? modal.text : '',
      buttonTexts: modal.visible ? modal.buttons : [],
      containerType: modal.containerType,
    }));
  }
}

async function waitForUploadCompletionState(page: Page): Promise<'modal' | 'drawer-closed'> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const modal = await getVisibleModal(page);
    if (modal.visible) return 'modal';
    if (!(await isDrawerVisible(page))) return 'drawer-closed';
    await page.waitForTimeout(500);
  }

  const modal = await getVisibleModal(page);
  throw new Error('[上传链路] 上传抽屉/结果弹窗链路断在中间阶段；' + formatModalDiagnostics({
    modalText: modal.visible ? modal.text : '',
    buttonTexts: modal.visible ? modal.buttons : [],
    containerType: modal.containerType,
  }));
}

async function waitForFileInput(page: Page) {
  const fileInput = page.locator('.purchase-ant-drawer input[type="file"], .purchase-ant-drawer-content-wrapper input[type="file"], input[type="file"]').last();
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await fileInput.count().catch(() => 0)) {
      return fileInput;
    }
    await page.waitForTimeout(300);
  }
  throw new Error('[上传抽屉] 抽屉已打开但未找到文件输入框');
}

async function waitForCartCleared(page: Page): Promise<void> {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    await waitForUiSettled(page, { timeout: 3000 });
    const cartState = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('tbody tr')).filter((row) => {
        const el = row as HTMLElement;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden';
      });

      const bodyText = (document.body.innerText || '').replace(/\s+/g, ' ');
      const hasEmptyHint = /暂无数据|暂无商品|空空如也|暂无补货商品|未查询到数据/.test(bodyText);
      return {
        rowCount: rows.length,
        hasEmptyHint,
      };
    });
    const readyForUpload = await isCartReadyForUpload(page);
    log('  [清空结果] rowCount=' + cartState.rowCount + ', emptyHint=' + cartState.hasEmptyHint + ', readyForUpload=' + readyForUpload);

    if (cartState.rowCount === 0 || cartState.hasEmptyHint || readyForUpload) {
      return;
    }
    await page.waitForTimeout(500);
  }

  const readyForUpload = await isCartReadyForUpload(page);
  if (readyForUpload) {
    log('  [清空结果] 页面已进入可上传状态，按清空成功继续');
    return;
  }

  throw new Error('[清空确认] 按钮匹配到了但点击后页面未收敛');
}

function startUploadApiTrace(page: Page): UploadApiTraceContext {
  const trace: UploadApiTraceContext = { responses: [] };

  const listener = async (response: Response) => {
    const url = response.url();
    if (!url.includes('qnh.meituan.com')) return;
    if (!/\/api\//i.test(url)) return;
    if (!/replenish|dispatch|detail|import|upload|purchase|preview/i.test(url)) return;

    const request = response.request();
    let requestBody = request.postData() || '';
    if (requestBody.length > 500) requestBody = requestBody.slice(0, 500);

    let responseBody = '';
    const contentType = response.headers()['content-type'] || '';
    if (/json|text/i.test(contentType)) {
      responseBody = await response.text().catch(() => '');
      if (responseBody.length > 3000) responseBody = responseBody.slice(0, 3000);
    }

    trace.responses.push({
      url,
      status: response.status(),
      method: request.method(),
      requestBody,
      responseBody,
    });

    if (trace.responses.length > 80) {
      trace.responses.shift();
    }
  };

  trace.listener = listener;
  page.on('response', listener);
  return trace;
}

function stopUploadApiTrace(page: Page, trace: UploadApiTraceContext): void {
  if (trace.listener) {
    page.off('response', trace.listener);
  }
}

async function flushUploadApiTrace(page: Page, trace: UploadApiTraceContext, stage: string): Promise<void> {
  stopUploadApiTrace(page, trace);
  await page.waitForTimeout(800);

  const relevant = trace.responses
    .filter((item) => /replenish|dispatch|detail|import|upload|purchase|preview/i.test(item.url + ' ' + (item.requestBody || '') + ' ' + (item.responseBody || '')))
    .slice(-12);

  if (relevant.length === 0) {
    log('  [' + stage + '] 未捕获到上传相关接口响应');
    return;
  }

  log('  [' + stage + '] 接口追踪: ' + JSON.stringify(relevant));
}

async function refreshReplenishListNoAfterUpload(page: Page, ctx: StepContext): Promise<void> {
  const oldListNo = ctx.replenishListNo || '';
  ctx.previewNo = '';

  const pageListNo = await detectReplenishListNoFromPage(page);
  const apiListNo = await detectReplenishListNoFromRequests(page);
  const nextListNo = apiListNo || pageListNo || oldListNo;

  if (!nextListNo) {
    throw new Error('[上传后清单号刷新] 未识别到 replenishListNo');
  }

  ctx.replenishListNo = nextListNo;
  if (nextListNo !== oldListNo) {
    log('  [上传后清单号刷新] replenishListNo 已更新: ' + oldListNo + ' -> ' + nextListNo);
  } else {
    log('  [上传后清单号刷新] 继续使用当前 replenishListNo: ' + nextListNo);
  }
}

async function detectReplenishListNoFromPage(page: Page): Promise<string> {
  const fromUrl = getUrlParam(page.url(), 'replenishListNo');
  if (fromUrl) return fromUrl;

  return page.evaluate(() => {
    const text = (document.body.innerText || '').replace(/\s+/g, ' ');
    const match = text.match(/BHQD-\d{8}-\d+/i);
    return match?.[0] || '';
  }).catch(() => '');
}

async function detectReplenishListNoFromRequests(page: Page): Promise<string> {
  const entries = await page.evaluate(() => {
    const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    return resources.slice(-100).map((item) => item.name || '');
  }).catch(() => [] as string[]);

  for (const entry of entries.reverse()) {
    const match = entry.match(/replenishListNo=([^&#]+)/i) || entry.match(/(BHQD-\d{8}-\d+)/i);
    if (match?.[1]) {
      return decodeURIComponent(match[1]);
    }
  }

  return '';
}

function getUrlParam(url: string, key: string): string {
  const normalized = url.replace('#/', '');
  const queryIndex = normalized.indexOf('?');
  if (queryIndex < 0) return '';
  const query = normalized.slice(queryIndex + 1);
  const params = new URLSearchParams(query);
  return params.get(key) || '';
}

async function isDrawerVisible(page: Page): Promise<boolean> {
  for (const selector of DRAWER_SELECTORS) {
    const visible = await page.locator(selector).first().isVisible({ timeout: 300 }).catch(() => false);
    if (visible) return true;
  }
  return false;
}

if (isCliEntry('step-clean-cart.ts', 'step-clean-cart.js', 'step-clean-cart.mjs', 'step-clean-cart.cjs')) {
  (async () => {
    const { loadConfig, parseCLI } = await import('../lib/config');
    const { launchBrowser } = await import('../lib/browser');
    const { ensureLogin } = await import('../lib/page-helpers');
    const { loadContext, createEmptyContext } = await import('../lib/context');

    const { overrides } = parseCLI();
    const config = loadConfig(overrides);
    const { context, page } = await launchBrowser();

    const ctx = loadContext() || createEmptyContext(config.supplier);
    const targetUrl = ctx.replenishListNo
      ? config.baseUrl + '/home.html#/purchase/replenish-dispatch/detail-list?replenishListNo=' + ctx.replenishListNo + '&replenishMode=1'
      : config.baseUrl + '/home.html#/purchase/replenishment/refer?fromTask=0';
    await ensureLogin(page, targetUrl);
    const result = await stepCleanCart(page, config, ctx);
    log('Result: ' + JSON.stringify(result));
    await context.close();
  })().catch(err => { console.error(err); process.exit(1); });
}
