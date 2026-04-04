/**
 * 爆好价活动自动报名（最终闭环版）
 * 流程：活动列表 → 详情报名 → 选择门店 → 导出商品数据 → 转换Excel → 上传 → 提交
 */
import { chromium, Frame, Page, Download, Request, Response } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import ExcelJS from 'exceljs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getTargetFrame, clickSignupButton, selectStoresAndNext } from './shared-utils';
import { transformBaohaojiaWithArtifacts } from './transform-baohao';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const __filename = fileURLToPath(import.meta.url);
const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
let runtimeLogForwarder: RuntimeOptions['onLog'];
const ACTIVITY_URL_BASE = 'https://nr.ele.me/app/eleme-nr-bfe-newretail/common-next';
const KNOWN_BAOHAO_KEYWORDS = [
  '宁波-热销品-3-6月',
  '宁波-畅销品爆好价-3-6月',
  '宁波-高搜流量品-3-6月',
  '【组包】宁波-高搜流量品-3-6月',
];

export interface BaohaojiaAutomationLogEntry {
  data?: any;
  level: 'error' | 'info' | 'warn';
  msg: string;
  ts: string;
}

export type RuntimeOptions = {
  continueAction?: 'continue_review' | 'rerun_recorded';
  initialStock: number;
  continueManifestPath?: string;
  onLog?: (entry: BaohaojiaAutomationLogEntry) => void;
  reportPath?: string;
  reviewMode: 'auto' | 'manual';
  runtimeBaseDir?: string;
  signupMode: 'all' | 'repeat_only' | 'unsigned_only';
};

function parseRuntimeOptions(): RuntimeOptions {
  let initialStock = 9999;
  let reviewMode: 'auto' | 'manual' = 'auto';
  let signupMode: 'all' | 'repeat_only' | 'unsigned_only' = 'all';
  let reportPath = '';
  let continueManifestPath = '';
  let continueAction: 'continue_review' | 'rerun_recorded' = 'continue_review';

  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];

    if (arg === '--initial-stock' && process.argv[index + 1]) {
      const parsed = Number.parseInt(process.argv[index + 1], 10);
      if (Number.isFinite(parsed) && parsed >= 0) {
        initialStock = parsed;
      }
      index += 1;
      continue;
    }

    if (arg === '--review-mode' && process.argv[index + 1]) {
      const raw = `${process.argv[index + 1] || ''}`.trim();
      if (raw === 'manual' || raw === 'auto') {
        reviewMode = raw;
      }
      index += 1;
      continue;
    }

    if (arg === '--signup-mode' && process.argv[index + 1]) {
      const raw = `${process.argv[index + 1] || ''}`.trim();
      if (raw === 'all' || raw === 'repeat_only' || raw === 'unsigned_only') {
        signupMode = raw;
      }
      index += 1;
      continue;
    }

    if (arg === '--report-path' && process.argv[index + 1]) {
      reportPath = `${process.argv[index + 1] || ''}`.trim();
      index += 1;
      continue;
    }

    if (arg === '--continue-manifest' && process.argv[index + 1]) {
      continueManifestPath = `${process.argv[index + 1] || ''}`.trim();
      index += 1;
      continue;
    }

    if (arg === '--continue-action' && process.argv[index + 1]) {
      const raw = `${process.argv[index + 1] || ''}`.trim();
      if (raw === 'continue_review' || raw === 'rerun_recorded') {
        continueAction = raw;
      }
      index += 1;
    }
  }

  return {
    continueAction: continueManifestPath ? continueAction : undefined,
    continueManifestPath: continueManifestPath || undefined,
    initialStock,
    reportPath: reportPath || undefined,
    reviewMode,
    signupMode,
  };
}

type ActivitySourceTab = '已报名活动' | '未报名活动';
type ActivityListTab = '全部活动' | ActivitySourceTab;

type ScannedActivity = {
  fullText: string;
  hasSignupBtn: boolean;
  id: string;
  index: number;
  name: string;
  sourceTab: ActivitySourceTab;
};

type ContinueManifest = {
  activities: Array<{
    activityId?: string;
    activityName: string;
    detailRoute?: string;
    sourceTab: ActivitySourceTab;
    uploadPath?: string;
  }>;
};

let runtimePaths:
  | {
      dataDir: string;
      logDir: string;
      userDataDir: string;
    }
  | undefined;

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function resolveRuntimeBaseDir(runtimeBaseDir?: string) {
  return `${runtimeBaseDir || process.env.DESKTOP_AUTOMATION_BASE_DIR || path.join(__dirname, '..')}`.trim();
}

function setRuntimePaths(runtimeBaseDir?: string) {
  const baseDir = resolveRuntimeBaseDir(runtimeBaseDir);
  runtimePaths = {
    dataDir: path.join(baseDir, 'data'),
    logDir: path.join(baseDir, 'logs'),
    userDataDir: path.join(baseDir, 'user_data'),
  };

  ensureDir(runtimePaths.dataDir);
  ensureDir(runtimePaths.logDir);
  ensureDir(runtimePaths.userDataDir);
}

function getRuntimePaths() {
  if (!runtimePaths) {
    setRuntimePaths();
  }
  return runtimePaths!;
}

function getLogFile() {
  return path.join(getRuntimePaths().logDir, `baohao_${today}.log`);
}

function log(level: string, msg: string, data?: any) {
  const ts = new Date().toISOString();
  const text = `[${ts}] [${level.toUpperCase()}] ${msg}${data ? ' ' + JSON.stringify(data) : ''}`;
  console.log(text);
  fs.appendFileSync(
    getLogFile(),
    JSON.stringify({ ts, level, msg, ...(data ? { data } : {}) }) + '\n',
  );
  if (level === 'info' || level === 'warn' || level === 'error') {
    runtimeLogForwarder?.({ data, level, msg, ts });
  }
}

function isTarget(name: string, fullText: string): boolean {
  const combined = `${name} ${fullText}`;
  if (!(combined.includes('爆好价') || (combined.includes('商品特价') && combined.includes('宁波')))) {
    if (!KNOWN_BAOHAO_KEYWORDS.some(k => combined.includes(k))) return false;
  }
  // 只处理3月份开始的活动，跳过1-2月
  if (combined.includes('03/01') || combined.includes('3-6月') || combined.includes('3.1-')) return true;
  // 排除已过期的1-2月活动
  if (combined.includes('01/') || combined.includes('02/28') || combined.includes('1.19-') || combined.includes('1.26-')) return false;
  return true;
}

function extractActivityIdFromText(value: string) {
  const patterns = [
    /activityId["'=:\s]+(\d{5,})/iu,
    /"activityId"\s*:\s*"?(\d{5,})"?/iu,
    /activityId%22\s*:\s*%22?(\d{5,})/iu,
    /activityId=(\d{5,})/iu,
    /activity_id=(\d{5,})/iu,
  ];
  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return match[1];
  }
  return '';
}

function tryExtractActivityIdFromRequest(request?: Request | null) {
  if (!request) return '';
  const url = decodeURIComponent(request.url() || '');
  const direct = extractActivityIdFromText(url);
  if (direct) return direct;

  const postData = decodeURIComponent(request.postData() || '');
  const fromPostData = extractActivityIdFromText(postData);
  if (fromPostData) return fromPostData;

  try {
    const payload = request.postDataJSON?.();
    const raw = JSON.stringify(payload);
    return extractActivityIdFromText(raw);
  } catch {
    return '';
  }
}

async function getActivityContext(page: Page, frame: Frame) {
  const pageUrl = decodeURIComponent(page.url() || '');
  const frameUrl = decodeURIComponent(frame.url() || '');
  const pageHref = await page
    .evaluate(() => decodeURIComponent(window.location.href || ''))
    .catch(() => '');
  const frameHref = await frame
    .evaluate(() => decodeURIComponent(window.location.href || ''))
    .catch(() => '');

  const activityId =
    extractActivityIdFromText(frameUrl) ||
    extractActivityIdFromText(pageUrl) ||
    extractActivityIdFromText(frameHref) ||
    extractActivityIdFromText(pageHref) ||
    '';

  return {
    activityId,
    detailRoute: frameUrl || frameHref || pageUrl || pageHref,
  };
}

