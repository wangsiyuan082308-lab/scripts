export interface Merchant {
  id: string;
  name: string;
  contact?: string;
  phone?: string;
  address?: string;
  status?: number; // 0: inactive, 1: active
  createdAt?: string;
  updatedAt?: string;
  [key: string]: any;
}

async function invokeIpc<T>(channel: string, ...args: any[]): Promise<T> {
  // @ts-ignore
  const result = await window.ipcRenderer.invoke(channel, ...args);
  // Compatible with backend response structure { code: 0, data: ... }
  if (result && typeof result === 'object' && 'code' in result && 'data' in result) {
    if (result.code === 0) {
      return result.data;
    }
    throw new Error(result.message || 'IPC Operation Failed');
  }
  return result;
}

export async function getMerchantList(params?: any) {
  return invokeIpc<Merchant[]>('get-merchants', params);
}

export async function addMerchant(data: Merchant) {
  return invokeIpc('add-merchant', data);
}

export async function updateMerchant(data: Merchant) {
  return invokeIpc('update-merchant', data);
}

export async function deleteMerchant(id: string) {
  return invokeIpc('delete-merchant', id);
}
