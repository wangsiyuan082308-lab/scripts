import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface ActivityStoreMetrics {
  avgOrderValue: number;
  dailyOrders: number;
  grossMargin: number;
}

export interface ActivityRecord {
  daysToDeadline?: number;
  endTime?: string;
  existsButNotImmediate?: boolean;
  fullText?: string;
  immediateSignup?: boolean;
  level?: 'p0' | 'p1' | 'p2' | 'p3';
  merchantCost?: number;
  name: string;
  platform?: string;
  platformSubsidy?: number;
  requiresChainAccount?: boolean;
  startTime?: string;
  status?: string;
  url?: string;
  [key: string]: any;
}

export interface ActivityCatalogSummary {
  available: number;
  expired: number;
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  signedUp: number;
  total: number;
}

export interface ActivityCatalogResult {
  list: ActivityRecord[];
  summary: ActivityCatalogSummary;
}

export const ACTIVITY_DATA_DIR = join(
  process.env.HOME || '/Users/mac',
  '.openclaw/workspace/skills/eleme-activity-assistant/data',
);

export const STORE_METRICS: Record<string, ActivityStoreMetrics> = {
  '中山店': { avgOrderValue: 42, grossMargin: 0.23, dailyOrders: 120 },
  '太仓店': { avgOrderValue: 48, grossMargin: 0.25, dailyOrders: 130 },
  '宜宾店': { avgOrderValue: 38, grossMargin: 0.22, dailyOrders: 100 },
  '安吉店': { avgOrderValue: 45, grossMargin: 0.25, dailyOrders: 150 },
  '合肥店': { avgOrderValue: 40, grossMargin: 0.23, dailyOrders: 110 },
  '江北店': { avgOrderValue: 43, grossMargin: 0.24, dailyOrders: 125 },
  '济阳店': { avgOrderValue: 36, grossMargin: 0.22, dailyOrders: 90 },
  '长兴店': { avgOrderValue: 44, grossMargin: 0.24, dailyOrders: 140 },
};

function extractSignedNames(dataDir: string) {
  const signedNames = new Set<string>();

  try {
    const dataFiles = readdirSync(dataDir);
    for (const fileName of dataFiles.filter(
      (name) => name.startsWith('super_brand_signup_') && name.endsWith('.json'),
    )) {
      try {
        const signup = JSON.parse(readFileSync(join(dataDir, fileName), 'utf-8'));
        if (!Array.isArray(signup?.results)) continue;
        for (const item of signup.results) {
          if (item?.success && item?.name) {
            signedNames.add(String(item.name));
          }
        }
      } catch {
        // ignore broken single files
      }
    }
  } catch {
    // ignore dir read failure
  }

  try {
    const historyPath = join(dataDir, '报名历史.json');
    if (existsSync(historyPath)) {
      const history = JSON.parse(readFileSync(historyPath, 'utf-8'));
      for (const [date, items] of Object.entries(history)) {
        if (date.startsWith('_') || !Array.isArray(items)) continue;
        for (const item of items as any[]) {
          if ((item?.success || item?.status === 'success') && item?.name) {
            signedNames.add(String(item.name));
          }
        }
      }
    }

    const activitiesHistoryPath = join(dataDir, 'activities_history.json');
    if (existsSync(activitiesHistoryPath)) {
      const history = JSON.parse(readFileSync(activitiesHistoryPath, 'utf-8'));
      if (Array.isArray(history)) {
        for (const item of history) {
          if ((item?.signedUp || item?.status === 'signed_up') && item?.name) {
            signedNames.add(String(item.name));
          }
        }
      }
    }
  } catch {
    // ignore broken historical files
  }

  return signedNames;
}

function inferActivityWindow(activity: ActivityRecord) {
  if (activity.startTime && activity.endTime) {
    return {
      endTime: activity.endTime,
      startTime: activity.startTime,
    };
  }

  const fullText = activity.fullText || '';
  let match = fullText.match(
    /活动时间[：:]\s*(\d{4}\/\d{2}\/\d{2})\s*~\s*(\d{4}\/\d{2}\/\d{2})/,
  );
  if (match) {
    return { startTime: match[1], endTime: match[2] };
  }

  match = fullText.match(/活动时间[：:]\s*(\d{2}\/\d{2})\s*~\s*(\d{2}\/\d{2})/);
  if (match) {
    const year = new Date().getFullYear();
    return {
      startTime: `${year}/${match[1]}`,
      endTime: `${year}/${match[2]}`,
    };
  }

  return {
    endTime: activity.endTime,
    startTime: activity.startTime,
  };
}

function inferPlatformSubsidy(activity: ActivityRecord) {
  if (activity.platformSubsidy) {
    return activity.platformSubsidy;
  }

  const text = `${activity.name || ''} ${activity.fullText || ''}`;
  const match = text.match(/(?:最高补|平台补|平台出资)\s*(\d+(?:\.\d+)?)/);
  return match ? Number.parseFloat(match[1]) : 0;
}

