import { requestClient } from './request';

export interface ExecutionLogItem {
  action: string;
  detail: string;
  id: string;
  result: string;
  source: string;
  time: string;
}

export interface ExecutionLogResponse {
  files: string[];
  list: ExecutionLogItem[];
  selectedDate?: string;
  total: number;
}

interface ExecutionLogQuery {
  date?: string;
}

function isElectron() {
  return typeof window !== 'undefined' && window.ipcRenderer !== undefined;
}

function normalizeRemoteLogItem(item: Record<string, any>, index: number): ExecutionLogItem {
  return {
    id: String(item.id ?? `remote-log-${index}`),
    time: String(item.time ?? ''),
    source: '活动',
    action: String(item.action ?? '执行日志'),
    result: String(item.result ?? 'INFO'),
    detail: String(item.detail ?? ''),
  };
}

export async function getExecutionLogs(
  params: ExecutionLogQuery = {},
): Promise<ExecutionLogResponse> {
  if (isElectron()) {
    return window.ipcRenderer.invoke('get-execution-logs', params);
  }

  const response = await requestClient.get<any>('/eleme/logs', { params });
  const list = Array.isArray(response?.list)
    ? response.list.map((item: Record<string, any>, index: number) =>
        normalizeRemoteLogItem(item, index),
      )
    : [];

  return {
    files: Array.isArray(response?.files) ? response.files : [],
    list,
    total: response?.total ?? list.length,
  };
}
