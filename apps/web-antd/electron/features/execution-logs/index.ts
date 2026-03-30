import fs from 'node:fs/promises';
import path from 'node:path';

import { ensureRuntimeDir } from '../../shared/runtime-paths';

export interface ExecutionLogQuery {
  date?: string;
}

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

const ELEME_LOG_PATTERN = /^activity_(\d{8})\.log$/u;
const WITHDRAWAL_LOG_PATTERN = /^app_(\d{8})\.json$/u;

function normalizeDate(value?: string) {
  if (!value) return '';
  const matched = value.match(/\d{8}/u);
  return matched?.[0] || '';
}

async function safeReadDir(dirPath: string) {
  try {
    return await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function safeReadFile(filePath: string) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

function getElemeLogDirs() {
  const appRoot = process.env.APP_ROOT || process.cwd();
  return [
    path.join(appRoot, 'electron', 'features', 'eleme-activity', 'logs'),
    path.join(appRoot, 'dist-electron', 'features', 'eleme-activity', 'logs'),
  ];
}

function getWithdrawalLogDir() {
  return ensureRuntimeDir('product-master', 'logs');
}

function buildDetail(parts: Array<null | string | undefined>) {
  return parts
    .map((item) => `${item || ''}`.trim())
    .filter(Boolean)
    .join(' | ');
}

function stringifyExtra(data: unknown) {
  if (data === undefined || data === null || data === '') {
    return '';
  }
  if (typeof data === 'string') {
    return data;
  }
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

function parseElemeLine(line: string, index: number): ExecutionLogItem | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    const entry = JSON.parse(trimmed) as {
      data?: unknown;
      level?: string;
      message?: string;
      timestamp?: string;
    };
    const time = entry.timestamp || '';
    const message = entry.message || '活动执行日志';
    const result = (entry.level || 'INFO').toUpperCase();
    return {
      id: `activity_${time}_${index}_${message}`,
      time,
      source: '活动',
      action: message,
      result,
      detail: stringifyExtra(entry.data),
    };
  } catch {
    return {
      id: `activity_raw_${index}_${trimmed.slice(0, 20)}`,
      time: '',
      source: '活动',
      action: '原始日志',
      result: 'INFO',
      detail: trimmed,
    };
  }
}

function parseWithdrawalLine(line: string, index: number): ExecutionLogItem | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    const entry = JSON.parse(trimmed) as {
      code?: string;
      level?: string;
      message?: string;
      module?: string;
      reason?: string;
      stage?: string;
      store?: string;
      timestamp?: string;
    };
    const time = entry.timestamp || '';
    const action = entry.module || 'withdrawal';
    const result = (entry.level || 'INFO').toUpperCase();
    return {
      id: `withdrawal_${time}_${index}_${action}`,
      time,
      source: '提现',
      action,
      result,
      detail: buildDetail([
        entry.store ? `门店: ${entry.store}` : '',
        entry.message,
        entry.stage ? `阶段: ${entry.stage}` : '',
        entry.reason ? `原因: ${entry.reason}` : '',
        entry.code ? `编码: ${entry.code}` : '',
      ]),
    };
  } catch {
    return {
      id: `withdrawal_raw_${index}_${trimmed.slice(0, 20)}`,
      time: '',
      source: '提现',
      action: '原始日志',
      result: 'INFO',
      detail: trimmed,
    };
  }
}

async function readLogItemsFromFile(
  filePath: string,
  parser: (line: string, index: number) => ExecutionLogItem | null,
) {
  const content = await safeReadFile(filePath);
  if (!content) return [];

  return content
    .split(/\r?\n/u)
    .map((line, index) => parser(line, index))
    .filter((item): item is ExecutionLogItem => Boolean(item));
}

async function collectElemeDates() {
  const dates = new Set<string>();
  for (const dirPath of getElemeLogDirs()) {
    const files = await safeReadDir(dirPath);
    for (const file of files) {
      if (!file.isFile()) continue;
      const matched = file.name.match(ELEME_LOG_PATTERN);
      if (matched) {
        dates.add(matched[1]);
      }
    }
  }
  return dates;
}

async function collectWithdrawalDates() {
  const dates = new Set<string>();
  const files = await safeReadDir(getWithdrawalLogDir());
  for (const file of files) {
    if (!file.isFile()) continue;
    const matched = file.name.match(WITHDRAWAL_LOG_PATTERN);
    if (matched) {
      dates.add(matched[1]);
    }
  }
  return dates;
}

async function loadElemeLogsByDate(date: string) {
  const items: ExecutionLogItem[] = [];
  for (const dirPath of getElemeLogDirs()) {
    const filePath = path.join(dirPath, `activity_${date}.log`);
    items.push(...(await readLogItemsFromFile(filePath, parseElemeLine)));
  }
  return items;
}

async function loadWithdrawalLogsByDate(date: string) {
  const filePath = path.join(getWithdrawalLogDir(), `app_${date}.json`);
  return readLogItemsFromFile(filePath, parseWithdrawalLine);
}

function dedupeLogs(items: ExecutionLogItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = [item.source, item.time, item.action, item.result, item.detail].join('::');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function getExecutionLogs(
  query: ExecutionLogQuery = {},
): Promise<ExecutionLogResponse> {
  const allDates = new Set<string>([
    ...(await collectElemeDates()),
    ...(await collectWithdrawalDates()),
  ]);
  const files = Array.from(allDates).sort((left, right) => right.localeCompare(left));
  const selectedDate = normalizeDate(query.date) || files[0];

  if (!selectedDate) {
    return {
      files,
      list: [],
      total: 0,
    };
  }

  const [elemeLogs, withdrawalLogs] = await Promise.all([
    loadElemeLogsByDate(selectedDate),
    loadWithdrawalLogsByDate(selectedDate),
  ]);

  const list = dedupeLogs([...elemeLogs, ...withdrawalLogs]).sort((left, right) =>
    (right.time || '').localeCompare(left.time || ''),
  );

  return {
    files,
    list,
    selectedDate,
    total: list.length,
  };
}
