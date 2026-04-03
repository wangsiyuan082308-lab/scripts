import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface ProductMasterStoreRecord {
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

export interface ProductMasterSupplierRecord {
  cartonSizes?: string[];
  procurementCosts?: number[];
  storeCodes?: string[];
  storeNames?: string[];
  supplierCode?: string;
  supplierName?: string;
}

export interface ProductMasterRecord {
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

export interface ProductMasterSerializedIndex {
  byCodeEntries: Array<[string, ProductMasterRecord]>;
  fileMtimeMs: number;
  filePath: string;
  records: ProductMasterRecord[];
}

export interface ProductMasterIndex {
  byCode: Map<string, ProductMasterRecord>;
  fileMtimeMs: number;
  filePath: string;
  records: ProductMasterRecord[];
}

export interface ProductMasterMeta {
  indexBuiltAt?: string;
  indexRawFileMtimeMs?: number;
  indexRecordCount?: number;
  rawCopiedAt?: string;
  rawFileMtimeMs?: number;
  rawFileSize?: number;
  rawSourcePath?: string;
  schemaVersion: number;
}

export interface ProductMasterListItem {
  baseUnitProcurementCost?: number | null;
  cartonProcurementCost?: number | null;
  cartonSize?: string;
  currentRetailPrice?: number | null;
  hasStorePriceVariance?: boolean;
  primaryStoreNames: string[];
  primarySupplierNames: string[];
  procurementCost?: number | null;
  productName: string;
  priceVarianceReason?: string;
  sku: string;
  specification: string;
  storeCount: number;
  supplierCount: number;
  upc: string;
}

export interface ProductMasterFilterOptions {
  storeOptions: Array<{ label: string; value: string }>;
  supplierOptions: Array<{ label: string; value: string }>;
}

interface RuntimePaths {
  dataDir: string;
  indexPath: string;
  metaPath: string;
  rawPath: string;
}

interface CachedIndex {
  key: string;
  value: ProductMasterIndex;
}

const PRODUCT_MASTER_SCHEMA_VERSION = 1;
const PRODUCT_MASTER_DIRNAME = 'product-master';
const PRODUCT_MASTER_INDEX_FILENAME = 'product-master.index.json';
const PRODUCT_MASTER_META_FILENAME = 'product-master.meta.json';
const PRODUCT_MASTER_RAW_FILENAME = 'product-master.raw.json';
const LEGACY_PRODUCT_MASTER_FILENAME = 'product-master.json';
let cachedIndex: CachedIndex | null = null;
let pendingLoad: Promise<ProductMasterIndex> | null = null;

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

function uniqueNumbers(values: Array<unknown>) {
  return [...new Set(values.map((value) => toNumber(value)).filter((value): value is number => value != null))];
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

function parseCartonInfo(cartonSize?: string) {
  const text = normalizeText(cartonSize);
  const match = text.match(/(\d+(?:\.\d+)?)\s*([^/／]+)\s*[\/／]\s*([^/／]+)/);
  if (!match) {
    return {
      baseUnit: '',
      factor: null as number | null,
      purchaseUnit: '',
    };
  }

  const factor = Number.parseFloat(match[1]);
  return {
    baseUnit: normalizeText(match[2]),
    factor: Number.isFinite(factor) && factor > 0 ? factor : null,
    purchaseUnit: normalizeText(match[3]),
  };
}

function getProcurementDimensions(record: ProductMasterRecord) {
  const procurementCost = record.procurementCost ?? null;
  const cartonSize = normalizeText(record.cartonSize);
  const carton = parseCartonInfo(cartonSize);
  const factor =
    record.aoxiangConversionFactor != null && record.aoxiangConversionFactor > 0
      ? record.aoxiangConversionFactor
      : 1;

  if (procurementCost == null) {
    return {
      baseUnitProcurementCost: null as number | null,
      cartonProcurementCost: null as number | null,
      cartonSize,
    };
  }

  if (factor > 1) {
    return {
      baseUnitProcurementCost: procurementCost,
      cartonProcurementCost: Number((procurementCost * factor).toFixed(4)),
      cartonSize,
    };
  }

  const cartonProcurementCost = procurementCost;
  const baseUnitProcurementCost = carton.factor
    ? Number((cartonProcurementCost / carton.factor).toFixed(4))
    : procurementCost;

  return {
    baseUnitProcurementCost,
    cartonProcurementCost,
    cartonSize,
  };
}

export function getProductMasterProcurementPricing(record: ProductMasterRecord) {
  return getProcurementDimensions(record);
}

function getDefaultRuntimeRoot() {
  if (process.env.PRODUCT_MASTER_HOME) {
    return process.env.PRODUCT_MASTER_HOME;
  }
  return path.join(os.homedir(), '.scriptai', PRODUCT_MASTER_DIRNAME);
}

function getLegacyProductMasterSourceCandidates() {
  return uniqueStrings([
    process.env.PRODUCT_MASTER_SOURCE_PATH,
    path.join(os.homedir(), '.openclaw', 'data', LEGACY_PRODUCT_MASTER_FILENAME),
  ]);
}

export function getProductMasterRuntimePaths(): RuntimePaths {
  const dataDir = getDefaultRuntimeRoot();
  return {
    dataDir,
    indexPath: path.join(dataDir, PRODUCT_MASTER_INDEX_FILENAME),
    metaPath: path.join(dataDir, PRODUCT_MASTER_META_FILENAME),
    rawPath: path.join(dataDir, PRODUCT_MASTER_RAW_FILENAME),
  };
}

async function ensureDirectory(dirPath: string) {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

async function writeJsonAtomic(filePath: string, data: unknown) {
  await ensureDirectory(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
  await fs.promises.rename(tempPath, filePath);
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(content) as T;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
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
  } satisfies ProductMasterSerializedIndex;
}

function hydrateIndex(serialized: ProductMasterSerializedIndex): ProductMasterIndex {
  return {
    byCode: new Map(serialized.byCodeEntries),
    fileMtimeMs: serialized.fileMtimeMs,
    filePath: serialized.filePath,
    records: serialized.records,
  };
}

function resolveWorkerUrl() {
  const workerExt = import.meta.url.endsWith('.ts') ? '.ts' : '.js';
  return new URL(`./worker${workerExt}`, import.meta.url);
}

function shouldUseWorker() {
  return import.meta.url.endsWith('.js');
}

async function buildIndexInWorker(filePath: string, fileMtimeMs: number) {
  const worker = new Worker(resolveWorkerUrl(), {
    workerData: {
      fileMtimeMs,
      filePath,
    },
  });

  return await new Promise<ProductMasterSerializedIndex>((resolve, reject) => {
    worker.once('message', (payload) => resolve(payload as ProductMasterSerializedIndex));
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`商品总表 worker 退出异常: ${code}`));
      }
    });
  });
}

