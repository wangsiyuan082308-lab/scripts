/**
 * v4 类型定义
 *
 * 通用类型（StepResult、FailedSku、NO_STOCK_KEYWORDS）已提取到 shared-libs/types，
 * 本文件 import + re-export 并保留翱象专属类型。
 */
import * as path from 'path';
import { StepResult, FailedSku, NO_STOCK_KEYWORDS } from '@oby/types';

// --- 从共享库 re-export ---
export { StepResult, FailedSku, NO_STOCK_KEYWORDS };

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

export const USER_DATA = path.join(__dirname, '..', '..', '..', 'eleme-activity-assistant', 'user_data');
export const DATA_DIR = path.join(__dirname, '..', '..', 'data');
export const REPORTS_DIR = path.join(__dirname, '..', '..', 'data', 'reports');

export const QUANTITY_KEYWORDS = ['不满足换算关系', '建议调整为', '的倍数', '换算', '起订量', '最低采购量'];
export const MIXED_BATCH_KEYWORDS = ['混批', '混批限制', '不支持混批'];
