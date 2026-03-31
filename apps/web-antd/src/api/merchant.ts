import { requestClient } from '#/api/request';

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

type MerchantListResult = {
  items?: Merchant[];
  total?: number;
};

function normalizeMerchant(data: Partial<Merchant>): Merchant {
  return {
    ...data,
    address: `${data.address || ''}`.trim(),
    contact: `${data.contact || ''}`.trim(),
    id: `${data.id || ''}`.trim(),
    name: `${data.name || ''}`.trim(),
    phone: `${data.phone || ''}`.trim(),
    updatedAt: new Date().toISOString(),
  };
}

export async function getMerchantList(params?: any) {
  const query = params?.data ?? params ?? {};
  const result = await requestClient.get<MerchantListResult>('/merchant/list', {
    params: {
      name: `${query?.name || ''}`.trim(),
      page: query?.page || 1,
      pageSize: query?.pageSize || 1000,
    },
  });

  return Array.isArray(result?.items) ? result.items : [];
}

export async function addMerchant(data: Merchant) {
  const merchant = normalizeMerchant(data);
  return requestClient.post('/merchant/list', merchant);
}

export async function updateMerchant(data: Merchant) {
  const merchant = normalizeMerchant(data);
  if (!merchant.id) {
    throw new Error('商户ID不能为空');
  }
  return requestClient.put('/merchant/list', merchant);
}

export async function deleteMerchant(id: string) {
  if (!`${id || ''}`.trim()) {
    throw new Error('商户ID不能为空');
  }

  return requestClient.delete('/merchant/list', {
    params: { id },
  });
}
