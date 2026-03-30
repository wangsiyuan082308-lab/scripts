/**
 * 牵牛花自动采购 v2 类型定义
 */
import * as path from 'path';

export interface StepResult {
  step: string;
  success: boolean;
  message: string;
  data?: any;
}

export interface StepContext {
  supplier: string;
  adviceFile?: string;
  cartFile?: string;
  planFile?: string;
  replenishListNo?: string;
  previewNo?: string;
  planOrderId?: string;
  outOrderId?: string;
  totalAmount?: number;
  totalItems?: number;
  validatedResultCount?: number;
  validatedCartCount?: number;
  noStockSkus: NoStockSku[];
  prevRoundNoStockSkus: NoStockSku[];
  round: number;
  confirmOnly?: boolean;  // step5: 跳过生成单据，直接去采购单列表下单
  stepResults: StepResult[];
}

export interface NoStockSku {
  sku: string;
  name: string;
  reason: string;
}

export interface SupplierConfig {
  name: string;
  code?: string;
  aliases?: string[];
  type: string;
}

export interface StoreConfig {
  name: string;
  maxItems: number;
}

export interface PurchaseReport {
  platform: 'qianniuhua';
  supplier: string;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  totalRounds: number;
  success: boolean;
  planOrderId: string;
  outOrderId: string;
  totalAmount: number;
  orderCount: number;
  totalItems: number;
  noStockSkuCount: number;
  noStockSkus: NoStockSku[];
  errorMessage: string;
  muteCompliance?: 'PASS' | 'FAIL';
  steps: StepResult[];
}

// Directory constants
export const ROOT_DIR = path.resolve(__dirname, '../..');
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const DOWNLOADS_DIR = path.join(DATA_DIR, 'downloads');
export const PLANS_DIR = path.join(DATA_DIR, 'plans');
export const REPORTS_DIR = path.join(DATA_DIR, 'reports');
export const LOGS_DIR = path.join(ROOT_DIR, 'logs');
export const CONTEXT_DIR = path.join(DATA_DIR, 'context');

// Keywords
export const NO_STOCK_KEYWORDS = ['库存不足', '无库存', '库存为0', '缺货', '商家无货', '该商品已下架', '无法下单', '已下架'];
