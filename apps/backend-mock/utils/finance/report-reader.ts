import { existsSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join, relative, resolve } from 'node:path';

const requireFromWebAntd = createRequire(
  join(process.cwd(), 'apps/web-antd/package.json'),
);
const ExcelJS = requireFromWebAntd('exceljs') as {
  Workbook: new () => {
    xlsx: { readFile: (path: string) => Promise<void> };
    worksheets: Array<{
      actualColumnCount?: number;
      actualRowCount?: number;
      columnCount: number;
      name: string;
      rowCount: number;
      getCell: (row: number, column: number) => { value: unknown };
      getRow: (row: number) => {
        eachCell: (
          options: { includeEmpty: boolean },
          callback: (cell: { value: unknown }, columnNumber: number) => void,
        ) => void;
      };
    }>;
    getWorksheet: (name: string) => any;
  };
};

export type FinanceReportType = 'abnormal' | 'store' | 'summary' | 'unknown';
export type FinanceValueFormat = 'int' | 'money' | 'percent' | 'text';

export interface FinanceSheetSummary {
  columnCount: number;
  name: string;
  rowCount: number;
}

export interface FinanceReportListItem {
  absolutePath: string;
  createdAt: string;
  fileName: string;
  id: string;
  month: string;
  relativePath: string;
  size: number;
  storeName: string;
  type: FinanceReportType;
  typeLabel: string;
}

export interface FinanceCompareMetricRow {
  currentValue: number | null;
  diffRate: null | number;
  diffValue: number | null;
  format: FinanceValueFormat;
  group: string;
  label: string;
  previousValue: number | null;
}

export interface FinanceRawMetricRow {
  format: FinanceValueFormat;
  label: string;
  rawValue: null | number | string;
  sourceColumn: string;
  sourceLabel: string;
  sourceRow: number;
  sourceSheet: string;
}

export interface FinanceTablePreviewRow {
  [key: string]: number | string;
  __sourceRow?: number;
}

export interface FinanceTablePreview {
  columnLetters: Record<string, string>;
  columns: string[];
  headerRowIndex: number;
  rowCount: number;
  rows: FinanceTablePreviewRow[];
}

export interface FinanceSummaryView {
  columns: string[];
  storeRows: FinanceTablePreviewRow[];
  totalRow: FinanceTablePreviewRow | null;
}

export interface FinanceAbnormalView {
  detailPreview: FinanceTablePreview;
  firstAbnormalOrder: FinanceTablePreviewRow | null;
  storeSummary: FinanceTablePreview;
  topRiskStore: FinanceTablePreviewRow | null;
}

export interface FinanceReportDetail {
  detailType: 'store' | 'table';
  abnormalView?: FinanceAbnormalView;
  previousReport: FinanceReportListItem | null;
  report: FinanceReportListItem;
  storeRawMetrics?: FinanceRawMetricRow[];
  sheetSummaries: FinanceSheetSummary[];
  storeMetrics?: FinanceCompareMetricRow[];
  summaryView?: FinanceSummaryView;
  tablePreview?: FinanceTablePreview;
}

const SKILL_DIR = join(
  process.env.HOME || '/Users/mac',
  '.openclaw/workspace/skills/oby-finance-analyzer',
);
const OUTPUT_DIR = join(SKILL_DIR, '${args.output_dir}');

const STORE_METRIC_ORDER = [
  '订单数量',
  '订单平均价',
  '总收入',
  '实收交易额',
  '商品原价总金额',
  '配送收入',
  '商品包装费',
  '营销活动费用',
  '营销活动费用费率',
  '商品成本',
  '配送费',
  '配送费单均',
  '平台佣金',
  '公益捐赠',
  '管理费',
  '推广费',
  '饿了么',
  '美团',
  '房租物业',
  '加盟费',
  '人力成本',
  '水电杂项',
  '办公杂项',
  '线上毛利',
  '线上毛利率',
  '净利润',
  '净利润率',
];

const PERCENT_METRICS = new Set([
  '营销活动费用费率',
  '线上毛利率',
  '净利润率',
]);

const INT_METRICS = new Set(['订单数量']);

const OVERVIEW_METRICS = new Set(['订单数量', '订单平均价']);
const INCOME_METRICS = new Set([
  '总收入',
  '实收交易额',
  '商品原价总金额',
  '配送收入',
  '商品包装费',
  '营销活动费用',
  '营销活动费用费率',
]);
const COST_METRICS = new Set([
  '商品成本',
  '配送费',
  '配送费单均',
  '平台佣金',
  '公益捐赠',
  '管理费',
  '推广费',
  '饿了么',
  '美团',
  '房租物业',
  '加盟费',
  '人力成本',
  '水电杂项',
  '办公杂项',
]);

