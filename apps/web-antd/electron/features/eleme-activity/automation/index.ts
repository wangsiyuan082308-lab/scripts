/**
 * 饿了么活动助手 - 活动爬虫
 * 功能：提取活动列表、计算 ROI、推荐活动、飞书推送、自动报名
 * 版本：2.0.0
 */

import puppeteer from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'node:child_process';
import { dispatchSignup, classifyActivity as classifyActivityType, type ActivityType, type SignupResult as DispatchResult } from './signup-dispatcher';
import { createLogger as createSharedLogger } from '@oby/logger';
import { sendMessage, buildUnifiedOpsReport } from '@oby/feishu-notify';

import { isCliEntry } from '../../../utils/is-main-module';

const _sharedLogger = createSharedLogger('eleme-activity', { console: false });

const config = {
  browser: {
    timeout_ms: 60000,
    screenshot_on_error: true
  }
};

// ============================================================
// 日志系统（保持原有不变）
// ============================================================

type LogLevel = 'info' | 'warn' | 'error';

function log(level: LogLevel, message: string, data?: any) {
  const timestamp = new Date().toISOString();
  const logEntry = {
    timestamp,
    level,
    message,
    ...(data ? { data } : {})
  };
  
  console.log(JSON.stringify(logEntry, null, 2));
  
  // 写入日志文件
  const logFile = path.join(__dirname, '..', 'logs', `activity_${new Date().toISOString().split('T')[0].replace(/-/g, '')}.log`);
  fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');

  // 同步写入共享结构化日志
  const sl = level === 'error' ? 'error' : level === 'warn' ? 'warn' : 'info';
  _sharedLogger[sl]('log', { message, ...(data ? { data } : {}) });
}

// ============================================================
// 数据类型定义
// ============================================================

interface Activity {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  signupDeadline: string;
  daysToDeadline: number;
  platformSubsidy: number;
  merchantCost: number;
  threshold: number;
  suitableStores: string[];
  fullText: string;
  status: 'available' | 'signed_up' | 'expired';
  immediateSignup: boolean;
  existsButNotImmediate: boolean;
  accountScope: 'store' | 'chain';
  requiredAccountScope: 'store' | 'chain';
  requiresChainAccount: boolean;
  reasonTags: string[];
  url: string;
  detailLoaded: boolean;
}

interface StoreMetrics {
  name: string;
  avgOrderValue: number;
  grossMargin: number;
  dailyOrders: number;
}

interface RecommendationResult {
  p0: Activity[];
  p1: Activity[];
  p2: Activity[];
  p3: Activity[];
}

interface AutoSignupConfig {
  enabled: boolean;
  dryRun: boolean;
  p0: boolean;
  p1: boolean;
  activityTypes?: ActivityType[];
}

interface AppConfig {
  stores?: Array<{
    name: string;
    avgOrderValue?: number;
    grossMargin?: number;
    dailyOrders?: number;
    enable?: boolean;
  }>;
  autoSignup?: AutoSignupConfig;
  feishu?: {
    target_user_id?: string;
  };
}

// ============================================================
// 配置加载
// ============================================================

function loadAppConfig(): AppConfig {
  const configPath = path.join(__dirname, '..', 'config.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw) as AppConfig;
  } catch (err) {
    log('warn', '读取 config.json 失败，使用默认配置', { err });
    return {};
  }
}

function loadStoreMetrics(): StoreMetrics[] {
  const appConfig = loadAppConfig();

  // 默认门店指标（当 config.json 没有 avgOrderValue 等财务字段时使用）
  const defaults: Record<string, Partial<StoreMetrics>> = {
    '安吉店': { avgOrderValue: 45, grossMargin: 0.25, dailyOrders: 150 },
    '长兴店': { avgOrderValue: 42, grossMargin: 0.23, dailyOrders: 120 },
    '太仓店': { avgOrderValue: 40, grossMargin: 0.22, dailyOrders: 100 },
    '中山店': { avgOrderValue: 38, grossMargin: 0.22, dailyOrders: 90 },
    '宜宾店': { avgOrderValue: 40, grossMargin: 0.22, dailyOrders: 95 },
    '合肥店': { avgOrderValue: 40, grossMargin: 0.22, dailyOrders: 95 },
    '济阳店': { avgOrderValue: 38, grossMargin: 0.21, dailyOrders: 85 },
    '江北店': { avgOrderValue: 38, grossMargin: 0.21, dailyOrders: 85 },
    '宁波店': { avgOrderValue: 42, grossMargin: 0.23, dailyOrders: 110 },
  };

  // 尝试从 oby-finance-analyzer 读取门店配置
  let obyCfg: any = null;
  try {
    const obyPath = path.join(__dirname, '..', '..', 'oby-finance-analyzer', 'store_config.json');
    if (fs.existsSync(obyPath)) {
      obyCfg = JSON.parse(fs.readFileSync(obyPath, 'utf-8'));
      log('info', '从 oby-finance-analyzer 读取门店配置成功');
    }
  } catch (err) {
    log('warn', '读取 oby-finance-analyzer/store_config.json 失败', { err });
  }

  const stores: StoreMetrics[] = [];

  if (appConfig.stores && appConfig.stores.length > 0) {
    for (const s of appConfig.stores) {
      if (s.enable === false) continue;
      const shortName = s.name;
      const def = defaults[shortName] || { avgOrderValue: 40, grossMargin: 0.22, dailyOrders: 100 };
      stores.push({
        name: shortName,
        avgOrderValue: s.avgOrderValue ?? def.avgOrderValue ?? 40,
        grossMargin: s.grossMargin ?? def.grossMargin ?? 0.22,
        dailyOrders: s.dailyOrders ?? def.dailyOrders ?? 100,
      });
    }
  } else {
    // 从 defaults 构建基础列表
    for (const [name, metrics] of Object.entries(defaults)) {
      stores.push({
        name,
        avgOrderValue: metrics.avgOrderValue!,
        grossMargin: metrics.grossMargin!,
        dailyOrders: metrics.dailyOrders!,
      });
    }
  }

  log('info', `加载了 ${stores.length} 个门店配置`, { stores: stores.map(s => s.name) });
  return stores;
}

// ============================================================
// 数据持久化辅助
// ============================================================

function ensureDataDir() {
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  return dataDir;
}

