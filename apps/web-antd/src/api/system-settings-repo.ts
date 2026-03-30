export interface MerchantRecord {
  id: string;
  name: string;
  contact?: string;
  phone?: string;
  address?: string;
  status?: number;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: any;
}

export interface SupplierRecord {
  supplierId: string;
  supplierName: string;
  contact?: string;
  phone?: string;
  address?: string;
  type?: string;
  status?: string;
  minOrder?: string;
  settlementType?: string;
  [key: string]: any;
}

export interface StoreRecord {
  id: string;
  storeId: string;
  storeName: string;
  platform?: string;
  region?: string;
  address?: string;
  contact?: string;
  phone?: string;
  [key: string]: any;
}

type StoreName = 'merchants' | 'stores' | 'suppliers';

const DB_NAME = 'system-settings-db';
const DB_VERSION = 1;
const STORE_NAMES: StoreName[] = ['merchants', 'stores', 'suppliers'];
const STORE_KEYS: Record<StoreName, string> = {
  merchants: 'id',
  stores: 'storeId',
  suppliers: 'supplierId',
};

let dbPromise: null | Promise<IDBDatabase> = null;

function ensureIndexedDb() {
  if (typeof indexedDB === 'undefined') {
    throw new Error('当前环境不支持 IndexedDB');
  }
}

function openDatabase(): Promise<IDBDatabase> {
  ensureIndexedDb();
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      for (const storeName of STORE_NAMES) {
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: STORE_KEYS[storeName] });
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB 打开失败'));
  });

  return dbPromise;
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB 请求失败'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB 事务中止'));
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB 事务失败'));
  });
}

async function getAll<T>(storeName: StoreName): Promise<T[]> {
  const db = await openDatabase();
  const transaction = db.transaction(storeName, 'readonly');
  const store = transaction.objectStore(storeName);
  const list = await requestToPromise(store.getAll() as IDBRequest<T[]>);
  await transactionDone(transaction);
  return list;
}

async function putOne<T>(storeName: StoreName, item: T): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(storeName, 'readwrite');
  const store = transaction.objectStore(storeName);
  store.put(item as any);
  await transactionDone(transaction);
}

async function putMany<T>(storeName: StoreName, items: T[]): Promise<void> {
  if (items.length === 0) return;
  const db = await openDatabase();
  const transaction = db.transaction(storeName, 'readwrite');
  const store = transaction.objectStore(storeName);
  for (const item of items) {
    store.put(item as any);
  }
  await transactionDone(transaction);
}

async function deleteOne(storeName: StoreName, key: IDBValidKey): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(storeName, 'readwrite');
  const store = transaction.objectStore(storeName);
  store.delete(key);
  await transactionDone(transaction);
}

export async function listMerchants() {
  return getAll<MerchantRecord>('merchants');
}

export async function saveMerchant(item: MerchantRecord) {
  await putOne('merchants', item);
  return item;
}

export async function saveMerchants(items: MerchantRecord[]) {
  await putMany('merchants', items);
  return items;
}

export async function removeMerchant(id: string) {
  await deleteOne('merchants', id);
}

export async function listSuppliers() {
  return getAll<SupplierRecord>('suppliers');
}

export async function saveSupplier(item: SupplierRecord) {
  await putOne('suppliers', item);
  return item;
}

export async function saveSuppliers(items: SupplierRecord[]) {
  await putMany('suppliers', items);
  return items;
}

export async function removeSupplier(supplierId: string) {
  await deleteOne('suppliers', supplierId);
}

export async function listStores() {
  return getAll<StoreRecord>('stores');
}

export async function saveStore(item: StoreRecord) {
  await putOne('stores', item);
  return item;
}

export async function saveStores(items: StoreRecord[]) {
  await putMany('stores', items);
  return items;
}

export async function removeStore(storeId: string) {
  await deleteOne('stores', storeId);
}
