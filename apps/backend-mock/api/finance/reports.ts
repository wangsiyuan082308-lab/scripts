import { defineEventHandler, getQuery } from 'h3';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { useResponseError } from '../../utils/response';

const SKILL_DIR = join(
  process.env.HOME || '/Users/mac',
  '.openclaw/workspace/skills/oby-finance-analyzer',
);
const OUTPUT_DIR = join(SKILL_DIR, '${args.output_dir}');

export default defineEventHandler((event) => {
  const query = getQuery(event);
  const month = query.month as string;
  const store = query.store as string;

  try {
    const reports: any[] = [];

    // 递归扫描输出目录
    function scan(dir: string) {
      if (!existsSync(dir)) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          scan(fullPath);
        } else if (entry.name.endsWith('.xlsx') || entry.name.endsWith('.csv')) {
          const stat = statSync(fullPath);
          // 从文件名提取门店和月份
          const nameMatch = entry.name.match(/(\d{4}-\d{2})月[_-]?(.+?)[_-]?(?:财务报表|毛利|总表)/);
          const reportMonth = nameMatch?.[1] || '';
          const storeName = nameMatch?.[2] || '';

          if (month && reportMonth !== month) continue;
          if (store && !storeName.includes(store)) continue;

          reports.push({
            id: `${reportMonth}_${storeName}`,
            fileName: entry.name,
            storeName: storeName || '汇总',
            month: reportMonth,
            size: stat.size,
            createdAt: stat.mtime.toISOString(),
            relativePath: fullPath.replace(OUTPUT_DIR, '').replace(/^\//, ''),
          });
        }
      }
    }

    scan(OUTPUT_DIR);
    reports.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return {
      code: 0,
      data: {
        list: reports,
        total: reports.length,
      },
    };
  } catch (e: any) {
    return useResponseError(e.message, e.message);
  }
});
