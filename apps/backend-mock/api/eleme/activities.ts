import { defineEventHandler, getQuery } from 'h3';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { useResponseError } from '../../utils/response';

const DATA_DIR = join(
  process.env.HOME || '/Users/mac',
  '.openclaw/workspace/skills/eleme-activity-assistant/data',
);

// 门店指标（用于 ROI 计算）
const STORE_METRICS: Record<string, { avgOrderValue: number; grossMargin: number; dailyOrders: number }> = {
  '安吉店': { avgOrderValue: 45, grossMargin: 0.25, dailyOrders: 150 },
  '中山店': { avgOrderValue: 42, grossMargin: 0.23, dailyOrders: 120 },
  '宜宾店': { avgOrderValue: 38, grossMargin: 0.22, dailyOrders: 100 },
  '太仓店': { avgOrderValue: 48, grossMargin: 0.25, dailyOrders: 130 },
  '长兴店': { avgOrderValue: 44, grossMargin: 0.24, dailyOrders: 140 },
  '合肥店': { avgOrderValue: 40, grossMargin: 0.23, dailyOrders: 110 },
  '济阳店': { avgOrderValue: 36, grossMargin: 0.22, dailyOrders: 90 },
  '江北店': { avgOrderValue: 43, grossMargin: 0.24, dailyOrders: 125 },
};

function calculateROI(activity: any, storeName: string = '安吉店') {
  const store = STORE_METRICS[storeName] || STORE_METRICS['安吉店']!;
  const grossProfitPerOrder = store.avgOrderValue * store.grossMargin;
  const costPerOrder = activity.merchantCost || 0;
  const netProfitPerOrder = grossProfitPerOrder - costPerOrder;

  const baseIncremental = store.dailyOrders * 0.3;
  const subsidyFactor = 1 + ((activity.platformSubsidy || 0) / 100);
  const deadlineFactor = (activity.daysToDeadline || 999) < 7 ? 1.5 : 1.0;
  const incrementalOrders = Math.round(baseIncremental * subsidyFactor * deadlineFactor);

  const totalRevenue = incrementalOrders * netProfitPerOrder;
  const totalCost = incrementalOrders * costPerOrder;

  return totalCost <= 0 ? 999 : Math.round((totalRevenue / totalCost) * 100) / 100;
}

function classifyActivity(activity: any): 'p0' | 'p1' | 'p2' | 'p3' {
  if (activity.status !== 'available') return 'p3';
  const roi = calculateROI(activity);
  const d = activity.daysToDeadline ?? 999;
  const subsidy = activity.platformSubsidy ?? 0;

  if (d <= 7 && roi >= 1.0) return 'p0';
  if (subsidy >= 5 && roi >= 1.5) return 'p1';
  if (roi >= 1.0) return 'p2';
  return 'p3';
}

