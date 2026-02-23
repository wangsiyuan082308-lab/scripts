import { defineEventHandler, getQuery } from 'h3';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const LOGS_DIR = join(
  process.env.HOME || '/Users/mac',
  '.openclaw/workspace/skills/eleme-activity-assistant/logs',
);

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  data?: any;
}

export default defineEventHandler((event) => {
  const query = getQuery(event);
  const date = query.date as string; // YYYYMMDD
  const level = query.level as string; // info|warn|error
  const limit = Math.min(Number(query.limit) || 200, 1000);

  if (!existsSync(LOGS_DIR)) {
    return { code: 0, data: { list: [], files: [], message: '暂无日志' } };
  }

  try {
    // 列出所有日志文件
    const files = readdirSync(LOGS_DIR)
      .filter((f) => f.endsWith('.log'))
      .sort()
      .reverse();

    // 选择目标文件
    let targetFile: string | undefined;
    if (date) {
      targetFile = files.find((f) => f.includes(date));
    } else {
      targetFile = files[0]; // 最新的
    }

    if (!targetFile) {
      return { code: 0, data: { list: [], files, message: '未找到匹配的日志文件' } };
    }

    const filePath = join(LOGS_DIR, targetFile);
    const raw = readFileSync(filePath, 'utf-8');
    const lines = raw.trim().split('\n').filter(Boolean);

    let entries: LogEntry[] = lines.map((line) => {
      try {
        const d = JSON.parse(line);
        return {
          timestamp: d.timestamp || d.ts || '',
          level: (d.level || 'info').toLowerCase(),
          message: d.message || d.msg || '',
          data: d.data || undefined,
        };
      } catch {
        return { timestamp: '', level: 'info', message: line };
      }
    });

    // 按级别过滤
    if (level) {
      entries = entries.filter((e) => e.level === level);
    }

    // 倒序（最新在前）+ 限制数量
    entries.reverse();
    entries = entries.slice(0, limit);

    return {
      code: 0,
      data: {
        list: entries,
        file: targetFile,
        files: files.slice(0, 30),
        total: lines.length,
      },
    };
  } catch (e: any) {
    return { code: -1, data: { list: [], files: [] }, message: e.message };
  }
});