function toText(value: unknown) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    const cellValue = value as Record<string, unknown>;
    if (typeof cellValue.text === 'string') return cellValue.text.trim();
    if (cellValue.result != null) return String(cellValue.result).trim();
    if (Array.isArray(cellValue.richText)) {
      return cellValue.richText
        .map((item) =>
          item && typeof item === 'object' && 'text' in item
            ? `${(item as { text?: unknown }).text || ''}`
            : '',
        )
        .join('')
        .trim();
    }
  }
  return String(value).trim();
}

function normalizeHeader(text: string) {
  return text.replace(/\*/g, '').replace(/\s+/g, '').trim();
}

function normalizeKey(text: string) {
  return text.replace(/\s+/g, '').toLowerCase();
}

function uniqueHeaders(headers: string[]) {
  const counter = new Map<string, number>();
  return headers.map((header, index) => {
    const base = header || `列${index + 1}`;
    const used = counter.get(base) || 0;
    counter.set(base, used + 1);
    return used === 0 ? base : `${base}_${used + 1}`;
  });
}

function resolveHeaderRow(worksheet: {
  getRow: (row: number) => {
    eachCell: (
      options: { includeEmpty: boolean },
      callback: (cell: { value: unknown }, columnNumber: number) => void,
    ) => void;
  };
  rowCount: number;
}) {
  const maxScanRows = Math.min(10, worksheet.rowCount);
  let bestRowIndex = 1;
  let bestHeaders: string[] = [];

  for (let rowIndex = 1; rowIndex <= maxScanRows; rowIndex++) {
    const row = worksheet.getRow(rowIndex);
    const headers: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      headers.push(normalizeHeader(toText(cell.value)));
    });

    if (
      headers.filter(Boolean).length > bestHeaders.filter(Boolean).length
    ) {
      bestHeaders = headers;
      bestRowIndex = rowIndex;
    }
  }

  return {
    headers: uniqueHeaders(bestHeaders),
    rowIndex: bestRowIndex,
  };
}

function getFinanceValueFormat(label: string): FinanceValueFormat {
  if (PERCENT_METRICS.has(label)) return 'percent';
  if (INT_METRICS.has(label)) return 'int';
  return 'money';
}

function getFinanceMetricGroup(label: string) {
  if (OVERVIEW_METRICS.has(label)) return '概览';
  if (INCOME_METRICS.has(label)) return '收入';
  if (COST_METRICS.has(label)) return '成本';
  return '利润';
}

function toNumber(value: unknown) {
  if (value == null) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const text = toText(value).replace(/,/g, '').replace(/%/g, '');
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function getPreviousMonth(month: string) {
  if (!month) return '';
  const [yearText, monthText] = month.split('-');
  const year = Number(yearText);
  const currentMonth = Number(monthText);
  if (!year || !currentMonth) return '';
  if (currentMonth === 1) {
    return `${year - 1}-12`;
  }
  return `${year}-${`${currentMonth - 1}`.padStart(2, '0')}`;
}

function typeLabel(type: FinanceReportType) {
  switch (type) {
    case 'abnormal':
      return '毛利异常';
    case 'store':
      return '门店报表';
    case 'summary':
      return '月度汇总';
    default:
      return '其他';
  }
}

export function classifyFinanceReport(
  fileName: string,
  parentName = '',
): Pick<FinanceReportListItem, 'month' | 'storeName' | 'type' | 'typeLabel'> {
  const monthMatch = fileName.match(/(\d{4}-\d{2})月/);
  const month = monthMatch?.[1] || '';

  if (fileName.includes('毛利异常')) {
    return {
      month,
      storeName: '毛利异常',
      type: 'abnormal',
      typeLabel: typeLabel('abnormal'),
    };
  }

  if (fileName.includes('门店模板汇总') || fileName.includes('门店总表')) {
    return {
      month,
      storeName: '汇总',
      type: 'summary',
      typeLabel: typeLabel('summary'),
    };
  }

  const storeMatch = fileName.match(
    /(\d{4}-\d{2})月[-_]?(.+?)[_-]?(?:财务报表|门店报表)/,
  );

  return {
    month,
    storeName:
      storeMatch?.[2] ||
      (parentName && parentName !== '${args.output_dir}' ? parentName : '未识别门店'),
    type: 'store',
    typeLabel: typeLabel('store'),
  };
}

export function scanFinanceReports(filters?: {
  month?: string;
  store?: string;
  type?: '' | FinanceReportType;
}) {
  const reports: FinanceReportListItem[] = [];
  if (!existsSync(OUTPUT_DIR)) return reports;

  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
        continue;
      }
      if (!entry.name.endsWith('.xlsx') && !entry.name.endsWith('.csv')) {
        continue;
      }

      const parsed = classifyFinanceReport(entry.name, basename(dir));
      if (filters?.month && parsed.month !== filters.month) continue;
      if (filters?.type && parsed.type !== filters.type) continue;
      if (filters?.store && !parsed.storeName.includes(filters.store)) continue;

      const stat = statSync(fullPath);
      const relativePath = relative(OUTPUT_DIR, fullPath);
      reports.push({
        absolutePath: fullPath,
        createdAt: stat.mtime.toISOString(),
        fileName: entry.name,
        id: encodeURIComponent(relativePath),
        month: parsed.month,
        relativePath,
        size: stat.size,
        storeName: parsed.storeName,
        type: parsed.type,
        typeLabel: parsed.typeLabel,
      });
    }
  };

  visit(OUTPUT_DIR);

  return reports.sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
}

