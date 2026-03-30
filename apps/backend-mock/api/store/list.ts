import { defineEventHandler, getQuery, readBody } from 'h3';

interface Store {
  storeId: string;
  storeName: string;
  platform: 'Aoxiang' | 'Qianniuhua';
  address: string;
  contact: string;
}

let stores: Store[] = [
  {
    storeId: 'S001',
    storeName: 'Aoxiang Flagship',
    platform: 'Aoxiang',
    address: '123 Tech Blvd',
    contact: 'Alice',
  },
  {
    storeId: 'S002',
    storeName: 'Qianniuhua Outlet',
    platform: 'Qianniuhua',
    address: '456 Market St',
    contact: 'Bob',
  },
  {
    storeId: 'S003',
    storeName: '安吉测试门店',
    platform: 'Aoxiang',
    address: 'Anji County',
    contact: 'Charlie',
  },
  {
    storeId: 'S004',
    storeName: '江北测试门店',
    platform: 'Qianniuhua',
    address: 'Jiangbei District',
    contact: 'David',
  },
  {
    storeId: 'S005',
    storeName: '长兴测试门店',
    platform: 'Aoxiang',
    address: 'Changxing County',
    contact: 'Eve',
  },
];

export default defineEventHandler(async (event) => {
  const method = event.method;

  if (method === 'GET') {
    const query = getQuery(event);
    const { page = 1, pageSize = 10, storeName, storeId } = query;
    
    let filtered = stores;
    if (storeName) {
      filtered = filtered.filter((s) => s.storeName.includes(storeName as string));
    }
    if (storeId) {
      filtered = filtered.filter((s) => s.storeId.includes(storeId as string));
    }

    const start = (Number(page) - 1) * Number(pageSize);
    const end = start + Number(pageSize);
    const list = filtered.slice(start, end);

    return {
      code: 0,
      data: {
        items: list,
        total: filtered.length,
      },
      message: 'success',
    };
  }

  if (method === 'POST') {
    const body = await readBody(event);
    if (Array.isArray(body)) {
       const newStores = body.map((s: any) => ({
        ...s,
        // If storeId is missing, generate one
        storeId: s.storeId || `S${Date.now()}`,
      }));
      stores = [...stores, ...newStores];
      return { code: 0, data: newStores.length, message: 'Import success' };
    } else {
      const newStore = {
        ...body,
        storeId: body.storeId || `S${Date.now()}`,
      };
      stores.push(newStore);
      return { code: 0, data: newStore, message: 'Add success' };
    }
  }

  if (method === 'DELETE') {
    const query = getQuery(event);
    const storeId = query.storeId as string;
    stores = stores.filter((s) => s.storeId !== storeId);
    return { code: 0, data: null, message: 'Delete success' };
  }
});
