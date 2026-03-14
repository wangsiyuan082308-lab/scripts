import { chromium } from 'playwright';
import * as path from 'path';

const LOG_DIR = path.join(__dirname, '..', 'logs');

async function main() {
  const userDataDir = path.join(__dirname, '..', 'user_data');
  const activityUrl = 'https://nr.ele.me/app/eleme-nr-bfe-newretail/common-next#/pc/platformActivitiesPc/';

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });

  const page = context.pages()[0] || await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  try {
    console.log('【第1步】打开活动页面...');
    await page.goto(activityUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(10000);
    await page.screenshot({ path: path.join(LOG_DIR, 'step1_list.png'), fullPage: false });
    console.log('  截图: step1_list.png');

    let targetFrame = page.mainFrame();
    for (const f of page.frames()) {
      try {
        if (f.url().includes('ms.ele.me') || f.url().includes('ebai-zs-webapp')) {
          targetFrame = f;
          break;
        }
      } catch {}
    }

    console.log('【第2步】查找爆好价活动...');
    const cards = await targetFrame.evaluate(() => {
      return Array.from(document.querySelectorAll('.zs-act-view-v2')).map((card, i) => {
        const text = (card.textContent || '').replace(/\s+/g, ' ').substring(0, 300);
        const btns = Array.from(card.querySelectorAll('button, a, span'))
          .map(el => (el.textContent || '').trim())
          .filter(t => t.length > 0 && t.length < 30);
        return { index: i, text, btns };
      });
    });

    console.log('  本页共 ' + cards.length + ' 个活动卡片');
    const baoCards = cards.filter(c =>
      c.text.includes('爆好价') || (c.text.includes('商品特价') && c.text.includes('宁波'))
    );

    if (baoCards.length === 0) {
      console.log('  ❌ 本页未找到爆好价活动');
      return;
    }

    for (const c of baoCards) {
      console.log('  [爆好价] #' + c.index + ': ' + c.text.substring(0, 80));
      console.log('    按钮: ' + JSON.stringify(c.btns));
    }

    const first = baoCards[0];
    console.log('\n【第3步】点击进入第一个爆好价活动 #' + first.index + '...');
    const card = targetFrame.locator('.zs-act-view-v2').nth(first.index);
    await card.click();
    await page.waitForTimeout(5000);
    await page.screenshot({ path: path.join(LOG_DIR, 'step3_detail.png'), fullPage: false });
    console.log('  截图: step3_detail.png');

    const bodyText = await targetFrame.evaluate(() => {
      return document.body.innerText.substring(0, 3000);
    });
    console.log('  页面内容(前800字):');
    console.log(bodyText.substring(0, 800));

    const allButtons = await targetFrame.evaluate(() => {
      return Array.from(document.querySelectorAll('button, a'))
        .map(el => {
          const text = (el.textContent || '').trim().substring(0, 50);
          const visible = (el as HTMLElement).offsetParent !== null;
          return { text, visible };
        })
        .filter(b => b.text.length > 0 && b.text.length < 50 && b.visible);
    });
    console.log('  可见按钮: ' + JSON.stringify(allButtons.map(b => b.text)));

  } catch (err: any) {
    console.error('错误:', err.message);
    await page.screenshot({ path: path.join(LOG_DIR, 'step_error.png'), fullPage: true }).catch(() => {});
  } finally {
    await context.close();
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
