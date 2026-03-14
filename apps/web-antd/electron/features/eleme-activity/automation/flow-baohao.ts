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
    console.log('【第1步】打开活动列表...');
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

    // 找爆好价并点击列表"立即报名"
    const cards = await frame.evaluate(() => {
      return Array.from(document.querySelectorAll('.zs-act-view-v2')).map((c, i) => ({
        index: i,
        text: (c.textContent || '').replace(/\s+/g, ' ').substring(0, 100),
      }));
    });
    const bao = cards.filter(c => c.text.includes('爆好价'));
    if (bao.length === 0) { console.log('❌ 没有爆好价'); return; }
    const listBtn = frame.locator('.zs-act-view-v2').nth(bao[0].index).locator('text=立即报名').first();
    await listBtn.click();
    console.log('✅ 已进入详情页');
    await page.waitForTimeout(5000);

    // 第2步：JS点击详情页"立即报名"（找有尺寸的那个）
    console.log('【第2步】JS点击详情页"立即报名"...');
    await frame.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      for (const btn of btns) {
        if ((btn.textContent || '').trim() === '立即报名') {
          const rect = btn.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            btn.click();
            return;
          }
        }
      }
    });
    console.log('✅ 已进入报名向导');
    await page.waitForTimeout(5000);

    // 第3步：选择门店
    console.log('【第3步】选择门店...');

    // 点"全选"
    const selectAll = frame.locator('text=全选').first();
    if (await selectAll.isVisible()) {
      await selectAll.click();
      console.log('  已点击"全选"');
      await page.waitForTimeout(2000);
    } else {
      console.log('  ⚠️ "全选"不可见，尝试JS点击');
      await frame.evaluate(() => {
        const el = Array.from(document.querySelectorAll('*')).find(e => (e.textContent || '').trim() === '全选');
        if (el) (el as HTMLElement).click();
      });
      await page.waitForTimeout(2000);
    }

    // 检查已选门店数
    const selectedText = await frame.evaluate(() => {
      const el = Array.from(document.querySelectorAll('*')).find(e => (e.textContent || '').includes('已选门店'));
      return el ? (el.textContent || '').trim() : '未找到';
    });
    console.log('  ' + selectedText);

    await page.screenshot({ path: path.join(LOG_DIR, 'flow3_stores.png') });

    // 勾选同意协议
    console.log('  勾选同意协议...');
    const checkbox = frame.locator('input[type="checkbox"]');
    if (await checkbox.count() > 0) {
      const checked = await checkbox.first().isChecked().catch(() => false);
      if (!checked) {
        await checkbox.first().click({ force: true });
        console.log('  已勾选');
        await page.waitForTimeout(1000);
      } else {
        console.log('  已经勾选了');
      }
    }

    // 点"下一步"
    console.log('  点击"下一步"...');
    const nextBtn = frame.locator('button:has-text("下一步")');
    if (await nextBtn.isVisible()) {
      await nextBtn.click();
    } else {
      await frame.evaluate(() => {
        const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('下一步'));
        if (btn) btn.click();
      });
    }
    console.log('✅ 已点击"下一步"');
    await page.waitForTimeout(5000);
    await page.screenshot({ path: path.join(LOG_DIR, 'flow4_addproduct.png') });

    // 第4步：查看添加商品页面
    console.log('\n【第4步】添加商品页面...');
    const pageText = await frame.evaluate(() => document.body.innerText.substring(0, 3000));
    console.log('页面内容(前600字):');
    console.log(pageText.substring(0, 600));

    // 找关键按钮
    const keyBtns = await frame.evaluate(() => {
      return Array.from(document.querySelectorAll('button, a, span')).map(el => {
        const t = (el.textContent || '').trim();
        const vis = (el as HTMLElement).offsetParent !== null;
        const rect = el.getBoundingClientRect();
        return { text: t.substring(0, 50), tag: el.tagName, vis, w: rect.width, h: rect.height };
      }).filter(b => b.vis && b.text.length > 0 && b.text.length < 50 && (
        b.text.includes('导出') || b.text.includes('添加') || b.text.includes('上传') ||
        b.text.includes('下载') || b.text.includes('提交') || b.text.includes('拖拽') ||
        b.text.includes('商品') || b.text.includes('确认')
      ));
    });
    console.log('\n关键按钮:');
    for (const b of keyBtns) {
      console.log('  ' + b.tag + ' "' + b.text + '" vis=' + b.vis + ' ' + b.w + 'x' + b.h);
    }

    console.log('\n=== 到达添加商品页面，等待指令 ===');

  } catch (err: any) {
    console.error('错误: ' + err.message);
    await page.screenshot({ path: path.join(LOG_DIR, 'flow_error.png'), fullPage: true }).catch(() => {});
  } finally {
    await ctx.close();
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