async function saveShot(page: Page, name: string): Promise<string> {
  const file = `${name}_${Date.now()}.png`;
  await page
    .screenshot({ path: path.join(getRuntimePaths().logDir, file), fullPage: false })
    .catch(() => {});
  return file;
}

function buildActivityUrl() {
  return `${ACTIVITY_URL_BASE}?codexReload=${Date.now()}#/pc/platformActivitiesPc/`;
}

async function ensureActivityPage(page: Page): Promise<void> {
  await page.goto(buildActivityUrl(), { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(8000);

  if (page.url().includes('login') || page.url().includes('sso')) {
    log('warn', '检测到未登录，等待手动登录');
    try { execSync('say "请登录饿了么"', { stdio: 'ignore' }); } catch {}
    await page.waitForFunction(() => !window.location.href.includes('login') && !window.location.href.includes('sso'), { timeout: 300000 });
    await page.waitForTimeout(3000);
  }

  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(3000);
}

async function scanCards(frame: Frame, sourceTab: ActivitySourceTab): Promise<ScannedActivity[]> {
  return frame.evaluate(() => {
    const normalizeCardIdentity = (rawText: string) => {
      return rawText
        .replace(/\s+/g, ' ')
        .replace(/查看详情|立即报名|追加报名|继续报名|报名中|已报名|下载查看|刷新/gu, '')
        .trim();
    };
    const cards = Array.from(document.querySelectorAll('.zs-act-view-v2, .zs-act-view, [class*="act-view"]'));
    return cards.map((card, i) => {
      const text = (card.textContent || '').replace(/\s+/g, ' ');
      const normalizedText = normalizeCardIdentity(text);
      const id = normalizedText.substring(0, 200);
      const name = normalizedText.substring(0, 160).trim();
      const status = text.includes('已结束') ? 'expired' : text.includes('已报名') ? 'signed_up' : 'available';
      const hasSignupBtn = Array.from(card.querySelectorAll('button, a, span')).some(el => {
        const t = (el.textContent || '').trim();
        return t === '立即报名' || t === '追加报名' || t === '继续报名' || t === '已报名';
      });
      return { index: i, name, fullText: text.substring(0, 800), status, id, hasSignupBtn };
    });
  }).then((items) =>
    items.map((item) => ({
      ...item,
      sourceTab,
    })),
  );
}

async function toPage(frame: Frame, pageNum: number): Promise<void> {
  await frame.evaluate((pn: number) => {
    document.querySelector('.ant-pagination')?.querySelectorAll('li').forEach(li => {
      if (li.textContent?.trim() === String(pn)) (li as HTMLElement).click();
    });
  }, pageNum);
}

async function openDownloadCenter(page: Page, frame: Frame): Promise<void> {
  const tryOpen = async (targetPage: Page, targetFrame: Frame) => {
    const clickedIcon = await targetPage.evaluate(() => {
      const selectors = [
        '.eb-task-open',
        '[class*="task-open"]',
        '[class*="download-center"]',
        '[aria-label*="下载"]',
      ];
      for (const selector of selectors) {
        const target = document.querySelector(selector) as HTMLElement | null;
        if (!target) continue;
        const rect = target.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        target.click();
        return selector;
      }
      return '';
    }).catch(() => '');

    if (clickedIcon) {
      log('info', '  → 已点击下载中心图标', { selector: clickedIcon });
      await targetPage.waitForTimeout(1200);
      return true;
    }

    const clickDownloadView = async (surface: Page | Frame) => {
      return surface.evaluate(() => {
        const isVisible = (el: Element) => {
          const rect = (el as HTMLElement).getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };

        const nodes = Array.from(document.querySelectorAll('button, a, span, div, [role="button"], .ant-btn'));
        for (const node of nodes) {
          const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
          if (!isVisible(node) || !text) continue;
          if (text === '下载查看' || text.includes('下载查看')) {
            const clickable =
              (node.closest('button, a, [role="button"], .ant-btn') as HTMLElement | null) ||
              (node as HTMLElement);
            clickable.click();
            return text;
          }
        }
        return '';
      }).catch(() => '');
    };

    const clickedInPage = await targetPage.evaluate(() => {
      const findAndClick = () => {
        const els = Array.from(document.querySelectorAll('a, button, span, div'));
        for (const el of els) {
          const text = (el.textContent || '').trim();
          const rect = el.getBoundingClientRect();
          const visible = rect.width > 0 && rect.height > 0;
          if (!visible || !text.includes('下载中心')) continue;

          const clickable =
            (el.closest('button, a, [role="button"], .ant-btn, .ant-dropdown-trigger') as HTMLElement | null) ||
            (el as HTMLElement);
          clickable.click();
          return true;
        }
        return false;
      };
      return findAndClick();
    });

    if (!clickedInPage) {
      const clickedInFrame = await targetFrame.evaluate(() => {
        const findAndClick = () => {
          const els = Array.from(document.querySelectorAll('a, button, span, div'));
          for (const el of els) {
            const text = (el.textContent || '').trim();
            const rect = el.getBoundingClientRect();
            const visible = rect.width > 0 && rect.height > 0;
            if (!visible || !text.includes('下载中心')) continue;

            const clickable =
              (el.closest('button, a, [role="button"], .ant-btn, .ant-dropdown-trigger') as HTMLElement | null) ||
              (el as HTMLElement);
            clickable.click();
            return true;
          }
          return false;
        };
        return findAndClick();
      });

      if (!clickedInFrame) {
        const clickedDownloadView =
          (await clickDownloadView(targetFrame)) || (await clickDownloadView(targetPage));
        if (!clickedDownloadView) {
          return false;
        }
        log('info', '  → 已点击下载查看入口', { text: clickedDownloadView });
      }
    }

    await targetPage.waitForTimeout(1200);
    return true;
  };

  if (await tryOpen(page, frame)) {
    return;
  }

  await ensureActivityPage(page);
  const refreshedFrame = await getTargetFrame(page);
  if (await tryOpen(page, refreshedFrame)) {
    return;
  }

  throw new Error('未找到下载中心入口');
}

async function clickDownloadInCenter(page: Page, frame: Frame): Promise<Download> {
  const waitDownloadAfterAction = async (waitMs: number): Promise<Download | null> => {
    const dl = await Promise.race([
      page.waitForEvent('download', { timeout: waitMs }).catch(() => null),
      page.waitForTimeout(waitMs + 200).then(() => null),
    ]);
    return dl;
  };

  const clickTaskDownload = async (surface: Page | Frame) => {
    return surface.evaluate(() => {
      const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
      const isVisible = (element: Element) => {
        const rect = (element as HTMLElement).getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const wrappers = Array.from(
        document.querySelectorAll(
          '.task-item-wrapper, .task-item, [class*="task-item"], [class*="download-item"]',
        ),
      ).filter(isVisible);

      const targetWrapper = wrappers.find((wrapper) => {
        const text = normalize(wrapper.textContent || '');
        if (!text) return false;
        const looksLikeTemplate = /模板/.test(text);
        const looksLikeExportData =
          /导出.*商品数据|商品数据|邀约商品/.test(text) && !looksLikeTemplate;
        return looksLikeExportData;
      });

      if (targetWrapper) {
        (targetWrapper as HTMLElement).dispatchEvent(
          new MouseEvent('mouseover', { bubbles: true }),
        );
        const action =
          Array.from(
            targetWrapper.querySelectorAll(
              '.task-item-btn, button, a, [role="button"], .ant-btn, .ant-btn-link',
            ),
          )
            .map((item) => item as HTMLElement)
            .find((item) => {
              const text = normalize(item.textContent || '');
              return isVisible(item) && /(下载|重新下载|立即下载|下载文件)/.test(text);
            }) ||
          (targetWrapper.querySelector('.task-item-btn') as HTMLElement | null);

        if (action) {
          action.click();
          return `clicked-task:${normalize(targetWrapper.textContent || '')}`;
        }
      }

      return '';
    });
  };

  const clickFromPage = async () => {
    return page.evaluate(() => {
      const isVisible = (el: Element) => {
        const rect = (el as HTMLElement).getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const normalize = (t: string) => t.replace(/\s+/g, ' ').trim();
      const actionText = /^(立即下载|重新下载|下载文件|下载)$/;
      const weakActionText = /(下载|重下|重新)/;
      const nonActionText = /(下载中心|下载已完成|已下载|下载完成|任务详情|记录|时间|状态|文件名|模板)/;

      const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], .ant-btn, .ant-btn-link'));

      const exactTarget = candidates.find(el => {
        const text = normalize(el.textContent || '');
        if (!isVisible(el) || !text || nonActionText.test(text)) return false;
        return actionText.test(text);
      });

      if (exactTarget) {
        (exactTarget as HTMLElement).click();
        return `clicked:${normalize(exactTarget.textContent || '')}`;
      }

      const fallbackTarget = candidates.find(el => {
        const text = normalize(el.textContent || '');
        if (!isVisible(el) || !text || nonActionText.test(text)) return false;
        return weakActionText.test(text);
      });

      if (fallbackTarget) {
        (fallbackTarget as HTMLElement).click();
        return `clicked:${normalize(fallbackTarget.textContent || '')}`;
      }

      const iconTarget = Array.from(document.querySelectorAll('button[class*="download"], a[class*="download"], [role="button"][class*="download"], [aria-label*="下载"]')).find(isVisible);
      if (iconTarget) {
        (iconTarget as HTMLElement).click();
        return 'clicked:icon-download';
      }

      const visibleTexts = candidates
        .map(el => normalize(el.textContent || ''))
        .filter(t => t && t.length <= 30)
        .slice(0, 30);
      return `none:${visibleTexts.join('|')}`;
    });
  };

  const clickFromFrame = async () => {
    return frame.evaluate(() => {
      const isVisible = (el: Element) => {
        const rect = (el as HTMLElement).getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const normalize = (t: string) => t.replace(/\s+/g, ' ').trim();
      const actionText = /^(立即下载|重新下载|下载文件|下载)$/;
      const weakActionText = /(下载|重下|重新)/;
      const nonActionText = /(下载中心|下载已完成|已下载|下载完成|任务详情|记录|时间|状态|文件名|模板)/;

      const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], .ant-btn, .ant-btn-link'));

      const exactTarget = candidates.find(el => {
        const text = normalize(el.textContent || '');
        if (!isVisible(el) || !text || nonActionText.test(text)) return false;
        return actionText.test(text);
      });

      if (exactTarget) {
        (exactTarget as HTMLElement).click();
        return `clicked:${normalize(exactTarget.textContent || '')}`;
      }

      const fallbackTarget = candidates.find(el => {
        const text = normalize(el.textContent || '');
        if (!isVisible(el) || !text || nonActionText.test(text)) return false;
        return weakActionText.test(text);
      });

      if (fallbackTarget) {
        (fallbackTarget as HTMLElement).click();
        return `clicked:${normalize(fallbackTarget.textContent || '')}`;
      }

      const iconTarget = Array.from(document.querySelectorAll('button[class*="download"], a[class*="download"], [role="button"][class*="download"], [aria-label*="下载"]')).find(isVisible);
      if (iconTarget) {
        (iconTarget as HTMLElement).click();
        return 'clicked:icon-download';
      }

      const visibleTexts = candidates
        .map(el => normalize(el.textContent || ''))
        .filter(t => t && t.length <= 30)
        .slice(0, 30);
      return `none:${visibleTexts.join('|')}`;
    });
  };

  const readTaskPanelSnapshot = async () => {
    return page.evaluate(() => {
      const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
      const wrappers = Array.from(
        document.querySelectorAll(
          '.task-item-wrapper, .task-item, [class*="task-item"], [class*="download-item"]',
        ),
      ).map((item) => normalize(item.textContent || '')).filter(Boolean);
      return wrappers.slice(0, 10);
    }).catch(() => [] as string[]);
  };

  for (let i = 1; i <= 120; i++) {
    const pageTaskResult = await clickTaskDownload(page).catch(() => '');
    const frameTaskResult = pageTaskResult
      ? ''
      : await clickTaskDownload(frame).catch(() => '');

    let pageResult = pageTaskResult;
    let frameResult = frameTaskResult;

    if (!pageResult && !frameResult) {
      pageResult = await clickFromPage();
      frameResult = pageResult.startsWith('clicked:') ? 'skip' : await clickFromFrame();
    }

    if (
      pageResult.startsWith('clicked:') ||
      frameResult.startsWith('clicked:') ||
      pageResult.startsWith('clicked-task:') ||
      frameResult.startsWith('clicked-task:')
    ) {
      log('info', `  → 下载中心点击下载尝试#${i}`, { pageResult, frameResult });
      const maybeDownload = await waitDownloadAfterAction(4500);
      if (maybeDownload) return maybeDownload;
    } else if (i === 1 || i % 5 === 0) {
      const taskItems = i === 1 || i % 10 === 0 ? await readTaskPanelSnapshot() : [];
      log('info', `  → 下载中心尚未出现下载动作#${i}`, {
        frameResult,
        pageResult,
        taskItems,
      });
    }

    if (i % 15 === 0) {
      await openDownloadCenter(page, frame).catch(() => {});
    }

    await page.waitForTimeout(1200);
  }

  await page.screenshot({
    path: path.join(getRuntimePaths().logDir, `baohao_download_center_timeout_${Date.now()}.png`),
  }).catch(() => {});
  throw new Error('下载中心中未找到可点击的下载按钮（已轮询等待）');
}

async function exportTemplate(
  page: Page,
  frame: Frame,
): Promise<{ activityId?: string; exportTaskId?: string; savePath: string }> {
  log('info', '  → 导出商品数据模板（导出后进入下载中心下载）');

  const candidateButtons = [
    'button:has-text("导出商品数据")',
    'button:has-text("导出招商商品数据")',
    'button:has-text("导出招商文件")',
    'button:has-text("导出")',
  ];

  let clicked = false;
  const exportTaskResponsePromise = page
    .waitForResponse(
      (response) =>
        /download\.exporttask/i.test(response.url()) &&
        response.request().method() === 'POST',
      { timeout: 20_000 },
    )
    .catch(() => null);

  for (const sel of candidateButtons) {
    const btn = frame.locator(sel);
    if (await btn.count() > 0) {
      await btn.first().click();
      clicked = true;
      log('info', `  → 已点击导出按钮: ${sel}`);
      break;
    }
  }

  if (!clicked) {
    throw new Error('未找到导出按钮（导出商品数据/导出招商文件）');
  }

  const exportTaskResponse = await exportTaskResponsePromise;

  let exportTaskId = '';
  let activityId = '';
  if (exportTaskResponse) {
    try {
      const payload = (await exportTaskResponse.json()) as any;
      exportTaskId =
        `${payload?.data?.data?.taskId || payload?.data?.taskId || ''}`.trim();
      activityId =
        `${payload?.data?.data?.activityId || payload?.data?.activityId || ''}`.trim() ||
        tryExtractActivityIdFromRequest(exportTaskResponse.request());
      log('info', '  → 导出任务已创建', {
        activityId: activityId || 'unknown',
        taskId: exportTaskId || 'unknown',
      });
    } catch {}
  }

  await page.waitForTimeout(2000);

  let download: Download | null = null;
  const directDownload = await page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
  if (directDownload) {
    log('info', '  → 导出后直接触发下载（兜底路径）');
    download = directDownload;
  } else {
    if (exportTaskId) {
      const exportReady = await page
        .waitForResponse(
          async (response) => {
            if (!/gei\.readtask/i.test(response.url())) return false;
            if (!decodeURIComponent(response.url()).includes(exportTaskId)) return false;
            try {
              const payload = (await response.json()) as any;
              return payload?.data?.data === true;
            } catch {
              return false;
            }
          },
          { timeout: 90_000 },
        )
        .catch(() => null);

      if (exportReady) {
        log('info', '  → 导出任务已完成，可开始下载', { taskId: exportTaskId });
      } else {
        log('warn', '  → 导出任务等待超时，转入下载中心兜底轮询', {
          taskId: exportTaskId,
        });
      }
    }

    await openDownloadCenter(page, frame);
    await page.waitForTimeout(1500);
    const downloadFrame = await getTargetFrame(page);
    download = await clickDownloadInCenter(page, downloadFrame);
    log('info', '  → 已在下载中心点击下载');
  }

  const suggested = download.suggestedFilename() || `baohao_export_${Date.now()}.xlsx`;
  const savePath = path.join(getRuntimePaths().dataDir, `${Date.now()}_${suggested}`);
  await download.saveAs(savePath);
  log('info', '  → 导出文件已保存', { file: savePath });
  return {
    activityId: activityId || undefined,
    exportTaskId: exportTaskId || undefined,
    savePath,
  };
}

async function countExcelDataRows(filePath: string): Promise<number> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  if (!ws) return 0;

  let count = 0;
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = [1, 2, 3, 4, 5].map(c => String(row.getCell(c).value || '').trim());
    const hasAny = values.some(v => v.length > 0);
    if (hasAny) count++;
  });

  return count;
}