function resolveFinancePath(relativePath: string) {
  const safeRelativePath = `${relativePath || ''}`.replace(/^\/+/, '');
  const resolvedPath = resolve(OUTPUT_DIR, safeRelativePath);
  const outputRoot = resolve(OUTPUT_DIR);
  if (
    resolvedPath !== outputRoot &&
    !resolvedPath.startsWith(`${outputRoot}/`)
  ) {
    throw new Error('非法报表路径');
  }
  return resolvedPath;
}

function getSheetSummaries(workbook: { worksheets: any[] }) {
  return workbook.worksheets.map((sheet) => ({
    columnCount: sheet.columnCount || sheet.actualColumnCount || 0,
    name: sheet.name,
    rowCount: sheet.rowCount || sheet.actualRowCount || 0,
  }));
}

export function extractStoreMetricMap(worksheet: {
  getCell: (row: number, column: number) => { value: unknown };
  name: string;
  rowCount: number;
}) {
  const metrics = new Map<string, number | null>();
  if (worksheet.name === '单门店报表') {
    for (let rowIndex = 2; rowIndex <= worksheet.rowCount; rowIndex++) {
      const label = toText(worksheet.getCell(rowIndex, 1).value);
      if (!label || label.startsWith('【')) continue;
      metrics.set(label, toNumber(worksheet.getCell(rowIndex, 2).value));
    }
    return metrics;
  }

  for (let rowIndex = 1; rowIndex <= worksheet.rowCount; rowIndex++) {
    const rawLabel = toText(worksheet.getCell(rowIndex, 2).value);
    if (!rawLabel) continue;

    const labelMap: Record<string, string> = {
      佣金: '平台佣金',
      收入: '总收入',
      营销活动费率: '营销活动费用费率',
    };
    const label = labelMap[rawLabel] || rawLabel;
    if (!STORE_METRIC_ORDER.includes(label)) continue;
    metrics.set(label, toNumber(worksheet.getCell(rowIndex, 3).value));
  }

  return metrics;
}

export function extractStoreRawMetrics(worksheet: {
  getCell: (row: number, column: number) => { value: unknown };
  name: string;
  rowCount: number;
}) {
  const rows: FinanceRawMetricRow[] = [];

  if (worksheet.name === '单门店报表') {
    for (let rowIndex = 2; rowIndex <= worksheet.rowCount; rowIndex++) {
      const sourceLabel = toText(worksheet.getCell(rowIndex, 1).value);
      if (!sourceLabel || sourceLabel.startsWith('【')) continue;
      const rawCellValue = worksheet.getCell(rowIndex, 2).value;
      rows.push({
        format: getFinanceValueFormat(sourceLabel),
        label: sourceLabel,
        rawValue: toNumber(rawCellValue) ?? toText(rawCellValue),
        sourceColumn: 'B',
        sourceLabel,
        sourceRow: rowIndex,
        sourceSheet: worksheet.name,
      });
    }
    return rows;
  }

  const legacyLabelMap: Record<string, string> = {
    佣金: '平台佣金',
    收入: '总收入',
    营销活动费率: '营销活动费用费率',
  };

  for (let rowIndex = 1; rowIndex <= worksheet.rowCount; rowIndex++) {
    const sourceLabel = toText(worksheet.getCell(rowIndex, 2).value);
    if (!sourceLabel) continue;
    const label = legacyLabelMap[sourceLabel] || sourceLabel;
    if (!STORE_METRIC_ORDER.includes(label)) continue;
    const rawCellValue = worksheet.getCell(rowIndex, 3).value;
    rows.push({
      format: getFinanceValueFormat(label),
      label,
      rawValue: toNumber(rawCellValue) ?? toText(rawCellValue),
      sourceColumn: 'C',
      sourceLabel,
      sourceRow: rowIndex,
      sourceSheet: worksheet.name,
    });
  }

  return rows;
}

