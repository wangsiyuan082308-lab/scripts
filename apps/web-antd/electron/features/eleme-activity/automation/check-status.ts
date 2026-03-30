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

  console.log('打开活动页面...');
  await page.goto(activityUrl, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);

  let targetFrame = page.mainFrame();
  for (const f of page.frames()) {
    try { if (f.url().includes('ms.ele.me') || f.url().includes('ebai-zs-webapp')) { targetFrame = f; break; } } catch {}
  }
  await targetFrame.waitForSelector('.zs-act-view-v2', { timeout: 30000 }).catch(() => {});

  const totalPages = await targetFrame.evaluate(() => {
    const pag = document.querySelector('.ant-pagination');
    if (!pag) return 1;
    let max = 1;
    pag.querySelectorAll('li').forEach(li => { const n = parseInt(li.textContent?.trim() || ''); if (!isNaN(n)) max = Math.max(max, n); });
    return max;
  });

  console.log(`共 ${totalPages} 页\n`);

  const allActivities: any[] = [];

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    if (pageNum > 1) {
      await targetFrame.evaluate((pn: number) => {
        document.querySelector('.ant-pagination')?.querySelectorAll('li').forEach(li => {
          if (li.textContent?.trim() === String(pn)) (li as HTMLElement).click();
        });
      }, pageNum);
      await page.waitForTimeout(5000);
    }

    const cards = await targetFrame.evaluate(() => {
      return Array.from(document.querySelectorAll('.zs-act-view-v2')).map(card => {
        const text = card.textContent?.trim() || '';
        const hasSignup = !!Array.from(card.querySelectorAll('span, button')).find(
          (el: Element) => el.textContent?.trim() === '立即报名'
        );
        const hasSignedUp = text.includes('已报名') || text.includes('已参加');
        // 判断活动类型
        let type = '其他';
        if (text.includes('品类红包')) type = '品类红包';
        else if (text.includes('超级品牌') || text.includes('品牌红包')) type = '超级品牌';
        else if (text.includes('专属券') || text.includes('专享券')) type = '专属券';
        return { text: text.substring(0, 120), hasSignup, hasSignedUp, type };
      });
    });

    for (const card of cards) {
      allActivities.push({ ...card, page: pageNum });
    }
  }

  // 分类统计
  const unsigned = allActivities.filter(a => a.hasSignup && !a.hasSignedUp);
  const signed = allActivities.filter(a => a.hasSignedUp || !a.hasSignup);

  console.log('═'.repeat(60));
  console.log('  活动报名状态检查');
  console.log('═'.repeat(60));

  // 未报名的活动
  console.log(`\n📋 未报名活动（显示"立即报名"）: ${unsigned.length}个`);
  if (unsigned.length > 0) {
    for (const a of unsigned) {
      const icon = a.type === '品类红包' ? '🏷️' : a.type === '超级品牌' ? '🏪' : a.type === '专属券' ? '🎫' : '📌';
      console.log(`  ${icon} [${a.type}] ${a.text.substring(0, 80)}`);
    }
  } else {
    console.log('  ✅ 无');
  }

  // 按类型统计未报名
  const unsignedByType: Record<string, number> = {};
  for (const a of unsigned) {
    unsignedByType[a.type] = (unsignedByType[a.type] || 0) + 1;
  }
  console.log('\n📊 未报名按类型统计:');
  for (const [type, count] of Object.entries(unsignedByType)) {
    console.log(`  ${type}: ${count}个`);
  }
  if (Object.keys(unsignedByType).length === 0) {
    console.log('  ✅ 全部已报名');
  }

  // 特别检查品类红包和超级品牌
  const unsignedCategory = unsigned.filter(a => a.type === '品类红包' || a.text.includes('品类红包'));
  const unsignedBrand = unsigned.filter(a => a.type === '超级品牌' || a.text.includes('超级品牌') || a.text.includes('品牌红包'));
  const unsignedCoupon = unsigned.filter(a => a.text.includes('专属券') || a.text.includes('专享券'));

  console.log('\n🔍 重点检查:');
  console.log(`  品类红包未报名: ${unsignedCategory.length}个`);
  console.log(`  超级品牌未报名: ${unsignedBrand.length}个`);
  console.log(`  专属券未报名: ${unsignedCoupon.length}个`);

  console.log(`\n总计: ${allActivities.length}个活动, ${unsigned.length}个未报名, ${signed.length}个已处理`);
  console.log('═'.repeat(60));

  await context.close();
}

main().catch(console.error);