function saveActivities(activities: Activity[]) {
  try {
    const dataDir = ensureDataDir();
    const filePath = path.join(dataDir, 'activities.json');
    fs.writeFileSync(filePath, JSON.stringify(activities, null, 2), 'utf-8');
    log('info', '活动数据已持久化', { path: filePath, count: activities.length });

    const onlineOpsInputDir = path.join(__dirname, '..', '..', 'online-ops-assistant', 'data', 'input');
    if (!fs.existsSync(onlineOpsInputDir)) {
      fs.mkdirSync(onlineOpsInputDir, { recursive: true });
    }
    const onlineOpsInputFile = path.join(onlineOpsInputDir, 'eleme_activities.json');
    fs.writeFileSync(onlineOpsInputFile, JSON.stringify(activities, null, 2), 'utf-8');
    log('info', '已同步活动数据到线上运营小助手输入目录', { path: onlineOpsInputFile, count: activities.length });
  } catch (err) {
    log('error', '保存活动数据失败', { err });
  }
}

function appendSignupHistory(record: {
  activityId: string;
  activityName: string;
  signedAt: string;
  success: boolean;
  message: string;
  dryRun: boolean;
}) {
  try {
    const dataDir = ensureDataDir();
    const historyFile = path.join(dataDir, '报名历史.json');
    let history: any[] = [];
    if (fs.existsSync(historyFile)) {
      try {
        history = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
      } catch {
        history = [];
      }
    }
    history.push(record);
    fs.writeFileSync(historyFile, JSON.stringify(history, null, 2), 'utf-8');
    log('info', '报名历史已追加', { historyFile, record });
  } catch (err) {
    log('error', '保存报名历史失败', { err });
  }
}

function classifyAccountScope(activityName: string, fullText: string): {
  accountScope: 'store' | 'chain';
  requiredAccountScope: 'store' | 'chain';
  immediateSignup: boolean;
  existsButNotImmediate: boolean;
  requiresChainAccount: boolean;
  reasonTags: string[];
} {
  const text = `${activityName} ${fullText}`;
  const isSuperBrand = text.includes('超级品牌');
  const asksChain = /请使用连锁账号报名|连锁账号报名/.test(text);
  const immediateSignup = /立即报名|追加报名|继续报名/.test(text) && !asksChain;
  const requiredAccountScope: 'store' | 'chain' = (isSuperBrand || asksChain) ? 'chain' : 'store';
  const accountScope: 'store' | 'chain' = asksChain ? 'store' : requiredAccountScope;
  const requiresChainAccount = requiredAccountScope === 'chain' && accountScope !== 'chain';
  const existsButNotImmediate = requiresChainAccount || !immediateSignup;
  const reasonTags = new Set<string>();
  if (asksChain || isSuperBrand) reasonTags.add('requires_chain_account');
  if (asksChain) reasonTags.add('store_scope_only');
  if (existsButNotImmediate) reasonTags.add('exists_but_not_immediate');
  if (!immediateSignup) reasonTags.add('not_immediate_signup');

  return {
    accountScope,
    requiredAccountScope,
    immediateSignup,
    existsButNotImmediate,
    requiresChainAccount,
    reasonTags: Array.from(reasonTags),
  };
}

// ============================================================
// 活动爬虫
// ============================================================

class ActivityScraper {
  private page: any = null;
  private browser: any = null;
  private targetFrame: any = null;
  
  async initialize() {
    log('info', '初始化浏览器...');
    
    const userDataDir = path.join(__dirname, '..', 'user_data');
    
    const browserContext = await puppeteer.chromium.launchPersistentContext(userDataDir, {
      channel: 'chrome',
      headless: false,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-dev-shm-usage'
      ]
    });
    
    this.browser = browserContext;
    this.page = browserContext.pages()[0] || await browserContext.newPage();
    
