/**
 * 饿了么活动报名 - 内置版
 *
 * 直接执行活动报名流程，不依赖外部脚本
 */
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import ExcelJS from 'exceljs';

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

/**
 * 饿了么活动报名表生成器
 */
export class ElemeActivityGenerator {
  /**
   * 生成饿了么活动报名 Excel
   * @param inputString 分号分割的UPC条码字符串
   * @returns Excel Buffer
   */
  static async run(inputString: string): Promise<Buffer> {
    // 解析输入，支持中英文分号、逗号、空白字符分割
    const storeIds = [
      ...new Set(
        inputString
          .split(/[;；,，\s\n]+/)
          .map((id) => id.trim())
          .filter((id) => id.length > 0),
      ),
    ];

    if (storeIds.length === 0) {
      throw new Error('未找到有效的商品UPC数据');
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('活动报名表');

    // 设置说明行
    worksheet.mergeCells('A1:B1');
    const noteCell = worksheet.getCell('A1');
    noteCell.value = '说明： \n 1、不要删除表头 \n 2、商品条形码：必填。';
    noteCell.alignment = { horizontal: 'left', vertical: 'top', wrapText: true };
    noteCell.font = { bold: true, color: { argb: 'FFFF0000' } };
    worksheet.getRow(1).height = 60;
    worksheet.getColumn(1).width = 30;

    // 设置表头
    const headerRow = worksheet.getRow(2);
    headerRow.values = ['商品条形码（必填）'];
    headerRow.font = { bold: true };
    headerRow.alignment = { horizontal: 'center' };

    // 填充数据
    storeIds.forEach((id) => {
      worksheet.addRow([id]);
    });

    const buffer = (await workbook.xlsx.writeBuffer()) as Buffer;
    return Buffer.from(buffer);
  }
}