/**
 * 超级品牌活动自动报名 - 修复版（集成P0修复）
 * 集成: 1) 品牌活动三层回退链 2) 提交按钮三级回退 3) AI Assistant防护 4) 5字段失败落盘
 */

import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

// 导入修复模块
import { BrandActivityFallback } from './lib/brand-activity-fallback';
import { SubmitButtonFallback } from './lib/submit-button-fallback';
import { AIAssistantFrameGuard } from './lib/ai-assistant-frame-guard';
import { FailureEvidenceCollector } from './lib/failure-evidence-collector';

// ============================================================
// 日志系统
// ============================================================

const LOG_DIR = path.join(__dirname, '..', 'logs');
const DATA_DIR = path.join(__dirname, '..', 'data');
const EVIDENCE_DIR = path.join(DATA_DIR, 'evidence');

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(EVIDENCE_DIR)) fs.mkdirSync(EVIDENCE_DIR, { recursive: true });

const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
const LOG_FILE = path.join(LOG_DIR, `super_brand_${today}.log`);

function log(level: 'info' | 'warn' | 'error', msg: string, data?: any) {
  const ts = new Date().toISOString();
  const entry = { ts, level, msg, ...(data ? { data } : {}) };
  const line = JSON.stringify(entry);
  console.log(`[${ts}] [${level.toUpperCase()}] ${msg}${data ? ' ' + JSON.stringify(data) : ''}`);
  fs.appendFileSync(LOG_FILE, line + '\n');
}

// ============================================================
// 活动类型识别
// ============================================================

type ActivityType = 'super_brand' | 'brand_coupon' | 'flash_sale' | 'other';

function classifyActivity(name: string, fullText: string): ActivityType {
  const combined = name + ' ' + fullText;
  if (combined.includes('超级品牌')) return 'super_brand';
  if (/专属券|专享券|品类红包/.test(combined)) return 'brand_coupon';
  if (/闪购567|限时抢购|爆好价|爆涨红包/.test(combined)) return 'flash_sale';
  return 'other';
}

function isChainAccountOnly(text: string): boolean {
  return /请使用连锁账号报名|连锁账号报名/.test(text);
}

async function ensureMainAccount(page: any) {
  // 硬性门禁：活动报名必须在“杭州货百盈*”总账号下执行
  const currentAccountText = await page.locator('.account-info, .user-name, [class*="account"]').first().textContent().catch(() => '');
  if (!currentAccountText?.includes('货百盈')) {
    log('error', '当前账号非杭州货百盈总账号，停止执行');
    throw new Error('WRONG_ACCOUNT');
  }
}

// ============================================================
// 主函数 - 集成所有修复
// ============================================================

