import { chromium } from 'playwright';
import * as path from 'path';

async function main() {
  const userDataDir = path.join(__dirname, '..', 'user_data');
  const activityUrl = 'https://nr.ele.me/app/eleme-nr-bfe-newretail/common-next#/pc/platformActivitiesPc/';

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome', headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });
  const page = context.pages()[0] || await context.newPage();

  await page.goto(activityUrl, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);

  let targetFrame = page.mainFrame();
  for (const f of page.frames()) {
    try { if (f.url().includes('ms.ele.me') || f.url().includes('ebai-zs-webapp')) { targetFrame = f; break; } } catch {}
  }
  await targetFrame.waitForSelector('.zs-act-view-v2', { timeout: 30000 }).catch(() => {});

  // 1. 列出所有筛选按钮
  const filters = await targetFrame.evaluate(() => {
    const results: string[] = [];
    document.querySelectorAll('[class*="filter"], [class*="Filter"]').forEach(el => {
      const cls = (el.className || '').toString();
      const text = (el as HTMLElement).innerText?.trim() || '';
      if (text.length > 0 && text.length < 50) {
        results.push(`[${cls.substring(0, 60)}] ${text}`);
      }
    });
    return [...new Set(results)];
  });
  console.log('=== 筛选按钮 ===');
  filters.forEach(s => console.log(s));

  // 2. 列出所有活动卡片的类型标签
  const cardTypes = await targetFrame.evaluate(() => {
    const types = new Set<string>();
    document.querySelectorAll('.zs-act-view-v2').forEach(card => {
      // 找标签元素
      card.querySelectorAll('[class*="tag"], [class*="Tag"], [class*="label"], [class*="type"], span').forEach(el => {
        const t = (el as HTMLElement).innerText?.trim();
        if (t && t.length < 30 && t.length > 1) types.add(t);
      });
    });
    return [...types];
  });
  console.log('\n=== 活动卡片中的标签 ===');
  cardTypes.forEach(s => console.log(s));

  // 3. 搜索所有包含"超级品牌"的文本
  const superBrandTexts = await targetFrame.evaluate(() => {
    const body = document.body.innerText;
    const lines = body.split('\n').filter(l => l.includes('超级品牌'));
    return lines.map(l => l.trim().substring(0, 100));
  });
  console.log('\n=== 包含"超级品牌"的文本 ===');
  superBrandTexts.forEach(s => console.log(s));

  // 4. 列出所有3页的活动名称
  console.log('\n=== 所有活动列表 ===');
  for (let p = 1; p <= 3; p++) {
    const cards = await targetFrame.evaluate(() => {
      return Array.from(document.querySelectorAll('.zs-act-view-v2')).map(card => {
        const text = (card.textContent || '').replace(/\s+/g, ' ').substring(0, 120);
        return text;
      });
    });
    console.log(`\n--- 第 ${p} 页 (${cards.length} 个) ---`);
    cards.forEach((c, i) => console.log(`${i+1}. ${c}`));

    if (p < 3) {
      await targetFrame.evaluate((pn: number) => {
        document.querySelector('.ant-pagination')?.querySelectorAll('li').forEach(li => {
          if (li.textContent?.trim() === String(pn) && !li.classList.contains('ant-pagination-disabled'))
            (li as HTMLElement).click();
        });
      }, p + 1);
      await page.waitForTimeout(5000);
    }
  }

  await context.close();
}

main().catch(console.error);
