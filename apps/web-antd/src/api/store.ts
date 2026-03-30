import {
  listStores,
  removeStore,
  saveStore,
  saveStores,
} from './system-settings-repo';

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

function includesIgnoreCase(value: string, keyword: string) {
  return value.toLowerCase().includes(keyword.toLowerCase());
}

export async function getStoreList(params: any) {
  const stores = await listStores();
  const query = params?.data ?? params ?? {};
  const storeName = `${query?.storeName || ''}`.trim();
  const storeId = `${query?.storeId || ''}`.trim();
  return stores.filter((item) => {
    const matchName = !storeName || includesIgnoreCase(item.storeName || '', storeName);
    const matchId = !storeId || includesIgnoreCase(item.storeId || '', storeId);
    return matchName && matchId;
  });
}

export async function addStore(data: Store) {
  return saveStore(normalizeStore(data));
}

export async function updateStore(data: Store) {
  const stores = await listStores();
  const storeKey = `${data.storeId || data.id || ''}`.trim();
  if (!storeKey) {
    throw new Error('店铺ID不能为空');
  }

  const existing = stores.find(
    (item) => item.storeId === storeKey || `${item.id || ''}`.trim() === storeKey,
  );

  const normalized = normalizeStore({
    ...(existing || {}),
    ...data,
    id: existing?.storeId || storeKey,
    storeId: existing?.storeId || storeKey,
  });

  return saveStore({
    ...(existing || {}),
    ...normalized,
  });
}

export async function deleteStore(id: string) {
  await removeStore(id);
  return listStores();
}

export async function addStores(data: Store[]) {
  const normalized = data
    .map((item) => normalizeStore(item))
    .filter((item) => item.storeId || item.storeName);
  await saveStores(normalized);
  return normalized;
}