export function buildFinanceCompareRows(
  currentMetrics: Map<string, number | null>,
  previousMetrics?: Map<string, number | null> | null,
) {
  return STORE_METRIC_ORDER.map((label) => {
    const currentValue = currentMetrics.get(label) ?? null;
    const previousValue =
      previousMetrics && previousMetrics.has(label)
        ? previousMetrics.get(label) ?? null
        : null;
    const diffValue =
      currentValue == null || previousValue == null
        ? null
        : currentValue - previousValue;
    const diffRate =
      diffValue == null || previousValue == null || previousValue === 0
        ? null
        : diffValue / Math.abs(previousValue);

    return {
      currentValue,
      diffRate,
      diffValue,
      format: getFinanceValueFormat(label),
      group: getFinanceMetricGroup(label),
      label,
      previousValue,
    } satisfies FinanceCompareMetricRow;
  });
}

export function extractWorksheetTablePreview(worksheet: {
  getCell: (row: number, column: number) => { value: unknown };
  getRow: (row: number) => {
    eachCell: (
      options: { includeEmpty: boolean },
      callback: (cell: { value: unknown }, columnNumber: number) => void,
    ) => void;
  };
  rowCount: number;
}, options?: { limit?: number }) {
  const { headers, rowIndex } = resolveHeaderRow(worksheet);
  const rows: FinanceTablePreviewRow[] = [];
  const limit = options?.limit ?? 80;
  const columnLetters: Record<string, string> = {};

  headers.forEach((header, index) => {
    const normalizedHeader = header || `列${index + 1}`;
    let current = index + 1;
    let label = '';
    while (current > 0) {
      const mod = (current - 1) % 26;
      label = String.fromCharCode(65 + mod) + label;
      current = Math.floor((current - 1) / 26);
    }
    columnLetters[normalizedHeader] = label;
  });

  for (
    let currentRow = rowIndex + 1;
    currentRow <= worksheet.rowCount && rows.length < limit;
    currentRow++
  ) {
    const record: FinanceTablePreviewRow = {
      __sourceRow: currentRow,
    };
    let hasValue = false;
    headers.forEach((header, columnIndex) => {
      const value = worksheet.getCell(currentRow, columnIndex + 1).value;
      const textValue = toText(value);
      const numericValue = toNumber(value);
      if (textValue) hasValue = true;
      record[header || `列${columnIndex + 1}`] =
        numericValue != null && textValue !== '' ? numericValue : textValue;
    });
    if (hasValue) rows.push(record);
  }

  return {
    columnLetters,
    columns: headers.filter(Boolean),
    headerRowIndex: rowIndex,
    rowCount: Math.max(worksheet.rowCount - rowIndex, 0),
    rows,
  } satisfies FinanceTablePreview;
}

async function loadWorkbook(filePath: string) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  return workbook;
}

export function buildSummaryView(worksheet: {
  getCell: (row: number, column: number) => { value: unknown };
  getRow: (row: number) => {
    eachCell: (
      options: { includeEmpty: boolean },
      callback: (cell: { value: unknown }, columnNumber: number) => void,
    ) => void;
  };
  rowCount: number;
}) {
  const preview = extractWorksheetTablePreview(worksheet, { limit: 200 });
  const storeRows = preview.rows.filter((row) => `${row['门店'] || ''}` !== '合计');
  const totalRow =
    preview.rows.find((row) => `${row['门店'] || ''}` === '合计') || null;

  return {
    columns: preview.columns,
    storeRows,
    totalRow,
  } satisfies FinanceSummaryView;
}

export function buildAbnormalView(storeSummarySheet: {
  getCell: (row: number, column: number) => { value: unknown };
  getRow: (row: number) => {
    eachCell: (
      options: { includeEmpty: boolean },
      callback: (cell: { value: unknown }, columnNumber: number) => void,
    ) => void;
  };
  rowCount: number;
}, detailSheet: {
  getCell: (row: number, column: number) => { value: unknown };
  getRow: (row: number) => {
    eachCell: (
      options: { includeEmpty: boolean },
      callback: (cell: { value: unknown }, columnNumber: number) => void,
    ) => void;
  };
  rowCount: number;
}) {
  const storeSummary = extractWorksheetTablePreview(storeSummarySheet, {
    limit: 200,
  });
  const detailPreview = extractWorksheetTablePreview(detailSheet, { limit: 60 });

  return {
    detailPreview,
    firstAbnormalOrder: detailPreview.rows[0] || null,
    storeSummary,
    topRiskStore: storeSummary.rows[0] || null,
  } satisfies FinanceAbnormalView;
}

