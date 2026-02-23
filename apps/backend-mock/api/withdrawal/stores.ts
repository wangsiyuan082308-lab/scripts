import { defineEventHandler } from 'h3';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const LOGS_DIR = join(
  process.env.HOME || '/Users/mac',
  '.openclaw/workspace/skills/eleme-auto-withdrawal/logs',
);

export default defineEventHandler(() => {
  try {
    if (!existsSync(LOGS_DIR)) {
      return { code: 0, data: { list: [], total: 0 } };
    }

    const appFiles = readdirSync(LOGS_DIR)
      .filter((f) => f.startsWith('app_') && f.endsWith('.json'))
      .sort()
      .reverse();

    const storeMap = new Map<string, any>();

    for (const file of appFiles.slice(0, 30)) {
      try {
        const raw = readFileSync(join(LOGS_DIR, file), 'utf-8');
        const lines = raw.trim().split('\n').filter(Boolean);
        const fileStores = new Map<string, any>();

        // 从文件名提取日期
        const dateMatch = file.match(/app_(\d{4})(\d{2})(\d{2})/);
        const dateStr = dateMatch
          ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`
          : file;

        for (const line of lines) {
          try {
            const d = JSON.parse(line);
            if (d.module === 'store' && d.store) {
              if (!fileStores.has(d.store)) {
                fileStores.set(d.store, { status: 'unknown', amount: 0 });
              }
              const msg = d.message || '';
              const balanceMatch = msg.match(/余额.*?(\d+\.?\d*)/);
              if (balanceMatch) {
                fileStores.get(d.store)!.amount = parseFloat(balanceMatch[1]!);
              }
            }
            if (d.module === 'main' && d.message?.includes('✅')) {
              for (const [name, s] of fileStores) {
                if (d.message.includes(name)) s.status = 'success';
              }
            }
            if (d.module === 'main' && d.message?.includes('❌')) {
              for (const [name, s] of fileStores) {
                if (d.message.includes(name)) s.status = 'failed';
              }
            }
          } catch {}
        }

        for (const [name, info] of fileStores) {
          if (!storeMap.has(name)) {
            storeMap.set(name, {
              name,
              totalRuns: 0,
              successCount: 0,
              failCount: 0,
              totalAmount: 0,
              lastRun: null,
              lastStatus: null,
            });
          }
          const entry = storeMap.get(name)!;
          entry.totalRuns++;
          if (info.status === 'success') {
            entry.successCount++;
            entry.totalAmount += info.amount;
          } else if (info.status === 'failed') {
            entry.failCount++;
          }
          if (!entry.lastRun) {
            entry.lastRun = dateStr;
            entry.lastStatus = info.status;
          }
        }
      } catch {}
    }

    const list = Array.from(storeMap.values()).map((s) => ({
      ...s,
      totalAmount: Math.round(s.totalAmount * 100) / 100,
      successRate:
        s.totalRuns > 0
          ? Math.round((s.successCount / s.totalRuns) * 1000) / 10
          : 0,
    }));

    return {
      code: 0,
      data: { list, total: list.length },
    };
  } catch (e: any) {
    return { code: -1, data: { list: [], total: 0 }, message: e.message };
  }
});
