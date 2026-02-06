import { chromium, BrowserContext, Page, Frame } from 'playwright';
import * as readline from 'readline';
import * as path from 'path';
import * as fs from 'fs';

// 配置常量
const CONFIG = {
  url: 'https://nr.ele.me/app/eleme-nr-bfe-newretail/common-next#/pc/orderProcessingPc/tab',
  password: '130816',
  targetStores: ['Oby便利超市(安吉店)', 'Oby便利超市(长兴店)'],
  userDataDir: path.join(process.cwd(), 'user_data'), // 持久化数据目录
  coordsFile: path.join(process.cwd(), 'coords.json'), // 坐标记录文件
};

// 坐标记录接口
interface Coords {
  [storeName: string]: {
    x: number;
    y: number;
  }[];
}

/**
 * 读取坐标记录
 */
function loadCoords(): Coords {
  if (fs.existsSync(CONFIG.coordsFile)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG.coordsFile, 'utf-8'));
    } catch (e) {
      console.error('读取坐标文件失败，将使用空记录');
    }
  }
  return {};
}

/**
 * 保存坐标记录
 */
function saveCoords(coords: Coords) {
  fs.writeFileSync(CONFIG.coordsFile, JSON.stringify(coords, null, 2));
}

/**
 * 获取用户输入
 * @param query 提示信息
 */
function askQuestion(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) =>
    rl.question(query, (ans) => {
      rl.close();
      resolve(ans);
    })
  );
}

/**
 * 延迟函数，用于模拟人类等待
 * @param ms 毫秒
 */
function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 主程序
 */
async function main() {
  console.log('正在启动浏览器...');

  // 使用持久化上下文，保存登录状态
  const context = await chromium.launchPersistentContext(CONFIG.userDataDir, {
    headless: false, // 必须有头模式，否则会被检测且无法手动登录
    viewport: { width: 1280, height: 800 },
    args: [
      '--disable-blink-features=AutomationControlled', // 尝试隐藏自动化特征
      '--start-maximized',
    ],
  });

  const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

  // 反爬虫绕过尝试：注入 webdriver 属性移除脚本
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined,
    });
  });

  console.log(`正在打开目标 URL: ${CONFIG.url}`);
  await page.goto(CONFIG.url, { waitUntil: 'networkidle' });

  // 检查是否需要登录
  // 这里通过简单的 URL 检查或页面元素检查来判断
  // 饿了么通常跳转到 sso 或 login 页面
  if (page.url().includes('login') || page.url().includes('sso')) {
    console.log('\n检测到需要登录！');
    console.log('请在弹出的浏览器窗口中手动完成登录操作。');
    console.log('脚本将自动检测登录状态，登录成功后会自动继续...');
    
    // 播放提示音（Mac系统）
    try {
      require('child_process').exec('say "请登录"');
    } catch (e) {}

    // 自动轮询等待登录成功（URL 不再包含 login 或 sso）
    // 设置 5 分钟超时
    await page.waitForFunction(() => {
        return !window.location.href.includes('login') && !window.location.href.includes('sso');
    }, null, { timeout: 300000 });
  }

  console.log('登录确认完成，开始执行自动化任务...');

  // 确保页面加载完成
  await page.waitForLoadState('domcontentloaded');
  await delay(2000);

  // --- 第二步：循环处理所有目标门店 ---
  for (const storeName of CONFIG.targetStores) {
      console.log(`\n=== 开始处理门店: ${storeName} ===`);
      
      // 切换到目标门店
      await switchStore(page, storeName);
      
      // --- 第三步：点击财务模块 ---
      await navigateToFinance(page);

      // --- 第四步：识别提现按钮并操作 ---
      await handleWithdrawal(page, storeName);
      
      console.log(`=== 门店 ${storeName} 处理完毕 ===\n`);
      await delay(2000);
  }

  console.log('所有任务执行完毕！');
  // 保持浏览器开启以便观察结果，或者询问是否关闭
  // await context.close();
}

/**
 * 切换门店逻辑
 * @param page 页面对象
 * @param targetStore 目标店铺名称
 */
