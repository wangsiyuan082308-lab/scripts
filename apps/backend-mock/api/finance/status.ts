import { defineEventHandler } from 'h3';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SKILL_DIR = join(
  process.env.HOME || '/Users/mac',
  '.openclaw/workspace/skills/oby-finance-analyzer',
);
const OUTPUT_DIR = join(SKILL_DIR, '${args.output_dir}');
const CONFIG_PATH = join(SKILL_DIR, 'store_config.json');

export default defineEventHandler(() => {
  try {
    // 门店数量
    const config = existsSync(CONFIG_PATH)
      ? JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
      : { stores: {} };
    const storeCount = Object.keys(config.stores || {}).length;

    // 报表统计
    let reportCount = 0;
    let latestReport: string | null = null;
    let latestMtime: Date | null = null;
    const months = new Set<string>();

    function scan(dir: string) {
      if (!existsSync(dir)) return;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          scan(fullPath);
        } else if (entry.name.endsWith('.xlsx') || entry.name.endsWith('.csv')) {
          reportCount++;
          const stat = statSync(fullPath);
          if (!latestMtime || stat.mtime > latestMtime) {
            latestMtime = stat.mtime;
            latestReport = entry.name;
          }
          const monthMatch = entry.name.match(/(\d{4}-\d{2})月/);
          if (monthMatch) months.add(monthMatch[1]!);
        }
      }
    }

    scan(OUTPUT_DIR);

    return {
      code: 0,
      data: {
        storeCount,
        reportCount,
        monthCount: months.size,
        months: Array.from(months).sort().reverse(),
        latestReport,
        latestMtime: latestMtime?.toISOString() || null,
      },
    };
  } catch (e: any) {
    return { code: -1, data: null, message: e.message };
  }
});
