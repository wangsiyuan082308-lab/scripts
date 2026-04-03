import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, '..', 'logs');
const DATA_DIR = path.join(__dirname, '..', 'data');

async function main() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  const userDataDir = path.join(__dirname, '..', 'user_data');
  const url = 'https://nr.ele.me/app/eleme-nr-bfe-newretail/common-next#/pc/platformActivitiesPc/';

  const ctx = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
    acceptDownloads: true,
  });

  const page = ctx.pages()[0] || await ctx.newPage();
  await page.addInitScript(() => {
    (window as any).__name = (target: any) => target;
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  page.on('response', async (response) => {
    const url = response.url();
    if (!/download|export|task|file|导出/i.test(url)) return;
    try {
      const request = response.request();
      const method = request.method();
      const status = response.status();
      const headers = response.headers();
      const contentType = headers['content-type'] || '';
      let bodyPreview = '';
      if (/json/i.test(contentType)) {
        bodyPreview = JSON.stringify(await response.json()).slice(0, 500);
      } else if (/text/i.test(contentType)) {
        bodyPreview = (await response.text()).slice(0, 500);
      }
      console.log(
        `[NET][${method}] ${status} ${url}${bodyPreview ? `\n  body: ${bodyPreview}` : ''}`,
      );
    } catch {}
  });

  try {
    // === 快速导航到添加商品页面 ===
    console.log('【导航】打开活动列表...');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(10000);

    let frame = page.mainFrame();
    for (const f of page.frames()) {
      try {
        if (f.url().includes('ms.ele.me') || f.url().includes('ebai-zs-webapp')) {
          frame = f;
          break;
        }
      } catch {}
    }

    // 找爆好价并点击
    const cards = await frame.evaluate(() => {
      return Array.from(document.querySelectorAll('.zs-act-view-v2')).map((c, i) => ({
        index: i,
        text: (c.textContent || '').replace(/\s+/g, ' ').substring(0, 100),
      }));
    });
    const bao = cards.filter(c => c.text.includes('爆好价'));
    if (bao.length === 0) { console.log('❌ 没有爆好价'); return; }

    // 点击列表"立即报名"
    await frame.locator('.zs-act-view-v2').nth(bao[0].index).locator('text=立即报名').first().click();
    await page.waitForTimeout(5000);

    // JS点击详情页"立即报名"
    await frame.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      for (const btn of btns) {
        if ((btn.textContent || '').trim() === '立即报名') {
          const rect = btn.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) { btn.click(); return; }
        }
      }
    });
    await page.waitForTimeout(5000);

    // 全选门店（如果还没选）
    const selectedCount = await frame.evaluate(() => {
      const el = Array.from(document.querySelectorAll('*')).find(e => (e.textContent || '').match(/已选门店（\d+）/));
      const m = el ? (el.textContent || '').match(/已选门店（(\d+)）/) : null;
      return m ? parseInt(m[1]) : 0;
    });
    if (selectedCount === 0) {
      await frame.locator('text=全选').first().click();
      await page.waitForTimeout(1000);
    }
    console.log('  门店已选: ' + (selectedCount || '全选'));

    // 勾选协议
    const cb = frame.locator('input[type="checkbox"]');
    if (await cb.count() > 0) {
      const checked = await cb.first().isChecked().catch(() => false);
      if (!checked) { await cb.first().click({ force: true }); await page.waitForTimeout(500); }
    }

    // 点下一步
    await frame.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('下一步'));
      if (btn) btn.click();
    });
    await page.waitForTimeout(5000);
    console.log('✅ 已到达添加商品页面');

    // === 第4步：点击"导出商品数据" ===
    console.log('\n【第4步】点击"导出商品数据"...');
    const exportBtn = frame.locator('button:has-text("导出商品数据")');
    if (await exportBtn.count() === 0) {
      console.log('❌ 未找到"导出商品数据"按钮');
      await page.screenshot({ path: path.join(LOG_DIR, 'flow4_noexport.png') });
      return;
    }
    await exportBtn.first().click();
    console.log('✅ 已点击"导出商品数据"');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(LOG_DIR, 'flow4_after_export.png') });

    // 检查是否有弹窗或提示
    const afterExportText = await frame.evaluate(() => {
      // 检查ant-modal
      const modal = document.querySelector('.ant-modal-content');
      if (modal) return 'MODAL: ' + (modal.textContent || '').substring(0, 300);
      // 检查ant-message
      const msg = document.querySelector('.ant-message');
      if (msg) return 'MSG: ' + (msg.textContent || '').substring(0, 200);
      // 检查toast
      const toast = document.querySelector('.ant-notification');
      if (toast) return 'TOAST: ' + (toast.textContent || '').substring(0, 200);
      return 'NO_POPUP';
    });
    console.log('点击后状态: ' + afterExportText);

    // 等一下看看有没有下载触发
    await page.waitForTimeout(5000);

    // 看看页面有没有变化（比如跳转到下载中心）
    const currentUrl = page.url();
    console.log('当前URL: ' + currentUrl);

    // 检查是否有"下载中心"入口
    const downloadCenter = await frame.evaluate(() => {
      const els = Array.from(document.querySelectorAll('a, button, span'));
      const dc = els.filter(e => (e.textContent || '').includes('下载中心'));
      return dc.map(e => ({ tag: e.tagName, text: (e.textContent || '').trim().substring(0, 50), href: (e as HTMLAnchorElement).href || '' }));
    });
    console.log('下载中心入口: ' + JSON.stringify(downloadCenter));

    await page.screenshot({ path: path.join(LOG_DIR, 'flow4_export_result.png') });
    console.log('\n=== 导出商品数据已触发，等待分析 ===');

  } catch (err: any) {
    console.error('错误: ' + err.message);
    await page.screenshot({ path: path.join(LOG_DIR, 'flow_error.png'), fullPage: true }).catch(() => {});
  } finally {
    await ctx.close();
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