    await this.page.addInitScript(() => {
      // @ts-ignore
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined
      });
    });
    
    log('info', '浏览器初始化完成');
  }
  
  /**
   * 找到目标 iframe frame
   */
  private async findTargetFrame(): Promise<any> {
    const frames = this.page.frames();
    log('info', `找到${frames.length}个 frames`);
    
    let targetFrame: any = null;
    
    // 优先级1: 找包含活动内容的最深层 frame（ebai-zs-webapp）
    // 优先级2: 找 ms.ele.me 域名的 frame
    // 页面结构: 主框架(nr.ele.me) → eb-frame(ms.ele.me/ebai-zs-webapp) → 内部iframe
    const priorities = [
      (url: string) => url.includes('ebai-zs-webapp'),
      (url: string) => url.includes('ms.ele.me') && !url.includes('xdomain-storage'),
      (url: string) => url.includes('ms.ele.me'),
    ];
    
    for (const matcher of priorities) {
      for (const frame of frames) {
        try {
          const url = frame.url();
          if (matcher(url)) {
            // 检查这个 frame 是否有活动相关内容
            const hasContent = await frame.evaluate(() => {
              return !!(
                document.querySelector('[class*="act-view"]') ||
                document.querySelector('[class*="activity"]') ||
                document.querySelector('button') ||
                document.body?.innerText?.includes('报名')
              );
            }).catch(() => false);
            
            if (hasContent) {
              targetFrame = frame;
              log('info', `找到目标 frame (有活动内容): ${url.substring(0, 100)}...`);
              break;
            }
            // 即使没内容也记住，作为备选
            if (!targetFrame) {
              targetFrame = frame;
              log('info', `找到候选 frame: ${url.substring(0, 100)}...`);
            }
          }
        } catch {
          // Frame 无法访问，继续下一个
        }
      }
      if (targetFrame) break;
    }
    
    if (!targetFrame && frames.length > 2) {
      targetFrame = frames[2];
      log('warn', `使用 frame[2]: ${targetFrame.url()}`);
    }
    
    if (!targetFrame) {
      log('warn', '未找到目标 iframe，使用主页面');
      targetFrame = this.page.mainFrame();
    }
    
    log('info', `使用 frame: ${targetFrame.url()}`);
    this.targetFrame = targetFrame;
    return targetFrame;
  }

  /**
   * 切换到连锁账号（解锁品牌活动报名权限）
   * @param chainName 连锁名称，默认 OBy24h便利
   */
  async switchToChainAccount(chainName: string = 'OBy24h便利'): Promise<boolean> {
    if (!this.page) throw new Error('浏览器未初始化');

    const CHAIN_SWITCH_TIMEOUT = 60000; // 60秒超时
    const MAX_RETRIES = 3;

    log('info', `切换到连锁账号: ${chainName}`);

    // 保存截图辅助函数
    const saveDiagnosticScreenshot = async (stage: string) => {
      try {
        const screenshotPath = path.join(__dirname, '..', 'logs', `chain_switch_${stage}_${Date.now()}.png`);
        await this.page.screenshot({ path: screenshotPath, fullPage: true });
        log('info', `诊断截图已保存 [${stage}]`, { path: screenshotPath });
      } catch (e) {
        log('warn', `截图失败 [${stage}]`, { e });
      }
    };

    // 获取当前账号名称（多种选择器尝试）
    const getCurrentAccount = async (): Promise<string> => {
      const selectors = [
        '.account-switch .current-account',
        '.account-switch-trigger .current-account',
        '.account-switch-trigger',
        '[class*="account-switch"] [class*="current"]',
        '[class*="account"] [class*="current"]',
      ];

      for (const selector of selectors) {
        try {
          const text = await this.page.$eval(selector, (el: any) => el?.textContent?.trim() || '').catch(() => null);
          if (text && text.length > 0 && text.length < 50) {
            log('info', `找到当前账号元素 [${selector}]: ${text}`);
            return text;
          }
        } catch {}
      }

      // 最后尝试：获取所有可能的账号显示元素
      const fallbackText = await this.page.evaluate(() => {
        // 尝试找包含"便利"或"OBy"的元素
        const allElements = Array.from(document.querySelectorAll('*'));
        for (const el of allElements) {
          const text = el.textContent?.trim() || '';
          if ((text.includes('便利') || text.includes('OBy') || text.includes('连锁')) && text.length < 50) {
            // 检查是否是账号切换相关元素
            const classList = el.className || '';
            if (classList.includes('account') || classList.includes('switch') || classList.includes('cascader')) {
              return text;
            }
          }
        }
        return '';
      });

      if (fallbackText) {
        log('info', `通过 fallback 找到当前账号: ${fallbackText}`);
      } else {
        log('warn', '未能获取当前账号名称');
      }

      return fallbackText;
    };

    for (let retry = 0; retry < MAX_RETRIES; retry++) {
      try {
        log('info', `切换尝试 ${retry + 1}/${MAX_RETRIES}`);

        // 截图：切换前状态
        if (retry > 0) {
          await saveDiagnosticScreenshot(`retry_${retry}_before`);
        }

        // 先检查当前账号
        const currentAccount = await getCurrentAccount();

        if (currentAccount.includes(chainName) || currentAccount.includes('连锁')) {
          log('info', `已在连锁账号视角，无需切换`, { currentAccount });
          return true;
        }

        log('info', `当前账号: "${currentAccount}"，开始切换...`);

        // 查找并点击账号切换触发器（多种选择器）
        const triggerSelectors = [
          '.account-switch .account-switch-trigger',
          '.account-switch-trigger',
          '[class*="account-switch"]',
          '[class*="cascader"]',
        ];

        let triggerClicked = false;
        for (const selector of triggerSelectors) {
          try {
            const trigger = await this.page.$(selector);
            if (trigger) {
              log('info', `找到触发器 [${selector}]，准备点击`);
              await trigger.click({ timeout: 5000 });
              triggerClicked = true;
              break;
            }
          } catch (e) {
            log('warn', `触发器点击失败 [${selector}]`, { e: String(e) });
          }
        }

        if (!triggerClicked) {
          log('warn', '未找到账号切换触发器');
          await saveDiagnosticScreenshot(`retry_${retry}_no_trigger`);
          continue;
        }

        // 等待下拉菜单出现
        await this.page.waitForTimeout(1000);
        await saveDiagnosticScreenshot(`retry_${retry}_dropdown`);

        // 尝试多种下拉菜单选择器
        const dropdownSelectors = [
          '.account-switch-dropdown',
          '.cascade-menu',
          '[class*="dropdown"]',
          '[class*="cascader"] [class*="menu"]',
          '.ant-cascader-menu',
        ];

        let dropdownFound = false;
        for (const selector of dropdownSelectors) {
          try {
            await this.page.waitForSelector(selector, { timeout: 5000 });
            log('info', `下拉菜单已出现 [${selector}]`);
            dropdownFound = true;
            break;
          } catch {}
        }

        if (!dropdownFound) {
          log('warn', '下拉菜单未出现');
          continue;
        }

        // 找到连锁项并点击（多种选择器）
        const switched = await this.page.evaluate((target: string) => {
          // 尝试多种选择器找菜单项
          const itemSelectors = [
            '.cascade-menu-item',
            '.cascader-option',
            '.ant-cascader-menu-item',
            'li[class*="cascader"]',
            '[class*="menu-item"]',
            'li',
          ];

          for (const selector of itemSelectors) {
            const items = Array.from(document.querySelectorAll(selector));
            for (const item of items) {
              const text = item.textContent?.trim() || '';
              // 匹配包含目标名称或"连锁"关键字
              if (text.includes(target) || text.includes('连锁') || text.includes('OBy')) {
                log('info', `找到连锁项: ${text}`);
                (item as HTMLElement).click();
                return { success: true, text };
              }
            }
          }
          return { success: false, text: '' };
        }, chainName);

        if (!switched.success) {
          log('warn', `未找到连锁账号项`, { chainName });
          await saveDiagnosticScreenshot(`retry_${retry}_not_found`);
          continue;
        }

        log('info', `点击了连锁项: ${switched.text}`);

        // 等待页面刷新/响应
        await this.page.waitForTimeout(3000);

        // 等待网络空闲（延长超时）
        try {
          await this.page.waitForLoadState('networkidle', { timeout: CHAIN_SWITCH_TIMEOUT / 2 });
        } catch {
          log('warn', '等待 networkidle 超时，继续验证');
        }

        // 验证切换成功
        const newAccount = await getCurrentAccount();
        await saveDiagnosticScreenshot(`retry_${retry}_after`);

        const success = newAccount.includes(chainName) || newAccount.includes('连锁');
        log(success ? 'info' : 'warn', `账号切换${success ? '成功' : '待验证'}`, {
          from: currentAccount,
          to: newAccount,
          expected: chainName
        });

        if (success) {
          return true;
        }

        // 失败后等待一会儿再重试
        if (retry < MAX_RETRIES - 1) {
          log('info', `切换未成功，等待 3 秒后重试...`);
          await this.page.waitForTimeout(3000);
        }

      } catch (err) {
        log('error', `账号切换异常 (尝试 ${retry + 1})`, { err: String(err) });
        await saveDiagnosticScreenshot(`retry_${retry}_error`);

        if (retry < MAX_RETRIES - 1) {
          await this.page.waitForTimeout(2000);
        }
      }
    }

    log('warn', `连锁账号切换失败，已重试 ${MAX_RETRIES} 次`);
    return false;
  }

  /**
   * 切换回单店账号
   */
  async switchToStore(chainName: string, storeName: string): Promise<boolean> {
    if (!this.page) throw new Error('浏览器未初始化');

    log('info', `切换到单店: ${storeName}`);

    try {
      await this.page.click('.account-switch .account-switch-trigger');
      await this.page.waitForTimeout(800);
      await this.page.waitForSelector('.account-switch-dropdown', { timeout: 5000 });

      // hover 连锁项展开子菜单
      const items = await this.page.$$('.cascade-menu-item');
      for (const item of items) {
        const text = await item.textContent();
        if (text?.includes(chainName)) {
          await item.hover();
          break;
        }
      }
      await this.page.waitForTimeout(800);

      // 点击门店
      const allItems = await this.page.$$('li');
      for (const li of allItems) {
        const text = await li.textContent();
        if (text?.includes(storeName) && text?.includes('单店')) {
          await li.click();
          break;
        }
      }

      await this.page.waitForTimeout(3000);
      await this.page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

      const current = await this.page.evaluate(() => {
        const el = document.querySelector('.account-switch .current-account');
        return el?.textContent?.trim() || '';
      });

      const success = current.includes(storeName);
      log(success ? 'info' : 'warn', `切换到单店${success ? '成功' : '失败'}: ${current}`);
      return success;
    } catch (err) {
      log('error', '切换单店异常', { err });
      return false;
    }
  }

  async scrapeActivities(): Promise<Activity[]> {
    if (!this.page) {
      throw new Error('浏览器未初始化');
    }
    
    const activityUrl = 'https://nr.ele.me/app/eleme-nr-bfe-newretail/common-next#/pc/platformActivitiesPc/';
    
    log('info', '开始爬取活动列表', { url: activityUrl });
    
    try {
      await this.page.goto(activityUrl, {
        waitUntil: 'networkidle',
        timeout: config.browser.timeout_ms
      });
      
      // 检测登录状态
      log('info', '检测登录状态...');
      
      if (this.page.url().includes('login') || this.page.url().includes('sso')) {
        log('warn', '检测到需要登录！等待用户手动登录...');
        
        try {
          execSync('say "请登录饿了么"', { stdio: 'ignore' });
        } catch {}
        
        log('info', '等待登录成功（最多 5 分钟）...');
        await this.page.waitForFunction(
          () => !window.location.href.includes('login') && !window.location.href.includes('sso'),
          null,
          { timeout: 300_000 }
        );
        
        log('info', '登录成功！');
        await this.page.waitForLoadState('domcontentloaded');
        await this.page.waitForTimeout(2000);
      } else {
        log('info', '已登录状态，继续...');
      }
      
      // 等待活动列表加载
      log('info', '等待活动列表加载...');
      await this.page.waitForLoadState('networkidle', {
        timeout: config.browser.timeout_ms
      });
      await this.page.waitForTimeout(5000);
      
      // 截图
      const screenshotPath = path.join(__dirname, '..', 'logs', `activities_${Date.now()}.png`);
      await this.page.screenshot({ path: screenshotPath, fullPage: true });
      log('info', '页面截图已保存', { path: screenshotPath });
      
      // 找到目标 frame
      log('info', '查找活动列表 frame...');
      const targetFrame = await this.findTargetFrame();
      
      // ============================================
      // 处理分页（ant-pagination）
      // ============================================
      log('info', '检查分页...');
      
      let allActivities: any[] = [];
      let currentPage = 1;
      let totalPages = 1;
      
      // 获取总页数
      const pageInfo = await targetFrame.evaluate(() => {
        const antPagination = document.querySelector('.ant-pagination');
        if (!antPagination) return { totalPages: 1 };
        
        const items = antPagination.querySelectorAll('li');
        let maxPage = 1;
        items.forEach((li: Element) => {
          const text = li.textContent?.trim();
          const pageNum = parseInt(text || '');
          if (!isNaN(pageNum) && text !== '') {
            maxPage = Math.max(maxPage, pageNum);
          }
        });
        
        return { totalPages: maxPage };
      });
      
      totalPages = pageInfo.totalPages;
      log('info', `检测到 ${totalPages} 页活动`);
      
      while (currentPage <= totalPages) {
        log('info', `提取第 ${currentPage} 页...`);
        
        // 提取当前页活动
        const pageActivities = await targetFrame.evaluate(() => {
          const activityCards = Array.from(document.querySelectorAll('.zs-act-view-v2'));
          
          return activityCards.map((card: Element) => {
            const text = (card.textContent || '').replace(/\s+/g, ' ');
            const htmlCard = card as HTMLElement;
            
            // 提取活动名称
            let name = '';
            const fullTitleMatch = text.match(/【([^】]+)】\s*([^\n活动时间]+)/);
            if (fullTitleMatch) {
              name = `[${fullTitleMatch[1].trim()}]${fullTitleMatch[2].trim()}`.replace(/\s+/g, ' ');
            } else {
              const bracketMatch = text.match(/【([^】]+)】/);
              name = bracketMatch ? `[${bracketMatch[1].trim()}]` : text.substring(0, 60).trim();
            }
            
            // 清理名称
            name = name.replace(/立即报名 | 报名截止 | 活动时间.*$/g, '').trim();
            const activityTimeIndex = name.indexOf('活动时间');
            if (activityTimeIndex > 0) {
              name = name.substring(0, activityTimeIndex).trim();
            }
            if (name.length > 50) {
              name = name.substring(0, 50) + '...';
            }
            
            // 提取时间
            const timeMatch = text.match(/活动时间\s*[：:]\s*(\d{2}\/\d{2})\s*~\s*(\d{2}\/\d{2})/);
            const startTime = timeMatch ? timeMatch[1] : '';
            const endTime = timeMatch ? timeMatch[2] : '';
            
            // 提取截止
            const deadlineMatch = text.match(/(\d+)\s*天后\s*报名截止/);
            const daysToDeadline = deadlineMatch ? parseInt(deadlineMatch[1]) : 999;
            
            // ============================================
            // 改进的补贴提取逻辑
            // ============================================
            let platformSubsidy = 0;
            let merchantCost = 0;
            let threshold = 0;

            // 1. 淘宝闪购补 / 平台补贴 / 红包补贴 / 满减补贴
            const subsidyPatterns = [
              /淘宝闪购补\s*(\d+(?:\.\d+)?)\s*元?/,
              /平台补贴\s*(\d+(?:\.\d+)?)\s*元?/,
              /平台补\s*(\d+(?:\.\d+)?)\s*元?/,
              /红包补贴\s*(\d+(?:\.\d+)?)\s*元?/,
              /满减补贴\s*(\d+(?:\.\d+)?)\s*元?/,
              /补贴\s*(\d+(?:\.\d+)?)\s*元/,
              /补\s*(\d+(?:\.\d+)?)\s*元/,
              /立减\s*(\d+(?:\.\d+)?)\s*元/,
              /优惠\s*(\d+(?:\.\d+)?)\s*元/,
            ];
            for (const pattern of subsidyPatterns) {
              const m = text.match(pattern);
              if (m) {
                platformSubsidy = parseFloat(m[1]);
                break;
              }
            }

            // 2. 商家承担金额
            const merchantPatterns = [
              /商家承担\s*(\d+(?:\.\d+)?)\s*元?/,
              /商家出资\s*(\d+(?:\.\d+)?)\s*元?/,
              /商家补贴\s*(\d+(?:\.\d+)?)\s*元?/,
              /商家\s*(\d+(?:\.\d+)?)\s*元/,
            ];
            for (const pattern of merchantPatterns) {
              const m = text.match(pattern);
              if (m) {
                merchantCost = parseFloat(m[1]);
                break;
              }
            }

            // 3. 门槛金额
            const thresholdPatterns = [
              /满\s*(\d+(?:\.\d+)?)\s*元/,
              /满\s*(\d+(?:\.\d+)?)\s*减/,
              /起送\s*(\d+(?:\.\d+)?)/,
              /消费满\s*(\d+(?:\.\d+)?)/,
            ];
            for (const pattern of thresholdPatterns) {
              const m = text.match(pattern);
              if (m) {
                threshold = parseFloat(m[1]);
                break;
              }
            }
            
            // 不在浏览器上下文中调用 classifyAccountScope，返回原始数据
            const fullTextForMeta = text.substring(0, 800);

            return {
              id: htmlCard.getAttribute('data-id') || `activity_${Date.now()}_${Math.random()}`,
              name,
              startTime,
              endTime,
              signupDeadline: daysToDeadline < 999 ? `${daysToDeadline}天后` : '',
              daysToDeadline,
              platformSubsidy,
              merchantCost,
              threshold,
              suitableStores: [] as string[], // 由外部根据配置填充
              fullText: fullTextForMeta,
              status: text.includes('已报名') ? 'signed_up' : text.includes('已结束') ? 'expired' : 'available',
              // 临时字段，稍后处理
              _needsAccountMeta: true,
              url: (htmlCard.querySelector('a') as HTMLAnchorElement | null)?.href || window.location.href,
              detailLoaded: false
            };
          });
        });
        
        // 在 Node.js 上下文中处理 accountMeta
        const processedActivities = pageActivities.map((act: any) => {
          const accountMeta = classifyAccountScope(act.name, act.fullText || '');
          return {
            ...act,
            immediateSignup: accountMeta.immediateSignup,
            existsButNotImmediate: accountMeta.existsButNotImmediate,
            accountScope: accountMeta.accountScope,
            requiredAccountScope: accountMeta.requiredAccountScope,
            requiresChainAccount: accountMeta.requiresChainAccount,
            reasonTags: accountMeta.reasonTags,
            _needsAccountMeta: undefined // 清理临时字段
          };
        });
        
        // 合并到总列表
        allActivities.push(...processedActivities);
        log('info', `第 ${currentPage} 页提取完成，当前共 ${allActivities.length} 个活动`);
        
        // 点击下一页
        if (currentPage < totalPages) {
          const nextPageNum = currentPage + 1;
          log('info', `点击页码 ${nextPageNum}...`);
          
          await targetFrame.evaluate((pageNum: number) => {
            const antPagination = document.querySelector('.ant-pagination');
            if (!antPagination) return;
            
            const items = antPagination.querySelectorAll('li');
            items.forEach((li: Element) => {
              const text = li.textContent || '';
              const isDisabled = li.classList.contains('ant-pagination-disabled');
              
              if (text.trim() === String(pageNum) && !isDisabled) {
                (li as HTMLElement).click();
              }
            });
          }, nextPageNum);
          
          log('info', '等待页面加载...');
          await this.page.waitForLoadState('networkidle', { timeout: 30000 });
          await this.page.waitForTimeout(5000);
          
          currentPage++;
        } else {
          break;
        }
      }
      
      // 去重
      const seen = new Set();
      const uniqueActivities = allActivities.filter((act: any) => {
        if (seen.has(act.name)) return false;
        seen.add(act.name);
        return true;
      });
      
      log('info', '活动数据提取完成', { 
        count: uniqueActivities.length,
        totalPages: totalPages,
        sample: uniqueActivities.slice(0, 5).map((a: any) => ({ 
          name: a.name, 
          status: a.status,
          deadline: a.daysToDeadline,
          subsidy: a.platformSubsidy,
          merchantCost: a.merchantCost,
          threshold: a.threshold,
        }))
      });
      
      log('info', '爬取完成', { count: uniqueActivities.length, totalPages: totalPages });
      
      return uniqueActivities as Activity[];
      
    } catch (error) {
      log('error', '爬取失败', { error });
      
      if (config.browser.screenshot_on_error && this.page) {
        const screenshotPath = path.join(__dirname, '..', 'logs', `error_${Date.now()}.png`);
        await this.page.screenshot({ path: screenshotPath, fullPage: true });
        log('info', '错误截图已保存', { path: screenshotPath });
      }
      
      throw error;
    }
  }

  /**
   * 加载活动详情页，提取更详细的补贴/门槛/商家成本信息
   */
  async loadActivityDetails(activities: Activity[]): Promise<Activity[]> {
    const needDetail = activities.filter(a => !a.detailLoaded && a.status === 'available');
    log('info', `开始加载活动详情，共 ${needDetail.length} 个需要加载`);

    for (let i = 0; i < needDetail.length; i++) {
      const activity = needDetail[i];
      log('info', `加载活动详情 [${i + 1}/${needDetail.length}]: ${activity.name}`);

      try {
        if (activity.url && activity.url !== this.page.url() && !activity.url.includes('platformActivitiesPc')) {
          await this.page.goto(activity.url, {
            waitUntil: 'networkidle',
            timeout: 30000
          });
          await this.page.waitForTimeout(2000);
        }

        // 在当前 frame 中尝试点击该活动卡片
        const targetFrame = this.targetFrame || await this.findTargetFrame();

        const detailData = await targetFrame.evaluate((actName: string) => {
          // 找到对应的活动卡片
          const cards = Array.from(document.querySelectorAll('.zs-act-view-v2'));
          let card: Element | null = null;
          for (const c of cards) {
            if ((c.textContent || '').includes(actName.replace(/\[|\]/g, '').substring(0, 20))) {
              card = c;
              break;
            }
          }
          if (!card) return null;

          const text = (card.textContent || '').replace(/\s+/g, ' ');

          // 提取更多字段
          let platformSubsidy = 0;
          let merchantCost = 0;
          let threshold = 0;

          const subsidyPatterns = [
            /淘宝闪购补\s*(\d+(?:\.\d+)?)\s*元?/,
            /平台补贴\s*(\d+(?:\.\d+)?)\s*元?/,
            /平台补\s*(\d+(?:\.\d+)?)\s*元?/,
            /红包补贴\s*(\d+(?:\.\d+)?)\s*元?/,
            /满减补贴\s*(\d+(?:\.\d+)?)\s*元?/,
            /补贴\s*(\d+(?:\.\d+)?)\s*元/,
            /补\s*(\d+(?:\.\d+)?)\s*元/,
            /立减\s*(\d+(?:\.\d+)?)\s*元/,
          ];
          for (const pattern of subsidyPatterns) {
            const m = text.match(pattern);
            if (m) { platformSubsidy = parseFloat(m[1]); break; }
          }

          const merchantPatterns = [
            /商家承担\s*(\d+(?:\.\d+)?)\s*元?/,
            /商家出资\s*(\d+(?:\.\d+)?)\s*元?/,
            /商家补贴\s*(\d+(?:\.\d+)?)\s*元?/,
            /商家\s*(\d+(?:\.\d+)?)\s*元/,
          ];
          for (const pattern of merchantPatterns) {
            const m = text.match(pattern);
            if (m) { merchantCost = parseFloat(m[1]); break; }
          }

          const thresholdPatterns = [
            /满\s*(\d+(?:\.\d+)?)\s*元/,
            /满\s*(\d+(?:\.\d+)?)\s*减/,
            /起送\s*(\d+(?:\.\d+)?)/,
            /消费满\s*(\d+(?:\.\d+)?)/,
          ];
          for (const pattern of thresholdPatterns) {
            const m = text.match(pattern);
            if (m) { threshold = parseFloat(m[1]); break; }
          }

          return { platformSubsidy, merchantCost, threshold };
        }, activity.name);

        if (detailData) {
          if (detailData.platformSubsidy > 0) activity.platformSubsidy = detailData.platformSubsidy;
          if (detailData.merchantCost > 0) activity.merchantCost = detailData.merchantCost;
          if (detailData.threshold > 0) activity.threshold = detailData.threshold;
        }

        activity.detailLoaded = true;
        log('info', `详情加载完成: ${activity.name}`, {
          platformSubsidy: activity.platformSubsidy,
          merchantCost: activity.merchantCost,
          threshold: activity.threshold,
        });

        // 避免限流：2-3 秒间隔
        if (i < needDetail.length - 1) {
          const waitMs = 2000 + Math.random() * 1000;
          await this.page.waitForTimeout(waitMs);
        }

      } catch (err) {
        log('warn', `加载活动详情失败: ${activity.name}`, { err });
        activity.detailLoaded = true; // 标记为已尝试，避免反复失败
      }
    }

    log('info', '所有活动详情加载完成');
    return activities;
  }

  /**
   * 对单个活动执行报名（通过调度器路由到对应流程）
   */
  async signupActivity(activity: Activity, config?: { targetStores?: string[]; maxMerchantCostRatio?: number; dryRun?: boolean }): Promise<{ success: boolean; message: string }> {
    log('info', `开始报名活动: ${activity.name}`);

    try {
      const targetFrame = this.targetFrame || await this.findTargetFrame();

      const result = await dispatchSignup({
        page: this.page,
        frame: targetFrame,
        activity: {
          name: activity.name,
          merchantCost: activity.merchantCost,
          platformSubsidy: activity.platformSubsidy,
          threshold: activity.threshold,
          fullText: activity.fullText,
        },
        config: {
          targetStores: config?.targetStores || [],
          maxMerchantCostRatio: config?.maxMerchantCostRatio || 0.3,
          dryRun: config?.dryRun ?? true,
        },
      });

      return { success: result.success, message: result.message };

    } catch (err: any) {
      log('error', `报名活动失败: ${activity.name}`, { err: err?.message });
      return { success: false, message: err?.message || '未知错误' };
    }
  }
  
  async close() {
    if (this.browser) {
      await this.browser.close();
      log('info', '浏览器已关闭');
    }
  }
}