export default defineEventHandler((event) => {
  const query = getQuery(event);
  const status = (query.status as string) || 'all';

  const filePath = join(DATA_DIR, 'activities.json');
  if (!existsSync(filePath)) {
    return { code: 0, data: { list: [], summary: null, message: '暂无活动数据' } };
  }

  try {
    const raw = readFileSync(filePath, 'utf-8');
    let activities: any[] = JSON.parse(raw);

    // 合并报名结果：从 super_brand_signup_*.json 和 报名历史.json 中标记已报名活动
    const signedNames = new Set<string>();

    // super_brand_signup 文件（单个文件解析失败不影响整体）
    try {
      const dataFiles = readdirSync(DATA_DIR);
      for (const f of dataFiles.filter((f) => f.startsWith('super_brand_signup_') && f.endsWith('.json'))) {
        try {
          const signup = JSON.parse(readFileSync(join(DATA_DIR, f), 'utf-8'));
          if (signup.results) {
            for (const r of signup.results) {
              if (r.success) signedNames.add(r.name);
            }
          }
        } catch {
          // 单个 signup 文件解析失败，跳过
        }
      }
    } catch {
      // 读取目录失败，跳过报名文件合并
    }

    // 报名历史（解析失败不影响整体）
    try {
      const historyPath = join(DATA_DIR, '报名历史.json');
      if (existsSync(historyPath)) {
        const history = JSON.parse(readFileSync(historyPath, 'utf-8'));
        for (const [date, items] of Object.entries(history)) {
          if (date.startsWith('_') || !Array.isArray(items)) continue;
          for (const item of items as any[]) {
            if (item.success || item.status === 'success') {
              signedNames.add(item.name);
            }
          }
        }
      }
      // activities_history.json
      const ahPath = join(DATA_DIR, 'activities_history.json');
      if (existsSync(ahPath)) {
        const ah = JSON.parse(readFileSync(ahPath, 'utf-8'));
        if (Array.isArray(ah)) {
          for (const item of ah) {
            if (item.signedUp || item.status === 'signed_up') {
              signedNames.add(item.name);
            }
          }
        }
      }
    } catch {}

    // 标记已报名状态 + 补全数据
    activities = activities.map((a) => {
      const isSigned = signedNames.has(a.name) ||
        [...signedNames].some((n) => a.name?.includes(n) || n?.includes(a.name));

      // 从 fullText 提取活动时间
      let { startTime, endTime } = a;
      if (!startTime && a.fullText) {
        // 先尝试 YYYY/MM/DD 格式
        let timeMatch = a.fullText.match(/活动时间[：:]\s*(\d{4}\/\d{2}\/\d{2})\s*~\s*(\d{4}\/\d{2}\/\d{2})/);
        if (timeMatch) {
          startTime = timeMatch[1];
          endTime = timeMatch[2];
        } else {
          // 再尝试 MM/DD 格式
          timeMatch = a.fullText.match(/活动时间[：:]\s*(\d{2}\/\d{2})\s*~\s*(\d{2}\/\d{2})/);
          if (timeMatch) {
            const year = new Date().getFullYear();
            startTime = `${year}/${timeMatch[1]}`;
            endTime = `${year}/${timeMatch[2]}`;
          }
        }
      }

      // 从名称或 fullText 提取平台补贴金额（"最高补X"、"平台补X"、"平台出资X"）
      let platformSubsidy = a.platformSubsidy || 0;
      if (!platformSubsidy) {
        const text = a.name + ' ' + (a.fullText || '');
        const subsidyMatch = text.match(/(?:最高补|平台补|平台出资)\s*(\d+(?:\.\d+)?)/);
        if (subsidyMatch) {
          platformSubsidy = parseFloat(subsidyMatch[1]);
        }
      }

      // 从 fullText 提取商家出资（"商户出资X"、"商家承担X"）
      let merchantCost = a.merchantCost || 0;
      if (!merchantCost && a.fullText) {
        const costMatch = a.fullText.match(/(?:商户出资|商家承担|商家出)\s*(\d+(?:\.\d+)?)/);
        if (costMatch) {
          merchantCost = parseFloat(costMatch[1]);
        }
      }

      // 推断平台来源
      let platform = 'unknown';
      const url = a.url || '';
      if (url.includes('ele.me') || url.includes('eleme')) {
        platform = 'eleme';
      } else if (url.includes('meituan') || url.includes('waimai')) {
        platform = 'meituan';
      }

      return {
        ...a,
        startTime,
        endTime,
        platform,
        platformSubsidy,
        merchantCost,
        status: isSigned ? 'signed_up' : a.status,
      };
    });

    // 添加推荐等级（ROI 仅用于内部分级，不对外暴露）
    activities = activities.map((a) => ({
      ...a,
      level: classifyActivity(a),
    }));

    // 按状态过滤
    if (status !== 'all') {
      activities = activities.filter((a) => a.status === status);
    }

    // 按推荐等级排序: p0 > p1 > p2 > p3
    const order = { p0: 0, p1: 1, p2: 2, p3: 3 };
    activities.sort((a, b) => (order[a.level as keyof typeof order] ?? 9) - (order[b.level as keyof typeof order] ?? 9));

    const summary = {
      total: activities.length,
      available: activities.filter((a) => a.status === 'available').length,
      signedUp: activities.filter((a) => a.status === 'signed_up').length,
      expired: activities.filter((a) => a.status === 'expired').length,
      p0: activities.filter((a) => a.level === 'p0').length,
      p1: activities.filter((a) => a.level === 'p1').length,
      p2: activities.filter((a) => a.level === 'p2').length,
      p3: activities.filter((a) => a.level === 'p3').length,
    };

    return { code: 0, data: { list: activities, summary } };
  } catch (e: any) {
    return useResponseError(e.message, e.message);
  }
});
