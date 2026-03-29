import { exec } from 'node:child_process';
import { chromium } from 'playwright';
import { CONFIG, evolutionConfig } from './config';
import { createLogger } from './logger';
const log = createLogger('browser');
/**
 * 启动持久化浏览器上下文
 */
export async function launchBrowser() {
    log.info('正在启动浏览器...');
    const context = await chromium.launchPersistentContext(CONFIG.userDataDir, {
        headless: false,
        channel: 'chrome',
        viewport: { width: 1280, height: 800 },
        userAgent: evolutionConfig.userAgent,
        args: [
            '--disable-blink-features=AutomationControlled',
            '--start-maximized',
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--no-sandbox',
        ],
    });
    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();
    // 反爬虫：移除 webdriver 属性
    await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });
    return { context, page };
}
/**
 * 导航到饿了么后台并确保已登录
 */
export async function navigateAndLogin(page) {
    log.info(`正在打开目标 URL: ${CONFIG.url}`);
    try {
        await page.goto(CONFIG.url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
        await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => { });
    }
    catch (error) {
        log.warn('打开目标 URL 超时，将继续尝试后续步骤。');
    }
    // 检查是否需要登录
    if (page.url().includes('login') || page.url().includes('sso')) {
        log.info('检测到需要登录，请在浏览器窗口中手动完成登录...');
        try {
            exec('say "请登录"');
        }
        catch { }
        await page.waitForFunction(() => !window.location.href.includes('login') && !window.location.href.includes('sso'), null, { timeout: 300_000 });
    }
    log.info('登录确认完成，开始执行自动化任务...');
    await page.waitForLoadState('domcontentloaded');
    await delay(2000);
}
/**
 * 安全关闭浏览器
 */
export async function closeBrowser(context) {
    try {
        await context.close();
        log.info('浏览器已关闭。');
    }
    catch {
        log.warn('浏览器关闭时出错（可能已关闭）。');
    }
}
/**
 * 检查浏览器连接是否存活，断开则恢复
 */
export async function ensureBrowserAlive(page) {
    try {
        await page.evaluate(() => document.title);
    }
    catch {
        log.warn('浏览器连接断开，正在恢复...');
        await page.goto(CONFIG.url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
        await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => { });
        await delay(3000);
    }
}
/**
 * 延迟函数
 */
export function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
