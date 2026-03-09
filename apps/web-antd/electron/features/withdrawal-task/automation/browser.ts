import type { BrowserContext, Page } from 'playwright';

import type { AutomationRuntimePaths, ResolvedAutomationConfig } from './config';
import type { AutomationLogger } from './logger';

export interface BrowserSession {
  context: BrowserContext;
  page: Page;
}

async function loadChromium() {
  const module = (await import('playwright')) as typeof import('playwright');
  return module.chromium;
}

function isLoginUrl(url: string) {
  return /login|sso/i.test(url);
}

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  logger.warn(mode === 'manual' ? '检测到登录失效，请在浏览器中手动完成登录' : '定时任务检测到登录失效');

  if (mode === 'daily') {
    throw new Error('饿了么登录已失效，请先手动执行一次任务完成登录');
  }

  await page.waitForFunction(() => !/login|sso/i.test(window.location.href), undefined, {
    timeout: timeoutMs,
  });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  await delay(1000);
  logger.info('登录状态已恢复');
}

export async function closeBrowserSession(context: BrowserContext, logger: AutomationLogger) {
  try {
    await context.close();
    logger.info('浏览器会话已关闭');
  } catch (error: any) {
    logger.warn(`关闭浏览器失败: ${error?.message || String(error)}`);
  }
}