async function main() {
  log('info', '=== 超级品牌活动自动报名启动（修复版） ===');
  
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  
  const page = await context.newPage();
  const activityUrl = 'https://nr.ele.me/app/eleme-nr-bfe-newretail/common-next#/pc/platformActivitiesPc/';
  
  try {
    // 打开活动页面
    log('info', '打开活动页面...');
    await page.goto(activityUrl, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(5000);
    
    // 检查登录状态
    log('info', '检测登录状态...');
    const loggedIn = await page.locator('text=退出登录, text=Logout, [class*="user"]').count() > 0;
    if (!loggedIn) {
      log('error', '未登录，请先登录');
      throw new Error('NOT_LOGGED_IN');
    }
    
    // 等待活动列表加载
    log('info', '等待活动列表加载...');
    await page.waitForTimeout(5000);
    
    // 找到目标frame
    let targetFrame = null;
    for (const frame of page.frames()) {
      try {
        if (frame.url().includes('ms.ele.me') || frame.url().includes('ebai-zs-webapp')) {
          targetFrame = frame;
          break;
        }
      } catch (error) {
        // 忽略错误
      }
    }
    
    if (!targetFrame) {
      log('error', '未找到活动列表frame');
      throw new Error('FRAME_NOT_FOUND');
    }
    
    log('info', `找到目标frame: ${targetFrame.url().substring(0, 100)}...`);
    
    // ============================================================
    // 修复1: 初始化品牌活动回退链
    // ============================================================
    const brandFallback = new BrandActivityFallback(page, targetFrame, { debug: true });
    
    // 尝试切换到品牌活动tab
    log('info', '=== 使用品牌活动三层回退链 ===');
    const brandSwitchResult = await brandFallback.switchToBrandTab();
    
    if (brandSwitchResult.success) {
      log('info', `品牌活动tab切换成功 (方法: ${brandSwitchResult.method})`);
    } else {
      log('warn', `品牌活动tab切换失败，使用默认tab`);
    }
    
    // 验证是否在品牌活动页面
    const isBrandPage = await brandFallback.verifyBrandActivityPage();
    log('info', `品牌活动页面验证: ${isBrandPage ? '是' : '否'}`);
    
    // ============================================================
    // 修复2: 初始化AI Assistant防护
    // ============================================================
    const aiGuard = new AIAssistantFrameGuard(page, activityUrl, { 
      debug: true,
      checkInterval: 3000,
      maxRetries: 3
    });
    
    // 开始监控frame漂移
    await aiGuard.startMonitoring(targetFrame);
    log('info', 'AI Assistant防护已启动');
    
    // ============================================================
    // 修复3: 初始化失败证据收集器
    // ============================================================
    const evidenceCollector = new FailureEvidenceCollector(page, targetFrame, {
      evidenceDir: EVIDENCE_DIR,
      debug: true
    });
    
    // ============================================================
    // 修复4: 初始化提交按钮回退链
    // ============================================================
    const submitFallback = new SubmitButtonFallback(targetFrame, {
      buttonText: ['立即报名', '确认', '提交', '下一步', '报名', '确认报名'],
      debug: true
    });
    
    // 等待活动卡片加载
    log('info', '等待活动卡片加载...');
    await targetFrame.waitForSelector('.activity-card, .card, [class*="activity"]', { timeout: 10000 });
    log('info', '活动卡片已加载');
    
    // 开始扫描所有页面
    log('info', '开始扫描所有页面...');
    
    // 获取总页数
    const totalPages = await targetFrame.evaluate(() => {
      const pag = document.querySelector('.ant-pagination');
      if (!pag) return 1;
      let max = 1;
      pag.querySelectorAll('li').forEach(li => {
        const n = parseInt(li.textContent?.trim() || '');
        if (n > max) max = n;
      });
      return max;
    }).catch(() => 1);
    
    log('info', `共 ${totalPages} 页`);
    
    const signedActivities: string[] = [];
    const failedActivities: Array<{name: string, error: string}> = [];
    
    // 扫描每一页
    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      log('info', `--- 第 ${pageNum}/${totalPages} 页 ---`);
      
      // 如果不是第一页，翻页
      if (pageNum > 1) {
        log('info', `翻到第 ${pageNum} 页...`);
        
        try {
          const pageBtn = targetFrame.locator(`.ant-pagination-item[title="${pageNum}"]`).first();
          if (await pageBtn.count() > 0) {
            await pageBtn.click();
            await page.waitForTimeout(3000);
          }
        } catch (error) {
          log('error', `翻页失败: ${error.message}`);
          // 收集翻页失败证据
          await evidenceCollector.collectEvidence(
            'PAGE_TURN_FAILED',
            FailureEvidenceCollector.buildSelectorHitPath(page, targetFrame, [
              `.ant-pagination-item[title="${pageNum}"]`,
              '.ant-pagination'
            ]),
            { pageNum, totalPages, error: error.message }
          );
          break;
        }
      }
      
      // 获取当前页活动
      const activities = await targetFrame.evaluate(() => {
        const cards = Array.from(document.querySelectorAll('.activity-card, .card, [class*="activity"]'));
        return cards.map(card => ({
          name: card.querySelector('.title, .name, [class*="title"], [class*="name"]')?.textContent?.trim() || '',
          fullText: card.textContent?.trim() || '',
          element: card
        }));
      }).catch(() => []);
      
      // 处理每个活动
      for (const activity of activities) {
        if (!activity.name) continue;
        
        const activityType = classifyActivity(activity.name, activity.fullText);
        
        // 只处理超级品牌活动
        if (activityType !== 'super_brand') {
          continue;
        }
        
        log('info', `处理活动: ${activity.name}`);
        
        try {
          // ============================================================
          // 使用提交按钮回退链点击报名
          // ============================================================
          log('info', '使用提交按钮三级回退链...');
          const submitResult = await submitFallback.clickSubmitButton();
          
          if (!submitResult.success) {
            throw new Error(`提交按钮未找到 (方法: ${submitResult.method})`);
          }
          
          log('info', `提交按钮点击成功: ${submitResult.clickedText} (方法: ${submitResult.method})`);
          
          // 等待报名弹窗
          await page.waitForTimeout(2000);
          
          // 处理弹窗确认
          const confirmDialog = page.locator('.ant-modal, [role="dialog"]').filter({ hasText: /确认|确定|提交/ }).first();
          if (await confirmDialog.count() > 0) {
            const confirmBtn = confirmDialog.locator('button').filter({ hasText: /确认|确定|提交/ }).first();
            if (await confirmBtn.count() > 0) {
              await confirmBtn.click();
              log('info', '已确认报名');
            }
          }
          
          // 等待报名完成
          await page.waitForTimeout(3000);
          
          // 返回活动列表页
          log('info', '返回活动列表...');
          const breadcrumb = targetFrame.locator('text=平台活动').first();
          if (await breadcrumb.count() > 0) {
            await breadcrumb.click();
            await page.waitForTimeout(3000);
          }
          
          signedActivities.push(activity.name);
          log('info', `报名成功: ${activity.name}`);
          
        } catch (error) {
          log('error', `活动报名失败: ${activity.name}`, { error: error.message });
          failedActivities.push({ name: activity.name, error: error.message });
          
          // ============================================================
          // 修复: 强制落盘5字段失败证据
          // ============================================================
          const evidence = await evidenceCollector.collectEvidence(
            'ACTIVITY_SIGNUP_FAILED',
            FailureEvidenceCollector.buildSelectorHitPath(page, targetFrame, [
              `text=${activity.name}`,
              'button:has-text("立即报名")',
              '[role="button"]:has-text("立即报名")'
            ]),
            {
              activity_name: activity.name,
              activity_type: activityType,
              page_num: pageNum,
              error_message: error.message,
              ai_guard_status: aiGuard.getStatus()
            }
          );
          
          log('info', `失败证据已保存: ${evidence.error_code}`);
        }
        
        // 检查AI Assistant防护状态
        const guardStatus = aiGuard.getStatus();
        if (guardStatus.driftCount > 0) {
          log('warn', `检测到${guardStatus.driftCount}次frame漂移，已自动恢复`);
        }
      }
    }
    
    // ============================================================
    // 保存结果
    // ============================================================
    const result = {
      timestamp: new Date().toISOString(),
      total_pages: totalPages,
      signed_count: signedActivities.length,
      signed_activities: signedActivities,
      failed_count: failedActivities.length,
      failed_activities: failedActivities,
      ai_guard_drift_count: aiGuard.getStatus().driftCount,
      evidence_files: evidenceCollector.listEvidenceFiles()
    };
    
    const resultPath = path.join(DATA_DIR, `super_brand_signup_${today}.json`);
    fs.writeFileSync(resultPath, JSON.stringify(result, null, 2), 'utf8');
    
    log('info', '=== 报名汇总 ===');
    log('info', `扫描活动总数: ${signedActivities.length + failedActivities.length}`);
    log('info', `超级品牌活动: ${signedActivities.length + failedActivities.length} 个`);
    log('info', `新报名成功: ${signedActivities.length} 个`);
    log('info', `失败: ${failedActivities.length} 个`);
    log('info', `AI Assistant漂移恢复次数: ${aiGuard.getStatus().driftCount}`);
    log('info', `失败证据文件数: ${evidenceCollector.listEvidenceFiles().length}`);
    log('info', `结果已保存: ${resultPath}`);
    log('info', `日志文件: ${LOG_FILE}`);
    
  } catch (error) {
    log('error', '执行失败', { error: error.message, stack: error.stack });
    
    // 主流程失败时也收集证据
    try {
      const evidenceCollector = new FailureEvidenceCollector(page, null, {
        evidenceDir: EVIDENCE_DIR,
        debug: true
      });
      
      const evidence = await evidenceCollector.collectEvidence(
        'MAIN_PROCESS_FAILED',
        FailureEvidenceCollector.buildSelectorHitPath(page, null, [
          'text=平台活动',
          '.activity-card',
          'button:has-text("立即报名")'
        ]),
        {
          error_message: error.message,
          error_stack: error.stack,
          url: page.url()
        }
      );
      
      log('info', `主流程失败证据已保存: ${evidence.error_code}`);
    } catch (evidenceError) {
      log('error', '证据保存失败', { error: evidenceError.message });
    }
    
    throw error;
  } finally {
    // 停止AI Assistant防护
    try {
      // aiGuard.stopMonitoring();
    } catch (error) {
      // 忽略错误
    }
    
    log('info', '浏览器已关闭');
    await browser.close();
    log('info', '=== 超级品牌活动报名完成 ===');
  }
}

// 执行主函数
if (require.main === module) {
  main().catch(error => {
    console.error('程序执行失败:', error);
    process.exit(1);
  });
}

export { main };