import { requestClient } from './request';

export interface Merchant {
  id: string;
  name: string;
  contact?: string;
  phone?: string;
  address?: string;
  status?: number | string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: any;
}

function createMerchantId() {
  return `M${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, '0')}`;
}

function normalizeMerchant(data: Partial<Merchant>): Merchant {
  const id = (data.id || '').trim() || createMerchantId();
  return {
    ...data,
    address: (data.address || '').trim(),
    contact: (data.contact || '').trim(),
    id,
    name: (data.name || '').trim(),
    phone: (data.phone || '').trim(),
    updatedAt: new Date().toISOString(),
  };
}

function includesIgnoreCase(value: string, keyword: string) {
  return value.toLowerCase().includes(keyword.toLowerCase());
}

export async function getMerchantList(params?: any) {
  const query = params?.data ?? params ?? {};
  const response = await requestClient.get<{ items: Merchant[]; total: number }>(
    '/merchant/list',
    {
      params: {
        page: 1,
        pageSize: 500,
        ...query,
      },
    },
  );
  const merchants = response.items || [];
  const keyword = `${query?.name || ''}`.trim();
  if (!keyword) {
    return merchants;
  }

  return merchants.filter((item) => includesIgnoreCase(item.name || '', keyword));
}

export async function addMerchant(data: Merchant) {
  const merchant = normalizeMerchant(data);
  return requestClient.post<Merchant>('/merchant/list', {
    ...merchant,
    createdAt: merchant.createdAt || new Date().toISOString(),
  });
}

export async function updateMerchant(data: Merchant) {
  if (!data?.id) {
    throw new Error('商户ID不能为空');
  }
  const existing = (await getMerchantList()).find((item) => item.id === data.id);
  return requestClient.put<Merchant>('/merchant/list', {
    ...(existing || {}),
    ...normalizeMerchant(data),
    createdAt: existing?.createdAt || data.createdAt || new Date().toISOString(),
  });
}

export async function deleteMerchant(id: string) {
  await requestClient.delete<boolean>('/merchant/list', {
    params: { id },
  });
  return getMerchantList();
}
