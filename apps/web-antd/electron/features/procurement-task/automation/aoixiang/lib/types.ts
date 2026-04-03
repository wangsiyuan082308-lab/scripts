import * as path from 'path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface FailedSku {
  sku: string;
  name: string;
  reason: string;
}

export interface SupplierConfig {
  name: string;
  code?: string;
  type?: string;
  channel?: string;
}

export interface PurchaseResult {
  supplier: string;
  planOrderId: string;
  success: boolean;
  round: number;
  noStockSkus: FailedSku[];
  totalAmount?: number;
  skuCount?: number;
}

export const USER_DATA = path.join(__dirname, '..', 'config', 'user_data');
export const DATA_DIR = path.join(__dirname, '..', 'data');
export const MAX_RETRIES = 3;

export const TARGET_TABS = [
  { index: 1, name: '动销售罄待补货' },
  { index: 2, name: '售罄待补货' },
  { index: 3, name: '建议补货' },
];

export const NO_STOCK_KEYWORDS = ['库存不足', '无库存', '库存为0', '缺货', '商家无货', '该商品已下架', '无法下单'];

export const DEFAULT_SUPPLIERS: SupplierConfig[] = [
  { name: '集采-卫生巾供应商', code: '20251223', type: '1688线上' },
  { name: '集采-十月结晶', type: '1688线上' },
];
