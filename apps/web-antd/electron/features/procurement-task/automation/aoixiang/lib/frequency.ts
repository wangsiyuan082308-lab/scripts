/**
 * 采购频率控制
 *
 * 记录每个供应商的上次采购时间，防止同日重复采购。
 */
import * as fs from 'fs';
import * as path from 'path';
import { DATA_DIR } from './types-v4';
import { log } from './utils';

const FREQUENCY_FILE = path.join(DATA_DIR, 'last-purchase.json');

interface PurchaseRecord {
  lastRun: string;
  status: string;
}

type FrequencyData = Record<string, PurchaseRecord>;

interface FrequencyCheckResult {
  allowed: boolean;
  lastRun?: string;
  hoursSince?: number;
}

function loadFrequencyData(): FrequencyData {
  try {
    if (fs.existsSync(FREQUENCY_FILE)) {
      return JSON.parse(fs.readFileSync(FREQUENCY_FILE, 'utf-8'));
    }
  } catch (e: any) {
    log(`频率数据读取失败: ${e.message}，将重新创建`);
  }
  return {};
}

function saveFrequencyData(data: FrequencyData): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  fs.writeFileSync(FREQUENCY_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

export function checkFrequency(supplier: string, minIntervalHours: number = 12): FrequencyCheckResult {
  const data = loadFrequencyData();
  const record = data[supplier];

  if (!record?.lastRun) {
    return { allowed: true };
  }

  const lastRunDate = new Date(record.lastRun);
  if (isNaN(lastRunDate.getTime())) {
    log(`供应商 ${supplier} 的上次采购时间格式无效，允许执行`);
    return { allowed: true };
  }

  const hoursSince = (Date.now() - lastRunDate.getTime()) / (1000 * 60 * 60);

  return {
    allowed: hoursSince >= minIntervalHours,
    lastRun: record.lastRun,
    hoursSince,
  };
}

export function recordPurchase(supplier: string): void {
  const data = loadFrequencyData();
  data[supplier] = {
    lastRun: new Date().toISOString(),
    status: 'success',
  };
  saveFrequencyData(data);
  log(`已记录采购时间: ${supplier} -> ${data[supplier].lastRun}`);
}
