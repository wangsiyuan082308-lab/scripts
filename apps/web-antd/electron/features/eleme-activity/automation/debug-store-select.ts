import { chromium, Frame } from 'playwright';
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

    let frame: Frame = page.mainFrame();
    for (const f of page.frames()) {
      try {
        if (f.url().includes('ms.ele.me') || f.url().includes('ebai-zs-webapp')) { frame = f; break; }
      } catch {}
    }

    // 进入爆好价详情
    const cards = await frame.evaluate(() => {
      return Array.from(document.querySelectorAll('.zs-act-view-v2')).map((c, i) => ({
        index: i, text: (c.textContent || '').replace(/\s+/g, ' ').substring(0, 100),
      }));
    });
    const bao = cards.filter(c => c.text.includes('爆好价'));
    if (bao.length === 0) { console.log('❌ 没有爆好价'); return; }
    await frame.locator('.zs-act-view-v2').nth(bao[0].index).locator('text=立即报名').first().click();
    await page.waitForTimeout(5000);

    // JS点击详情页"立即报名"
    await frame.evaluate(() => {
      for (const btn of Array.from(document.querySelectorAll('button'))) {
        if ((btn.textContent || '').trim() === '立即报名') {
          const r = btn.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) { btn.click(); return; }
        }
      }
    });
    await page.waitForTimeout(5000);
    console.log('✅ 到达选择门店页面');

    // === 详细分析门店选择区域的DOM ===
    console.log('\n【分析门店选择区域】');
    const storeAreaHTML = await frame.evaluate(() => {
      // 找包含"全选"和"门店"的区域
      const el = Array.from(document.querySelectorAll('*')).find(e => {
        const t = (e.textContent || '');
        return t.includes('全选') && t.includes('门店列表') && e.children.length > 3 && e.children.length < 30;
      });
      return el ? el.innerHTML.substring(0, 3000) : 'NOT_FOUND';
    });
    console.log('门店区域HTML(前2000字):');
    console.log(storeAreaHTML.substring(0, 2000));

    // 找所有checkbox相关元素
    console.log('\n【所有checkbox元素】');
    const checkboxes = await frame.evaluate(() => {
      const results: any[] = [];
      // ant-checkbox-wrapper
      const wrappers = document.querySelectorAll('.ant-checkbox-wrapper, [class*="checkbox"], input[type="checkbox"]');
      for (const w of Array.from(wrappers)) {
        const rect = w.getBoundingClientRect();
        const text = (w.textContent || '').trim().substring(0, 60);
        const cls = w.className?.toString().substring(0, 80) || '';
        const checked = cls.includes('checked') || (w as HTMLInputElement).checked;
        results.push({
          tag: w.tagName,
          text,
          cls,
          checked,
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        });
      }
      return results;
    });
    console.log('checkbox元素 (' + checkboxes.length + '):');
    for (const cb of checkboxes) {
      console.log('  ' + cb.tag + ' "' + cb.text.substring(0, 30) + '" checked=' + cb.checked + ' @(' + cb.x + ',' + cb.y + ') ' + cb.w + 'x' + cb.h + ' cls=' + cb.cls.substring(0, 50));
    }

    // 找树节点（可能是ant-tree）
    console.log('\n【树节点】');
    const treeNodes = await frame.evaluate(() => {
      const nodes = document.querySelectorAll('.ant-tree-treenode, [class*="tree-node"], [class*="store-item"], [class*="shop-item"]');
      return Array.from(nodes).map(n => ({
        text: (n.textContent || '').trim().substring(0, 60),
        cls: n.className?.toString().substring(0, 80),
        childCount: n.children.length,
      }));
    });
    console.log('树节点 (' + treeNodes.length + '):');
    for (const n of treeNodes) {
      console.log('  "' + n.text.substring(0, 40) + '" children=' + n.childCount + ' cls=' + n.cls.substring(0, 50));
    }

    await page.screenshot({ path: path.join(LOG_DIR, 'store_debug.png') });

  } catch (err: any) {
    console.error('错误: ' + err.message);
  } finally {
    await ctx.close();
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
