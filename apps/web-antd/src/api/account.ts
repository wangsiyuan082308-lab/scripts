import { requestClient } from '#/api/request';

export interface Account {
  id: string;
  phone: string;
  username: string;
  realName: string;
  status: string;
  roleCode: string;
  merchantIds: string[];
  merchantNames: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface AccountForm {
  id?: string;
  phone?: string;
  username: string;
  realName: string;
  password?: string;
  status: string;
  roleCode: string;
  merchantIds: string[];
}

type AccountListResult = {
  items?: Account[];
  total?: number;
};

export async function getAccountList(params?: any) {
  const query = params?.data ?? params ?? {};
  const result = await requestClient.get<AccountListResult>('/account/list', {
    params: {
      keyword: `${query?.keyword || ''}`.trim(),
      phone: `${query?.phone || ''}`.trim(),
      page: query?.page || 1,
      pageSize: query?.pageSize || 1000,
      status: `${query?.status || ''}`.trim(),
      username: `${query?.username || ''}`.trim(),
    },
  });

  return Array.isArray(result?.items) ? result.items : [];
}

export async function addAccount(data: AccountForm) {
  return requestClient.post('/account/list', {
    ...data,
    merchantIds: Array.isArray(data.merchantIds) ? data.merchantIds : [],
  });
}

export async function updateAccount(data: AccountForm) {
  if (!`${data.id || ''}`.trim()) {
    throw new Error('账户ID不能为空');
  }

  return requestClient.put('/account/list', {
    ...data,
    merchantIds: Array.isArray(data.merchantIds) ? data.merchantIds : [],
  });
}

export async function deleteAccount(id: string) {
  if (!`${id || ''}`.trim()) {
    throw new Error('账户ID不能为空');
  }

  return requestClient.delete('/account/list', {
    params: { id },
  });
}
