import { requestClient } from './request';

export interface Account {
  id: string;
  merchantIds: string[];
  merchantNames: string[];
  phone: string;
  realName: string;
  roleCode: string;
  status: string;
  storeIds: string[];
  storeNames: string[];
  username: string;
}

export interface AccountPayload {
  id?: string;
  merchantIds?: string[];
  phone?: string;
  password?: string;
  realName?: string;
  roleCode?: string;
  status?: string;
  storeIds?: string[];
  username?: string;
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => `${item || ''}`.trim())
    .filter(Boolean);
}

function normalizeAccount(data: Partial<AccountPayload> & Partial<Account>): AccountPayload {
  return {
    id: `${data.id || ''}`.trim() || undefined,
    merchantIds: normalizeStringArray(data.merchantIds),
    password: `${data.password || ''}`.trim() || undefined,
    phone: `${data.phone || ''}`.trim(),
    realName: `${data.realName || ''}`.trim(),
    roleCode: `${data.roleCode || ''}`.trim() || 'merchant_admin',
    status: `${data.status || ''}`.trim() || 'active',
    storeIds: normalizeStringArray(data.storeIds),
    username: `${data.username || ''}`.trim(),
  };
}

export async function getAccountList(params?: any) {
  const query = params?.data ?? params ?? {};
  const response = await requestClient.get<{ items: Account[]; total: number }>(
    '/account/list',
    {
      params: {
        page: 1,
        pageSize: 500,
        ...query,
      },
    },
  );

  return response.items || [];
}

export async function addAccount(data: AccountPayload) {
  return requestClient.post<Account>('/account/list', normalizeAccount(data));
}

export async function updateAccount(data: AccountPayload) {
  if (!`${data.id || ''}`.trim()) {
    throw new Error('账户ID不能为空');
  }

  return requestClient.put<Account>('/account/list', normalizeAccount(data));
}

export async function deleteAccount(id: string) {
  await requestClient.delete<boolean>('/account/list', {
    params: { id },
  });
  return true;
}