async function buildIndexLocally(filePath: string, fileMtimeMs: number) {
  const rows = (await readJsonFile<ProductMasterRecord[]>(filePath)) || [];
  return buildSerializedIndex(rows, filePath, fileMtimeMs);
}

async function buildSerializedIndexSafely(filePath: string, fileMtimeMs: number) {
  if (!shouldUseWorker()) {
    return await buildIndexLocally(filePath, fileMtimeMs);
  }

  try {
    return await buildIndexInWorker(filePath, fileMtimeMs);
  } catch (error) {
    console.warn(
      '[product-master] worker 构建索引失败，回退到主线程解析:',
      error instanceof Error ? error.message : String(error),
    );
    return await buildIndexLocally(filePath, fileMtimeMs);
  }
}

function getCacheKey(filePath: string, fileMtimeMs: number) {
  return `${filePath}:${fileMtimeMs}`;
}

export async function loadProductMasterIndex(forceRefresh = false): Promise<ProductMasterIndex> {
  const paths = getProductMasterRuntimePaths();
  await ensureDirectory(paths.dataDir);

  if (!fs.existsSync(paths.rawPath)) {
    return {
      byCode: new Map(),
      fileMtimeMs: 0,
      filePath: paths.rawPath,
      records: [],
    };
  }

  const rawStat = await fs.promises.stat(paths.rawPath);
  const cacheKey = getCacheKey(paths.rawPath, rawStat.mtimeMs);
  if (!forceRefresh && cachedIndex?.key === cacheKey) {
    return cachedIndex.value;
  }

  if (!forceRefresh && pendingLoad) {
    return await pendingLoad;
  }

  const loadPromise = (async () => {
    const meta = await readJsonFile<ProductMasterMeta>(paths.metaPath);
    const serializedIndex = await readJsonFile<ProductMasterSerializedIndex>(paths.indexPath);

    if (
      !forceRefresh &&
      meta?.schemaVersion === PRODUCT_MASTER_SCHEMA_VERSION &&
      meta.indexRawFileMtimeMs === rawStat.mtimeMs &&
      serializedIndex?.fileMtimeMs === rawStat.mtimeMs
    ) {
      const hydrated = hydrateIndex(serializedIndex);
      cachedIndex = {
        key: cacheKey,
        value: hydrated,
      };
      return hydrated;
    }

    const nextSerialized = await buildSerializedIndexSafely(
      paths.rawPath,
      rawStat.mtimeMs,
    );

    await writeJsonAtomic(paths.indexPath, nextSerialized);
    await writeJsonAtomic(paths.metaPath, {
      indexBuiltAt: new Date().toISOString(),
      indexRawFileMtimeMs: rawStat.mtimeMs,
      indexRecordCount: nextSerialized.records.length,
      rawFileMtimeMs: rawStat.mtimeMs,
      rawFileSize: rawStat.size,
      rawSourcePath: paths.rawPath,
      schemaVersion: PRODUCT_MASTER_SCHEMA_VERSION,
    } satisfies ProductMasterMeta);

    const hydrated = hydrateIndex(nextSerialized);
    cachedIndex = {
      key: cacheKey,
      value: hydrated,
    };
    return hydrated;
  })();

  pendingLoad = loadPromise.finally(() => {
    pendingLoad = null;
  });

  return await pendingLoad;
}

