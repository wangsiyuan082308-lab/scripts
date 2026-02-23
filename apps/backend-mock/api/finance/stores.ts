import { defineEventHandler } from 'h3';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const CONFIG_PATH = join(
  process.env.HOME || '/Users/mac',
  '.openclaw/workspace/skills/oby-finance-analyzer/store_config.json',
);

export default defineEventHandler(() => {
  try {
    if (!existsSync(CONFIG_PATH)) {
      return { code: 0, data: { stores: {}, message: '门店配置文件不存在' } };
    }

    const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    const stores = config.stores || {};

    // 转为列表格式，方便前端展示
    const list = Object.entries(stores).map(([fullName, cfg]: [string, any]) => {
      const fc = cfg.fixed_costs || {};
      const totalFixedCost = Object.values(fc).reduce((s: number, v: any) => s + (Number(v) || 0), 0);
      return {
        name: fullName,
        shortName: cfg.short_name || fullName,
        meituanId: cfg.meituan_id || '',
        elemeName: cfg.eleme_name || '',
        salary: fc.salary || 0,
        rent: fc.rent || 0,
        depreciation: fc.depreciation || 0,
        promotion: fc.promotion || 0,
        meituanPromo: fc.meituan_promo || 0,
        elemePromo: fc.eleme_promo || 0,
        office: fc.office || 0,
        franchise: fc.franchise || 0,
        totalFixedCost: Math.round(totalFixedCost * 100) / 100,
      };
    });

    return {
      code: 0,
      data: {
        list,
        total: list.length,
        raw: config,
      },
    };
  } catch (e: any) {
    return { code: -1, data: { list: [], total: 0 }, message: e.message };
  }
});
