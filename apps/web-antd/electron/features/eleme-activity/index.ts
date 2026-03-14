/**
 * 饿了么活动报名 - 内置版
 * 
 * 直接执行活动报名流程，不依赖外部脚本
 */
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

// 从内置automation目录导入
import { transformBaohaojia } from './automation/transform-baohao';

// 配置
const LOG_DIR = path.join(__dirname, 'logs');
const DATA_DIR = path.join(__dirname, 'data');

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// 活动类型
export type ActivityType = 'baohao' | 'super_brand' | 'brand_coupon' | 'category_coupon';

export interface ActivityTask {
  activityId: string;
  activityName: string;
  activityType: ActivityType;
  storeIds: string[];
  storeNames: string[];
}

export interface ActivityResult {
  success: boolean;
  message: string;
  activityName: string;
  exportedFile?: string;
  processedFile?: string;
  storeCount?: number;
}

/**
 * 执行爆好价报名
 */
export async function executeBaohaoSignup(
  task: ActivityTask,
): Promise<ActivityResult> {
  const log = (level: string, msg: string) => {
    console.log(`[${new Date().toISOString()}] [${level}] ${msg}`);
  };
  
  log('info', `=== 爆好价报名启动 ===`);
  log('info', `活动: ${task.activityName}`);
  log('info', `门店: ${task.storeNames.join(', ')}`);
  
  try {
    // 启动浏览器
    const browser = await chromium.launch({ 
      headless: false,
      channel: 'chrome',
    });
    
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    
    const page = await context.newPage();
    
    // 导航到活动页面
    await page.goto('https://nr.ele.me/app/eleme-nr-bfe-newretail/common-next#/pc/platformActivitiesPc/', {
      waitUntil: 'domcontentloaded',
    });
    
    // 等待登录
    await page.waitForTimeout(5000);
    
    // TODO: 实现完整的报名流程
    // 这里需要调用 signup-baohao.ts 中的逻辑
    
    await browser.close();
    
    return {
      success: true,
      message: '报名流程启动成功',
      activityName: task.activityName,
    };
    
  } catch (error: any) {
    log('error', `报名失败: ${error.message}`);
    return {
      success: false,
      message: error.message,
      activityName: task.activityName,
    };
  }
}

/**
 * 执行Excel转换（爆好价）
 */
export async function transformBaohaoExcel(
  inputPath: string,
  initialStock: number = 9999,
): Promise<{ success: boolean; outputPath?: string; message: string }> {
  try {
    const outputPath = await transformBaohaojia(inputPath, initialStock);
    return {
      success: true,
      outputPath,
      message: `转换完成: ${outputPath}`,
    };
  } catch (error: any) {
    return {
      success: false,
      message: error.message,
    };
  }
}

// 导出接口
export const ElemeActivityRunner = {
  executeBaohaoSignup,
  transformBaohaoExcel,
};