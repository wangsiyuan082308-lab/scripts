import type { BrowserContext, Page } from 'playwright';

import { Notification } from 'electron';

import type { AutomationRuntimePaths, ResolvedAutomationConfig } from './config';
import type { AutomationLogger } from './logger';

/**
 * 浏览器持久化会话句柄。
 */
export interface BrowserSession {
  context: BrowserContext;
  page: Page;
}

/**
 * 按需加载 Playwright Chromium，减少非执行路径的启动开销。
 */
async function loadChromium() {
  const module = (await import('playwright')) as typeof import('playwright');
  return module.chromium;
}

/**
 * 判断当前 URL 是否处于登录相关页面。
 */
function isLoginUrl(url: string) {
  return /login|sso/i.test(url);
}

function formatDuration(ms: number) {
  if (ms % 60000 === 0) {
    return `${ms / 60000} 分钟`;
  }
  if (ms >= 60000) {
    return `${(ms / 60000).toFixed(1)} 分钟`;
  }
  return `${Math.round(ms / 1000)} 秒`;
}

function notifyLoginRequired() {
  try {
    if (!Notification.isSupported()) {
      return;
    }

    new Notification({
      title: '饿了么自动提现需要登录',
      body: '检测到登录失效，请在打开的浏览器窗口中完成登录，任务会继续等待。',
    }).show();
  } catch {}
}

/**
 * 简单延时工具。
 */
export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 等待用户手动完成登录，并在检测到退出登录页后回跳目标页面。
 * 参考 OpenClaw shared-libs/browser 的 ensureLogin 轮询模式实现。
 */
async function waitForLoginRecovery(
  page: Page,
  config: ResolvedAutomationConfig,
  timeoutMs: number,
  logger: AutomationLogger,
) {
  const pollInterval = 3000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    await delay(Math.min(pollInterval, timeoutMs - (Date.now() - startedAt)));

    if (isLoginUrl(page.url())) {
      continue;
    }

    logger.info(`检测到已退出登录路由，当前地址：${page.url()}`);
    await delay(1000);
    await page.goto(config.targetUrl, {
      timeout: 120_000,
      waitUntil: 'domcontentloaded',
    });
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
    await delay(1000);

    if (!isLoginUrl(page.url())) {
      logger.info('登录状态已恢复，已返回目标页面');
      return;
    }

    logger.warn('检测到路由跳转，但回到目标页后仍命中登录页，继续等待手动登录完成');
  }

  throw new Error(`登录等待超时（${formatDuration(timeoutMs)}），请手动登录后重试`);
}

/**
 * 启动浏览器持久化上下文，并注入反自动化探测规避脚本。
 */
export async function launchBrowserSession(
  config: ResolvedAutomationConfig,
  paths: AutomationRuntimePaths,
  logger: AutomationLogger,
): Promise<BrowserSession> {
  logger.info('启动浏览器持久化会话');
  const chromium = await loadChromium();

  const context = await chromium.launchPersistentContext(paths.profileDir, {
    headless: false,
    channel: config.chromeChannel,
    viewport: { width: 1440, height: 900 },
    userAgent: config.userAgent,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--start-maximized',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-sandbox',
    ],
  });

  const page = context.pages()[0] || (await context.newPage());
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  return { context, page };
}

/**
 * 检查页面连接是否可用；若失联则重新打开目标页面。
 */
export async function ensureBrowserAlive(
  page: Page,
  config: ResolvedAutomationConfig,
  logger: AutomationLogger,
) {
  try {
    await page.evaluate(() => document.title);
  } catch {
    logger.warn('检测到页面连接中断，重新打开目标页面');
    await page.goto(config.targetUrl, { timeout: 120_000, waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  }
}

/**
 * 打开目标页面并校验登录态。
 * 手动和定时模式都会在未登录时保留浏览器并等待用户完成登录，再自动回跳目标页继续执行。
 */
export async function navigateAndEnsureLogin(
  page: Page,
  config: ResolvedAutomationConfig,
  mode: 'daily' | 'manual',
  logger: AutomationLogger,
) {
  logger.info('打开饿了么后台页面');
  await page.goto(config.targetUrl, { timeout: 120_000, waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);

  if (!isLoginUrl(page.url())) {
    return;
  }

  const timeoutMs = mode === 'manual' ? config.manualLoginTimeoutMs : config.scheduledLoginTimeoutMs;
  notifyLoginRequired();
  logger.warn(
    mode === 'manual'
      ? `检测到登录失效，请在浏览器中手动完成登录，最长等待 ${formatDuration(timeoutMs)}`
      : `定时任务检测到登录失效，请手动登录后继续执行，最长等待 ${formatDuration(timeoutMs)}`,
  );
  logger.info(`当前位于登录路由：${page.url()}`);

  await waitForLoginRecovery(page, config, timeoutMs, logger);
}

/**
 * 安全关闭浏览器会话。
 */
export async function closeBrowserSession(context: BrowserContext, logger: AutomationLogger) {
  try {
    await context.close();
    logger.info('浏览器会话已关闭');
  } catch (error: any) {
    logger.warn(`关闭浏览器失败: ${error?.message || String(error)}`);
  }
}
