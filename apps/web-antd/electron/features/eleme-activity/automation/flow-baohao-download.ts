import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import os from 'node:os';

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
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  try {
    console.log('打开页面...');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(10000);

    // 点击下载中心图标
    await page.locator('.eb-task-open').first().click();
    await page.waitForTimeout(3000);

    // hover第一个item让下载按钮出现
    const firstItem = page.locator('.task-item-wrapper').first();
    await firstItem.hover();
    await page.waitForTimeout(1000);

    // 点击第一个"下载"按钮
    console.log('点击第一个"下载"按钮...');
    const dlBtn = page.locator('.task-item-btn').first();

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }).catch(() => null),
      dlBtn.click(),
    ]);

    if (download) {
      const filename = download.suggestedFilename();
      const savePath = path.join(DATA_DIR, filename);
      await download.saveAs(savePath);
      console.log('✅ 文件已下载: ' + savePath);
      console.log('  文件名: ' + filename);
      console.log('  大小: ' + fs.statSync(savePath).size + ' bytes');
    } else {
      console.log('没有触发Playwright下载事件，检查其他方式...');

      // 可能是通过window.open或直接跳转下载
      await page.waitForTimeout(3000);

      // 检查新页面
      const pages = ctx.pages();
      console.log('页面数: ' + pages.length);
      for (let i = 0; i < pages.length; i++) {
        console.log('  页面' + i + ': ' + pages[i].url().substring(0, 150));
      }

      // 检查系统下载目录
      const downloadDir = path.join(os.homedir(), 'Downloads');
      const recentFiles = fs.readdirSync(downloadDir)
        .map(f => ({ name: f, time: fs.statSync(path.join(downloadDir, f)).mtimeMs }))
        .sort((a, b) => b.time - a.time)
        .slice(0, 5);
      console.log('\n最近下载的文件:');
      for (const f of recentFiles) {
        const age = Math.round((Date.now() - f.time) / 1000);
        console.log('  ' + f.name + ' (' + age + '秒前)');
      }

      await page.screenshot({ path: path.join(LOG_DIR, 'flow_dc_afterclick.png') });
    }

  } catch (err: any) {
    console.error('错误: ' + err.message);
  } finally {
    await ctx.close();
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
