import { createRequire } from 'node:module';
import { join } from 'node:path';

import {
  buildFinanceCompareRows,
  readFinanceReportDetail,
  scanFinanceReports,
} from './report-reader';

const requireFromWebAntd = createRequire(
  join(process.cwd(), 'apps/web-antd/package.json'),
);
const ExcelJS = requireFromWebAntd('exceljs') as {
  Workbook: new () => {
    xlsx: { readFile: (path: string) => Promise<void> };
    worksheets: Array<{
      getRow: (row: number) => {
        eachCell: (
          options: { includeEmpty: boolean },
          callback: (cell: { value: unknown }, columnNumber: number) => void,
        ) => void;
      };
      name: string;
      rowCount: number;
    }>;
  };
};

export interface FinanceMigrationAuditMetric {
  baselineValue: null | number;
  diffValue: null | number;
  generatedValue: null | number;
  label: string;
  matches: boolean;
}

export interface FinanceMigrationAuditStore {
  blockedReasons: string[];
  matchedMetrics: number;
  mismatchedMetrics: FinanceMigrationAuditMetric[];
  reportFile: string;
  storeName: string;
  totalComparedMetrics: number;
}

export interface FinanceMigrationAuditResult {
  generatedAt: string;
  month: string;
  sourceFiles: {
    meituanPromo: string | null;
    qianniuhua: string | null;
    reports: string[];
  };
  stores: FinanceMigrationAuditStore[];
  summary: {
    exactMatchStores: number;
    storesWithGaps: number;
    totalStores: number;
  };
}

export function compareMigrationMetrics(
  baselineMetrics: Map<string, null | number>,
  generatedMetrics: Array<{ currentValue: null | number; label: string }>,
) {
  const mismatchedMetrics: FinanceMigrationAuditMetric[] = [];
  let totalComparedMetrics = 0;

  for (const item of generatedMetrics) {
    const baselineValue = baselineMetrics.get(item.label);
    if (baselineValue == null) continue;
    totalComparedMetrics += 1;
    const generatedValue = item.currentValue;
    const diffValue =
      baselineValue == null || generatedValue == null
        ? null
        : generatedValue - baselineValue;
    const matches = Math.abs(diffValue || 0) < 0.0001;
    if (!matches) {
      mismatchedMetrics.push({
        baselineValue,
        diffValue,
        generatedValue,
        label: item.label,
        matches,
      });
    }
  }

  return {
    matchedMetrics: totalComparedMetrics - mismatchedMetrics.length,
    mismatchedMetrics,
    totalComparedMetrics,
  };
}

const DOWNLOAD_FINANCE_DIR = join(
  process.env.HOME || '/Users/mac',
  'Downloads/财务报表',
);

function toText(value: unknown) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return `${value}`.trim();
}

function toNumber(value: unknown) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = toText(value).replace(/,/g, '').replace(/%/g, '');
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeQnhHeaders(headers: string[]) {
  return headers.map((header, index) => {
    const value = `${header || ''}`.trim();
    return value || `列${index + 1}`;
  });
}

async function readQianniuhuaSummaryRows(filePath: string) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  const levelOne: string[] = [];
  const levelTwo: string[] = [];
  worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell) => {
    levelOne.push(toText(cell.value));
  });
  worksheet.getRow(2).eachCell({ includeEmpty: true }, (cell) => {
    levelTwo.push(toText(cell.value));
  });

  const headers = normalizeQnhHeaders(
    levelOne.map((value, index) => {
      const second = levelTwo[index] || '';
      if (value === '门店') return '门店';
      if (value === '门店id') return '门店id';
      if (value && second) return `${value}-${second}`;
      return value || second;
    }),
  );

  const rows: Record<string, unknown>[] = [];
  for (let rowIndex = 3; rowIndex <= worksheet.rowCount; rowIndex++) {
    const row: Record<string, unknown> = {};
    let hasValue = false;
    headers.forEach((header, index) => {
      const cell = (worksheet as any).getCell(rowIndex, index + 1);
      const text = toText(cell?.value);
      if (text) hasValue = true;
      row[header] = cell?.value ?? '';
    });
    if (hasValue) rows.push(row);
  }
  return rows;
}

