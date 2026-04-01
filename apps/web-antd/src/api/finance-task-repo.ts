import type { UploadFile } from 'ant-design-vue';

export type FinanceTaskStatus = 'draft' | 'ready' | 'regenerating';
export type FinanceTaskSource = 'manual' | 'regenerate';
export type FinanceTaskFileKind =
  | 'aoxiang'
  | 'eleme_promo'
  | 'meituan_promo'
  | 'qianniuhua';

export interface FinanceTaskRecord {
  createdAt: string;
  id: string;
  month: string;
  notes?: string;
  reportFileName?: string;
  reportRelativePath?: string;
  source: FinanceTaskSource;
  status: FinanceTaskStatus;
  storeName: string;
  taskName: string;
  updatedAt: string;
}

export interface FinanceTaskFileRecord {
  blob: Blob;
  id: string;
  kind: FinanceTaskFileKind;
  lastModified: number;
  name: string;
  size: number;
  taskId: string;
  type: string;
  updatedAt: string;
}

type StoreName = 'finance_task_files' | 'finance_tasks';

const DB_NAME = 'finance-workbench-db';
const DB_VERSION = 1;
const STORE_KEYS: Record<StoreName, string> = {
  finance_task_files: 'id',
  finance_tasks: 'id',
};
const STORE_NAMES: StoreName[] = ['finance_tasks', 'finance_task_files'];

let dbPromise: null | Promise<IDBDatabase> = null;

function ensureIndexedDb() {
  if (typeof indexedDB === 'undefined') {
    throw new Error('当前环境不支持 IndexedDB');
  }
}

function createTaskId() {
  return `finance_task_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

function openDatabase(): Promise<IDBDatabase> {
  ensureIndexedDb();
  if (dbPromise) return dbPromise;

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
  transaction.objectStore(storeName).put(item as any);
  await transactionDone(transaction);
}

async function deleteOne(storeName: StoreName, key: IDBValidKey): Promise<void> {
  const db = await openDatabase();
  const transaction = db.transaction(storeName, 'readwrite');
  transaction.objectStore(storeName).delete(key);
  await transactionDone(transaction);
}

export async function listFinanceTasks() {
  const list = await getAll<FinanceTaskRecord>('finance_tasks');
  return list.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function saveFinanceTask(task: Partial<FinanceTaskRecord>) {
  const now = new Date().toISOString();
  const normalized: FinanceTaskRecord = {
    createdAt: task.createdAt || now,
    id: task.id || createTaskId(),
    month: `${task.month || ''}`.trim(),
    notes: `${task.notes || ''}`.trim() || undefined,
    reportFileName: `${task.reportFileName || ''}`.trim() || undefined,
    reportRelativePath: `${task.reportRelativePath || ''}`.trim() || undefined,
    source: task.source || 'manual',
    status: task.status || 'draft',
    storeName: `${task.storeName || ''}`.trim(),
    taskName: `${task.taskName || ''}`.trim() || '财务任务',
    updatedAt: now,
  };

  await putOne('finance_tasks', normalized);
  return normalized;
}

export async function removeFinanceTask(taskId: string) {
  await deleteOne('finance_tasks', taskId);
  const files = await listFinanceTaskFiles(taskId);
  await Promise.all(files.map((file) => deleteOne('finance_task_files', file.id)));
}

export async function listFinanceTaskFiles(taskId: string) {
  const list = await getAll<FinanceTaskFileRecord>('finance_task_files');
  return list.filter((item) => item.taskId === taskId);
}

export async function replaceFinanceTaskFile(
  taskId: string,
  kind: FinanceTaskFileKind,
  file?: File | null,
) {
  const fileId = `${taskId}:${kind}`;
  if (!file) {
    await deleteOne('finance_task_files', fileId);
    return;
  }

  const record: FinanceTaskFileRecord = {
    blob: file,
    id: fileId,
    kind,
    lastModified: file.lastModified,
    name: file.name,
    size: file.size,
    taskId,
    type: file.type,
    updatedAt: new Date().toISOString(),
  };
  await putOne('finance_task_files', record);
}

export function buildUploadFile(record: FinanceTaskFileRecord): UploadFile {
  const file = new File([record.blob], record.name, {
    lastModified: record.lastModified,
    type: record.type,
  });

  return {
    lastModified: record.lastModified,
    name: record.name,
    originFileObj: file as any,
    size: record.size,
    status: 'done',
    type: record.type,
    uid: record.id,
  };
}
