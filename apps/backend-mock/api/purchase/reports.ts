import { defineEventHandler, getQuery } from 'h3';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const HOME = homedir();

const AOIXIANG_DIR = join(
  HOME,
  '.openclaw/skills-pool/business/aoixiang-auto-purchase/data',
);
const QIANNIUHUA_DIR = join(
  HOME,
  '.openclaw/skills-pool/business/qianniuhua-auto-purchase/data',
);

interface PurchaseReport {
  date: string;
  platform: '翱象' | '牵牛花';
  suppliers: string[];
  success: boolean;
  itemCount: number;
  duration: string;
  orderNo: string;
  totalAmount: number;
  noStockSkus: Array<{ sku: string; name?: string; reason?: string }>;
  generatedAt: string;
}

/** 从翱象 purchase_*.json 解析报告 */
function parseAoixiangPurchase(filePath: string): PurchaseReport | null {
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
    const date = raw.date || '';
    const items = raw.items || [];
    const suppliers = [
      ...new Set(items.map((i: any) => i.supplierName).filter(Boolean)),
    ] as string[];
    const totalAmount = items.reduce((sum: number, i: any) => {
      return sum + (i.purchasePrice || 0) * (i.suggestedQty || 0);
    }, 0);

    return {
      date,
      platform: '翱象',
      suppliers,
      success: items.length > 0,
      itemCount: items.length,
      duration: '-',
      orderNo: '-',
      totalAmount: Math.round(totalAmount) / 100,
      noStockSkus: items
        .filter((i: any) => i.inStock === 0)
        .map((i: any) => ({
          sku: i.skuCode,
          name: i.skuName,
          reason: '库存为0',
        })),
      generatedAt: raw.generatedAt || '',
    };
  } catch {
    return null;
  }
}

/** 从翱象 purchase-order-probe-*.json 解析订单探测报告 */
function parseAoixiangProbe(
  filePath: string,
  fileName: string,
): PurchaseReport | null {
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
    const entries = Array.isArray(raw) ? raw : [raw];
    const orderMatch = fileName.match(/probe-(PP\w+)\.json/);
    const orderNo = orderMatch ? orderMatch[1]! : '-';

    // 从第一个 pageQuery 响应中提取信息
    let date = '';
    let itemCount = 0;
    let totalAmount = 0;
    let storeName = '';

    for (const entry of entries) {
      const data = entry?.body?.data;
      if (!data) continue;
      if (Array.isArray(data) && data[0]?.orderRelationId) {
        const order = data[0];
        date = order.createTime
          ? new Date(order.createTime).toISOString().slice(0, 10)
          : '';
        itemCount = order.skuTypeCount || 0;
        totalAmount = (order.purchaseAmount || 0) / 100;
        storeName = order.storeName || '';
      }
    }

    if (!date) return null;

    return {
      date,
      platform: '翱象',
      suppliers: [storeName].filter(Boolean),
      success: true,
      itemCount,
      duration: '-',
      orderNo,
      totalAmount,
      noStockSkus: [],
      generatedAt: '',
    };
  } catch {
    return null;
  }
}

/** 从翱象 no-stock-skus-*.json / failed-skus-*.json 解析 */
function parseAoixiangFailedSkus(
  filePath: string,
): Array<{ sku: string; name?: string; reason?: string }> {
  try {
    const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
    return (raw.skus || []).map((s: any) => ({
      sku: s.sku || s.skuCode || '',
      name: s.name || s.skuName || '',
      reason: s.reason || raw.reason || '无库存',
    }));
  } catch {
    return [];
  }
}

/** 从牵牛花目录解析报告 */
function parseQianniuhuaReports(dir: string): PurchaseReport[] {
  const reportsDir = join(dir, 'reports');
  if (!existsSync(reportsDir)) return [];

  const files = readdirSync(reportsDir).filter((f) => f.endsWith('.json'));
  const results: PurchaseReport[] = [];

  for (const file of files) {
    try {
      const raw = JSON.parse(readFileSync(join(reportsDir, file), 'utf-8'));
      results.push({
        date: raw.date || file.replace('.json', ''),
        platform: '牵牛花',
        suppliers: raw.supplier ? [raw.supplier] : (raw.suppliers || []),
        success: raw.success === true,
        itemCount: raw.totalItems || raw.itemCount || 0,
        duration: raw.durationMinutes ? `${raw.durationMinutes}分钟` : (raw.duration || '-'),
        orderNo: raw.outOrderId || raw.planOrderId || raw.orderNo || '-',
        totalAmount: raw.totalAmount || 0,
        noStockSkus: (raw.noStockSkus || []).map((s: any) => ({
          sku: s.sku,
          name: s.name || '',
          reason: s.reason || '',
        })),
        generatedAt: raw.endTime || raw.generatedAt || '',
      });
    } catch {}
  }

  return results;
}

