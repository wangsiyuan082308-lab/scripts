import ExcelJS from 'exceljs';

function normalizeHeader(text: string) {
  return text.replace(/\*/g, '').replace(/\s+/g, '').trim();
}

function toText(value: ExcelJS.CellValue | null | undefined): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text.trim();
    if ('result' in value && value.result != null) return String(value.result).trim();
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((item) => item.text || '').join('').trim();
    }
  }
  return String(value).trim();
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

function resolveHeaderRow(worksheet: ExcelJS.Worksheet) {
  const maxScanRows = Math.min(10, worksheet.rowCount);
  let bestRowIndex = 1;
  let bestHeaders: string[] = [];

  for (let rowIndex = 1; rowIndex <= maxScanRows; rowIndex++) {
    const row = worksheet.getRow(rowIndex);
    const headers: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell) => {
      headers.push(normalizeHeader(toText(cell.value)));
    });
    const nonEmpty = headers.filter(Boolean);
    if (nonEmpty.length > bestHeaders.filter(Boolean).length) {
      bestHeaders = headers;
      bestRowIndex = rowIndex;
    }
  }

  return {
    headers: uniqueHeaders(bestHeaders),
    rowIndex: bestRowIndex,
  };
}

function normalizeKey(text: string) {
  return text.replace(/\s+/g, '').toLowerCase();
}

function detectStoreKey(records: FinancialReportRecord[]) {
  const aliases = ['门店', '门店名称', '店铺', '店铺名称', '商家', '商家名称'];
  const keys = new Set<string>();
  for (const record of records.slice(0, 20)) {
    for (const key of Object.keys(record)) {
      if (!key.startsWith('__')) keys.add(key);
    }
  }
  for (const key of keys) {
    const normalized = normalizeKey(key);
    if (aliases.some((alias) => normalized.includes(normalizeKey(alias)))) {
      return key;
    }
  }
  return '';
}

function detectAmountKeys(records: FinancialReportRecord[]) {
  const aliases = ['金额', '实收', '收入', '支出', '结算', '提现', '合计'];
  const keys = new Set<string>();
  for (const record of records.slice(0, 20)) {
    for (const key of Object.keys(record)) {
      if (!key.startsWith('__')) keys.add(key);
    }
  }
  return [...keys].filter((key) =>
    aliases.some((alias) => normalizeKey(key).includes(normalizeKey(alias))),
  );
}

function toNumber(value: string) {
  const normalized = `${value || ''}`.replace(/,/g, '').trim();
  if (!normalized) return 0;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface FinancialReportRecord {
  __fileName: string;
  __rowKey: string;
  __rowIndex: number;
  __sheetName: string;
  [key: string]: string | number;
}

export interface FinancialReportFile {
  fileName: string;
  rowCount: number;
  rows: FinancialReportRecord[];
  sheetNames: string[];
}

export interface FinancialStoreReport {
  amountSummaryText: string;
  amountTotals: Record<string, number>;
  monthLabel: string;
  rowCount: number;
  rows: FinancialReportRecord[];
  sourceFiles: string[];
  storeName: string;
}

export async function parseFinancialExcelFile(
  file: ArrayBuffer | File | Uint8Array,
  fileName: string,
) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file as any);

  const rows: FinancialReportRecord[] = [];
  const sheetNames: string[] = [];

  for (const worksheet of workbook.worksheets) {
    sheetNames.push(worksheet.name);
    const { headers, rowIndex: headerRowIndex } = resolveHeaderRow(worksheet);

    for (let rowIndex = headerRowIndex + 1; rowIndex <= worksheet.rowCount; rowIndex++) {
      const row = worksheet.getRow(rowIndex);
      const record: FinancialReportRecord = {
        __fileName: fileName,
        __rowKey: `${fileName}__${worksheet.name}__${rowIndex}`,
        __rowIndex: rowIndex,
        __sheetName: worksheet.name,
      };

      let hasValue = false;
      headers.forEach((header, columnIndex) => {
        const value = toText(row.getCell(columnIndex + 1).value);
        if (value) hasValue = true;
        record[header || `列${columnIndex + 1}`] = value;
      });

      if (hasValue) rows.push(record);
    }
  }

  return {
    fileName,
    rowCount: rows.length,
    rows,
    sheetNames,
  } satisfies FinancialReportFile;
}

export function buildFinancialStoreReports(
  files: FinancialReportFile[],
  monthLabel: string,
) {
  const allRows = files.flatMap((item) => item.rows);
  const storeKey = detectStoreKey(allRows);
  const amountKeys = detectAmountKeys(allRows);
  const bucket = new Map<string, FinancialReportRecord[]>();

  for (const row of allRows) {
    const storeName = storeKey ? `${row[storeKey] || ''}`.trim() : '';
    const groupName = storeName || '未识别门店';
    const list = bucket.get(groupName) || [];
    list.push(row);
    bucket.set(groupName, list);
  }

  return [...bucket.entries()]
    .map(([storeName, rows]) => {
      const sourceFiles = [...new Set(rows.map((row) => `${row.__fileName}`))];
      const amountTotals: Record<string, number> = {};
      for (const key of amountKeys) {
        amountTotals[key] = rows.reduce(
          (sum, row) => sum + toNumber(`${row[key] || ''}`),
          0,
        );
      }
      const amountSummaryText =
        Object.keys(amountTotals).length > 0
          ? Object.entries(amountTotals)
              .map(([key, value]) => `${key}: ${value.toFixed(2)}`)
              .join(' / ')
          : '待补充财务汇总逻辑';

      return {
        amountSummaryText,
        amountTotals,
        monthLabel,
        rowCount: rows.length,
        rows,
        sourceFiles,
        storeName,
      } satisfies FinancialStoreReport;
    })
    .sort((current, next) => current.storeName.localeCompare(next.storeName, 'zh-CN'));
}
