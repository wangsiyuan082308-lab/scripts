import { defineEventHandler } from 'h3';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { useResponseError } from '../../utils/response';
import { getFinanceStatusSummary } from '../../utils/finance/report-reader';
const SKILL_DIR = join(
  process.env.HOME || '/Users/mac',
  '.openclaw/workspace/skills/oby-finance-analyzer',
);
const CONFIG_PATH = join(SKILL_DIR, 'store_config.json');

export default defineEventHandler(() => {
  try {
    // 门店数量
    const config = existsSync(CONFIG_PATH)
      ? JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'))
      : { stores: {} };
    const storeCount = Object.keys(config.stores || {}).length;

    const summary = getFinanceStatusSummary();

    return {
      code: 0,
      data: {
        storeCount,
        reportCount: summary.reportCount,
        monthCount: summary.monthCount,
        months: summary.months,
        latestReport: summary.latestReport,
        latestMtime: summary.latestMtime,
      },
    };
  } catch (e: any) {
    return useResponseError(e.message, e.message);
  }
});
