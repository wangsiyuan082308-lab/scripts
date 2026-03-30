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
  totalItems: number;
  noStockSkuCount: number;
  noStockSkus: NoStockSku[];
  errorMessage: string;
}

export interface NoStockSku {
  sku: string;
  name: string;
  reason: string;
}

export interface SupplierConfig {
  name: string;
  code?: string;
  type: string;
}

export const SUPPLIERS: Record<string, SupplierConfig> = {
  '集采-卫生巾供应商': { name: '集采-卫生巾供应商', code: '20251223', type: '1688线上' },
  '集采-十月结晶': { name: '集采-十月结晶', type: '1688线上' },
};

export const FEISHU_WEBHOOK = 'https://open.feishu.cn/open-apis/bot/v2/hook/06738670-f46c-40d3-801c-d9447efd35ef';

export const BASE_URL = 'https://qnh.meituan.com';
