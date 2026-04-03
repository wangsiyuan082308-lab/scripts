import { requestClient } from './request';

export type FinanceReportType = 'abnormal' | 'store' | 'summary' | 'unknown';
export type FinanceValueFormat = 'int' | 'money' | 'percent' | 'text';

export interface FinanceStatus {
  latestMtime: null | string;
  latestReport: null | string;
  monthCount: number;
  months: string[];
  reportCount: number;
  storeCount: number;
}

export interface FinanceStoreConfig {
  elemeName: string;
  franchise: number;
  meituanId: string;
  name: string;
  office: number;
  promotion: number;
  rent: number;
  salary: number;
  shortName: string;
  totalFixedCost: number;
}

export interface FinanceReportItem {
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

export interface FinanceReportSummarySnapshot {
  netProfit: null | number;
  netProfitRate: null | number;
  orderCount: null | number;
  profitStatus: 'break_even' | 'loss' | 'profit' | 'unknown';
}

export interface FinanceSheetSummary {
  columnCount: number;
  name: string;
  rowCount: number;
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

export interface FinanceTablePreview {
  columnLetters: Record<string, string>;
  columns: string[];
  headerRowIndex: number;
  rowCount: number;
  rows: Array<Record<string, number | string> & { __sourceRow?: number }>;
}

export interface FinanceSummaryView {
  columns: string[];
  storeRows: Record<string, number | string>[];
  totalRow: null | Record<string, number | string>;
}

export interface FinanceAbnormalView {
  detailPreview: FinanceTablePreview;
  firstAbnormalOrder: null | Record<string, number | string>;
  storeSummary: FinanceTablePreview;
  topRiskStore: null | Record<string, number | string>;
}

export interface FinanceReportDetail {
  abnormalView?: FinanceAbnormalView;
  detailType: 'store' | 'table';
  previousReport: FinanceReportItem | null;
  report: FinanceReportItem;
  storeRawMetrics?: FinanceRawMetricRow[];
  sheetSummaries: FinanceSheetSummary[];
  storeMetrics?: FinanceCompareMetricRow[];
  summaryView?: FinanceSummaryView;
  tablePreview?: FinanceTablePreview;
}

export async function getFinanceStatus() {
  return requestClient.get<FinanceStatus>('/finance/status');
}

export async function getFinanceStores() {
  return requestClient.get<{
    list: FinanceStoreConfig[];
    total: number;
  }>('/finance/stores');
}

export async function getFinanceReports(params?: {
  month?: string;
  store?: string;
  type?: '' | FinanceReportType;
}) {
  return requestClient.get<{
    list: FinanceReportItem[];
    total: number;
  }>('/finance/reports', {
    params,
  });
}

export async function getFinanceReportSummaries(params?: {
  month?: string;
  store?: string;
  type?: '' | FinanceReportType;
}) {
  return requestClient.get<{
    list: Array<{
      relativePath: string;
      summary: FinanceReportSummarySnapshot | null;
    }>;
    total: number;
  }>('/finance/reports/summaries', {
    params,
  });
}

export async function getFinanceReportDetail(relativePath: string) {
  return requestClient.get<FinanceReportDetail>('/finance/reports/detail', {
    params: { relativePath },
  });
}
