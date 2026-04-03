import { launchBrowser, saveCookies } from '../lib/browser';
import { ensureLogin } from './lib/page-helpers';
import { log } from './lib/utils';

const AOIXIANG_TARGET_URL = 'https://saas-retail.ele.me/#/replenish/list';
const AOIXIANG_API_BASE_URL = 'https://tc-supply-chain-portal.ele.me';

async function verifyAoxiangSession(page: any) {
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const result = await page
      .evaluate(async ({ apiBaseUrl }) => {
        const response = await fetch(`${apiBaseUrl}/supplier/management/pageAuthorized`, {
          body: JSON.stringify({
            pageIndex: 1,
            pageSize: 20,
          }),
          credentials: 'include',
          headers: {
            'content-type': 'application/json',
          },
          method: 'POST',
        });
        const payload = await response.json().catch(() => null);
        return {
          ok: response.ok,
          payload,
          status: response.status,
        };
      }, { apiBaseUrl: AOIXIANG_API_BASE_URL })
      .catch((error: Error) => ({
        ok: false,
        payload: null,
        status: 0,
        error: error.message,
      }));

    if (result?.ok && result?.payload?.success !== false && Array.isArray(result?.payload?.data)) {
      log(`翱象接口校验通过（第 ${attempt} 次）`);
      return;
    }

    const reason =
      result?.error ||
      result?.payload?.message ||
      `HTTP ${result?.status || 'unknown'}`;
    log(`翱象接口校验未通过（第 ${attempt} 次）: ${reason}`);
    await page.waitForTimeout(3000);
  }

  throw new Error('登录后仍无法访问翱象接口，请确认已完成登录并进入采购页面');
}

async function main() {
  log('=== 翱象登录态刷新 ===');
  const { browser, context, page } = await launchBrowser({
    cdpPort: 18792,
    headless: false,
  });

  try {
    await ensureLogin(page, AOIXIANG_TARGET_URL, {
      log,
      loginIndicators: ['login', 'passport', '欢迎登录'],
      maxWait: 180000,
    });
    await verifyAoxiangSession(page);
    await saveCookies(context);
    log('翱象登录态已刷新并写回 cookie 备份');
  } finally {
    await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error || '');
  log(`❌ 刷新登录态失败: ${message}`);
  process.exit(1);
});
