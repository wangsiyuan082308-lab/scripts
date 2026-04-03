import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { PurchaseReport } from './types-v2';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const LOGS_DIR = path.join(ROOT, 'logs');
const REPORTS_DIR = path.join(ROOT, 'data/reports');

const startTime = Date.now();

export type ObsStage =
  | 'flow.main'
  | 'flow.circuit-breaker'
  | 'step.run'
  | 'report.generate';

export interface ObsFields {
  stage: ObsStage;
  code: string;
  reason: string;
  retryable: boolean;
}

/** 初始化共享日志（在main入口调用一次） */
export function initLogger() {
  return null;
}

export function getLogger() { return null; }

export function log(msg: string) {
  const now = new Date();
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const line = `[${now.toLocaleString('zh-CN')}][${elapsed}s] ${msg}`;
  console.log(line);

  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
  const logFile = path.join(LOGS_DIR, `purchase_${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}.log`);
  fs.appendFileSync(logFile, line + '\n');

}

export function obs(level: 'info' | 'warn' | 'error', message: string, fields: ObsFields, extra: Record<string, any> = {}) {
  const payload = { ...fields, ...extra, message };
  log(`[OBS][${fields.code}] ${message} | stage=${fields.stage} retryable=${fields.retryable} reason=${fields.reason}`);

  const now = new Date();
  const obsLine = {
    timestamp: now.toISOString(),
    stage: fields.stage,
    code: fields.code,
    reason: fields.reason,
    retryable: fields.retryable,
    level: level.toUpperCase(),
    message,
    ...extra,
  };
  const obsFile = path.join(LOGS_DIR, `obs_${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}.jsonl`);
  fs.appendFileSync(obsFile, JSON.stringify(obsLine) + '\n');

}

export function savePurchaseReport(report: PurchaseReport): string {
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const safeDate = report.date.replace(/\//g, '-');
  const filename = `report-${report.supplier.replace(/[^a-zA-Z0-9\u4e00-\u9fff-]/g, '_')}-${safeDate}-${Date.now()}.json`;
  const filepath = path.join(REPORTS_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(report, null, 2), 'utf-8');
  log(`报告已保存: ${filepath}`);
  return filepath;
}
