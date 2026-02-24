import { defineEventHandler } from 'h3';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { useResponseError } from '../../utils/response';

const SKILL_DIR = join(
  process.env.HOME || '/Users/mac',
  '.openclaw/workspace/skills/eleme-auto-withdrawal',
);
const LOGS_DIR = join(SKILL_DIR, 'logs');

/** 从 JSONL 日志中解析门店提现结果 */
function parseAppLog(filePath: string) {
  const raw = readFileSync(filePath, 'utf-8');
  const lines = raw.trim().split('\n').filter(Boolean);
  const stores = new Map<string, any>();
  let riskLevel = 'NORMAL';

  for (const line of lines) {
    try {
      const d = JSON.parse(line);
      const mod = d.module || '';
      const msg = d.message || '';

      // 收集门店信息
      if (mod === 'store' && d.store) {
        if (!stores.has(d.store)) {
          stores.set(d.store, { name: d.store, status: 'unknown', amount: 0 });
        }
        // 提取余额
        const balanceMatch = msg.match(/余额.*?(\d+\.?\d*)/);
        if (balanceMatch) {
          stores.get(d.store)!.amount = parseFloat(balanceMatch[1]!);
        }
      }

      // 从摘要中提取状态
      if (mod === 'main' && msg.includes('✅')) {
        for (const [name, store] of stores) {
          if (msg.includes(name)) store.status = 'success';
        }
      }
      if (mod === 'main' && msg.includes('❌')) {
        for (const [name, store] of stores) {
          if (msg.includes(name)) store.status = 'failed';
        }
      }

      // 风控等级
      if (msg.includes('风控等级')) {
        const m = msg.match(/风控等级:\s*(\w+)/);
        if (m) riskLevel = m[1]!;
      }
    } catch {}
  }

  return {
    stores: Array.from(stores.values()),
    riskLevel,
    totalLines: lines.length,
  };
}

export default defineEventHandler(() => {
  try {
    const appFiles = existsSync(LOGS_DIR)
      ? readdirSync(LOGS_DIR)
          .filter((f) => f.startsWith('app_') && f.endsWith('.json'))
          .sort()
          .reverse()
      : [];

    let latestRun: any = null;
    let totalWithdrawn = 0;
    let successCount = 0;
    let failCount = 0;
    const storeNames = new Set<string>();

    for (const file of appFiles.slice(0, 30)) {
      try {
        const parsed = parseAppLog(join(LOGS_DIR, file));
        if (!latestRun) {
          // 从文件名提取日期 app_20260220.json → 2026-02-20
          const dateMatch = file.match(/app_(\d{4})(\d{2})(\d{2})/);
          const dateStr = dateMatch
            ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`
            : file;
          latestRun = {
            file,
            date: dateStr,
            stores: parsed.stores,
            riskLevel: parsed.riskLevel,
          };
        }
        for (const store of parsed.stores) {
          storeNames.add(store.name);
          if (store.status === 'success') {
            successCount++;
            totalWithdrawn += store.amount || 0;
          } else if (store.status === 'failed') {
            failCount++;
          }
        }
      } catch {}
    }

    // 读取优化历史
    const optimPath = join(SKILL_DIR, 'optimization_history.json');
    const optimHistory = existsSync(optimPath)
      ? JSON.parse(readFileSync(optimPath, 'utf-8'))
      : [];

    return {
      code: 0,
      data: {
        storeCount: storeNames.size,
        totalExecutions: appFiles.length,
        lastAnalyzed: latestRun?.date || null,
        logFileCount: appFiles.length,
        optimizationCount: Array.isArray(optimHistory) ? optimHistory.length : 0,
        totalWithdrawn: Math.round(totalWithdrawn * 100) / 100,
        successCount,
        failCount,
        successRate:
          successCount + failCount > 0
            ? Math.round((successCount / (successCount + failCount)) * 1000) / 10
            : 0,
        latestRun,
      },
    };
  } catch (e: any) {
    return useResponseError(e.message, e.message);
  }
});