export default defineEventHandler((event) => {
  try {
    const query = getQuery(event);
    const platformFilter = (query.platform as string) || '';

    const reports: PurchaseReport[] = [];

    // --- 翱象数据 ---
    if (platformFilter !== '牵牛花' && existsSync(AOIXIANG_DIR)) {
      const files = readdirSync(AOIXIANG_DIR).filter((f) =>
        f.endsWith('.json'),
      );

      // 按日期收集无库存SKU信息
      const noStockMap = new Map<
        string,
        Array<{ sku: string; name?: string; reason?: string }>
      >();
      for (const file of files) {
        if (file.startsWith('no-stock-skus-') || file.startsWith('failed-')) {
          const dateMatch = file.match(/(\d{4}-\d{2}-\d{2})/);
          if (dateMatch) {
            const skus = parseAoixiangFailedSkus(join(AOIXIANG_DIR, file));
            const existing = noStockMap.get(dateMatch[1]!) || [];
            noStockMap.set(dateMatch[1]!, [...existing, ...skus]);
          }
        }
      }

      // purchase_*.json
      for (const file of files) {
        if (file.startsWith('purchase_') && file.endsWith('.json')) {
          const report = parseAoixiangPurchase(join(AOIXIANG_DIR, file));
          if (report) {
            const extraSkus = noStockMap.get(report.date) || [];
            if (extraSkus.length > 0) {
              const existingCodes = new Set(
                report.noStockSkus.map((s) => s.sku),
              );
              for (const s of extraSkus) {
                if (!existingCodes.has(s.sku)) {
                  report.noStockSkus.push(s);
                }
              }
            }
            reports.push(report);
          }
        }
      }

      // purchase-order-probe-*.json
      for (const file of files) {
        if (file.startsWith('purchase-order-probe-') && file.endsWith('.json')) {
          const report = parseAoixiangProbe(join(AOIXIANG_DIR, file), file);
          if (report) {
            const extraSkus = noStockMap.get(report.date) || [];
            report.noStockSkus = extraSkus;
            reports.push(report);
          }
        }
      }

      // 新格式: data/reports/report-*.json (PurchaseReport 格式)
      const aoixiangReportsDir = join(AOIXIANG_DIR, 'reports');
      if (existsSync(aoixiangReportsDir)) {
        const reportFiles = readdirSync(aoixiangReportsDir).filter((f) => f.endsWith('.json'));
        for (const file of reportFiles) {
          try {
            const raw = JSON.parse(readFileSync(join(aoixiangReportsDir, file), 'utf-8'));
            reports.push({
              date: raw.date || '',
              platform: '翱象',
              suppliers: raw.supplier ? [raw.supplier] : [],
              success: raw.success === true,
              itemCount: raw.totalItems || 0,
              duration: raw.durationMinutes ? `${raw.durationMinutes}分钟` : '-',
              orderNo: raw.outOrderId || raw.planOrderId || '-',
              totalAmount: 0,
              noStockSkus: (raw.noStockSkus || []).map((s: any) => ({
                sku: s.sku,
                name: s.name || '',
                reason: s.reason || '',
              })),
              generatedAt: raw.endTime || '',
            });
          } catch {}
        }
      }
    }

    // --- 牵牛花数据 ---
    if (platformFilter !== '翱象') {
      const qnhReports = parseQianniuhuaReports(QIANNIUHUA_DIR);
      reports.push(...qnhReports);
    }

    // 按日期倒序
    reports.sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    );

    // 统计
    const totalCount = reports.length;
    const successCount = reports.filter((r) => r.success).length;
    const successRate =
      totalCount > 0 ? Math.round((successCount / totalCount) * 1000) / 10 : 0;
    const latestDate = reports[0]?.date || '-';

    return {
      code: 0,
      data: {
        summary: {
          totalCount,
          successCount,
          successRate,
          latestDate,
        },
        reports,
      },
    };
  } catch (e: any) {
    return { code: -1, data: null, message: e.message };
  }
});
