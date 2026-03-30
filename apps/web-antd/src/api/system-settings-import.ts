import ExcelJS from 'exceljs';

import type { Store } from './store';
import type { Supplier } from './supplier';

function normalizeHeader(text: string) {
  return text.replace(/\*/g, '').replace(/\s+/g, '').trim();
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
  }
  return String(value).trim();
}

function matchHeader(headers: Map<string, number>, aliases: string[]) {
  const normalizedAliases = aliases.map((item) => normalizeHeader(item));
  for (const alias of normalizedAliases) {
    const direct = headers.get(alias);
    if (direct) return direct;
  }
  for (const [header, column] of headers.entries()) {
    if (normalizedAliases.some((alias) => header.includes(alias) || alias.includes(header))) {
      return column;
    }
  }
  return 0;
}

function resolveHeaderRow(worksheet: ExcelJS.Worksheet, requiredAliases: string[][]) {
  const maxScanRows = Math.min(20, worksheet.rowCount);
  for (let rowIndex = 1; rowIndex <= maxScanRows; rowIndex++) {
    const row = worksheet.getRow(rowIndex);
    const headers = new Map<string, number>();
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const header = normalizeHeader(toText(cell.value));
      if (header) headers.set(header, colNumber);
    });
    if (headers.size === 0) continue;

    const matchedAll = requiredAliases.every((aliases) => matchHeader(headers, aliases) > 0);
    if (matchedAll) {
      return { headers, rowIndex };
    }
  }

  const fallbackRow = worksheet.getRow(1);
  const fallbackHeaders = new Map<string, number>();
  fallbackRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    const header = normalizeHeader(toText(cell.value));
    if (header) fallbackHeaders.set(header, colNumber);
  });
  return { headers: fallbackHeaders, rowIndex: 1 };
}

function cleanStoreAddress(address: string, storeName: string) {
  const normalized = address.replace(/\s+/g, ' ').trim();
  if (!normalized) return normalized;
  if (!storeName) return normalized;

  if (normalized.startsWith(storeName)) {
    return normalized.slice(storeName.length).replace(/^[,，:：\-–\s]+/, '').trim();
  }
  return normalized;
}

export async function parseStoreImportExcel(file: ArrayBuffer | File | Uint8Array) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file as any);
  const worksheet = workbook.worksheets[0];

  if (!worksheet) {
    throw new Error('Excel 文件中没有工作表');
  }

  const aliases = {
    address: ['详细地址', '地址'],
    contact: ['联系人', '负责人'],
    phone: ['联系电话', '电话', '联系方式'],
    region: ['区域'],
    storeId: ['门店编码', '店铺编码', '门店ID', '店铺ID'],
    storeName: ['门店名称', '店铺名称'],
  };

  const { headers, rowIndex: headerRowIndex } = resolveHeaderRow(worksheet, [aliases.storeId, aliases.storeName]);
  const columns = {
    address: matchHeader(headers, aliases.address),
    contact: matchHeader(headers, aliases.contact),
    phone: matchHeader(headers, aliases.phone),
    region: matchHeader(headers, aliases.region),
    storeId: matchHeader(headers, aliases.storeId),
    storeName: matchHeader(headers, aliases.storeName),
  };

  const stores: Store[] = [];
  for (let rowIndex = headerRowIndex + 1; rowIndex <= worksheet.rowCount; rowIndex++) {
    const row = worksheet.getRow(rowIndex);
    const storeName = toText(columns.storeName ? row.getCell(columns.storeName).value : '');
    const storeIdRaw = toText(columns.storeId ? row.getCell(columns.storeId).value : '');
    const region = toText(columns.region ? row.getCell(columns.region).value : '');
    const addressRaw = toText(columns.address ? row.getCell(columns.address).value : '');
    const contact = toText(columns.contact ? row.getCell(columns.contact).value : '');
    const phone = toText(columns.phone ? row.getCell(columns.phone).value : '');

    if (!storeName && !storeIdRaw) continue;

    const storeId = storeIdRaw || storeName;
    stores.push({
      id: storeId,
      storeId,
      storeName,
      platform: '',
      region,
      address: cleanStoreAddress(addressRaw, storeName),
      contact,
      phone,
    });
  }

  return stores;
}

export async function parseSupplierImportExcel(file: ArrayBuffer | File | Uint8Array) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(file as any);
  const worksheet = workbook.worksheets[0];

  if (!worksheet) {
    throw new Error('Excel 文件中没有工作表');
  }

  const aliases = {
    address: ['地址', '详细地址'],
    contact: ['联系人', '负责人'],
    minOrder: ['最小起订值', '起订值', '最低起订量'],
    phone: ['联系电话', '电话', '联系方式'],
    settlementType: ['结算方式'],
    status: ['供应商状态', '状态'],
    supplierId: ['供应商编码', '供应商ID', '编码'],
    supplierName: ['供应商名称', '名称'],
    type: ['供应商类型', '类型'],
  };

  const { headers, rowIndex: headerRowIndex } = resolveHeaderRow(worksheet, [aliases.supplierId, aliases.supplierName]);
  const columns = {
    address: matchHeader(headers, aliases.address),
    contact: matchHeader(headers, aliases.contact),
    minOrder: matchHeader(headers, aliases.minOrder),
    phone: matchHeader(headers, aliases.phone),
    settlementType: matchHeader(headers, aliases.settlementType),
    status: matchHeader(headers, aliases.status),
    supplierId: matchHeader(headers, aliases.supplierId),
    supplierName: matchHeader(headers, aliases.supplierName),
    type: matchHeader(headers, aliases.type),
  };

  const suppliers: Supplier[] = [];
  for (let rowIndex = headerRowIndex + 1; rowIndex <= worksheet.rowCount; rowIndex++) {
    const row = worksheet.getRow(rowIndex);
    const supplierName = toText(columns.supplierName ? row.getCell(columns.supplierName).value : '');
    const supplierIdRaw = toText(columns.supplierId ? row.getCell(columns.supplierId).value : '');
    const type = toText(columns.type ? row.getCell(columns.type).value : '');
    const contact = toText(columns.contact ? row.getCell(columns.contact).value : '');
    const phone = toText(columns.phone ? row.getCell(columns.phone).value : '');
    const address = toText(columns.address ? row.getCell(columns.address).value : '');
    const status = toText(columns.status ? row.getCell(columns.status).value : '');
    const minOrder = toText(columns.minOrder ? row.getCell(columns.minOrder).value : '');
    const settlementType = toText(columns.settlementType ? row.getCell(columns.settlementType).value : '');

    if (!supplierName && !supplierIdRaw) continue;

    const supplierId = supplierIdRaw || supplierName;
    suppliers.push({
      supplierId,
      supplierName,
      type,
      contact,
      phone,
      address,
      status,
      minOrder,
      settlementType,
    });
  }

  return suppliers;
}