// ============================================================
// 推荐算法
// ============================================================

class RecommendationEngine {
  
  calculateROI(activity: Activity, store: StoreMetrics): number {
    const grossProfitPerOrder = store.avgOrderValue * store.grossMargin;
    const costPerOrder = activity.merchantCost;
    const netProfitPerOrder = grossProfitPerOrder - costPerOrder;
    const estimatedIncrementalOrders = this.estimateIncrementalOrders(activity, store);
    const totalRevenue = estimatedIncrementalOrders * netProfitPerOrder;
    const totalCost = estimatedIncrementalOrders * costPerOrder;
    
    let roi: number;
    if (totalCost <= 0) {
      roi = 999;
    } else {
      roi = totalRevenue / totalCost;
    }
    
    return roi;
  }
  
  private estimateIncrementalOrders(activity: Activity, store: StoreMetrics): number {
    const baseIncremental = store.dailyOrders * 0.3;
    const subsidyFactor = 1 + (activity.platformSubsidy / 100);
    const deadlineFactor = activity.daysToDeadline < 7 ? 1.5 : 1.0;
    
    return Math.round(baseIncremental * subsidyFactor * deadlineFactor);
  }
  
  recommend(activities: Activity[], stores: StoreMetrics[]): RecommendationResult {
    const result: RecommendationResult = { p0: [], p1: [], p2: [], p3: [] };
    
    for (const activity of activities) {
      if (activity.status !== 'available') continue;
      if (activity.requiresChainAccount || !activity.immediateSignup) continue;
      
      const store = stores[0];
      const roi = this.calculateROI(activity, store);
      
      // P0（今日必报）：平台补贴≥15元 + ROI≥3.0 + 24小时内截止
      if (activity.platformSubsidy >= 15 && roi >= 3.0 && activity.daysToDeadline <= 1) {
        result.p0.push(activity);
      }
      // P1（值得报名）：ROI≥1.5 + 平台补贴≥5元
      else if (activity.platformSubsidy >= 5 && roi >= 1.5) {
        result.p1.push(activity);
      }
      // P2（可选）：ROI≥1.0
      else if (roi >= 1.0) {
        result.p2.push(activity);
      }
      // P3（不推荐）：ROI<1.0
      else {
        result.p3.push(activity);
      }
    }
    
    return result;
  }
}