export async function ensureProductMasterIndex(options?: {
  allowLegacySource?: boolean;
  forceRefresh?: boolean;
}): Promise<ProductMasterIndex> {
  const forceRefresh = options?.forceRefresh ?? false;
  let index = await loadProductMasterIndex(forceRefresh);

  if (index.records.length > 0 || !options?.allowLegacySource) {
    return index;
  }

  for (const sourcePath of getLegacyProductMasterSourceCandidates()) {
    try {
      const stat = await fs.promises.stat(sourcePath);
      if (!stat.isFile()) {
        continue;
      }
      const fileBuffer = await fs.promises.readFile(sourcePath);
      await importProductMasterJson(fileBuffer, sourcePath);
      index = await loadProductMasterIndex(true);
      if (index.records.length > 0) {
        return index;
      }
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        console.warn(
          '[product-master] legacy source import failed:',
          sourcePath,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  return index;
}

export function findProductMasterRecord(
  index: ProductMasterIndex,
  input: { barcode?: string; sku?: string },
) {
  const code = normalizeKey(input.barcode || input.sku);
  if (!code) return null;
  return index.byCode.get(code) || null;
}

export async function listProductMasterRecords(params?: {
  hasStorePriceVariance?: string;
  productName?: string;
  storeNames?: string[] | string;
  supplierNames?: string[] | string;
  upc?: string;
}) {
  const index = await loadProductMasterIndex();
  const varianceFilter = normalizeText(params?.hasStorePriceVariance);
  const productName = normalizeKey(params?.productName);
  const upc = normalizeKey(params?.upc);
  const selectedStoreNames = (Array.isArray(params?.storeNames)
    ? params?.storeNames
    : params?.storeNames
      ? [params.storeNames]
      : [])
    .map((item) => normalizeKey(item))
    .filter(Boolean);
  const selectedSupplierNames = (Array.isArray(params?.supplierNames)
    ? params?.supplierNames
    : params?.supplierNames
      ? [params.supplierNames]
      : [])
    .map((item) => normalizeKey(item))
    .filter(Boolean);

  const items: ProductMasterListItem[] = index.records
    .filter((record) => {
      const recordProductName = normalizeKey(record.productName);
      const recordUpc = normalizeKey(record.upc);
      const storeNames = (record.stores || []).map((store) =>
        normalizeKey(store.storeName),
      );
      const supplierNames = (record.stores || []).map((store) =>
        normalizeKey(store.supplierName),
      );

      const matchProductName =
        !productName || recordProductName.includes(productName);
      const matchUpc = !upc || recordUpc.includes(upc);
      const matchStoreName =
        selectedStoreNames.length === 0 ||
        selectedStoreNames.some((target) =>
          storeNames.some((name) => name.includes(target)),
        );
      const matchSupplierName =
        selectedSupplierNames.length === 0 ||
        selectedSupplierNames.some((target) =>
          supplierNames.some((name) => name.includes(target)),
        );

      return (
        matchProductName && matchUpc && matchStoreName && matchSupplierName
      );
    })
    .map((record) => {
      const storeCosts = (record.stores || [])
        .map((store) => ({
          procurementCost: store.procurementCost ?? null,
          storeName: store.storeName || store.storeCode || '未知门店',
        }))
        .filter((item) => item.procurementCost != null);

      const uniqueStoreCosts = uniqueNumbers(
        storeCosts.map((item) => item.procurementCost),
      );
      const rowHasStorePriceVariance = uniqueStoreCosts.length > 1;
      const priceVarianceReason = rowHasStorePriceVariance
        ? storeCosts
            .map((item) => `${item.storeName}: ${item.procurementCost}`)
            .join('；')
        : '';

      if (varianceFilter === '是' && !rowHasStorePriceVariance) {
        return null;
      }
      if (varianceFilter === '否' && rowHasStorePriceVariance) {
        return null;
      }

      return {
        ...getProcurementDimensions(record),
        currentRetailPrice: record.currentRetailPrice,
        hasStorePriceVariance: rowHasStorePriceVariance,
        primaryStoreNames: uniqueStrings(
          (record.stores || []).map((store) => store.storeName).filter(Boolean),
        ).slice(0, 3),
        primarySupplierNames: uniqueStrings(
          (record.stores || [])
            .map((store) => store.supplierName)
            .filter(Boolean),
        ).slice(0, 3),
        priceVarianceReason,
        procurementCost: record.procurementCost,
        productName: record.productName || '',
        sku: record.sku || '',
        specification: record.specification || '',
        storeCount:
          record.storeCount ??
          uniqueStrings((record.stores || []).map((store) => store.storeCode)).length,
        supplierCount:
          record.supplierCount ??
          uniqueStrings(
            (record.stores || []).map((store) => store.supplierCode || store.supplierName),
          ).length,
        upc: record.upc || '',
      };
    })
    .filter(Boolean)
    .sort((left, right) =>
      `${left.productName}|${left.upc}`.localeCompare(
        `${right.productName}|${right.upc}`,
        'zh-CN',
      ),
    );

  return items;
}

export async function getProductMasterFilterOptions(): Promise<ProductMasterFilterOptions> {
  const index = await loadProductMasterIndex();
  const storeOptions = uniqueStrings(
    index.records.flatMap((record) =>
      (record.stores || []).map((store) => store.storeName).filter(Boolean),
    ),
  )
    .sort((left, right) => left.localeCompare(right, 'zh-CN'))
    .map((item) => ({ label: item, value: item }));

  const supplierOptions = uniqueStrings(
    index.records.flatMap((record) =>
      (record.stores || []).map((store) => store.supplierName).filter(Boolean),
    ),
  )
    .sort((left, right) => left.localeCompare(right, 'zh-CN'))
    .map((item) => ({ label: item, value: item }));

  return {
    storeOptions,
    supplierOptions,
  };
}

export interface ProductMasterStatus {
  exists: boolean;
  fileMtimeMs: number;
  indexBuiltAt?: string;
  recordCount: number;
  rawPath: string;
  rawSourcePath?: string;
  rawSize: number;
  schemaVersion: number;
}

export async function getProductMasterStatus(): Promise<ProductMasterStatus> {
  const paths = getProductMasterRuntimePaths();
  await ensureDirectory(paths.dataDir);

  const meta = await readJsonFile<ProductMasterMeta>(paths.metaPath);
  try {
    const stat = await fs.promises.stat(paths.rawPath);
    const index = await loadProductMasterIndex();
    return {
      exists: true,
      fileMtimeMs: stat.mtimeMs,
      indexBuiltAt: meta?.indexBuiltAt,
      rawPath: paths.rawPath,
      rawSourcePath: meta?.rawSourcePath,
      rawSize: stat.size,
      recordCount: index.records.length,
      schemaVersion: meta?.schemaVersion || PRODUCT_MASTER_SCHEMA_VERSION,
    };
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
    return {
      exists: false,
      fileMtimeMs: 0,
      indexBuiltAt: meta?.indexBuiltAt,
      rawPath: paths.rawPath,
      rawSourcePath: meta?.rawSourcePath,
      rawSize: 0,
      recordCount: 0,
      schemaVersion: meta?.schemaVersion || PRODUCT_MASTER_SCHEMA_VERSION,
    };
  }
}

export async function refreshProductMasterIndex() {
  const paths = getProductMasterRuntimePaths();
  await ensureDirectory(paths.dataDir);

  if (!fs.existsSync(paths.rawPath)) {
    return {
      rawPath: paths.rawPath,
      refreshed: false,
      recordCount: 0,
    };
  }

  const rawStat = await fs.promises.stat(paths.rawPath);
  const serialized = await buildSerializedIndexSafely(
    paths.rawPath,
    rawStat.mtimeMs,
  );

  await writeJsonAtomic(paths.indexPath, serialized);
  await writeJsonAtomic(paths.metaPath, {
    indexBuiltAt: new Date().toISOString(),
    indexRawFileMtimeMs: rawStat.mtimeMs,
    indexRecordCount: serialized.records.length,
    rawFileMtimeMs: rawStat.mtimeMs,
    rawFileSize: rawStat.size,
    rawSourcePath: paths.rawPath,
    schemaVersion: PRODUCT_MASTER_SCHEMA_VERSION,
  } satisfies ProductMasterMeta);

  cachedIndex = {
    key: getCacheKey(paths.rawPath, rawStat.mtimeMs),
    value: hydrateIndex(serialized),
  };

  return {
    rawPath: paths.rawPath,
    refreshed: true,
    recordCount: serialized.records.length,
  };
}

export async function importProductMasterJson(
  fileBuffer: Buffer,
  sourceName = 'manual-upload.json',
) {
  const paths = getProductMasterRuntimePaths();
  await ensureDirectory(paths.dataDir);

  const payload = await parseProductMasterFile(fileBuffer, sourceName);

  await writeJsonAtomic(paths.rawPath, payload);
  const rawStat = await fs.promises.stat(paths.rawPath);
  const serialized = await buildSerializedIndexSafely(
    paths.rawPath,
    rawStat.mtimeMs,
  );

  await writeJsonAtomic(paths.indexPath, serialized);
  await writeJsonAtomic(paths.metaPath, {
    indexBuiltAt: new Date().toISOString(),
    indexRawFileMtimeMs: rawStat.mtimeMs,
    indexRecordCount: serialized.records.length,
    rawCopiedAt: new Date().toISOString(),
    rawFileMtimeMs: rawStat.mtimeMs,
    rawFileSize: rawStat.size,
    rawSourcePath: sourceName,
    schemaVersion: PRODUCT_MASTER_SCHEMA_VERSION,
  } satisfies ProductMasterMeta);

  cachedIndex = {
    key: getCacheKey(paths.rawPath, rawStat.mtimeMs),
    value: hydrateIndex(serialized),
  };

  return {
    rawPath: paths.rawPath,
    recordCount: serialized.records.length,
  };
}

export async function clearProductMaster() {
  const paths = getProductMasterRuntimePaths();
  const targets = [paths.rawPath, paths.indexPath, paths.metaPath];

  await Promise.all(
    targets.map(async (filePath) => {
      try {
        await fs.promises.rm(filePath, { force: true });
      } catch {}
    }),
  );

  cachedIndex = null;
  pendingLoad = null;

  return {
    cleared: true,
    rawPath: paths.rawPath,
  };
}

function getCellText(value: unknown) {
  if (value == null) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('text' in (value as any) && typeof (value as any).text === 'string') {
      return String((value as any).text).trim();
    }
    if ('result' in (value as any) && (value as any).result != null) {
      return String((value as any).result).trim();
    }
    if ('richText' in (value as any) && Array.isArray((value as any).richText)) {
      return (value as any).richText.map((item: any) => item.text || '').join('').trim();
    }
  }
  return String(value).trim();
}

function buildRetailPrice(row: Record<string, string>) {
  return (
    toNumber(row['淘宝闪购零售价（元）']) ??
    toNumber(row['美团零售价（元）']) ??
    toNumber(row['京东零售价（元）']) ??
    null
  );
}

async function parseProductMasterExcel(fileBuffer: Buffer, sourceName: string) {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(fileBuffer);
  const worksheet = workbook.worksheets[0];

  if (!worksheet) {
    throw new Error('Excel 文件中没有工作表');
  }

  const headerRow = worksheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headers[colNumber - 1] = getCellText(cell.value);
  });

  const requiredHeaders = [
    '仓库/门店名称',
    '仓库/门店编码',
    '供应商名称',
    '供应商编码',
    '商品名称',
    '商品编码',
    '商品条码',
    '规格',
    '箱规',
  ];

  const missingHeaders = requiredHeaders.filter((header) => !headers.includes(header));
  if (missingHeaders.length > 0) {
    throw new Error(`商品总表 Excel 缺少必要字段: ${missingHeaders.join('、')}`);
  }

  const rows: ProductMasterRecord[] = [];

  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber++) {
    const row = worksheet.getRow(rowNumber);
    const rowData: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (!header) return;
      rowData[header] = getCellText(row.getCell(index + 1).value);
    });

    const upc = rowData['商品条码'];
    const sku = rowData['商品编码'];
    const productName = rowData['商品名称'];
    if (!upc && !sku && !productName) continue;

    const procurementCost = toNumber(rowData['采购价(门店采购价)']);
    const retailPrice = buildRetailPrice(rowData);
    const storeRecord: ProductMasterStoreRecord = {
      aoxiangConversionFactor: toNumber(rowData['换算系数（翱象）']) ?? 1,
      baseUnit: rowData['单位类型'] === '最小单位' ? rowData['单位'] : '',
      cartonSize: rowData['箱规'],
      currentRetailPrice: retailPrice,
      procurementCost,
      purchaseUnit: rowData['单位'],
      sourceFile: sourceName,
      sourceUpdatedAt: rowData['更新时间'],
      status: rowData['补货状态'],
      storeCode: rowData['仓库/门店编码'],
      storeName: rowData['仓库/门店名称'],
      storeSku: sku,
      suggestedRetailPrice: retailPrice,
      supplierCode: rowData['供应商编码'],
      supplierName: rowData['供应商名称'],
      supplierProductCode: rowData['供应商商品编码'],
      supplierProductLink: rowData['采购链接'],
      supplierProductName: rowData['供应商商品名称'],
      supplierProductSpec: rowData['供应商商品规格'],
    };

    rows.push({
      aoxiangConversionFactor: toNumber(rowData['换算系数（翱象）']) ?? 1,
      cartonSize: rowData['箱规'],
      currentRetailPrice: retailPrice,
      procurementCost,
      productName,
      sku,
      skuAliases: sku ? [sku] : [],
      specification: rowData['规格'],
      stores: [storeRecord],
      suggestedRetailPrice: retailPrice,
      upc,
    });
  }

  if (rows.length === 0) {
    throw new Error('商品总表 Excel 未解析到有效数据');
  }

  return rows;
}

async function parseProductMasterFile(fileBuffer: Buffer, sourceName: string) {
  if (/\.xlsx?$/i.test(sourceName)) {
    return await parseProductMasterExcel(fileBuffer, sourceName);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(fileBuffer.toString('utf8'));
  } catch {
    throw new Error('商品总表文件解析失败，请上传 JSON 或补货建议导出服务 Excel');
  }

  if (!Array.isArray(payload)) {
    throw new Error('商品总表 JSON 必须是数组格式');
  }

  return payload as ProductMasterRecord[];
}
