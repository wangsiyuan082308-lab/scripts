/**
 * 爬取翱象补货页面结构和API
 */
import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

const USER_DATA = path.join(__dirname, '../skills/eleme-activity-assistant/user_data');
const OUTPUT_DIR = '/Users/mac/.openclaw/shared-data/eleme';

async function main() {
  const context = await chromium.launchPersistentContext(USER_DATA, {
    channel: 'chrome',
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });
  
  const page = context.pages()[0] || await context.newPage();
  
  // 收集API请求
  const apiCalls: any[] = [];
  page.on('request', (req) => {
    const url = req.url();
    if (url.includes('saas-retail') || url.includes('ele.me') || url.includes('eleme')) {
      if (url.includes('/api/') || url.includes('/h5/') || url.includes('mtop.')) {
        apiCalls.push({
          type: 'request',
          url: url.substring(0, 200),
          method: req.method(),
          ts: Date.now(),
        });
      }
    }
  });
  
  page.on('response', async (resp) => {
    const url = resp.url();
    if (url.includes('saas-retail') || url.includes('ele.me') || url.includes('eleme')) {
      if (url.includes('/api/') || url.includes('/h5/') || url.includes('mtop.')) {
        try {
          const body = await resp.json().catch(() => null);
          apiCalls.push({
            type: 'response',
            url: url.substring(0, 200),
            status: resp.status(),
            bodyKeys: body ? Object.keys(body).slice(0, 10) : [],
            bodyPreview: body ? JSON.stringify(body).substring(0, 500) : '',
            ts: Date.now(),
          });
        } catch {}
      }
    }
  });

  // 1. 翱象补货页面
  console.log('导航到翱象补货页面...');
  await page.goto('https://saas-retail.ele.me/#/replenish/list', { 
    waitUntil: 'networkidle', 
    timeout: 30000 
  }).catch(() => console.log('导航超时，继续...'));
  
  await page.waitForTimeout(8000);
  
  // 截图
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'aoixiang-replenish.png'), fullPage: true });
  console.log('截图已保存');
  
  // 提取DOM结构
  const domInfo = await page.evaluate(() => {
    const body = document.body;
    
    // 获取页面文本
    const text = body.innerText.substring(0, 3000);
    
    // 获取所有链接和导航
    const links = Array.from(document.querySelectorAll('a[href]')).map(a => ({
      text: a.textContent?.trim().substring(0, 50),
      href: (a as HTMLAnchorElement).href.substring(0, 100),
    })).filter(l => l.text);
    
    // 获取所有按钮
    const buttons = Array.from(document.querySelectorAll('button, [role="button"], .ant-btn')).map(b => ({
      text: b.textContent?.trim().substring(0, 50),
      class: b.className.substring(0, 80),
    })).filter(b => b.text);
    
    // 获取表格结构
    const tables = Array.from(document.querySelectorAll('table, .ant-table')).map(t => {
      const headers = Array.from(t.querySelectorAll('th, .ant-table-thead td')).map(h => h.textContent?.trim());
      const rowCount = t.querySelectorAll('tr, .ant-table-row').length;
      return { headers, rowCount };
    });
    
    // 获取侧边栏/菜单
    const menus = Array.from(document.querySelectorAll('.ant-menu-item, .ant-menu-submenu-title, [class*="menu"], [class*="nav"]')).map(m => ({
      text: m.textContent?.trim().substring(0, 50),
      class: m.className.substring(0, 80),
    })).filter(m => m.text && m.text.length < 30);
    
    // 获取表单元素
    const forms = Array.from(document.querySelectorAll('input, select, .ant-select, .ant-input')).map(f => ({
      type: (f as HTMLInputElement).type || f.tagName,
      placeholder: (f as HTMLInputElement).placeholder || '',
      class: f.className.substring(0, 80),
    }));
    
    return { text, links: links.slice(0, 30), buttons: buttons.slice(0, 20), tables, menus: menus.slice(0, 30), forms: forms.slice(0, 20) };
  });
  
  // 保存结果
  const result = {
    url: 'https://saas-retail.ele.me/#/replenish/list',
    crawledAt: new Date().toISOString(),
    dom: domInfo,
    apiCalls: apiCalls,
  };
  
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'aoixiang-replenish-crawl.json'),
    JSON.stringify(result, null, 2)
  );
  console.log(`已保存: aoixiang-replenish-crawl.json (${apiCalls.length}个API调用)`);
  
  // 2. 尝试导航到牵牛花
  console.log('\n导航到牵牛花...');
  await page.goto('https://qnh.meituan.com/home.html#/data/home/new?tabNo=Poi', {
    waitUntil: 'networkidle',
    timeout: 30000,
  }).catch(() => console.log('导航超时，继续...'));
  
  await page.waitForTimeout(8000);
  
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'qnh-home.png'), fullPage: true });
  
  const qnhDom = await page.evaluate(() => {
    const text = document.body.innerText.substring(0, 3000);
    const links = Array.from(document.querySelectorAll('a[href]')).map(a => ({
      text: a.textContent?.trim().substring(0, 50),
      href: (a as HTMLAnchorElement).href.substring(0, 100),
    })).filter(l => l.text);
    const buttons = Array.from(document.querySelectorAll('button, [role="button"]')).map(b => ({
      text: b.textContent?.trim().substring(0, 50),
    })).filter(b => b.text);
    const menus = Array.from(document.querySelectorAll('[class*="menu"], [class*="nav"], [class*="sidebar"]')).map(m => ({
      text: m.textContent?.trim().substring(0, 100),
      class: m.className.substring(0, 80),
    })).filter(m => m.text && m.text.length < 50);
    return { text, links: links.slice(0, 30), buttons: buttons.slice(0, 20), menus: menus.slice(0, 30) };
  });
  
  const qnhResult = {
    url: 'https://qnh.meituan.com/home.html#/data/home/new?tabNo=Poi',
    crawledAt: new Date().toISOString(),
    dom: qnhDom,
    apiCalls: apiCalls.filter(a => a.url?.includes('meituan')),
  };
  
  fs.writeFileSync(
    path.join(OUTPUT_DIR, 'qnh-home-crawl.json'),
    JSON.stringify(qnhResult, null, 2)
  );
  console.log('已保存: qnh-home-crawl.json');
  
  await context.close();
  console.log('\n爬取完成！');
}

main().catch(console.error);
