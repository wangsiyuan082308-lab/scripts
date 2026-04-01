import { requestClient } from './request';

export interface Store {
  id: string;
  merchantName?: string;
  storeId: string;
  storeName: string;
  platform: string;
  region: string;
  address: string;
  contact: string;
  phone: string;
  merchantId?: string;
}

function createStoreId() {
  return `STORE_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

function normalizePlatform(value: string) {
  const normalized = `${value || ''}`.trim();
  if (normalized === '翱象' || normalized === 'Aoxiang') {
    return 'Aoxiang';
  }
  if (normalized === '牵牛花' || normalized === 'Qianniuhua') {
    return 'Qianniuhua';
  }
  return normalized;
}

function normalizeStore(data: Partial<Store>): Store {
  const storeId = `${data.storeId || data.id || ''}`.trim() || createStoreId();
  const id = `${data.id || ''}`.trim() || storeId;
  return {
    address: `${data.address || ''}`.trim(),
    contact: `${data.contact || ''}`.trim(),
    id,
    merchantId: `${data.merchantId || ''}`.trim() || undefined,
    merchantName: `${data.merchantName || ''}`.trim() || undefined,
    phone: `${data.phone || ''}`.trim(),
    platform: normalizePlatform(`${data.platform || ''}`),
    region: `${data.region || ''}`.trim(),
    storeId,
    storeName: `${data.storeName || ''}`.trim(),
  };
}

export async function getStoreList(params: any) {
  const query = params?.data ?? params ?? {};
  const response = await requestClient.get<{ items: Store[]; total: number }>(
    '/store/list',
    {
      params: {
        page: 1,
        pageSize: 500,
        ...query,
      },
    },
  );
  return (response.items || []).map((item) => normalizeStore(item));
}

export async function addStore(data: Store) {
  return requestClient.post<Store>('/store/list', normalizeStore(data));
}

export async function updateStore(data: Store) {
  const storeKey = `${data.storeId || data.id || ''}`.trim();
  if (!storeKey) {
    throw new Error('店铺ID不能为空');
  }
  return requestClient.put<Store>(
    '/store/list',
    normalizeStore({
      ...data,
      id: storeKey,
      storeId: storeKey,
    }),
  );
}

export async function deleteStore(id: string, merchantId?: string) {
  await requestClient.delete<boolean>('/store/list', {
    params: {
      merchantId,
      storeId: id,
    },
  });
  return true;
}

export async function addStores(data: Store[]) {
  const normalized = data
    .map((item) => normalizeStore(item))
    .filter((item) => item.storeId || item.storeName);
  await requestClient.post<number>('/store/list', normalized);
  return normalized;
}
