/**
 * v4 类型定义
 *
 * 当前仓库内联最小公共类型，避免额外运行时依赖。
 */
import * as path from 'path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface StepResult {
  step: string;
  success: boolean;
  message: string;
  data?: any;
}

export interface FailedSku {
  sku: string;
  name: string;
  reason: string;
}

export const NO_STOCK_KEYWORDS = [
  '库存不足',
  '无库存',
  '库存为0',
  '缺货',
  '商家无货',
  '该商品已下架',
  '无法下单',
  '已下架',
] as const;

// --- 翱象专属类型 ---

export interface FailedOrder {
  orderId: string;
  supplyOrderId?: string;
  status: number;
  failReason: string;
  skuCount?: number;
  amount?: number;
  storeName?: string;
  storeCode?: string;
}

export interface StepAddTabAudit {
  tabName: string;
  added: number;
  total: number;
  isAllowed: boolean;
}

export interface StepAddStoreAudit {
  storeName: string;
  totalAdded: number;
  tabs: StepAddTabAudit[];
}

export interface StepAddAudit {
  stores: StepAddStoreAudit[];
  grandTotalAdded: number;
  enabledTabs: string[];
  allowedTabs: string[];
}

export interface PurchaseReport {
  platform: 'aoixiang';
  supplier: string;
  date: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  steps: StepResult[];
  planOrderId: string;
  totalItems: number;
  successCount: number;
  failedCount: number;
  failedOrders: FailedOrder[];
  noStockSkus: FailedSku[];
  errorMessage: string;
  stepAddAudit?: StepAddAudit;
}

// --- 翱象专属常量 ---

export const USER_DATA = path.join(__dirname, '..', 'config', 'user_data');
export const DATA_DIR = path.join(__dirname, '..', 'data');
export const REPORTS_DIR = path.join(DATA_DIR, 'reports');

export const QUANTITY_KEYWORDS = ['不满足换算关系', '建议调整为', '的倍数', '换算', '起订量', '最低采购量'];
export const MIXED_BATCH_KEYWORDS = ['混批', '混批限制', '不支持混批'];
