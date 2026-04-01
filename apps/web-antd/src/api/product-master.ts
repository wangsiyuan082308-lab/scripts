import { requestClient } from '#/api/request';
import { arrayBufferToBase64, readFileAsBuffer } from '#/utils/file';

export interface ProductMasterListItem {
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
  total?: number;
};

type ProductMasterFilterOptions = {
  storeOptions?: FilterOption[];
  supplierOptions?: FilterOption[];
};

export async function getProductMasterStatus() {
  return requestClient.get<ProductMasterStatus>('/product/master/status');
}

export async function getProductMasterFilterOptions() {
  return requestClient.get<ProductMasterFilterOptions>(
    '/product/master/filter-options',
  );
}

export async function listProductMasterRecords(params?: {
  hasStorePriceVariance?: string;
  productName?: string;
  storeNames?: string[];
  supplierNames?: string[];
  upc?: string;
}) {
  const result = await requestClient.get<ProductMasterListResult>(
    '/product/master/records',
    {
      params: params || {},
    },
  );
  return Array.isArray(result?.items) ? result.items : [];
}

export async function refreshProductMaster() {
  return requestClient.post<{
    rawPath: string;
    recordCount: number;
    refreshed: boolean;
  }>('/product/master/refresh');
}

export async function updateProductMasterRecord(
  data: ProductMasterRecordMutation,
) {
  return requestClient.put<ProductMasterRecordMutation>(
    '/product/master/records',
    data,
  );
}

export async function deleteProductMasterRecord(upc: string) {
  return requestClient.delete<{
    deleted: number;
    rawPath: string;
    recordCount: number;
  }>('/product/master/records', {
    params: { upc },
  });
}

export async function importProductMaster(file: File) {
  const buffer = await readFileAsBuffer(file);
  return requestClient.post<{ rawPath: string; recordCount: number }>(
    '/product/master/import',
    {
      fileBase64: arrayBufferToBase64(buffer),
      fileName: file.name,
    },
    {
      timeout: 120_000,
    },
  );
}