// ============================================================
// 消息生成
// ============================================================

function generateUnifiedReport(
  activities: Activity[],
  recommendation: RecommendationResult,
  signupResults?: Array<{ name: string; success: boolean; dryRun: boolean }>
): string {
  const immediateSignup = activities.filter(a => a.status === 'available' && a.immediateSignup && !a.requiresChainAccount).length;
  const total = activities.length;
  const existsButNotImmediate = activities.filter(a => a.status === 'available' && a.existsButNotImmediate).length;
  const signed = (signupResults || []).filter(r => r.success).length;
  const failed = (signupResults || []).filter(r => !r.success).length;

  return buildUnifiedOpsReport('饿了么活动助手执行报告', 'manual', new Date().toISOString(), [
    {
      platform: 'eleme',
      total,
      immediateSignup,
      existsButNotImmediate,
      signed,
      failed,
      accountScope: activities.some(a => a.requiredAccountScope === 'chain') ? 'mixed' : 'store',
      reasons: ['活动存在但非立即报名态', '超级品牌默认需总账号/连锁账号视角'],
      notes: [
        `P0=${recommendation.p0.length}, P1=${recommendation.p1.length}, P2=${recommendation.p2.length}, P3=${recommendation.p3.length}`,
      ],
    },
  ]);
}

