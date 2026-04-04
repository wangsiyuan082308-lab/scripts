import { requestClient } from '#/api/request';
import { arrayBufferToBase64, readFileAsBuffer } from '#/utils/file';

export interface ProductMasterListItem {
  aoxiangConversionFactor?: null | number;
  baseUnitProcurementCost?: null | number;
  cartonProcurementCost?: null | number;
  cartonSize?: string;
  currentRetailPrice?: null | number;
  hasStorePriceVariance?: boolean;
  priceVarianceReason?: string;
  primaryStoreNames: string[];
  primarySupplierNames: string[];
  procurementCost?: null | number;
  productName: string;
  sku: string;
  specification: string;
  storeCount: number;
  supplierCount: number;
  upc: string;
}

export interface FilterOption {
  label: string;
  value: string;
}

export interface ProductMasterStatus {
  exists: boolean;
  fileMtimeMs: number;
  indexBuiltAt?: string;
  rawPath: string;
  rawSize: number;
  rawSourcePath?: string;
  recordCount: number;
  schemaVersion: number;
  versionTag: string;
}

export interface ProductMasterRecordMutation {
  cartonSize?: string;
  currentRetailPrice?: null | number;
  originalUpc: string;
  procurementCost?: null | number;
  productName: string;
  sku: string;
  specification: string;
  upc: string;
}

type ProductMasterListResult = {
  items?: ProductMasterListItem[];
  page?: number;
  pageSize?: number;
  total?: number;
  versionTag?: string;
};

type ProductMasterLookupResult = {
  items?: ProductMasterListItem[];
  total?: number;
};

type ProductMasterFilterOptions = {
  storeOptions?: FilterOption[];
  supplierOptions?: FilterOption[];
};

export interface ProductMasterListQuery {
  hasStorePriceVariance?: string;
  page?: number;
  pageSize?: number;
  productName?: string;
  storeNames?: string[];
  supplierNames?: string[];
  upc?: string;
}

export interface ProductMasterListPageResult {
  items: ProductMasterListItem[];
  page: number;
  pageSize: number;
  total: number;
  versionTag?: string;
}

type CacheEntry<T> = {
  expireAt: number;
  value: T;
};

const PRODUCT_MASTER_CACHE_TTL_MS = 15_000;
let productMasterStatusCache: CacheEntry<ProductMasterStatus> | null = null;
let productMasterFilterOptionsCache: CacheEntry<ProductMasterFilterOptions> | null =
  null;
const productMasterListCache = new Map<
  string,
  CacheEntry<ProductMasterListPageResult>
>();

function getCachedValue<T>(entry: CacheEntry<T> | null) {
  if (!entry || entry.expireAt <= Date.now()) {
    return null;
  }
  return entry.value;
}

function clearProductMasterCache() {
  productMasterStatusCache = null;
  productMasterFilterOptionsCache = null;
  productMasterListCache.clear();
}

export async function getProductMasterStatus() {
  const cached = getCachedValue(productMasterStatusCache);
  if (cached) {
    return cached;
  }
  const result = await requestClient.get<ProductMasterStatus>('/product/master/status');
  productMasterStatusCache = {
    expireAt: Date.now() + PRODUCT_MASTER_CACHE_TTL_MS,
    value: result,
  };
  return result;
}

export async function getProductMasterFilterOptions() {
  const cached = getCachedValue(productMasterFilterOptionsCache);
  if (cached) {
    return cached;
  }
  const result = await requestClient.get<ProductMasterFilterOptions>(
    '/product/master/filter-options',
  );
  productMasterFilterOptionsCache = {
    expireAt: Date.now() + PRODUCT_MASTER_CACHE_TTL_MS,
    value: result,
  };
  return result;
}

export async function listProductMasterRecords(
  params?: ProductMasterListQuery,
): Promise<ProductMasterListPageResult> {
  const cacheKey = JSON.stringify(params || {});
  const cached = productMasterListCache.get(cacheKey);
  const cachedValue = getCachedValue(cached || null);
  if (cachedValue) {
    return cachedValue;
  }
  const result = await requestClient.get<ProductMasterListResult>(
    '/product/master/records',
    {
      params: params || {},
    },
  );
  const normalized = {
    items: Array.isArray(result?.items) ? result.items : [],
    page: result?.page || params?.page || 1,
    pageSize: result?.pageSize || params?.pageSize || 50,
    total: result?.total || 0,
    versionTag: result?.versionTag,
  };
  productMasterListCache.set(cacheKey, {
    expireAt: Date.now() + PRODUCT_MASTER_CACHE_TTL_MS,
    value: normalized,
  });
  return normalized;
}

export async function lookupProductMasterRecords(codes: string[]) {
  const result = await requestClient.post<ProductMasterLookupResult>(
    '/product/master/lookup',
    {
      codes,
    },
  );
  return Array.isArray(result?.items) ? result.items : [];
}

export async function refreshProductMaster() {
  const result = await requestClient.post<{
    rawPath: string;
    recordCount: number;
    refreshed: boolean;
  }>('/product/master/refresh');
  clearProductMasterCache();
  return result;
}

export async function updateProductMasterRecord(
  data: ProductMasterRecordMutation,
) {
  const result = await requestClient.put<ProductMasterRecordMutation>(
    '/product/master/records',
    data,
  );
  clearProductMasterCache();
  return result;
}

export async function deleteProductMasterRecord(upc: string) {
  const result = await requestClient.delete<{
    deleted: number;
    rawPath: string;
    recordCount: number;
  }>('/product/master/records', {
    params: { upc },
  });
  clearProductMasterCache();
  return result;
}

export async function importProductMaster(file: File) {
  const buffer = await readFileAsBuffer(file);
  const result = await requestClient.post<{ rawPath: string; recordCount: number }>(
    '/product/master/import',
    {
      fileBase64: arrayBufferToBase64(buffer),
      fileName: file.name,
    },
    {
      timeout: 120_000,
    },
  );
  clearProductMasterCache();
  return result;
}
