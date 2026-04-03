/**
 * 翱象浏览器启动
 *
 * 简单封装当前仓库的浏览器启动器，绑定翱象的 user_data 目录。
 * closeModals / resetSearch / switchToMaxPerPage 已移至 page-helpers.ts 统一导出。
 */
import type { Browser, BrowserContext, Page } from 'playwright';
import { USER_DATA } from './types';
import { launchBrowser as launchLocalBrowser } from '../../lib/browser';
import { log } from './utils';

/** 启动浏览器（persistent context，复用翱象 cookie） */
export async function launchBrowser(): Promise<{
  browser: Browser;
  context: BrowserContext;
  page: Page;
}> {
  return launchLocalBrowser({
    cdpPort: 18792,
    headless: false,
    log,
    userDataDir: USER_DATA,
  });
}
