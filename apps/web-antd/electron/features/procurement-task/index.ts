/**
 * 采购任务 - 内置版
 * 
 * 直接执行采购流程，不依赖外部脚本
 */
import type { Browser, Page } from 'playwright';
import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

// 导入采购模块
import { runAoixiangPurchase } from './automation/aoixiang/auto-purchase-v4';
import { runQianniuhuaPurchase } from './automation/qianniuhua/auto-purchase';
import { notifyFeishu } from './automation/lib/notify';

// 配置
const LOG_DIR = path.join(__dirname, 'logs');
const DATA_DIR = path.join(__dirname, 'data');

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// 采购任务类型
export type PurchaseType = 'aoixiang' | 'qianniuhua' | 'offline';
export type PurchaseTaskStatus = 'pending' | 'running' | 'success' | 'failed' | 'partial_success';

export interface PurchaseTask {
  id: string;
  type: PurchaseType;
  storeIds: string[];
  storeNames: string[];
  supplier?: string;
  status: PurchaseTaskStatus;
}

export interface PurchaseResult {
  success: boolean;
  message: string;
  orderCount?: number;
  totalAmount?: number;
  orderDetails?: any[];
}

/**
 * 执行翱象采购
 */
export async function executeAoixiangPurchase(
  task: PurchaseTask,
): Promise<PurchaseResult> {
  console.log(`=== 翱象采购启动 ===`);
  console.log(`门店: ${task.storeNames.join(', ')}`);
  
  try {
    const result = await runAoixiangPurchase({
      storeIds: task.storeIds,
      storeNames: task.storeNames,
    });
    
    return {
      success: result.success,
      message: result.message || '采购完成',
      orderCount: result.orderCount,
      totalAmount: result.totalAmount,
    };
  } catch (error: any) {
    return {
      success: false,
      message: error.message,
    };
  }
}

/**
 * 执行牵牛花采购
 */
export async function executeQianniuhuaPurchase(
  task: PurchaseTask,
): Promise<PurchaseResult> {
  console.log(`=== 牵牛花采购启动 ===`);
  console.log(`供应商: ${task.supplier || '默认'}`);
  
  try {
    const result = await runQianniuhuaPurchase({
      supplier: task.supplier,
    });
    
    return {
      success: result.success,
      message: result.message || '采购完成',
      orderCount: result.orderCount,
      totalAmount: result.totalAmount,
    };
  } catch (error: any) {
    return {
      success: false,
      message: error.message,
    };
  }
}

/**
 * 执行1688待付款汇总
 */
export async function executePendingPayments(): Promise<PurchaseResult> {
  console.log(`=== 1688待付款汇总 ===`);
  
  // TODO: 实现1688待付款汇总
  return {
    success: true,
    message: '待实现',
  };
}

// 导出接口
export const ProcurementRunner = {
  executeAoixiangPurchase,
  executeQianniuhuaPurchase,
  executePendingPayments,
};