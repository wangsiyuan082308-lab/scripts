import { chromium } from 'playwright';
import * as path from 'path';

const LOG_DIR = path.join(__dirname, '..', 'logs');

async function main() {
  const userDataDir = path.join(__dirname, '..', 'user_data');
  const url = 'https://nr.ele.me/app/eleme-nr-bfe-newretail/common-next#/pc/platformActivitiesPc/';

  const ctx = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });

  const page = ctx.pages()[0] || await ctx.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  try {
    console.log('打开页面...');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(10000);

    // 在主框架（不是iframe）里找右上方的下载中心
    console.log('【在主框架找下载中心】');
    const mainFrameElements = await page.evaluate(() => {
      // 扫描页面右上方区域的所有元素
      const results: any[] = [];
      const allEls = document.querySelectorAll('a, button, span, div, i');
      for (const el of Array.from(allEls)) {
        const rect = el.getBoundingClientRect();
        const text = (el.textContent || '').trim().substring(0, 60);
        // 右上方：x > 800, y < 100
        if (rect.x > 800 && rect.y < 100 && rect.width > 0 && rect.height > 0) {
          if (text.length > 0 && text.length < 60) {
            results.push({
              tag: el.tagName,
              text,
              class: el.className?.toString().substring(0, 80),
              x: Math.round(rect.x),
              y: Math.round(rect.y),
              w: Math.round(rect.width),
              h: Math.round(rect.height),
              href: (el as HTMLAnchorElement).href || '',
            });
          }
        }
      }
      return results;
    });

    console.log('主框架右上方元素 (' + mainFrameElements.length + '):');
    for (const el of mainFrameElements) {
      console.log('  ' + el.tag + ' "' + el.text + '" @(' + el.x + ',' + el.y + ') ' + el.w + 'x' + el.h + (el.href ? ' href=' + el.href : '') + ' class=' + el.class);
    }

    // 也找包含"下载"关键字的所有元素
    const downloadEls = await page.evaluate(() => {
      const results: any[] = [];
      const allEls = document.querySelectorAll('*');
      for (const el of Array.from(allEls)) {
        const text = (el.textContent || '').trim();
        if (text.includes('下载') && text.length < 30 && el.children.length < 3) {
          const rect = el.getBoundingClientRect();
          results.push({
            tag: el.tagName,
            text,
            class: el.className?.toString().substring(0, 80),
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            w: Math.round(rect.width),
            h: Math.round(rect.height),
            href: (el as HTMLAnchorElement).href || '',
          });
        }
      }
      return results;
    });

    console.log('\n包含"下载"的元素 (' + downloadEls.length + '):');
    for (const el of downloadEls) {
      console.log('  ' + el.tag + ' "' + el.text + '" @(' + el.x + ',' + el.y + ') ' + el.w + 'x' + el.h + (el.href ? ' href=' + el.href : ''));
    }

    // 截图看看右上方
    await page.screenshot({ path: path.join(LOG_DIR, 'flow_topright.png') });
    console.log('\n截图: flow_topright.png');

  } catch (err: any) {
    console.error('错误: ' + err.message);
  } finally {
    await ctx.close();
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
