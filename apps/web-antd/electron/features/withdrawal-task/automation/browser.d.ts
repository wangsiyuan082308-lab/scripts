import { type BrowserContext, type Page } from 'playwright';
/**
 * 启动持久化浏览器上下文
 */
export declare function launchBrowser(): Promise<{
    context: BrowserContext;
    page: Page;
}>;
/**
 * 导航到饿了么后台并确保已登录
 */
export declare function navigateAndLogin(page: Page): Promise<void>;
/**
 * 安全关闭浏览器
 */
export declare function closeBrowser(context: BrowserContext): Promise<void>;
/**
 * 检查浏览器连接是否存活，断开则恢复
 */
export declare function ensureBrowserAlive(page: Page): Promise<void>;
/**
 * 延迟函数
 */
export declare function delay(ms: number): Promise<unknown>;
