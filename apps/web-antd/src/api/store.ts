import { requestClient } from '#/api/request';

export interface Store {
  id: string;
  storeId: string;
  storeName: string;
  platform: string;
  region: string;
  address: string;
  contact: string;
  phone: string;
  merchantId?: string;
}

type StoreListResult = {
  items?: Store[];
  total?: number;
};

function createStoreId() {
  return `STORE_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

function normalizeStore(data: Partial<Store>): Store {
  const storeId = `${data.storeId || data.id || ''}`.trim() || createStoreId();
  return {
    address: `${data.address || ''}`.trim(),
    contact: `${data.contact || ''}`.trim(),
    id: storeId,
    merchantId: `${data.merchantId || ''}`.trim() || undefined,
    phone: `${data.phone || ''}`.trim(),
    platform: `${data.platform || ''}`.trim(),
    region: `${data.region || ''}`.trim(),
    storeId,
    storeName: `${data.storeName || ''}`.trim(),
  };
}

export async function getStoreList(params: any) {
  const query = params?.data ?? params ?? {};
  const result = await requestClient.get<StoreListResult>('/store/list', {
    params: {
      merchantId: `${query?.merchantId || ''}`.trim() || undefined,
      page: query?.page || 1,
      pageSize: query?.pageSize || 1000,
      storeId: `${query?.storeId || ''}`.trim(),
      storeName: `${query?.storeName || ''}`.trim(),
    },
  });

  return Array.isArray(result?.items) ? result.items : [];
}

export async function addStore(data: Store) {
  return requestClient.post('/store/list', normalizeStore(data));
}

export async function updateStore(data: Store) {
  const store = normalizeStore(data);
  if (!`${store.storeId || ''}`.trim()) {
    throw new Error('店铺ID不能为空');
  }

  return requestClient.put('/store/list', store);
}

export async function deleteStore(id: string) {
  if (!`${id || ''}`.trim()) {
    throw new Error('店铺ID不能为空');
  }

  return requestClient.delete('/store/list', {
    params: { storeId: id },
  });
}

export async function addStores(data: Store[]) {
  const normalized = data
    .map((item) => normalizeStore(item))
    .filter((item) => item.storeId || item.storeName);

  return requestClient.post('/store/list', normalized);
}