function findReportByRelativePath(relativePath: string) {
  const normalizedRelativePath = `${relativePath || ''}`.replace(/^\/+/, '');
  return scanFinanceReports().find(
    (item) => item.relativePath === normalizedRelativePath,
  );
}

export async function readFinanceReportDetail(relativePath: string) {
  const report =
    findReportByRelativePath(relativePath) ||
    (() => {
      const absolutePath = resolveFinancePath(relativePath);
      if (!existsSync(absolutePath)) {
        throw new Error('财务报表不存在');
      }
      const relativeOutputPath = relative(OUTPUT_DIR, absolutePath);
      const parsed = classifyFinanceReport(
        basename(absolutePath),
        basename(resolve(absolutePath, '..')),
      );
      const stat = statSync(absolutePath);
      return {
        absolutePath,
        createdAt: stat.mtime.toISOString(),
        fileName: basename(absolutePath),
        id: encodeURIComponent(relativeOutputPath),
        month: parsed.month,
        relativePath: relativeOutputPath,
        size: stat.size,
        storeName: parsed.storeName,
        type: parsed.type,
        typeLabel: parsed.typeLabel,
      } satisfies FinanceReportListItem;
    })();

  const workbook = await loadWorkbook(report.absolutePath);
  const sheetSummaries = getSheetSummaries(workbook);

  if (report.type === 'store') {
    const worksheet =
      workbook.getWorksheet('单门店报表') || workbook.getWorksheet('总表');
    if (!worksheet) {
      throw new Error('未找到门店财务报表工作表');
    }

    const currentMetrics = extractStoreMetricMap(worksheet);
    const previousMonth = getPreviousMonth(report.month);
    const previousReport =
      previousMonth && report.storeName
        ? scanFinanceReports({
            month: previousMonth,
            store: report.storeName,
            type: 'store',
          })[0] || null
        : null;
    let previousMetrics: Map<string, number | null> | null = null;

    if (previousReport) {
      const previousWorkbook = await loadWorkbook(previousReport.absolutePath);
      const previousWorksheet =
        previousWorkbook.getWorksheet('单门店报表') ||
        previousWorkbook.getWorksheet('总表');
      previousMetrics = previousWorksheet
        ? extractStoreMetricMap(previousWorksheet)
        : null;
    }

    return {
      detailType: 'store',
      previousReport,
      report,
      storeRawMetrics: extractStoreRawMetrics(worksheet),
      sheetSummaries,
      storeMetrics: buildFinanceCompareRows(currentMetrics, previousMetrics),
    } satisfies FinanceReportDetail;
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('报表工作表为空');
  }

  if (report.type === 'summary') {
    return {
      detailType: 'table',
      previousReport: null,
      report,
      sheetSummaries,
      summaryView: buildSummaryView(worksheet),
      tablePreview: extractWorksheetTablePreview(worksheet, { limit: 200 }),
    } satisfies FinanceReportDetail;
  }

  if (report.type === 'abnormal') {
    const detailSheet = workbook.worksheets[1];
    if (!detailSheet) {
      throw new Error('未找到异常订单明细工作表');
    }

    return {
      abnormalView: buildAbnormalView(worksheet, detailSheet),
      detailType: 'table',
      previousReport: null,
      report,
      sheetSummaries,
      tablePreview: extractWorksheetTablePreview(worksheet, { limit: 200 }),
    } satisfies FinanceReportDetail;
  }

  return {
    detailType: 'table',
    previousReport: null,
    report,
    sheetSummaries,
    tablePreview: extractWorksheetTablePreview(worksheet),
  } satisfies FinanceReportDetail;
}

export function getFinanceStatusSummary() {
  const reports = scanFinanceReports();
  const months = Array.from(
    new Set(reports.map((item) => item.month).filter(Boolean)),
  ).sort((left, right) => right.localeCompare(left));

  return {
    latestReport: reports[0]?.fileName || null,
    latestMtime: reports[0]?.createdAt || null,
    monthCount: months.length,
    months,
    reportCount: reports.length,
  };
}

export const financePaths = {
  outputDir: OUTPUT_DIR,
  skillDir: SKILL_DIR,
};