async function switchStore(page: Page, targetStore: string) {
  console.log(`正在尝试切换到门店: ${targetStore}...`);
  
  try {
    // 策略：查找门店选择下拉框
    // 根据用户反馈，使用 class 名 'account-switch' 进行定位
    const storeSelector = page.locator('.account-switch').first();
    
    if (await storeSelector.isVisible()) {
        console.log('找到门店选择器 (.account-switch)，点击展开...');
        await storeSelector.click();
        await delay(1500); // 等待下拉菜单动画
        
        // 假设有一个搜索框
        const searchInput = page.getByPlaceholder(/搜索|门店/);
        if (await searchInput.isVisible()) {
            console.log(`搜索门店: ${targetStore}`);
            // 使用完整的店名进行搜索，以便更精确地定位
            await searchInput.fill(targetStore);
            await delay(1000);
            
            // 点击目标店铺
            // 尝试模糊匹配
            const targetStoreOption = page.locator('li, div[role="option"]').filter({ hasText: targetStore }).first();
            if (await targetStoreOption.isVisible()) {
                await targetStoreOption.click();
                console.log(`已切换到: ${targetStore}`);
                await delay(5000); // 等待页面刷新和数据加载
            } else {
                console.log(`未找到店铺: ${targetStore}`);
                // 调试：打印所有可见选项
                const options = await page.locator('li, div[role="option"]').allInnerTexts();
                console.log('当前可见的店铺选项:', options.slice(0, 10));
            }
        } else {
             console.log('未找到搜索框，尝试直接在下拉列表中查找目标店铺...');
             // 如果没有搜索框，直接在下拉列表中找
             const targetStoreOption = page.getByText(targetStore).first();
             if (await targetStoreOption.isVisible()) {
                 await targetStoreOption.click();
                 console.log(`已切换到: ${targetStore}`);
                 await delay(5000);
             }
        }
    } else {
        console.log('未找到明显的门店选择器（.account-switch），可能已经是目标店铺或选择器定位失败。');
    }
  } catch (error) {
    console.error('切换门店失败，继续尝试后续步骤:', error);
  }
}

/**
 * 导航到财务模块
 * @param page 页面对象
 */
async function navigateToFinance(page: Page) {
  console.log('正在导航到财务模块...');
  try {
    // 左边侧边栏，点击“财务”
    const financeLink = page.getByText('财务').first();
    await financeLink.click();
    await delay(2000); // 等待模块加载
  } catch (error) {
    console.error('点击财务模块失败:', error);
    throw error;
  }
}

/**
 * 通用按钮点击辅助函数
 * @param ctx Page 或 Frame 上下文
 * @param selectorOrText 选择器或文本内容（支持正则）
 * @param options 配置项：isText(是否为文本查找), timeout(超时时间)
 */
async function clickButton(ctx: Page | Frame, selectorOrText: string | RegExp, options: { isText?: boolean, timeout?: number } = {}) {
    const { isText = true, timeout = 1000 } = options;
    console.log(`尝试点击按钮: ${selectorOrText}`);

    try {
        let locator;
        if (isText) {
            // 查找包含目标文本的常见交互元素
            locator = ctx.locator('button, div, span, a').filter({ hasText: selectorOrText });
        } else {
            // 直接使用选择器
            locator = ctx.locator(selectorOrText as string);
        }

        const count = await locator.count();
        if (count === 0) {
            console.log(`未找到匹配元素: ${selectorOrText}`);
            return false;
        }

        // 遍历所有匹配元素，找到第一个真正可见的
        for (let i = 0; i < count; i++) {
            const element = locator.nth(i);
            
            // 1. 基础可见性检查 (Playwright isVisible)
            if (!await element.isVisible()) continue;

            // 2. 深度可见性检查 (检查 computed style，包括父级)
            const isDeepVisible = await element.evaluate((el) => {
                const style = window.getComputedStyle(el);
                if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
                
                // 向上检查父元素
                let parent = el.parentElement;
                while (parent) {
                    const parentStyle = window.getComputedStyle(parent);
                    if (parentStyle.display === 'none' || parentStyle.visibility === 'hidden') return false;
                    parent = parent.parentElement;
                }
                return true;
            });

            if (isDeepVisible) {
                // 尝试点击
                try {
                    await element.click({ timeout });
                    console.log(`成功点击按钮: ${selectorOrText}`);
                    return true;
                } catch (e) {
                    console.log('点击操作失败（可能被遮挡或不可交互），尝试下一个...');
                }
            }
        }
    } catch (e) {
        console.error(`点击按钮 ${selectorOrText} 过程中出错:`, e);
    }
    
    console.log(`未能成功点击任何匹配的按钮: ${selectorOrText}`);
    return false;
}

