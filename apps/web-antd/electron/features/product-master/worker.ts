import fs from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';

interface ProductMasterStoreRecord {
  aoxiangConversionFactor?: number | null;
  baseUnit?: string;
  cartonSize?: string;
  currentRetailPrice?: number | null;
  procurementCost?: number | null;
  purchaseUnit?: string;
  sourceFile?: string;
  sourceUpdatedAt?: string;
  status?: string;
  storeCode?: string;
  storeName?: string;
  storeSku?: string;
  suggestedRetailPrice?: number | null;
  supplierCode?: string;
  supplierName?: string;
  supplierProductCode?: string;
  supplierProductLink?: string;
  supplierProductName?: string;
  supplierProductSpec?: string;
}

interface ProductMasterSupplierRecord {
  cartonSizes?: string[];
  procurementCosts?: number[];
  storeCodes?: string[];
  storeNames?: string[];
  supplierCode?: string;
  supplierName?: string;
}

interface ProductMasterRecord {
  aoxiangConversionFactor?: number | null;
  cartonSize?: string;
  currentRetailPrice?: number | null;
  procurementCost?: number | null;
  productName?: string;
  sku?: string;
  skuAliases?: string[];
  specification?: string;
  storeCount?: number;
  stores?: ProductMasterStoreRecord[];
  suggestedRetailPrice?: number | null;
  supplierCount?: number;
  suppliers?: ProductMasterSupplierRecord[];
  upc?: string;
}

function normalizeText(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeKey(value: unknown) {
  return normalizeText(value).replace(/[\s()（）\-_/]/g, '').toLowerCase();
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const text = normalizeText(value);
  if (!text) return null;
  const parsed = Number.parseFloat(text.replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function uniqueStrings(values: Array<unknown>) {
  return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))];
}

function pickPreferredString(...values: Array<unknown>) {
  const candidates = values
    .map((value) => normalizeText(value))
    .filter(Boolean)
    .sort((left, right) => right.length - left.length);
  return candidates[0] || '';
}

function pickPreferredNumber(...values: Array<unknown>) {
  for (const value of values) {
    const parsed = toNumber(value);
    if (parsed != null) return parsed;
  }
  return null;
}

function compareUpdatedAt(left: unknown, right: unknown) {
  const leftTime = Date.parse(normalizeText(left));
  const rightTime = Date.parse(normalizeText(right));
  if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) return 0;
  if (Number.isNaN(leftTime)) return -1;
  if (Number.isNaN(rightTime)) return 1;
  return leftTime - rightTime;
}

function mergeStoreRecord(
  current: ProductMasterStoreRecord | undefined,
  incoming: ProductMasterStoreRecord,
) {
  if (!current) return incoming;
  const preferIncoming =
    compareUpdatedAt(current.sourceUpdatedAt, incoming.sourceUpdatedAt) <= 0;
  const primary = preferIncoming ? incoming : current;
  const secondary = preferIncoming ? current : incoming;
  return {
    aoxiangConversionFactor: pickPreferredNumber(
      primary.aoxiangConversionFactor,
      secondary.aoxiangConversionFactor,
    ),
    baseUnit: pickPreferredString(primary.baseUnit, secondary.baseUnit),
    cartonSize: pickPreferredString(primary.cartonSize, secondary.cartonSize),
    currentRetailPrice: pickPreferredNumber(
      primary.currentRetailPrice,
      secondary.currentRetailPrice,
    ),
    procurementCost: pickPreferredNumber(
      primary.procurementCost,
      secondary.procurementCost,
    ),
    purchaseUnit: pickPreferredString(primary.purchaseUnit, secondary.purchaseUnit),
    sourceFile: pickPreferredString(primary.sourceFile, secondary.sourceFile),
    sourceUpdatedAt: pickPreferredString(
      primary.sourceUpdatedAt,
      secondary.sourceUpdatedAt,
    ),
    status: pickPreferredString(primary.status, secondary.status),
    storeCode: pickPreferredString(primary.storeCode, secondary.storeCode),
    storeName: pickPreferredString(primary.storeName, secondary.storeName),
    storeSku: pickPreferredString(primary.storeSku, secondary.storeSku),
    suggestedRetailPrice: pickPreferredNumber(
      primary.suggestedRetailPrice,
      secondary.suggestedRetailPrice,
    ),
    supplierCode: pickPreferredString(primary.supplierCode, secondary.supplierCode),
    supplierName: pickPreferredString(primary.supplierName, secondary.supplierName),
    supplierProductCode: pickPreferredString(
      primary.supplierProductCode,
      secondary.supplierProductCode,
    ),
    supplierProductLink: pickPreferredString(
      primary.supplierProductLink,
      secondary.supplierProductLink,
    ),
    supplierProductName: pickPreferredString(
      primary.supplierProductName,
      secondary.supplierProductName,
    ),
    supplierProductSpec: pickPreferredString(
      primary.supplierProductSpec,
      secondary.supplierProductSpec,
    ),
  } satisfies ProductMasterStoreRecord;
}