function generateMessage(
  activities: Activity[],
  recommendation: RecommendationResult,
  signupResults?: Array<{ name: string; success: boolean; dryRun: boolean }>
): string {
  const today = new Date().toISOString().split('T')[0];
  
  let message = `📊 饿了么活动助手 | ${today}\n`;
  message += '═══════════════════════════════════════\n\n';
  
  if (recommendation.p0.length > 0) {
    message += '🔴 今日必报（即将截止）\n';
    message += '───────────────────────────────────────\n';
    recommendation.p0.slice(0, 3).forEach((act, idx) => {
      message += `${idx + 1}. 【${act.name}】\n`;
      message += `   • 适合门店：${act.suitableStores.join('、')}\n`;
      message += `   • 活动周期：${act.startTime} ~ ${act.endTime}\n`;
      message += `   • 报名截止：${act.daysToDeadline}天后\n`;
      if (act.platformSubsidy > 0) message += `   • 平台补贴：${act.platformSubsidy}元\n`;
      if (act.merchantCost > 0) message += `   • 商家承担：${act.merchantCost}元\n`;
      if (act.threshold > 0) message += `   • 门槛金额：满${act.threshold}元\n`;
      message += `   • 推荐理由：即将截止 + 流量加持\n`;
      message += `   • 预估 ROI：1:999（平台全额补贴）\n`;
      message += `   → 立即报名\n\n`;
    });
  }
  
  if (recommendation.p1.length > 0) {
    message += '🟡 值得报名（高补贴）\n';
    message += '───────────────────────────────────────\n';
    recommendation.p1.slice(0, 5).forEach((act, idx) => {
      message += `${idx + 1}. 【${act.name}】\n`;
      message += `   • 补贴：平台${act.platformSubsidy}元\n`;
      if (act.merchantCost > 0) message += `   • 商家承担：${act.merchantCost}元\n`;
      if (act.threshold > 0) message += `   • 门槛金额：满${act.threshold}元\n`;
      message += `   • 适合门店：${act.suitableStores.join('、')}\n`;
      message += `   • 活动周期：${act.startTime} ~ ${act.endTime}\n`;
      message += `   • 报名截止：${act.daysToDeadline}天后\n`;
      message += `   → 立即报名\n\n`;
    });
  }
  
  if (recommendation.p2.length > 0) {
    message += '🟢 可选活动\n';
    message += '───────────────────────────────────────\n';
    recommendation.p2.slice(0, 5).forEach((act, idx) => {
      message += `${idx + 1}. 【${act.name}】\n`;
      message += `   • 适合门店：${act.suitableStores.join('、')}\n`;
      message += `   → 立即报名\n\n`;
    });
  }

  // 报名执行结果（如果有）
  if (signupResults && signupResults.length > 0) {
    message += '📝 自动报名结果\n';
    message += '───────────────────────────────────────\n';
    signupResults.forEach(r => {
      const icon = r.dryRun ? '🔍' : (r.success ? '✅' : '❌');
      const suffix = r.dryRun ? '（演练模式）' : '';
      message += `${icon} ${r.name}${suffix}\n`;
    });
    message += '\n';
  }
  
  message += '═══════════════════════════════════════\n';
  message += `今日可报名活动：${activities.filter(a => a.status === 'available').length}个\n`;
  message += `  • 🔴 即将截止：${recommendation.p0.length}个\n`;
  message += `  • 🟡 高补贴：${recommendation.p1.length}个\n`;
  message += `  • 🟢 其他：${recommendation.p2.length}个\n\n`;
  message += '💡 建议：优先报名即将截止的活动，高补贴活动值得考虑！\n';
  
  return message;
}

