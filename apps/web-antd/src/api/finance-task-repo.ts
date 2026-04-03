import type { UploadFile } from 'ant-design-vue';

import { requestClient } from './request';

export type FinanceTaskStatus = 'draft' | 'ready' | 'regenerating';
export type FinanceTaskSource = 'manual' | 'regenerate';
export type FinanceTaskFileKind =
  | 'aoxiang'
  | 'eleme_promo'
  | 'meituan_promo'
  | 'qianniuhua';

export interface FinanceTaskRecord {
  anjiMtOrders?: number;
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
  fileBase64: string;
  id: string;
  kind: FinanceTaskFileKind;
  lastModified: number;
  name: string;
  size: number;
  taskId: string;
  type: string;
  updatedAt: string;
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = '';

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  return btoa(binary);
}

function base64ToBlob(base64: string, type: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new Blob([bytes], { type });
}

export async function listFinanceTasks() {
  return requestClient.get<FinanceTaskRecord[]>('/finance/tasks');
}

export async function saveFinanceTask(task: Partial<FinanceTaskRecord>) {
  const payload = {
    anjiMtOrders: task.anjiMtOrders,
    month: `${task.month || ''}`.trim(),
    notes: `${task.notes || ''}`.trim() || undefined,
    reportFileName: `${task.reportFileName || ''}`.trim() || undefined,
    reportRelativePath: `${task.reportRelativePath || ''}`.trim() || undefined,
    source: task.source || 'manual',
    status: task.status || 'draft',
    storeName: `${task.storeName || ''}`.trim(),
    taskName: `${task.taskName || ''}`.trim() || '财务任务',
  };

  if (`${task.id || ''}`.trim()) {
    return requestClient.put<FinanceTaskRecord>(`/finance/tasks/${task.id}`, payload);
  }

  return requestClient.post<FinanceTaskRecord>('/finance/tasks', payload);
}

export async function removeFinanceTask(taskId: string) {
  await requestClient.delete<boolean>(`/finance/tasks/${taskId}`);
}

export async function removeFinanceTasks(taskIds: string[]) {
  const uniqueTaskIds = Array.from(new Set(taskIds.filter(Boolean)));
  await Promise.all(uniqueTaskIds.map((taskId) => removeFinanceTask(taskId)));
}

export async function listFinanceTaskFiles(taskId: string) {
  return requestClient.get<FinanceTaskFileRecord[]>(`/finance/tasks/${taskId}/files`);
}

export async function replaceFinanceTaskFile(
  taskId: string,
  kind: FinanceTaskFileKind,
  file?: File | null,
) {
  if (!file) {
    await requestClient.delete<boolean>(`/finance/tasks/${taskId}/files/${kind}`);
    return;
  }

  await requestClient.put<boolean>(`/finance/tasks/${taskId}/files/${kind}`, {
    fileBase64: arrayBufferToBase64(await file.arrayBuffer()),
    lastModified: file.lastModified,
    name: file.name,
    size: file.size,
    type: file.type,
  });
}

export function buildUploadFile(record: FinanceTaskFileRecord): UploadFile {
  const blob = base64ToBlob(record.fileBase64, record.type);
  const file = new File([blob], record.name, {
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
