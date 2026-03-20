import * as fs from 'node:fs';
import * as path from 'node:path';
import { createRequire } from 'node:module';
// Shared logger is optional — resolve path dynamically to avoid compile-time breakage
let createSharedLogger = null;
try {
    const sharedPath = path.resolve(__dirname, '..', '..', '..', 'shared-libs', 'logger', 'src');
    if (fs.existsSync(sharedPath)) {
        createSharedLogger = createRequire(import.meta.url)(sharedPath).createLogger;
    }
}
catch { }
const LOG_DIR = path.join(process.cwd(), 'logs');
// 共享结构化日志实例（可选）
let _sharedLogger = null;
function getSharedLogger() {
    if (!_sharedLogger && createSharedLogger) {
        try {
            _sharedLogger = createSharedLogger('eleme-withdrawal', { console: false });
        }
        catch { }
    }
    return _sharedLogger;
}
/** 获取本地日期字符串 YYYYMMDD（避免UTC时区导致日期错位） */
function getLocalDateStr() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}${m}${d}`;
}
const LOG_FILE = path.join(LOG_DIR, `app_${getLocalDateStr()}.json`);
const OBS_FILE = path.join(LOG_DIR, `obs_${getLocalDateStr()}.jsonl`);
// 确保日志目录存在
if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
}
function writeObsNormalized(entry) {
    if (!entry.timestamp || !entry.stage || !entry.code || entry.reason === undefined || entry.retryable === undefined)
        return;
    const obsLine = {
        timestamp: entry.timestamp,
        stage: entry.stage,
        code: entry.code,
        reason: entry.reason,
        retryable: entry.retryable,
        level: entry.level,
        module: entry.module,
        store: entry.store,
        message: entry.message,
    };
    fs.appendFileSync(OBS_FILE, JSON.stringify(obsLine) + '\n');
}
function writeLogEntry(entry) {
    const line = JSON.stringify(entry);
    fs.appendFileSync(LOG_FILE, line + '\n');
    writeObsNormalized(entry);
    // 同步写入共享结构化日志（可选）
    const sl = getSharedLogger();
    if (sl) {
        const level = entry.level === 'ERROR' ? 'error' : entry.level === 'WARN' ? 'warn' : 'info';
        sl[level]('log', { module: entry.module, store: entry.store, message: entry.message, duration: entry.duration });
    }
}
export function createLogger(module, store) {
    const log = (level, message, extra) => {
        const entry = {
            timestamp: new Date().toISOString(),
            level,
            module,
            store,
            message,
            ...extra,
        };
        // 控制台输出（保持原有风格）
        const prefix = store ? `[${module}][${store}]` : `[${module}]`;
        const icon = level === 'ERROR' ? '❌' : level === 'WARN' ? '⚠️' : '';
        console.log(`${icon} ${prefix} ${message}`);
        // 写入结构化日志文件
        writeLogEntry(entry);
    };
    return {
        info: (msg, extra) => log('INFO', msg, extra),
        warn: (msg, extra) => log('WARN', msg, extra),
        error: (msg, extra) => log('ERROR', msg, extra),
        debug: (msg, extra) => log('DEBUG', msg, extra),
        obs: (level, message, obs, extra) => log(level, message, { ...obs, ...extra }),
        child: (childStore) => createLogger(module, childStore),
    };
}
// --- 业务埋点系统 ---
const METRICS_DIR = path.join(process.cwd(), 'logs', 'metrics');
if (!fs.existsSync(METRICS_DIR)) {
    fs.mkdirSync(METRICS_DIR, { recursive: true });
}
const METRICS_FILE = path.join(METRICS_DIR, `metrics_${getLocalDateStr()}.jsonl`);
function writeMetric(event) {
    fs.appendFileSync(METRICS_FILE, JSON.stringify(event) + '\n');
    // 同步写入共享结构化日志（业务埋点，可选）
    const sl = getSharedLogger();
    if (sl && typeof sl.track === 'function') {
        sl.track(event.event, event);
    }
}
export const metrics = {
    /** 门店切换埋点 */
    storeSwitch(store, success, durationMs) {
        writeMetric({
            event: 'store_switch',
            timestamp: new Date().toISOString(),
            store,
            success,
            durationMs,
        });
    },
    /** 余额检测埋点 */
    balanceCheck(store, amount) {
        writeMetric({
            event: 'balance_check',
            timestamp: new Date().toISOString(),
            store,
            amount,
        });
    },
    /** 提现操作埋点 */
    withdrawalAttempt(store, amount, result, reason) {
        writeMetric({
            event: 'withdrawal_attempt',
            timestamp: new Date().toISOString(),
            store,
            amount,
            result,
            reason,
        });
    },
    /** 风控触发埋点 */
    riskControl(level, trigger, action) {
        writeMetric({
            event: 'risk_control',
            timestamp: new Date().toISOString(),
            level,
            trigger,
            action,
        });
    },
    /** 选择器命中埋点 */
    selectorHit(store, selector, hit) {
        writeMetric({
            event: 'selector_hit',
            timestamp: new Date().toISOString(),
            store,
            selector,
            hit,
        });
    },
    /** 整体执行摘要埋点 */
    sessionSummary(total, success, fail, blocked, durationMs) {
        writeMetric({
            event: 'session_summary',
            timestamp: new Date().toISOString(),
            total,
            success,
            fail,
            blocked,
            durationMs,
        });
    },
};
// 清理旧日志（保留7天）
export function cleanOldLogs(days = 7) {
    try {
        for (const dir of [LOG_DIR, METRICS_DIR]) {
            const files = fs.readdirSync(dir);
            const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
            for (const file of files) {
                const filePath = path.join(dir, file);
                const stat = fs.statSync(filePath);
                if (stat.mtimeMs < cutoff) {
                    fs.unlinkSync(filePath);
                }
            }
        }
    }
    catch { }
}
