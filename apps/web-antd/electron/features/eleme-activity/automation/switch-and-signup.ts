/**
 * 切换到杭州货百盈总账号并执行超级品牌报名
 */

import { chromium } from 'playwright';
import * as path from 'path';
import { execSync } from 'node:child_process';

const USER_DATA_DIR = path.join(__dirname, '..', 'user_data');
const ACTIVITY_URL = 'https://nr.ele.me/app/eleme-nr-bfe-newretail/common-next#/pc/platformActivitiesPc/';

async function switchToMainAccount(page: any): Promise<boolean> {
  console.log('切换到杭州货百盈总账号...');
  
  try {
    // 检查当前账号
    const currentAccount = await page.evaluate(() => {
      const el = document.querySelector('.account-switch .current-account');
      return el?.textContent?.trim() || '';
    });
    
    console.log(`当前账号: ${currentAccount}`);
    
    if (currentAccount.includes('杭州货百盈')) {
      console.log('已在杭州货百盈总账号，无需切换');
      return true;
    }
    
    // 点击账号切换触发器
    await page.click('.account-switch .account-switch-trigger');
    await page.waitForTimeout(800);
    await page.waitForSelector('.account-switch-dropdown', { timeout: 5000 });
    
    // 找到杭州货百盈并点击
    const items = await page.$$('.cascade-menu-item, .account-switch-dropdown li, [class*="account-item"]');
    for (const item of items) {
      const text = await item.textContent();
      if (text?.includes('杭州货百盈')) {
        console.log(`找到目标账号: ${text}`);
        await item.click();
        await page.waitForTimeout(3000);
        await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
        
        // 验证切换结果
        const newAccount = await page.evaluate(() => {
          const el = document.querySelector('.account-switch .current-account');
          return el?.textContent?.trim() || '';
        });
        console.log(`切换后账号: ${newAccount}`);
        return newAccount.includes('杭州货百盈');
      }
    }
    
    console.log('未找到杭州货百盈账号项');
    return false;
  } catch (err: any) {
    console.error(`切换账号异常: ${err?.message}`);
    return false;
  }
}

async function main() {
  console.log('=== 切换账号并执行超级品牌报名 ===');
  
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    channel: 'chrome',
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });
  
  const page = context.pages()[0] || await context.newPage();
  
  try {
    // 打开活动页面
    console.log('打开活动页面...');
    await page.goto(ACTIVITY_URL, { waitUntil: 'networkidle', timeout: 60000 });
    
    // 检测登录
    if (page.url().includes('login') || page.url().includes('sso')) {
      console.log('需要登录，等待手动登录（最多5分钟）...');
      try { execSync('say "请登录饿了么"', { stdio: 'ignore' }); } catch {}
      await page.waitForFunction(
        () => !window.location.href.includes('login') && !window.location.href.includes('sso'),
        { timeout: 300000 }
      );
      console.log('登录成功');
      await page.waitForTimeout(3000);
    }
    
    // 切换到杭州货百盈总账号
    const switched = await switchToMainAccount(page);
    if (!switched) {
      console.error('切换账号失败，请手动切换后重新运行');
      await context.close();
      process.exit(1);
    }
    
    console.log('账号切换成功！');
    
    console.log('账号已切换到杭州货百盈，可以执行报名了！');
    console.log('请运行: npx ts-node -r tsconfig-paths/register src/signup-super-brand.ts');
    
    // 保持浏览器打开
    await page.waitForTimeout(60000);
    
  } catch (err: any) {
    console.error(`执行失败: ${err?.message}`);
  } finally {
    await context.close();
  }
}

main().catch(console.error);