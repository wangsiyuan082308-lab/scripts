import fs from 'node:fs';
import path from 'node:path';

import { withdrawalTaskStorage } from '../../shared/storage';
import type { StorageUserContext } from '../../shared/storage';

import { getAutomationRuntimePaths } from './automation/config';

interface ParsedLogEntry {
  level: string;
  message: string;
  module: string;
  sessionId?: string;
  store?: string;
  taskId?: string;
  timestamp: string;
}

function parseLogLine(line: string): null | ParsedLogEntry {
  const content = line.trim();
  if (!content) return null;

  try {
    const parsed = JSON.parse(content);
    return {
      level: String(parsed.level || 'info').toLowerCase(),
      message: String(parsed.message || ''),
      module: String(parsed.module || ''),
      sessionId: parsed.sessionId ? String(parsed.sessionId) : undefined,
      store: parsed.store ? String(parsed.store) : undefined,
      taskId: parsed.taskId ? String(parsed.taskId) : undefined,
      timestamp: String(parsed.timestamp || ''),
    };
  } catch {
    return {
      level: 'info',
      message: content,
      module: '',
      timestamp: '',
    };
  }
}

export async function getWithdrawalTaskLogs(
  taskId: string,
  user?: StorageUserContext,
  limit = 200,
) {
  const tasks = await withdrawalTaskStorage.get(user);
  const task = tasks.find((item) => item.taskId === taskId || item.id === taskId);
  if (!task) {
    return { list: [] };
  }

  const paths = getAutomationRuntimePaths(task.merchantId);
  if (!fs.existsSync(paths.logsDir)) {
    return { list: [] };
  }

  const files = fs
    .readdirSync(paths.logsDir)
    .filter((file) => file.startsWith('app_') && file.endsWith('.jsonl'))
    .sort();

  const entries: ParsedLogEntry[] = [];
  for (const file of files) {
    const raw = fs.readFileSync(path.join(paths.logsDir, file), 'utf8');
    const lines = raw.split('\n');
    for (const line of lines) {
      const entry = parseLogLine(line);
      if (!entry || entry.taskId !== task.taskId) continue;
      entries.push(entry);
    }
  }

  entries.sort((a, b) => {
    const timeA = new Date(a.timestamp || 0).getTime();
    const timeB = new Date(b.timestamp || 0).getTime();
    return timeA - timeB;
  });

  return {
    list: entries.slice(-Math.max(1, Math.min(limit, 1000))),
  };
}
