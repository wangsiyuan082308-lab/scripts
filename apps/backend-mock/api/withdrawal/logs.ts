import { defineEventHandler, getQuery } from 'h3';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const LOGS_DIR = join(
  process.env.HOME || '/Users/mac',
  '.openclaw/workspace/skills/eleme-auto-withdrawal/logs',
);

function parseLogLine(line: string) {
  // 尝试 JSON 格式 (app_*.json JSONL)
  try {
    const d = JSON.parse(line);
    return {
      timestamp: d.timestamp || '',
      level: (d.level || 'info').toLowerCase(),
      message: d.message || '',
      module: d.module || '',
      store: d.store || '',
    };
  } catch {}

  // 纯文本格式: [2026-02-20 06:00:11] 消息
  const match = line.match(/^\[(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\]\s*(.*)/);
  if (match) {
    const msg = match[2] || '';
    let level = 'info';
    if (msg.includes('❌') || msg.includes('失败') || msg.includes('error')) level = 'error';
    else if (msg.includes('⚠') || msg.includes('警告')) level = 'warn';
    else if (msg.includes('✅') || msg.includes('成功')) level = 'info';
    return { timestamp: match[1]!, level, message: msg, module: '', store: '' };
  }

  // 其他格式
  if (line.trim()) {
    return { timestamp: '', level: 'info', message: line.trim(), module: '', store: '' };
  }
  return null;
}

export default defineEventHandler((event) => {
  const query = getQuery(event);
  const file = query.file as string;
  const level = query.level as string;
  const limit = Math.min(Number(query.limit) || 500, 2000);

  if (!existsSync(LOGS_DIR)) {
    return { code: 0, data: { list: [], files: [] } };
  }

  try {
    // 列出所有日志文件（.log + app_*.json）
    const allFiles = readdirSync(LOGS_DIR).filter(
      (f) =>
        (f.startsWith('withdrawal_') && f.endsWith('.log')) ||
        (f.startsWith('app_') && f.endsWith('.json')),
    );
    const logFiles = allFiles.sort().reverse();

    const targetFile = file
      ? logFiles.find((f) => f === file)
      : logFiles[0];

    if (!targetFile) {
      return { code: 0, data: { list: [], files: logFiles } };
    }

    const raw = readFileSync(join(LOGS_DIR, targetFile), 'utf-8');
    const lines = raw.trim().split('\n').filter(Boolean);

    let entries = lines
      .map(parseLogLine)
      .filter((e): e is NonNullable<typeof e> => e !== null);

    // 收集门店列表
    const storeSet = new Set<string>();
    for (const e of entries) {
      if (e.store) storeSet.add(e.store);
    }

    if (level) {
      entries = entries.filter((e) => e.level === level);
    }

    entries.reverse();
    entries = entries.slice(0, limit);

    return {
      code: 0,
      data: {
        list: entries,
        file: targetFile,
        files: logFiles.slice(0, 30),
        total: lines.length,
        stores: Array.from(storeSet),
      },
    };
  } catch (e: any) {
    return { code: -1, data: { list: [], files: [] }, message: e.message };
  }
});
