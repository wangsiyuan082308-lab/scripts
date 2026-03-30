import { Buffer } from 'node:buffer';

import * as ExcelJS from 'exceljs';

export interface ExcelSchemaField {
  key: string;
  aliases: string[];
  required?: boolean;
}

export interface ExcelSchemaReadResult {
  data: any[];
  fieldMap: Record<string, string>;
  headerRowIndex: number;
  headers: string[];
}

function normalizeHeader(text: string): string {
  return text
    .replaceAll(/[\r\n]+/g, ' ')
    .replaceAll(/[*：:]/g, '')
    .replaceAll(/\s+/g, '')
    .trim()
    .toLowerCase();
}

function toText(value: ExcelJS.CellValue | null | undefined): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text.trim();
    if ('result' in value && value.result != null) return String(value.result).trim();
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((item) => item.text || '').join('').trim();
    }
    if ('hyperlink' in value && typeof value.hyperlink === 'string') {
      return value.hyperlink.trim();
    }
  }
  return String(value).trim();
}

function matchHeader(headers: Map<string, number>, aliases: string[]): number {
  const normalizedAliases = aliases.map((alias) => normalizeHeader(alias));

  for (const alias of normalizedAliases) {
    const exact = headers.get(alias);
    if (exact) return exact;
  }

  for (const [header, column] of headers.entries()) {
    if (normalizedAliases.some((alias) => header.includes(alias) || alias.includes(header))) {
      return column;
    }
  }

  return 0;
}

function resolveHeaderRow(
  worksheet: ExcelJS.Worksheet,
  requiredAliasGroups: string[][],
): { headers: Map<string, number>; rowIndex: number } {
  const maxScanRows = Math.min(20, worksheet.rowCount || 20);

  for (let rowIndex = 1; rowIndex <= maxScanRows; rowIndex++) {
    const row = worksheet.getRow(rowIndex);
    const headers = new Map<string, number>();

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const header = normalizeHeader(toText(cell.value));
      if (header) {
        headers.set(header, colNumber);
      }
    });

    if (headers.size === 0) continue;

    const matchedAll = requiredAliasGroups.every((aliases) => matchHeader(headers, aliases) > 0);
    if (matchedAll) {
      return { headers, rowIndex };
    }
  }

  const fallbackRow = worksheet.getRow(1);
  const fallbackHeaders = new Map<string, number>();
  fallbackRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    const header = normalizeHeader(toText(cell.value));
    if (header) {
      fallbackHeaders.set(header, colNumber);
    }
  });

  return { headers: fallbackHeaders, rowIndex: 1 };
}

function getWorksheetHeaders(
  worksheet: ExcelJS.Worksheet,
  headerRowIndex: number,
): string[] {
  const headerRow = worksheet.getRow(headerRowIndex);
  const headers: string[] = [];

  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = toText(cell.value).replaceAll(/[\r\n]+/g, '').trim();
  });

  return headers;
}

async function loadWorksheet(buffer: Buffer): Promise<ExcelJS.Worksheet | null> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook.worksheets[0] ?? null;
}

export async function readExcel(buffer: Buffer): Promise<any[]> {
  const worksheet = await loadWorksheet(buffer);
  if (!worksheet) return [];

  const { rowIndex: headerRowIndex } = resolveHeaderRow(worksheet, [
    ['UPC', '商品UPC'],
  ]);
  const headers = getWorksheetHeaders(worksheet, headerRowIndex);
  const data: any[] = [];

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowIndex) return;

    const rowData: any = {};
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const header = headers[colNumber - 1];
      if (!header) return;
      rowData[header] = toText(cell.value);
    });
    data.push(rowData);
  });

  return data;
}

export async function readExcelWithSchema(
  buffer: Buffer,
  schema: ExcelSchemaField[],
): Promise<ExcelSchemaReadResult> {
  const worksheet = await loadWorksheet(buffer);
  if (!worksheet) {
    return { data: [], fieldMap: {}, headerRowIndex: 1, headers: [] };
  }

  const requiredAliasGroups = schema
    .filter((field) => field.required !== false)
    .map((field) => field.aliases);
  const { headers: normalizedHeaders, rowIndex: headerRowIndex } = resolveHeaderRow(
    worksheet,
    requiredAliasGroups,
  );
  const headers = getWorksheetHeaders(worksheet, headerRowIndex);

  const fieldMap: Record<string, string> = {};
  for (const field of schema) {
    const columnIndex = matchHeader(normalizedHeaders, field.aliases);
    if (columnIndex > 0) {
      fieldMap[field.key] = headers[columnIndex - 1] || field.aliases[0] || field.key;
    }
  }

  const data: any[] = [];
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowIndex) return;

    const rowData: any = {};
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const header = headers[colNumber - 1];
      if (!header) return;
      rowData[header] = toText(cell.value);
    });
    data.push(rowData);
  });

  return {
    data,
    fieldMap,
    headerRowIndex,
    headers: headers.filter(Boolean),
  };
}

export { matchHeader, normalizeHeader, resolveHeaderRow, toText };