/**
 * 处理提现逻辑
 * @param page 页面对象
 * @param storeName 当前店铺名称，用于记录坐标
 */
async function handleWithdrawal(page: Page, storeName: string) {
  console.log('正在寻找账户总览及提现按钮...');
  
  // 加载历史坐标
  const allCoords = loadCoords();
  const storeCoords = allCoords[storeName] || [];

  // 优先尝试点击历史坐标
  if (storeCoords.length > 0) {
      console.log(`发现店铺 ${storeName} 的历史坐标记录，尝试点击...`);
      for (const coord of storeCoords) {
          console.log(`尝试点击坐标: (${coord.x}, ${coord.y})`);
          await page.mouse.click(coord.x, coord.y);
          await delay(1000);
          
          // 尝试处理弹窗，如果成功处理了，说明点击有效
          const handled = await handleWithdrawalPopup(page, page.frames()[0], true); // true 表示仅检测
          if (handled) {
              console.log('坐标点击有效，已处理弹窗。');
              // 如果一个坐标有效，可能还需要点击其他坐标（多个提现按钮），这里暂不中断循环，或者根据业务逻辑调整
              // 假设有多个提现按钮，我们依次点击所有记录的坐标
              await handleWithdrawalPopup(page, page.frames()[0]); // 真正处理
          } else {
              console.log('坐标点击未触发预期弹窗，可能已失效或需要重新定位。');
          }
      }
      // 坐标点击尝试完毕，为了保险起见，继续执行常规查找，防止有遗漏或坐标失效
      console.log('历史坐标尝试完毕，继续执行常规元素查找以确保无遗漏...');
  }

  // 等待可能的 iframe 加载
  await page.waitForTimeout(3000);

  // 寻找包含“账户总览”的区域，通常在 iframe 中
  // 遍历所有 frame 寻找目标
  const frames = page.frames();
  console.log(`当前页面共有 ${frames.length} 个 frame`);

  let withdrawalButtonsFound = 0;
  const newCoords: {x: number, y: number}[] = [];

  for (const frame of frames) {
    try {
        // 检查 frame 中是否有“账户总览”或“提现”按钮
        // 放宽匹配条件，不要 exact: true
        const withdrawBtn = frame.getByText('提现');
        const count = await withdrawBtn.count();
        
        if (count > 0) {
            console.log(`在 frame (${frame.url()}) 中发现 ${count} 个提现按钮`);
            
            // 遍历点击提现按钮
            const buttons = await withdrawBtn.all();
            for (const btn of buttons) {
                if (await btn.isVisible() && await btn.isEnabled()) {
                    console.log('点击提现按钮...');
                    
                    // 获取并记录坐标
                    const box = await btn.boundingBox();
                    if (box) {
                         newCoords.push({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
                    }

                    await btn.click();
                    await delay(1000);
                    
                    // 处理提现弹窗
                    await handleWithdrawalPopup(page, frame);
                    
                    withdrawalButtonsFound++;
                }
            }
        }
    } catch (e) {
        // 忽略跨域 frame 访问错误等
    }
  }
  
  // 更新坐标记录
  if (newCoords.length > 0) {
      allCoords[storeName] = newCoords;
      saveCoords(allCoords);
      console.log(`已更新店铺 ${storeName} 的提现按钮坐标记录。`);
  }

  if (withdrawalButtonsFound === 0) {
    console.log('未找到可用的提现按钮，可能已经提现完成或页面结构变更。');
  }
}

/**
 * 处理提现弹窗
 * @param page 页面对象
 * @param frame 当前所在的 frame (如果弹窗在 frame 内)
 * @param onlyCheck 是否仅检查弹窗存在而不进行操作，默认为 false
 */
async function handleWithdrawalPopup(page: Page, frame: Frame, onlyCheck: boolean = false): Promise<boolean> {
  console.log(onlyCheck ? '正在检测提现弹窗...' : '正在处理提现弹窗...');
  
  // 弹窗可能在顶层 page，也可能在 frame 内部
  // 先尝试在 frame 内查找，再尝试在 page 查找
  
  // 选择器策略：查找“全部提现”按钮
  const locatorProviders = [frame, page];
  let popupHandled = false;

  for (const provider of locatorProviders) {
    try {
        const allWithdrawBtn = provider.getByText('全部提现');
        if (await allWithdrawBtn.isVisible({ timeout: 2000 })) {
            if (onlyCheck) {
                return true; // 仅检查，发现弹窗直接返回 true
            }
            console.log('点击全部提现...');
            await allWithdrawBtn.click();
            await delay(1500); // 增加等待时间，确保弹窗完全渲染
            
            // 点击确定按钮
            // 使用封装的 clickButton 函数，尝试在 Page 和 Frame 中查找
            const confirmBtnRegex = /^确定$|^确认$|^确认提现$/;
            let clicked = await clickButton(page, confirmBtnRegex);
            if (!clicked) {
                clicked = await clickButton(frame, confirmBtnRegex);
            }

            if (clicked) {
                 await delay(1000);
                 // 处理密码弹窗
                 await handlePasswordPopup(page, frame);
                 popupHandled = true;
                 break;
            } else {
                 console.log('未找到明确的确定按钮，尝试直接检查密码框...');
                 const passwordInput = page.locator('input[type="password"]').or(frame.locator('input[type="password"]'));
                 if (await passwordInput.isVisible()) {
                     await handlePasswordPopup(page, frame);
                     popupHandled = true;
                     break;
                 }
            }
        }
    } catch (e) {}
  }
  
  if (!popupHandled) {
      console.log('未检测到提现金额输入弹窗，可能无需提现或余额为0。');
      try {
          await page.keyboard.press('Escape');
      } catch (e) {}
  }
  return popupHandled;
}

/**
 * 处理密码输入弹窗
 * @param page 全局页面对象
 * @param frame 当前操作的 frame
 */
async function handlePasswordPopup(page: Page, frame: Frame) {
  console.log('正在等待密码输入弹窗...');
  
  const passwordSelector = 'input[type="password"]';
  let targetContext: Page | Frame | null = null;

  try {
      // 轮询查找密码框，尝试 5 次，每次间隔 1 秒
      for (let i = 0; i < 5; i++) {
          if (await page.locator(passwordSelector).first().isVisible()) {
              targetContext = page;
              break;
          }
          if (await frame.locator(passwordSelector).first().isVisible()) {
              targetContext = frame;
              break;
          }
          await delay(1000);
      }

      if (targetContext) {
          console.log('找到密码输入框，正在输入...');
          const passwordInput = targetContext.locator(passwordSelector).first();
          await passwordInput.fill(CONFIG.password);
          await delay(500);
          
          // 点击确定按钮
          const confirmBtnRegex = /^确定$|^确认$|^提现$/;
          if (await clickButton(targetContext, confirmBtnRegex)) {
              await delay(2000); // 等待提交完成
              console.log('提现操作提交完成。');

              // 处理“知道了”按钮
              console.log('正在查找“知道了”按钮...');
              const gotItRegex = /^知道了$/;
              // 尝试多次查找
              for (let i = 0; i < 5; i++) {
                  if (await clickButton(page, gotItRegex)) break;
                  if (await clickButton(frame, gotItRegex)) break;
                  await delay(500);
              }
          } else {
              console.log('输入密码后未找到明确的确定按钮。');
          }
      } else {
          console.log('超时未检测到密码输入框，可能无需密码或已免密。');
      }
  } catch (e) {
      console.error('处理密码弹窗出错:', e);
  }
}

main().catch(console.error);