async function uploadProcessedExcel(page: Page, frame: Frame, filePath: string): Promise<void> {
  log('info', '  → 上传处理后的Excel');
  const fileInput = frame.locator('input[type="file"]');
  if (await fileInput.count() === 0) {
    throw new Error('未找到上传文件输入框 input[type="file"]');
  }
  await fileInput.first().setInputFiles(filePath);
  await page.waitForTimeout(6000);
}

async function submitAndVerify(page: Page, frame: Frame): Promise<{ success: boolean; message: string }> {
  log('info', '  → 提交报名');

  const clickSubmitInFrame = async (): Promise<boolean> => {
    return frame.evaluate(() => {
      const isVisible = (el: Element) => {
        const rect = (el as HTMLElement).getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const normalize = (t: string) => t.replace(/\s+/g, ' ').trim();
      const submitTexts = ['提交报名', '确认报名', '提交', '确认'];
      const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], .ant-btn'));

      const target = candidates.find(el => {
        const text = normalize(el.textContent || '');
        if (!isVisible(el) || !text) return false;
        if ((el as HTMLButtonElement).disabled) return false;
        return submitTexts.some(t => text === t || text.includes(t));
      });

      if (target) {
        (target as HTMLElement).click();
        return true;
      }
      return false;
    });
  };

  const clickSubmitInPage = async (): Promise<boolean> => {
    return page.evaluate(() => {
      const isVisible = (el: Element) => {
        const rect = (el as HTMLElement).getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const normalize = (t: string) => t.replace(/\s+/g, ' ').trim();
      const submitTexts = ['提交报名', '确认报名', '提交', '确认'];
      const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], .ant-btn'));

      const target = candidates.find(el => {
        const text = normalize(el.textContent || '');
        if (!isVisible(el) || !text) return false;
        if ((el as HTMLButtonElement).disabled) return false;
        return submitTexts.some(t => text === t || text.includes(t));
      });

      if (target) {
        (target as HTMLElement).click();
        return true;
      }
      return false;
    });
  };

  let clicked = await clickSubmitInFrame();
  if (!clicked) clicked = await clickSubmitInPage();

  if (!clicked) {
    const pageBtnTexts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button, a, [role="button"], .ant-btn'))
        .map(el => (el.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(t => t && t.length <= 20)
        .slice(0, 25)
    ).catch(() => [] as string[]);

    const frameBtnTexts = await frame.evaluate(() =>
      Array.from(document.querySelectorAll('button, a, [role="button"], .ant-btn'))
        .map(el => (el.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(t => t && t.length <= 20)
        .slice(0, 25)
    ).catch(() => [] as string[]);

    log('warn', '  → 未找到提交按钮', { pageBtnTexts, frameBtnTexts });
    return { success: false, message: '未找到提交按钮（可能需要人工确认页面状态）' };
  }

  await page.waitForTimeout(2500);

  const frameConfirmBtn = frame.locator('.ant-modal .ant-btn-primary');
  if (await frameConfirmBtn.count() > 0) {
    await frameConfirmBtn.first().click();
    await page.waitForTimeout(2000);
    log('info', '  → 已确认弹窗(frame)');
  }

  const pageConfirmBtn = page.locator('.ant-modal .ant-btn-primary');
  if (await pageConfirmBtn.count() > 0) {
    await pageConfirmBtn.first().click();
    await page.waitForTimeout(2000);
    log('info', '  → 已确认弹窗(page)');
  }

  const frameText = await frame.evaluate(() => document.body.innerText.substring(0, 6000)).catch(() => '');
  const pageText = await page.evaluate(() => document.body.innerText.substring(0, 6000)).catch(() => '');
  const resultText = `${frameText}\n${pageText}`;

  if (resultText.includes('报名成功') || resultText.includes('已报名') || resultText.includes('报名完成')) {
    return { success: true, message: '报名成功' };
  }
  if (resultText.includes('报名失败')) {
    return { success: false, message: '报名失败' };
  }
  if (resultText.includes('商品为空') || resultText.includes('未选择商品') || resultText.includes('请先添加商品')) {
    return { success: false, message: '提交失败：商品为空或未正确导入' };
  }
  if (resultText.includes('添加商品') || resultText.includes('选择商品') || resultText.includes('UPC')) {
    return { success: false, message: '仍停留在商品步骤，可能存在校验未通过' };
  }

  return { success: false, message: '已点击提交，但结果未明确（需人工复核）' };
}

async function searchKeyword(page: Page, frame: Frame, keyword: string): Promise<void> {
  // 优先在 frame 中操作搜索
  const filled = await frame.evaluate((kw) => {
    const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
    for (const input of inputs) {
      const p = (input.placeholder || '').trim();
      if (p.includes('搜索') || p.includes('活动') || p.includes('名称') || input.type === 'text') {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (nativeInputValueSetter) nativeInputValueSetter.call(input, kw);
        else input.value = kw;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        return `filled:${p}`;
      }
    }
    return 'no-input';
  }, keyword).catch(() => 'error');

  log('info', `搜索关键词: ${keyword}`, { filled });

  // 也尝试点击搜索按钮
  await frame.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, .ant-btn, [role="button"]'));
    const searchBtn = btns.find(el => {
      const text = (el.textContent || '').trim();
      return text === '搜索' || text === '查询';
    }) as HTMLElement | undefined;
    if (searchBtn) searchBtn.click();
  }).catch(() => {});

  await page.waitForTimeout(2000);
}

async function clickFilterTag(page: Page, frame: Frame, tagText: string): Promise<boolean> {
  const clicked = await frame.evaluate((tag) => {
    const isVisible = (el: Element) => {
      const rect = (el as HTMLElement).getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const candidates = Array.from(document.querySelectorAll('span, a, div, label, button, [class*="tag"], [class*="filter"], [class*="label"]'));
    const target = candidates.find(el => {
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!isVisible(el) || !text || text.length > 24) return false;
      return text === tag || text.startsWith(tag);
    }) as HTMLElement | undefined;

    if (target) {
      const clickable = (target.closest('a, button, [role="button"], label, [class*="tag"], [class*="filter"]') as HTMLElement | null) || target;
      clickable.click();
      return true;
    }
    return false;
  }, tagText).catch(() => false);

  if (clicked) {
    log('info', `已点击筛选标签: ${tagText}`);
    await page.waitForTimeout(3000);
  }
  return clicked;
}

async function clickVisibleText(
  page: Page,
  frame: Frame,
  textPattern: string,
): Promise<boolean> {
  const clickWithPattern = async (surface: Page | Frame) => {
    return surface.evaluate((rawPattern) => {
      const pattern = new RegExp(rawPattern);
      const isVisible = (el: Element) => {
        const rect = (el as HTMLElement).getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const nodes = Array.from(document.querySelectorAll('.ant-tabs-tab, button, a, span, div, label'));
      const tab = nodes.find((el) => {
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        return isVisible(el) && text.length <= 24 && pattern.test(text);
      }) as HTMLElement | undefined;

      if (!tab) return false;
      const clickable =
        (tab.closest('[role="tab"], .ant-tabs-tab, button, a, label') as HTMLElement | null) || tab;
      clickable.click();
      return true;
    }, textPattern).catch(() => false);
  };

  const clickedInFrame = await clickWithPattern(frame);
  if (clickedInFrame) return true;
  return await clickWithPattern(page);
}

async function switchToBaohaoTab(page: Page, frame: Frame): Promise<void> {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const clicked = await clickFilterTag(page, frame, '爆好价');
    if (clicked) {
      await page.waitForTimeout(2500);
      return;
    }

    if (attempt < 4) {
      log('warn', `未找到“爆好价”营销标签，准备重试`, { attempt });
      await ensureActivityPage(page);
      frame = await getTargetFrame(page);
      await page.waitForTimeout(2000);
      continue;
    }

    const frameText = await frame
      .evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim().substring(0, 600))
      .catch(() => '');
    const pageText = await page
      .evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim().substring(0, 600))
      .catch(() => '');
    throw new Error(
      `未找到“爆好价”营销标签 | frame=${frameText.substring(0, 120)} | page=${pageText.substring(0, 120)}`,
    );
  }
}