// ============================================================
// 主函数
// ============================================================

async function main() {
  log('info', '=== 饿了么活动助手启动 ===');
  
  const scraper = new ActivityScraper();
  const recommender = new RecommendationEngine();

  // 加载配置
  const appConfig = loadAppConfig();
  const autoSignupCfg: AutoSignupConfig = appConfig.autoSignup ?? {
    enabled: false,
    dryRun: true,
    p0: true,
    p1: false,
    activityTypes: ['super_brand', 'brand_coupon'],
  };

  const allowedAutoSignupTypes = new Set<ActivityType>(
    (autoSignupCfg.activityTypes && autoSignupCfg.activityTypes.length > 0)
      ? autoSignupCfg.activityTypes
      : ['super_brand', 'brand_coupon']
  );

  log('info', '自动报名配置', { autoSignupCfg });

  // 加载门店指标
  const stores = loadStoreMetrics();
  const storeNames = stores.map(s => s.name);
  
  try {
    // 初始化
    await scraper.initialize();
    
    // 切换到连锁账号（解锁品牌活动报名权限）
    const chainSwitched = await scraper.switchToChainAccount('OBy24h便利');
    if (!chainSwitched) {
      log('warn', '连锁账号切换失败，将以当前账号继续（部分品牌活动可能无法扫描/报名）');
    }
    
    // 爬取活动
    let activities = await scraper.scrapeActivities();

    // 加载活动详情（提取更精确的补贴/商家成本/门槛数据）
    try {
      activities = await scraper.loadActivityDetails(activities);
    } catch (err) {
      log('warn', '加载活动详情失败，使用列表页数据', { err });
    }

    // 为每个活动填充适合的门店列表
    activities = activities.map(act => ({
      ...act,
      suitableStores: storeNames,
    }));

    // 持久化活动数据（含详情）
    saveActivities(activities);
    
    // 推荐
    const recommendation = recommender.recommend(activities, stores);

    log('info', '推荐结果', {
      p0: recommendation.p0.length,
      p1: recommendation.p1.length,
      p2: recommendation.p2.length,
      p3: recommendation.p3.length,
    });

    // ============================================
    // 自动报名逻辑
    // ============================================
    const signupResults: Array<{ name: string; success: boolean; dryRun: boolean }> = [];

    if (autoSignupCfg.enabled) {
      const toSignup: Array<{ activity: Activity; priority: string; type: ActivityType }> = [];

      if (autoSignupCfg.p0) {
        recommendation.p0.forEach(a => {
          const type = classifyActivityType(a.name, a.fullText);
          if (allowedAutoSignupTypes.has(type)) {
            toSignup.push({ activity: a, priority: 'P0', type });
          } else {
            log('info', `自动报名跳过（类型不在白名单）: ${a.name}`, { type, priority: 'P0' });
          }
        });
      }
      if (autoSignupCfg.p1) {
        recommendation.p1.forEach(a => {
          const type = classifyActivityType(a.name, a.fullText);
          if (allowedAutoSignupTypes.has(type)) {
            toSignup.push({ activity: a, priority: 'P1', type });
          } else {
            log('info', `自动报名跳过（类型不在白名单）: ${a.name}`, { type, priority: 'P1' });
          }
        });
      }

      log('info', `待报名活动数量: ${toSignup.length}（dryRun=${autoSignupCfg.dryRun}）`, {
        allowedTypes: Array.from(allowedAutoSignupTypes),
      });

      for (const { activity, priority, type } of toSignup) {
        if (autoSignupCfg.dryRun) {
          log('info', `[DRY RUN] 跳过报名: ${activity.name} (${priority}, ${type})`);
          signupResults.push({ name: activity.name, success: true, dryRun: true });
          appendSignupHistory({
            activityId: activity.id,
            activityName: activity.name,
            signedAt: new Date().toISOString(),
            success: true,
            message: `dryRun 模式，未实际报名（type=${type}）`,
            dryRun: true,
          });
        } else {
          log('info', `执行报名: ${activity.name} (${priority}, ${type})`);
          const storeNames = stores.map(s => s.name);
          const result = await scraper.signupActivity(activity, {
            targetStores: storeNames,
            maxMerchantCostRatio: 0.3,
            dryRun: false,
          });
          signupResults.push({ name: activity.name, success: result.success, dryRun: false });
          appendSignupHistory({
            activityId: activity.id,
            activityName: activity.name,
            signedAt: new Date().toISOString(),
            success: result.success,
            message: `${result.message}（type=${type}）`,
            dryRun: false,
          });
          log(result.success ? 'info' : 'warn', `报名结果: ${activity.name}`, result);

          // 报名间隔
          await new Promise(r => setTimeout(r, 3000));
        }
      }
    } else {
      log('info', '自动报名未启用（autoSignup.enabled=false）');
    }
    
    // 切回单店账号（恢复原状）
    if (chainSwitched) {
      await scraper.switchToStore('OBy24h便利', 'Oby便利超市(安吉店)').catch(err => {
        log('warn', '切回单店失败，不影响本次执行', { err });
      });
    }

    // 生成消息
    const message = generateUnifiedReport(activities, recommendation, signupResults);
    
    log('info', '消息内容', { length: message.length, message });
    
    // 发送飞书（统一消息服务）
    log('info', '发送飞书消息...');
    const feishuConfig = appConfig.feishu || {};
    const targetId = feishuConfig.target_user_id || 'ou_42497b1b551250f41a295b184c90652d';
    const sendRes = sendMessage({
      channel: 'feishu',
      target: targetId,
      message,
      cwd: '/Users/mac/.openclaw/workspace',
    });
    if (!sendRes.ok) {
      throw new Error(sendRes.error || 'send message failed');
    }
    
    log('info', '飞书消息发送成功');
    
  } catch (error) {
    log('error', '执行失败', { error });
    throw error;
  } finally {
    await scraper.close();
    log('info', '=== 饿了么活动助手执行完成 ===');
  }
}

// 运行
if (isCliEntry('features/eleme-activity/automation/index.ts', 'features/eleme-activity/automation/index.js', 'index.ts', 'index.js', 'index.mjs', 'index.cjs')) {
  main().catch(console.error);
}
