export interface Store {
  id: string;
  storeId: string;
  storeName: string;
  platform: string;
  region: string;
  address: string;
  contact: string;
  phone: string;
}

async function invokeIpc<T>(channel: string, ...args: any[]): Promise<T> {
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

export async function getStoreList(params: any) {
  return invokeIpc<Store[]>('get-stores', params);
}

export async function addStore(data: Store) {
  return invokeIpc('add-store', data);
}

export async function updateStore(data: Store) {
  return invokeIpc('update-store', data);
}

export async function deleteStore(id: string) {
  return invokeIpc('delete-store', { storeId: id });
}

export async function addStores(data: Store[]) {
  // Use Promise.all to simulate batch addition since only single add channel is provided
  // Or check if 'add-store' supports array. Assuming safer approach:
  return Promise.all(data.map(item => invokeIpc('add-store', item)));
}