function deriveLegacyQnhMetrics(row: Record<string, unknown>) {
  const deliveryFee =
    (toNumber(row['费用-三方配送费']) || 0) +
    (toNumber(row['费用-配送服务费']) || 0);

  return new Map<string, number | null>([
    ['订单数量', toNumber(row['账单-订单量'])],
    ['总收入', toNumber(row['收入-总收入'])],
    ['商品原价总金额', toNumber(row['收入-商品原价总金额'])],
    ['配送收入', toNumber(row['收入-配送收入'])],
    ['商品包装费', toNumber(row['收入-商品包装费'])],
    ['营销活动费用', toNumber(row['收入-营销活动费用'])],
    ['配送费', deliveryFee],
    ['平台佣金', toNumber(row['费用-佣金'])],
    ['商品成本', toNumber(row['税率相关-商品成本'])],
    ['线上毛利', toNumber(row['税率相关-线上毛利'])],
  ]);
}

function findQianniuhuaFile(month: string) {
  const monthDir = join(DOWNLOAD_FINANCE_DIR, month);
  const candidates = [
    '经营分析PC端',
    '牵牛花',
    '经营分析',
    '导出财务分析订单数据',
  ];
  try {
    const { readdirSync } = require('node:fs');
    const files = readdirSync(monthDir).filter((file: string) => file.endsWith('.xlsx'));
    for (const prefix of candidates) {
      const matched = files.find((file: string) => file.startsWith(prefix));
      if (matched) return join(monthDir, matched);
    }
    return files.find((file: string) => file.includes('牵牛花'))
      ? join(monthDir, files.find((file: string) => file.includes('牵牛花'))!)
      : null;
  } catch {
    return null;
  }
}

function findPromoFile(month: string, keyword: string) {
  try {
    const { readdirSync } = require('node:fs');
    const monthDir = join(DOWNLOAD_FINANCE_DIR, month);
    const file = readdirSync(monthDir).find(
      (entry: string) => entry.endsWith('.xlsx') && entry.includes(keyword),
    );
    return file ? join(monthDir, file) : null;
  } catch {
    return null;
  }
}

export async function auditFinanceMigration(month: string) {
  const reports = scanFinanceReports({ month, type: 'store' });
  const qianniuhuaFile = findQianniuhuaFile(month);
  const meituanPromo = findPromoFile(month, '美团');
  const qnhRows = qianniuhuaFile ? await readQianniuhuaSummaryRows(qianniuhuaFile) : [];
  const qnhByStore = new Map(
    qnhRows.map((row) => [toText(row['门店']), row]),
  );

  const stores: FinanceMigrationAuditStore[] = [];

  for (const report of reports) {
    const detail = await readFinanceReportDetail(report.relativePath);
    const baselineRow = qnhByStore.get(`Oby便利超市（${report.storeName}）`);
    const blockedReasons: string[] = [];
    if (!baselineRow) {
      blockedReasons.push('未找到牵牛花门店汇总行');
    }
    if (!meituanPromo) {
      blockedReasons.push('未找到美团推广清单');
    }

    const mismatchedMetrics: FinanceMigrationAuditMetric[] = [];
    let totalComparedMetrics = 0;
    let matchedMetrics = 0;

    if (baselineRow && detail.storeMetrics) {
      const baselineMetrics = deriveLegacyQnhMetrics(baselineRow);
      const comparison = compareMigrationMetrics(
        baselineMetrics,
        detail.storeMetrics.map((item) => ({
          currentValue: item.currentValue,
          label: item.label,
        })),
      );
      mismatchedMetrics.push(...comparison.mismatchedMetrics);
      matchedMetrics = comparison.matchedMetrics;
      totalComparedMetrics = comparison.totalComparedMetrics;
    }

    if (mismatchedMetrics.length > 0) {
      blockedReasons.push('当前旧报表结果与牵牛花汇总行不一致，说明仍缺旧逻辑输入或二次处理口径');
    }

    stores.push({
      blockedReasons,
      matchedMetrics,
      mismatchedMetrics,
      reportFile: report.fileName,
      storeName: report.storeName,
      totalComparedMetrics,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    month,
    sourceFiles: {
      meituanPromo,
      qianniuhua: qianniuhuaFile,
      reports: reports.map((item) => item.fileName),
    },
    stores,
    summary: {
      exactMatchStores: stores.filter((item) => item.blockedReasons.length === 0).length,
      storesWithGaps: stores.filter((item) => item.blockedReasons.length > 0).length,
      totalStores: stores.length,
    },
  } satisfies FinanceMigrationAuditResult;
}
