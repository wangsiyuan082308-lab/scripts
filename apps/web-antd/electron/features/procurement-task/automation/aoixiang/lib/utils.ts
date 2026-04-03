import * as fs from 'fs';
import { DATA_DIR, FailedSku } from './types';

let _startTime = Date.now();

export function setStartTime(t: number) { _startTime = t; }

/** 兼容旧接口：当前仓库先使用控制台日志，不再依赖外部 logger 包。 */
export function initSharedLogger(_skillName = 'aoixiang-purchase') {
  return null;
}

/** 兼容旧接口：当前仓库先使用控制台日志，不再依赖外部 logger 包。 */
export function getSharedLogger() {
  return null;
}

export function log(msg: string) {
  const elapsed = ((Date.now() - _startTime) / 1000).toFixed(0);
  console.log(`[${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}][${elapsed}s] ${msg}`);
}

export function formatErrorTag(tag: string, message: string): string {
  return `❌ [${tag}] ${message}`;
}

export function failWithTag(tag: string, message: string): never {
  throw new Error(`[${tag}] ${message}`);
}

export function parseArgs(): { supplier: string; all: boolean } {
  const args = process.argv.slice(2);
  let supplier = '集采-卫生巾供应商';
  let all = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--supplier' && args[i + 1]) { supplier = args[i + 1]; i++; }
    else if (args[i] === '--all') { all = true; }
    else if (!args[i].startsWith('--')) { supplier = args[i]; }
  }
  return { supplier, all };
}

export function saveNoStockSkus(supplier: string, skus: FailedSku[]) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const date = new Date().toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai' }).replace(/\//g, '-');
  const file = `${DATA_DIR}/no-stock-${supplier.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')}-${date}.json`;
  const data = {
    supplier,
    date,
    savedAt: new Date().toISOString(),
    total: skus.length,
    skus,
  };
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
  log(`  💾 无库存SKU已保存: ${file} (共${skus.length}种)`);
}