async function switchToActivityTab(
  page: Page,
  frame: Frame,
  sourceTab: ActivitySourceTab,
): Promise<void> {
  const clicked = await clickVisibleText(page, frame, sourceTab);
  if (!clicked) {
    throw new Error(`未找到活动 tab: ${sourceTab}`);
  }
  log('info', `已切换活动 tab: ${sourceTab}`);
  await page.waitForTimeout(2500);
}

async function switchToAllActivities(page: Page, frame: Frame): Promise<void> {
  const clickInPage = await page.evaluate(() => {
    const isVisible = (el: Element) => {
      const rect = (el as HTMLElement).getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const nodes = Array.from(document.querySelectorAll('.ant-tabs-tab, button, a, span, div'));
    const tab = nodes.find(el => {
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      return isVisible(el) && (text === '全部活动' || text.includes('全部活动'));
    }) as HTMLElement | undefined;

    if (!tab) return false;
    const clickable = (tab.closest('[role="tab"], .ant-tabs-tab, button, a') as HTMLElement | null) || tab;
    clickable.click();
    return true;
  });

  if (!clickInPage) {
    await frame.evaluate(() => {
      const isVisible = (el: Element) => {
        const rect = (el as HTMLElement).getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const nodes = Array.from(document.querySelectorAll('.ant-tabs-tab, button, a, span, div'));
      const tab = nodes.find(el => {
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        return isVisible(el) && (text === '全部活动' || text.includes('全部活动'));
      }) as HTMLElement | undefined;

      if (!tab) return;
      const clickable = (tab.closest('[role="tab"], .ant-tabs-tab, button, a') as HTMLElement | null) || tab;
      clickable.click();
    }).catch(() => {});
  }

  await page.waitForTimeout(2000);
}

export function resolveListTabForSource(sourceTab: ActivitySourceTab): ActivityListTab {
  return sourceTab === '已报名活动' ? '全部活动' : '未报名活动';
}

export function isRepeatSignupCandidate(item: Pick<ScannedActivity, 'fullText' | 'hasSignupBtn'>) {
  if (/已结束/u.test(item.fullText)) return false;
  if (/报名中|已报名/u.test(item.fullText)) return true;
  if (/查看详情|操作进度/u.test(item.fullText) && !/立即报名/u.test(item.fullText)) return true;
  return false;
}

async function backToList(page: Page, frame: Frame): Promise<Frame> {
  await page.evaluate(() => {
    const closeSelectors = [
      '.ant-modal-close',
      '.ant-modal-close-x',
      '.ant-modal .ant-btn',
      '.ant-modal .ant-btn-primary',
    ];
    for (const selector of closeSelectors) {
      const nodes = Array.from(document.querySelectorAll(selector));
      for (const node of nodes) {
        const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
        const rect = (node as HTMLElement).getBoundingClientRect();
        const visible = rect.width > 0 && rect.height > 0;
        if (!visible) continue;
        if (
          selector.includes('close') ||
          ['关闭', '我知道了', '确认', '确定'].some((label) => text.includes(label))
        ) {
          (node as HTMLElement).click();
          return true;
        }
      }
    }
    return false;
  }).catch(() => false);
  await page.waitForTimeout(800);
  await ensureActivityPage(page);
  return await getTargetFrame(page);
}

async function runOneActivity(
  page: Page,
  frame: Frame,
  target: ScannedActivity,
  idx: number,
  runtimeOptions: RuntimeOptions,
  options: {
    continueUploadPath?: string;
    isContinueSubmit?: boolean;
    skipOpenFromList?: boolean;
  } = {},
) {
  const shots: string[] = [];
  let detailContext = await getActivityContext(page, frame);
  let detailFrame = frame;

  if (!options.skipOpenFromList) {
    const card = frame.locator('.zs-act-view-v2, .zs-act-view, [class*="act-view"]').nth(target.index);
    const cardSignupBtn = card.locator('text=/立即报名|追加报名|继续报名/');
    if (await cardSignupBtn.count() > 0) {
      await cardSignupBtn.first().click();
    } else {
      const opened = await card.evaluate((el) => {
        const candidates = Array.from(el.querySelectorAll('button, a, span, div'));
        const targetEl = candidates.find(node => {
          const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
          return text.includes('已报名') || text.includes('追加报名') || text.includes('继续报名');
        }) as HTMLElement | undefined;
        if (targetEl) {
          const clickable = (targetEl.closest('button, a, [role="button"], .ant-btn') as HTMLElement | null) || targetEl;
          clickable.click();
          return true;
        }
        return false;
      });

      if (!opened) {
        await card.click().catch(() => {});
      }
    }

    await page.waitForTimeout(5000);
    shots.push(await saveShot(page, `baohao_detail_${idx}`));

    detailFrame = await getTargetFrame(page);
    detailContext = await getActivityContext(page, detailFrame);
  } else {
    detailFrame = await getTargetFrame(page);
    detailContext = await getActivityContext(page, detailFrame);
    shots.push(await saveShot(page, `baohao_detail_${idx}`));
  }

  // 诊断：详情页按钮快照
  const detailBtns = await detailFrame.evaluate(() => {
    return Array.from(document.querySelectorAll('button, a, [role="button"], .ant-btn'))
      .map(el => {
        const rect = (el as HTMLElement).getBoundingClientRect();
        return {
          text: (el.textContent || '').replace(/\s+/g, ' ').trim().substring(0, 40),
          tag: el.tagName,
          visible: rect.width > 0 && rect.height > 0,
          disabled: (el as HTMLButtonElement).disabled || false,
        };
      })
      .filter(b => b.text.length > 0 && b.text.length <= 30);
  }).catch(() => []);
  log('info', `  → 详情页按钮列表`, { buttons: detailBtns.slice(0, 20) });

  // 优先检查"操作进度"按钮（已报名活动）
  let clickedDetail = false;
  const hasProgressBtn = detailBtns.some(b => b.text === '操作进度' && b.visible);
  
  if (hasProgressBtn) {
    // 已报名活动：点击"操作进度"进入追加商品流程
    const clickedProgress = await detailFrame.evaluate(() => {
      const labels = ['操作进度', '追加商品', '添加商品'];
      for (const btn of Array.from(document.querySelectorAll('button, a, [role="button"], .ant-btn'))) {
        const text = (btn.textContent || '').replace(/\s+/g, ' ').trim();
        if (labels.some(label => text === label)) {
          const r = (btn as HTMLElement).getBoundingClientRect();
          if (r.width > 0 && r.height > 0) { (btn as HTMLElement).click(); return text; }
        }
      }
      return '';
    }).catch(() => '');

    if (!clickedProgress) {
      const clickedProgressPage = await page.evaluate(() => {
        const labels = ['操作进度', '追加商品', '添加商品'];
        for (const btn of Array.from(document.querySelectorAll('button, a, [role="button"], .ant-btn'))) {
          const text = (btn.textContent || '').replace(/\s+/g, ' ').trim();
          if (labels.some(label => text === label)) {
            const r = (btn as HTMLElement).getBoundingClientRect();
            if (r.width > 0 && r.height > 0) { (btn as HTMLElement).click(); return text; }
          }
        }
        return '';
      }).catch(() => '');

      if (clickedProgressPage) {
        log('info', `  → 已点击: ${clickedProgressPage}（page层）`);
        clickedDetail = true;
      }
    } else {
      log('info', `  → 已点击: ${clickedProgress}（frame层）`);
      clickedDetail = true;
    }

    if (clickedDetail) {
      await page.waitForTimeout(5000);
      shots.push(await saveShot(page, `baohao_progress_${idx}`));

      // 进入操作进度后，诊断当前页面按钮
      const progressFrame = await getTargetFrame(page);
      const progressBtns = await progressFrame.evaluate(() => {
        return Array.from(document.querySelectorAll('button, a, [role="button"], .ant-btn'))
          .map(el => {
            const rect = (el as HTMLElement).getBoundingClientRect();
            return {
              text: (el.textContent || '').replace(/\s+/g, ' ').trim().substring(0, 40),
              visible: rect.width > 0 && rect.height > 0,
            };
          })
          .filter(b => b.visible && b.text.length > 0 && b.text.length <= 30);
      }).catch(() => []);
      log('info', '  → 操作进度页按钮', { buttons: progressBtns });

      // 尝试点击"追加报名"或"追加商品"
      const clickedAppend = await progressFrame.evaluate(() => {
        const labels = ['追加报名', '追加商品', '添加商品', '继续报名', '立即报名'];
        for (const btn of Array.from(document.querySelectorAll('button, a, [role="button"], .ant-btn'))) {
          const text = (btn.textContent || '').replace(/\s+/g, ' ').trim();
          if (labels.some(label => text === label || text.includes(label))) {
            const r = (btn as HTMLElement).getBoundingClientRect();
            if (r.width > 0 && r.height > 0) { (btn as HTMLElement).click(); return text; }
          }
        }
        return '';
      }).catch(() => '');

      if (clickedAppend) {
        log('info', `  → 已点击追加入口: ${clickedAppend}`);
        await page.waitForTimeout(5000);
        // 重新获取frame，因为点击后页面可能变化
        detailFrame = await getTargetFrame(page);
      } else {
        return { success: false, message: '进入操作进度后未找到追加报名/追加商品入口', screenshots: shots };
      }
    }
  } else {
    // 新活动：点击"立即报名"
    log('info', '  → 新活动，尝试点击"立即报名"');
    
    clickedDetail = await clickSignupButton(detailFrame);
    
    if (!clickedDetail) {
      clickedDetail = await page.evaluate(() => {
        const labels = ['立即报名', '追加报名', '继续报名', '报名'];
        for (const btn of Array.from(document.querySelectorAll('button, a, [role="button"], .ant-btn'))) {
          const text = (btn.textContent || '').replace(/\s+/g, ' ').trim();
          if (labels.some(label => text === label)) {
            const r = (btn as HTMLElement).getBoundingClientRect();
            if (r.width > 0 && r.height > 0) { (btn as HTMLElement).click(); return true; }
          }
        }
        return false;
      }).catch(() => false);
    }
    
    if (clickedDetail) {
      log('info', '  → 已点击"立即报名"');
    }
  }

  if (!clickedDetail) {
    return { success: false, message: `详情页未找到可点击报名按钮`, screenshots: shots };
  }

  await page.waitForTimeout(5000);

  const storeResult = await selectStoresAndNext(
    detailFrame,
    page,
  );
  if (!storeResult.success) {
    return {
      success: false,
      sourceTab: target.sourceTab,
      storeCount: storeResult.storeCount,
      storeIds: storeResult.storeIds,
      storeNames: storeResult.storeNames,
      activityId: detailContext.activityId || target.id,
      detailRoute: detailContext.detailRoute || page.url(),
      message: `门店/向导步骤失败: ${storeResult.error || '未知错误'}`,
      screenshots: shots,
    };
  }

  shots.push(await saveShot(page, `baohao_step2_${idx}`));

  let exported = '';
  let exportedRowCount = 0;
  let exportTaskId = '';
  let processedPath = options.continueUploadPath || '';
  let auditPath = '';
  let processedRowCount = 0;

  if (!options.isContinueSubmit) {
    const exportResult = await exportTemplate(page, detailFrame);
    exported = exportResult.savePath;
    exportTaskId = exportResult.exportTaskId || '';
    if (exportResult.activityId) {
      detailContext.activityId = exportResult.activityId;
    }
    shots.push(await saveShot(page, `baohao_exported_${idx}`));

    exportedRowCount = await countExcelDataRows(exported);
    log('info', '  → 导出文件数据行统计', { file: exported, rows: exportedRowCount });

    if (exportedRowCount === 0) {
      return {
        success: false,
        activityId: detailContext.activityId || target.id,
        detailRoute: detailContext.detailRoute || page.url(),
        sourceTab: target.sourceTab,
        message: '导出商品数据为空，已跳过上传和提交（无需执行下一步）',
        screenshots: shots,
        exported,
        exportTaskId,
        processed: null,
        storeCount: storeResult.storeCount,
        storeIds: storeResult.storeIds,
        storeNames: storeResult.storeNames,
        exportedRowCount,
        processedRowCount: 0,
      };
    }

    const transformed = await transformBaohaojiaWithArtifacts(
      exported,
      runtimeOptions.initialStock,
    );
    processedPath = transformed.uploadPath;
    auditPath = transformed.auditPath;
    processedRowCount = await countExcelDataRows(transformed.uploadPath);
    log('info', '  → 转换完成', {
      audit: transformed.auditPath,
      input: exported,
      output: transformed.uploadPath,
      rows: processedRowCount,
    });

    if (processedRowCount === 0) {
      return {
        success: false,
        audit: transformed.auditPath,
        activityId: detailContext.activityId || target.id,
        detailRoute: detailContext.detailRoute || page.url(),
        sourceTab: target.sourceTab,
        message: '转换后Excel为空，已跳过上传和提交（需人工核查转换规则）',
        screenshots: shots,
        exported,
        exportTaskId,
        processed: transformed.uploadPath,
        storeCount: storeResult.storeCount,
        storeIds: storeResult.storeIds,
        storeNames: storeResult.storeNames,
        exportedRowCount,
        processedRowCount,
      };
    }

    if (runtimeOptions.reviewMode === 'manual') {
      return {
        success: false,
        activityId: detailContext.activityId || target.id,
        audit: transformed.auditPath,
        detailRoute: detailContext.detailRoute || page.url(),
        exported,
        exportedRowCount,
        exportTaskId,
        message: '已生成上传文件和审计文件，等待人工审核',
        processed: transformed.uploadPath,
        processedRowCount,
        screenshots: shots,
        sourceTab: target.sourceTab,
        status: 'waiting_review',
        storeCount: storeResult.storeCount,
        storeIds: storeResult.storeIds,
        storeNames: storeResult.storeNames,
        waitingReview: true,
      };
    }
  } else {
    processedRowCount = await countExcelDataRows(processedPath);
  }

  await uploadProcessedExcel(page, detailFrame, processedPath);
  shots.push(await saveShot(page, `baohao_uploaded_${idx}`));

  const submitResult = await submitAndVerify(page, detailFrame);
  shots.push(await saveShot(page, `baohao_submitted_${idx}`));

  return {
    activityId: detailContext.activityId || target.id,
    exportTaskId: exportTaskId || undefined,
    audit: auditPath || undefined,
    detailRoute: detailContext.detailRoute || page.url(),
    exported: exported || undefined,
    exportedRowCount,
    processed: processedPath,
    processedRowCount,
    success: submitResult.success,
    message: submitResult.message,
    screenshots: shots,
    sourceTab: target.sourceTab,
    storeCount: storeResult.storeCount,
    storeIds: storeResult.storeIds,
    storeNames: storeResult.storeNames,
  };
}

function normalizeComparableText(value: string) {
  return value.replace(/\s+/g, '').replace(/[()（）]/g, '').trim();
}

function matchActivityName(candidate: string, targetName: string) {
  const left = normalizeComparableText(candidate);
  const right = normalizeComparableText(targetName);
  return left.includes(right) || right.includes(left);
}

async function waitForActivityCards(page: Page, frame: Frame) {
  try {
    await frame.waitForSelector('.zs-act-view-v2', { timeout: 30000 });
  } catch {
    await page.waitForTimeout(5000);
  }
}

async function getTotalPages(frame: Frame) {
  return await frame.evaluate(() => {
    const pag = document.querySelector('.ant-pagination');
    if (!pag) return 1;
    let max = 1;
    pag.querySelectorAll('li').forEach((li) => {
      const n = parseInt(li.textContent?.trim() || '');
      if (!isNaN(n)) max = Math.max(max, n);
    });
    return max;
  });
}

async function enterBaohaoTabView(page: Page, sourceTab: ActivitySourceTab) {
  let frame = await getTargetFrame(page);
  await switchToBaohaoTab(page, frame);
  frame = await getTargetFrame(page);
  const listTab = resolveListTabForSource(sourceTab);
  if (listTab === '全部活动') {
    await switchToAllActivities(page, frame);
  } else {
    await switchToActivityTab(page, frame, sourceTab);
  }
  frame = await getTargetFrame(page);
  await waitForActivityCards(page, frame);
  return frame;
}

async function findActivityInTab(
  page: Page,
  frame: Frame,
  sourceTab: ActivitySourceTab,
  activityName: string,
): Promise<null | { pageNum: number; target: ScannedActivity }> {
  const totalPages = await getTotalPages(frame);
  for (let pageNum = 1; pageNum <= totalPages; pageNum += 1) {
    if (pageNum > 1) {
      await toPage(frame, pageNum);
      await page.waitForTimeout(4000);
      frame = await getTargetFrame(page);
    }

    const cards = await scanCards(frame, sourceTab);
    const target = cards.find(
      (item) => isTarget(item.name, item.fullText) && matchActivityName(item.name, activityName),
    );
    if (target) {
      return { pageNum, target };
    }
  }

  return null;
}

async function runScanMode(
  page: Page,
  runtimeOptions: RuntimeOptions,
) {
  const results: any[] = [];
  const processedIds = new Set<string>();
  let found = 0;
  let stopScanning = false;

  const sourceTabs: ActivitySourceTab[] =
    runtimeOptions.signupMode === 'unsigned_only'
      ? ['未报名活动']
      : runtimeOptions.signupMode === 'repeat_only'
        ? ['已报名活动']
        : ['未报名活动', '已报名活动'];

  for (const sourceTab of sourceTabs) {
    if (stopScanning) break;
    let frame = await enterBaohaoTabView(page, sourceTab);
    const totalPages = await getTotalPages(frame);
    const listTab = resolveListTabForSource(sourceTab);
    log('info', `爆好价 ${sourceTab}（列表:${listTab}）共 ${totalPages} 页`);

    for (let pageNum = 1; pageNum <= totalPages; pageNum += 1) {
      if (stopScanning) break;
      log('info', `--- ${sourceTab}（列表:${listTab}）第 ${pageNum}/${totalPages} 页 ---`);

      while (true) {
        const cards = await scanCards(frame, sourceTab);
        const target = cards.find((item) => {
          const processedKey = `${sourceTab}::${item.id}`;
          if (!isTarget(item.name, item.fullText) || processedIds.has(processedKey)) return false;
          if (sourceTab === '未报名活动') {
            return item.hasSignupBtn && !/报名中|已报名/u.test(item.fullText);
          }
          return isRepeatSignupCandidate(item);
        });

        if (!target) {
          log('info', `${sourceTab}（列表:${listTab}）当前页无更多未处理爆好价活动`);
          break;
        }

        processedIds.add(`${sourceTab}::${target.id}`);
        found += 1;
        log('info', `[爆好价][${sourceTab}] #${found} ${target.name}`);

        try {
          const result = await runOneActivity(page, frame, target, found, runtimeOptions);
          results.push({ name: target.name, ...result });
          log('info', `  → 活动处理完成: ${result.message}`);
        } catch (err: any) {
          const errShot = await saveShot(page, `baohao_error_${found}`);
          results.push({
            activityId: target.id,
            detailRoute: page.url(),
            message: `流程异常: ${err?.message || '未知错误'}`,
            name: target.name,
            screenshots: [errShot],
            sourceTab,
            success: false,
          });
          log('error', '  → 活动处理异常', { error: err?.message || String(err) });
        }

        try {
          frame = await backToList(page, await getTargetFrame(page));
          frame = await enterBaohaoTabView(page, sourceTab);
          if (pageNum > 1) {
            await toPage(frame, pageNum);
            await page.waitForTimeout(3000);
            frame = await getTargetFrame(page);
          }
        } catch (err: any) {
          log('warn', '活动处理后无法恢复到爆好价筛选视图，提前结束本轮扫描', {
            error: err?.message || String(err),
            lastActivity: target.name,
            sourceTab,
          });
          stopScanning = true;
          break;
        }
      }

      if (!stopScanning && pageNum < totalPages) {
        await toPage(frame, pageNum + 1);
        await page.waitForTimeout(4000);
        frame = await getTargetFrame(page);
      }
    }
  }

  return { found, results };
}

async function runContinueMode(
  page: Page,
  runtimeOptions: RuntimeOptions,
) {
  if (!runtimeOptions.continueManifestPath) {
    throw new Error('缺少审核继续执行清单');
  }

  const manifest = JSON.parse(
    fs.readFileSync(runtimeOptions.continueManifestPath, 'utf-8'),
  ) as ContinueManifest;
  const results: any[] = [];
  let found = 0;

  const resolveRecordedDetailRoute = async (activity: ContinueManifest['activities'][number]) => {
    const rawRoute = decodeURIComponent(`${activity.detailRoute || ''}`.trim());
    const hasDirectDetailRoute =
      !!rawRoute &&
      (!!activity.activityId ? rawRoute.includes(`activityId=${activity.activityId}`) : true) &&
      /activity-detail-v2|activityId=/u.test(rawRoute);

    if (hasDirectDetailRoute) {
      return rawRoute;
    }

    if (!activity.activityId) {
      return '';
    }

    const urlCandidates = [
      rawRoute,
      decodeURIComponent(page.url() || ''),
      ...(page.frames().map((frame) => {
        try {
          return decodeURIComponent(frame.url() || '');
        } catch {
          return '';
        }
      })),
    ].filter(Boolean);

    for (const candidate of urlCandidates) {
      if (!/ebai-zs-webapp|common-next/u.test(candidate)) continue;
      try {
        const url = new URL(candidate);
        return `${url.origin}${url.pathname}${url.search}#/activity-detail-v2?activityId=${activity.activityId}&from=`;
      } catch {}
    }

    return '';
  };

  const tryOpenRecordedDetail = async (activity: ContinueManifest['activities'][number]) => {
    if (runtimeOptions.continueAction !== 'rerun_recorded') {
      return false;
    }

    const detailRoute = await resolveRecordedDetailRoute(activity);
    if (!detailRoute) {
      return false;
    }

    try {
      await page.goto(detailRoute, {
        timeout: 90_000,
        waitUntil: 'domcontentloaded',
      });
      await page.waitForTimeout(8000);
      const frame = await getTargetFrame(page);
      const context = await getActivityContext(page, frame);
      const currentPageUrl = decodeURIComponent(page.url() || '');
      const currentFrameUrl = decodeURIComponent(frame.url() || '');
      const frameText = await frame
        .evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim().substring(0, 1000))
        .catch(() => '');

      const activityIdMatches =
        !activity.activityId ||
        !context.activityId ||
        context.activityId === activity.activityId;
      const routeLooksLikeDetail =
        /activity-detail-v2|activityId=/u.test(currentPageUrl) ||
        /activity-detail-v2|activityId=/u.test(currentFrameUrl);
      const looksLikeDetailPage =
        /活动报名/u.test(frameText) && /操作进度|立即报名|追加报名|继续报名|取消报名/u.test(frameText);

      if (activityIdMatches && routeLooksLikeDetail && looksLikeDetailPage) {
        log('info', '已通过活动详情路由直达重跑目标', {
          activityId: activity.activityId || 'unknown',
          detailRoute,
        });
        return true;
      }
    } catch {}

    return false;
  };

  for (const activity of manifest.activities || []) {
    const recordedSourceTab = activity.sourceTab || '未报名活动';
    const directOpened = await tryOpenRecordedDetail(activity);

    if (directOpened) {
      found += 1;
      const target: ScannedActivity = {
        fullText: activity.activityName,
        hasSignupBtn: false,
        id: activity.activityId || activity.activityName,
        index: 0,
        name: activity.activityName,
        sourceTab: recordedSourceTab,
      };

      try {
        const result = await runOneActivity(page, await getTargetFrame(page), target, found, runtimeOptions, {
          skipOpenFromList: true,
        });
        results.push({
          name: activity.activityName,
          ...result,
        });
        log('info', `  → 活动重跑完成: ${result.message}`);
      } catch (err: any) {
        const errShot = await saveShot(page, `baohao_continue_error_${found}`);
        results.push({
          activityId: activity.activityId || target.id,
          detailRoute: page.url(),
          message: `活动重跑异常: ${err?.message || '未知错误'}`,
          name: activity.activityName,
          screenshots: [errShot],
          sourceTab: recordedSourceTab,
          success: false,
        });
        log('error', '  → 活动重跑异常', { error: err?.message || String(err) });
      }

      await backToList(page, await getTargetFrame(page));
      continue;
    }

    const candidateSourceTabs: ActivitySourceTab[] =
      runtimeOptions.continueAction === 'rerun_recorded'
        ? recordedSourceTab === '未报名活动'
          ? ['未报名活动', '已报名活动']
          : ['已报名活动', '未报名活动']
        : [recordedSourceTab];

    let matchedSourceTab: ActivitySourceTab | null = null;
    let match: null | { pageNum: number; target: ScannedActivity } = null;
    let frame: Frame | null = null;

    for (const sourceTab of candidateSourceTabs) {
      frame = await enterBaohaoTabView(page, sourceTab);
      match = await findActivityInTab(page, frame, sourceTab, activity.activityName);
      if (match) {
        matchedSourceTab = sourceTab;
        break;
      }
    }

    if (!match) {
      results.push({
        activityId: activity.activityId || activity.activityName,
        detailRoute: page.url(),
        message:
          runtimeOptions.continueAction === 'rerun_recorded'
            ? `活动重跑失败：未在任务记录对应视图中找到活动（已尝试 ${candidateSourceTabs.join('、')}）`
            : `审核继续执行失败：未在 ${recordedSourceTab} 视图中找到活动`,
        name: activity.activityName,
        sourceTab: recordedSourceTab,
        success: false,
      });
      continue;
    }

    const sourceTab = matchedSourceTab || recordedSourceTab;
    frame = frame || (await enterBaohaoTabView(page, sourceTab));

    found += 1;
    log(
      'info',
      `${
        runtimeOptions.continueAction === 'rerun_recorded' ? '[爆好价重跑]' : '[爆好价继续执行]'
      }[${sourceTab}] #${found} ${activity.activityName}`,
    );

    if (match.pageNum > 1) {
      await toPage(frame, match.pageNum);
      await page.waitForTimeout(4000);
      frame = await getTargetFrame(page);
    }

    try {
      const result =
        runtimeOptions.continueAction === 'rerun_recorded'
          ? await runOneActivity(page, frame, match.target, found, runtimeOptions)
          : await runOneActivity(page, frame, match.target, found, runtimeOptions, {
              continueUploadPath: activity.uploadPath,
              isContinueSubmit: true,
            });
      results.push({
        name: activity.activityName,
        ...result,
      });
      log(
        'info',
        `  → ${runtimeOptions.continueAction === 'rerun_recorded' ? '活动重跑完成' : '审核继续执行完成'}: ${result.message}`,
      );
    } catch (err: any) {
      const errShot = await saveShot(page, `baohao_continue_error_${found}`);
      results.push({
        activityId: activity.activityId || match.target.id,
        detailRoute: page.url(),
        message: `审核继续执行异常: ${err?.message || '未知错误'}`,
        name: activity.activityName,
        screenshots: [errShot],
        sourceTab,
        success: false,
      });
      log(
        'error',
        `  → ${runtimeOptions.continueAction === 'rerun_recorded' ? '活动重跑异常' : '审核继续执行异常'}`,
        { error: err?.message || String(err) },
      );
    }

    await backToList(page, await getTargetFrame(page));
  }

  return { found, results };
}

async function main(runtimeOptions: RuntimeOptions = parseRuntimeOptions()) {
  const previousLogForwarder = runtimeLogForwarder;
  setRuntimePaths(runtimeOptions.runtimeBaseDir);
  runtimeLogForwarder = runtimeOptions.onLog;
  log('info', '=== 爆好价活动最终闭环报名启动 ===');
  log('info', '运行参数', runtimeOptions);

  const userDataDir = getRuntimePaths().userDataDir;
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
    acceptDownloads: true,
  });

  const page = context.pages()[0] || await context.newPage();
  await page.addInitScript(() => {
    (window as any).__name = (target: any) => target;
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  try {
    await ensureActivityPage(page);
    const { found, results } = runtimeOptions.continueManifestPath
      ? await runContinueMode(page, runtimeOptions)
      : await runScanMode(page, runtimeOptions);

    const successCount = results.filter((item) => item.success).length;
    const waitingReviewCount = results.filter((item) => item.status === 'waiting_review').length;
    const failedCount = results.filter(
      (item) => !item.success && item.status !== 'waiting_review',
    ).length;

    log('info', '=== 爆好价报名汇总 ===');
    log('info', `找到: ${found} 个`);
    log('info', `成功: ${successCount}`);
    log('info', `待审核: ${waitingReviewCount}`);
    log('info', `失败/需人工: ${failedCount}`);

    console.log('\n══════════════════════════════════════════');
    console.log(`  爆好价活动报名结果 | ${new Date().toISOString().split('T')[0]}`);
    console.log('══════════════════════════════════════════');
    for (const r of results) {
      const icon = r.status === 'waiting_review' ? '🟡' : r.success ? '✅' : '❌';
      console.log(`  ${icon} ${r.name.substring(0, 60)}`);
      console.log(`     ${r.message}`);
    }
    console.log('══════════════════════════════════════════\n');

    const finalReportPath =
      runtimeOptions.reportPath || path.join(getRuntimePaths().dataDir, `baohao_signup_${today}.json`);
    fs.writeFileSync(
      finalReportPath,
      JSON.stringify(
        {
          reviewMode:
            runtimeOptions.continueAction === 'continue_review'
              ? 'manual'
              : runtimeOptions.reviewMode,
          signupMode: runtimeOptions.signupMode,
          timestamp: new Date().toISOString(),
          found,
          results,
        },
        null,
        2,
      ),
    );
  } catch (err: any) {
    log('error', '执行失败', { error: err?.message || String(err) });
    await saveShot(page, 'baohao_fatal');
    throw err;
  } finally {
    await context.close();
    runtimeLogForwarder = previousLogForwarder;
    log('info', '=== 爆好价活动最终闭环报名完成 ===');
  }
}

export async function runBaohaojiaSignup(runtimeOptions: RuntimeOptions) {
  return main(runtimeOptions);
}

const isDirectRun =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  !!process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (isDirectRun) {
  main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
  });
}
