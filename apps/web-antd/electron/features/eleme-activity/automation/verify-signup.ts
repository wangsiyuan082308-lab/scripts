/**
 * 验证脚本：检查超级品牌活动的实际报名状态
 */
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
  await page.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); });

  try {
    await page.goto(activityUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(5000);

    let targetFrame = page.mainFrame();
    for (const f of page.frames()) {
      try { if (f.url().includes('ms.ele.me') || f.url().includes('ebai-zs-webapp')) { targetFrame = f; break; } } catch {}
    }

    const totalPages = await targetFrame.evaluate(() => {
      const items = document.querySelectorAll('.ant-pagination li');
      let max = 1;
      items.forEach(li => { const n = parseInt(li.textContent || ''); if (!isNaN(n) && n > max) max = n; });
      return max;
    });

    console.log(`共 ${totalPages} 页\n`);
    console.log('=== 超级品牌活动当前状态 ===\n');

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      if (pageNum > 1) {
        await targetFrame.evaluate((pn: number) => {
          document.querySelector('.ant-pagination')?.querySelectorAll('li').forEach(li => {
            if (li.textContent?.trim() === String(pn)) (li as HTMLElement).click();
          });
        }, pageNum);
        await page.waitForTimeout(3000);
      }

      const cards = await targetFrame.evaluate(() => {
        return Array.from(document.querySelectorAll('.zs-act-view-v2')).map(card => {
          const text = (card.textContent || '').replace(/\s+/g, ' ');
          const isSuperBrand = text.includes('超级品牌') || text.includes('闪购仓');
          
          // 检查按钮状态
          const btns = Array.from(card.querySelectorAll('button, a, span'));
          let status = '未知';
          for (const btn of btns) {
            const t = (btn.textContent || '').trim();
            if (t === '立即报名') status = '❌ 未报名（立即报名按钮仍在）';
            else if (t === '已报名' || t === '报名中') status = '✅ 已报名';
            else if (t === '已过期') status = '⏰ 已过期';
            else if (t === '查看详情') status = '✅ 已报名（查看详情）';
          }
          
          // 提取活动名称（前60字）
          const name = text.substring(0, 80);
          
          return { name, isSuperBrand, status };
        });
      });

      for (const card of cards) {
        if (card.isSuperBrand) {
          console.log(`[第${pageNum}页] ${card.status}`);
          console.log(`  ${card.name}\n`);
        }
      }
    }

    console.log('=== 验证完成 ===');

  } catch (err: any) {
    console.error('Error:', err.message);
  } finally {
    await context.close();
  }
}

main().catch(console.error);
