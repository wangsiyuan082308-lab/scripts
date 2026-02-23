import { defineEventHandler, getRouterParam } from 'h3';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const DATA_DIR = join(
  process.env.HOME || '/Users/mac',
  '.openclaw/workspace/skills/eleme-activity-assistant/data',
);

export default defineEventHandler((event) => {
  const id = getRouterParam(event, 'id');
  if (!id) {
    return { code: -1, data: null, message: '缺少活动ID' };
  }

  try {
    // 从 activities.json 查找活动
    const activitiesPath = join(DATA_DIR, 'activities.json');
    let activity: any = null;

    if (existsSync(activitiesPath)) {
      const list: any[] = JSON.parse(readFileSync(activitiesPath, 'utf-8'));
      activity = list.find((a) => a.id === id || String(a.index) === id);
    }

    if (!activity) {
      return { code: -1, data: null, message: '活动不存在' };
    }

    // 从 super_brand_signup 文件中查找报名门店记录
    const signupStores: any[] = [];
    const signupFiles = readdirSync(DATA_DIR)
      .filter((f) => f.startsWith('super_brand_signup_') && f.endsWith('.json'))
      .sort()
      .reverse();

    for (const file of signupFiles) {
      try {
        const data = JSON.parse(readFileSync(join(DATA_DIR, file), 'utf-8'));
        if (data.results) {
          const match = data.results.find(
            (r: any) => r.name === activity.name || activity.name?.includes(r.name),
          );
          if (match) {
            signupStores.push({
              storeId: 'all',
              storeName: '全部门店（全选）',
              city: '-',
              signupTime: data.timestamp,
              status: match.success ? 'success' : 'failed',
              message: match.message,
            });
          }
        }
      } catch {}
    }

    // 从报名历史查找
    const historyPath = join(DATA_DIR, '报名历史.json');
    if (existsSync(historyPath)) {
      try {
        const history = JSON.parse(readFileSync(historyPath, 'utf-8'));
        for (const [date, items] of Object.entries(history)) {
          if (date.startsWith('_') || !Array.isArray(items)) continue;
          for (const item of items as any[]) {
            if (item.name === activity.name || activity.name?.includes(item.name)) {
              signupStores.push({
                storeId: item.storeId || 'unknown',
                storeName: item.storeName || item.store || '未知门店',
                city: item.city || '-',
                signupTime: date,
                status: item.status === 'success' || item.success ? 'success' : 'failed',
                message: item.message || '',
              });
            }
          }
        }
      } catch {}
    }

    return {
      code: 0,
      data: {
        ...activity,
        signupStores,
      },
    };
  } catch (e: any) {
    return { code: -1, data: null, message: e.message };
  }
});