function inferMerchantCost(activity: ActivityRecord) {
  if (activity.merchantCost) {
    return activity.merchantCost;
  }

  const fullText = activity.fullText || '';
  const match = fullText.match(/(?:商户出资|商家承担|商家出)\s*(\d+(?:\.\d+)?)/);
  return match ? Number.parseFloat(match[1]) : 0;
}

function inferPlatform(activity: ActivityRecord) {
  const url = activity.url || '';
  if (url.includes('ele.me') || url.includes('eleme')) {
    return 'eleme';
  }
  if (url.includes('meituan') || url.includes('waimai')) {
    return 'meituan';
  }
  return 'unknown';
}

export function getStoreMetrics(storeName = '安吉店') {
  return STORE_METRICS[storeName] || STORE_METRICS['安吉店']!;
}

export function calculateActivityRoi(
  activity: ActivityRecord,
  storeName = '安吉店',
) {
  const store = getStoreMetrics(storeName);
  const grossProfitPerOrder = store.avgOrderValue * store.grossMargin;
  const costPerOrder = activity.merchantCost || 0;
  const netProfitPerOrder = grossProfitPerOrder - costPerOrder;

  const baseIncremental = store.dailyOrders * 0.3;
  const subsidyFactor = 1 + ((activity.platformSubsidy || 0) / 100);
  const deadlineFactor = (activity.daysToDeadline || 999) < 7 ? 1.5 : 1.0;
  const incrementalOrders = Math.round(
    baseIncremental * subsidyFactor * deadlineFactor,
  );

  const totalRevenue = incrementalOrders * netProfitPerOrder;
  const totalCost = incrementalOrders * costPerOrder;
  return totalCost <= 0 ? 999 : Math.round((totalRevenue / totalCost) * 100) / 100;
}

export function classifyActivity(
  activity: ActivityRecord,
  storeName = '安吉店',
): 'p0' | 'p1' | 'p2' | 'p3' {
  if (activity.status !== 'available') return 'p3';
  const roi = calculateActivityRoi(activity, storeName);
  const daysToDeadline = activity.daysToDeadline ?? 999;
  const subsidy = activity.platformSubsidy ?? 0;

  if (daysToDeadline <= 7 && roi >= 1.0) return 'p0';
  if (subsidy >= 5 && roi >= 1.5) return 'p1';
  if (roi >= 1.0) return 'p2';
  return 'p3';
}

function normalizeActivity(
  activity: ActivityRecord,
  signedNames: Set<string>,
  storeName: string,
): ActivityRecord {
  const isSigned =
    signedNames.has(activity.name) ||
    [...signedNames].some(
      (name) => activity.name?.includes(name) || name.includes(activity.name),
    );

  const timeWindow = inferActivityWindow(activity);
  const normalized: ActivityRecord = {
    ...activity,
    endTime: timeWindow.endTime,
    merchantCost: inferMerchantCost(activity),
    platform: inferPlatform(activity),
    platformSubsidy: inferPlatformSubsidy(activity),
    startTime: timeWindow.startTime,
    status: isSigned ? 'signed_up' : activity.status,
  };

  return {
    ...normalized,
    level: classifyActivity(normalized, storeName),
  };
}

function buildSummary(list: ActivityRecord[]): ActivityCatalogSummary {
  return {
    available: list.filter((item) => item.status === 'available').length,
    expired: list.filter((item) => item.status === 'expired').length,
    p0: list.filter((item) => item.level === 'p0').length,
    p1: list.filter((item) => item.level === 'p1').length,
    p2: list.filter((item) => item.level === 'p2').length,
    p3: list.filter((item) => item.level === 'p3').length,
    signedUp: list.filter((item) => item.status === 'signed_up').length,
    total: list.length,
  };
}

export function loadActivityCatalog(options?: {
  dataDir?: string;
  status?: string;
  storeName?: string;
}) {
  const dataDir = options?.dataDir || ACTIVITY_DATA_DIR;
  const status = options?.status || 'all';
  const storeName = options?.storeName || '安吉店';
  const filePath = join(dataDir, 'activities.json');

  if (!existsSync(filePath)) {
    return {
      list: [],
      summary: buildSummary([]),
    } satisfies ActivityCatalogResult;
  }

  const raw = readFileSync(filePath, 'utf-8');
  const source = JSON.parse(raw) as ActivityRecord[];
  const signedNames = extractSignedNames(dataDir);
  let list = source.map((item) => normalizeActivity(item, signedNames, storeName));

  if (status !== 'all') {
    list = list.filter((item) => item.status === status);
  }

  const order = { p0: 0, p1: 1, p2: 2, p3: 3 };
  list.sort(
    (left, right) =>
      (order[left.level as keyof typeof order] ?? 9) -
      (order[right.level as keyof typeof order] ?? 9),
  );

  return {
    list,
    summary: buildSummary(list),
  } satisfies ActivityCatalogResult;
}
