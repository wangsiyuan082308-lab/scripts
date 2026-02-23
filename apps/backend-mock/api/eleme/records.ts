import { defineEventHandler } from 'h3';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DATA_DIR = join(
  process.env.HOME || '/Users/mac',
  '.openclaw/workspace/skills/eleme-activity-assistant/data',
);

export default defineEventHandler(() => {
  const filePath = join(DATA_DIR, '报名历史.json');
  const activitiesPath = join(DATA_DIR, 'activities.json');

  try {
    // 从报名历史获取记录
    let records: any[] = [];
    if (existsSync(filePath)) {
      const raw = JSON.parse(readFileSync(filePath, 'utf-8'));
      // 格式: { "日期": [活动列表] } 或数组
      if (Array.isArray(raw)) {
        records = raw;
      } else if (typeof raw === 'object') {
        // 跳过 _说明/_格式/_用途 等元数据字段
        for (const [date, items] of Object.entries(raw)) {
          if (date.startsWith('_')) continue;
          if (Array.isArray(items)) {
            records.push(...items.map((item: any) => ({ ...item, signupDate: date })));
          }
        }
      }
    }

    // 从 activities.json 中提取已报名的活动
    if (existsSync(activitiesPath)) {
      const activities: any[] = JSON.parse(readFileSync(activitiesPath, 'utf-8'));
      const signedUp = activities
        .filter((a) => a.status === 'signed_up')
        .map((a) => ({
          id: a.id,
          name: a.name,
          startTime: a.startTime,
          endTime: a.endTime,
          platformSubsidy: a.platformSubsidy,
          merchantCost: a.merchantCost,
          suitableStores: a.suitableStores,
          status: 'signed_up',
          source: 'activities.json',
        }));
      records.push(...signedUp);
    }

    // 去重
    const seen = new Set<string>();
    records = records.filter((r) => {
      const key = r.name || r.id || JSON.stringify(r);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return {
      code: 0,
      data: { list: records, total: records.length },
    };
  } catch (e: any) {
    return { code: -1, data: { list: [], total: 0 }, message: e.message };
  }
});