function buildMergedRecord(records: ProductMasterRecord[]) {
  const storeMap = new Map<string, ProductMasterStoreRecord>();

  for (const record of records) {
    const stores = Array.isArray(record.stores) ? record.stores : [];
    for (const store of stores) {
      const key = [
        normalizeKey(store.storeCode || store.storeName),
        normalizeKey(store.supplierCode || store.supplierName),
        normalizeKey(store.storeSku),
      ].join('|');
      if (!key.replace(/\|/g, '')) continue;
      storeMap.set(key, mergeStoreRecord(storeMap.get(key), store));
    }
  }

  const stores = [...storeMap.values()].sort((left, right) =>
    `${left.storeCode || ''}|${left.storeName || ''}|${left.supplierCode || ''}`.localeCompare(
      `${right.storeCode || ''}|${right.storeName || ''}|${right.supplierCode || ''}`,
      'zh-CN',
    ),
  );

  return {
    aoxiangConversionFactor: pickPreferredNumber(
      ...records.map((record) => record.aoxiangConversionFactor),
      ...stores.map((store) => store.aoxiangConversionFactor),
    ),
    cartonSize: pickPreferredString(...records.map((record) => record.cartonSize)),
    currentRetailPrice: pickPreferredNumber(
      ...records.map((record) => record.currentRetailPrice),
    ),
    procurementCost: pickPreferredNumber(
      ...records.map((record) => record.procurementCost),
      ...stores.map((store) => store.procurementCost),
    ),
    productName: pickPreferredString(...records.map((record) => record.productName)),
    sku: pickPreferredString(...records.map((record) => record.sku)),
    skuAliases: uniqueStrings(
      records.flatMap((record) => [record.sku, ...(record.skuAliases || [])]),
    ),
    specification: pickPreferredString(...records.map((record) => record.specification)),
    storeCount: stores.length,
    stores,
    suggestedRetailPrice: pickPreferredNumber(
      ...records.map((record) => record.suggestedRetailPrice),
    ),
    supplierCount: uniqueStrings(
      stores.map((store) => store.supplierCode || store.supplierName),
    ).length,
    suppliers: Array.isArray(records[0]?.suppliers)
      ? records[0]?.suppliers
      : undefined,
    upc: pickPreferredString(...records.map((record) => record.upc)),
  } satisfies ProductMasterRecord;
}

function buildSerializedIndex(rows: ProductMasterRecord[], filePath: string, fileMtimeMs: number) {
  const grouped = new Map<string, ProductMasterRecord[]>();
  for (const row of rows) {
    const key = normalizeText(row.upc || row.sku);
    if (!key) continue;
    const items = grouped.get(key) || [];
    items.push(row);
    grouped.set(key, items);
  }

  const records = [...grouped.values()].map((group) => buildMergedRecord(group));
  const byCodeEntries: Array<[string, ProductMasterRecord]> = [];
  for (const record of records) {
    for (const code of uniqueStrings([record.upc, record.sku, ...(record.skuAliases || [])])) {
      byCodeEntries.push([normalizeKey(code), record]);
    }
  }

  return {
    byCodeEntries,
    fileMtimeMs,
    filePath,
    records,
  };
}

const rows = JSON.parse(fs.readFileSync(workerData.filePath, 'utf8'));
const payload = buildSerializedIndex(
  Array.isArray(rows) ? rows : [],
  workerData.filePath,
  workerData.fileMtimeMs,
);
parentPort?.postMessage(payload);
