import * as fs from 'node:fs';
import * as path from 'node:path';

import type { AutomationRuntimePaths } from './config';

/**
 * 自动化日志级别。
 */
export type LogLevel = 'DEBUG' | 'ERROR' | 'INFO' | 'WARN';

/**
 * 单条结构化日志记录。
 */
interface LogEntry {
  code?: string;
  level: LogLevel;
  message: string;
  module: string;
  reason?: string;
  retryable?: boolean;
  sessionId?: string;
  stage?: string;
  store?: string;
  taskId?: string;
  timestamp: string;
}

/**
 * 自动化日志记录器接口。
 */
export interface AutomationLogger {
  child(store: string): AutomationLogger;
  debug(message: string, extra?: Omit<Partial<LogEntry>, 'level' | 'message' | 'module' | 'timestamp'>): void;
  error(message: string, extra?: Omit<Partial<LogEntry>, 'level' | 'message' | 'module' | 'timestamp'>): void;
  info(message: string, extra?: Omit<Partial<LogEntry>, 'level' | 'message' | 'module' | 'timestamp'>): void;
  warn(message: string, extra?: Omit<Partial<LogEntry>, 'level' | 'message' | 'module' | 'timestamp'>): void;
}

/**
 * 生成本地日期字符串，用于日志文件名分片。
 */
function getLocalDateStr() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * 创建结构化日志记录器，同时写入主日志和观测日志。
 */
export function createAutomationLogger(
  moduleName: string,
  paths: AutomationRuntimePaths,
  store?: string,
  context?: Pick<LogEntry, 'sessionId' | 'taskId'>,
): AutomationLogger {
  const logFile = path.join(paths.logsDir, `app_${getLocalDateStr()}.jsonl`);
  const obsFile = path.join(paths.logsDir, `obs_${getLocalDateStr()}.jsonl`);

  const write = (level: LogLevel, message: string, extra?: Partial<LogEntry>) => {
    const entry: LogEntry = {
      ...context,
      level,
      message,
      module: moduleName,
      store,
      timestamp: new Date().toISOString(),
      ...extra,
    };
    fs.appendFileSync(logFile, `${JSON.stringify(entry)}\n`);
    if (entry.stage || entry.code) {
      fs.appendFileSync(obsFile, `${JSON.stringify(entry)}\n`);
    }
    const prefix = store ? `[${moduleName}][${store}]` : `[${moduleName}]`;
    console[level === 'ERROR' ? 'error' : level === 'WARN' ? 'warn' : 'log'](`${prefix} ${message}`);
  };

  return {
    child(childStore: string) {
      return createAutomationLogger(moduleName, paths, childStore, context);
    },
    debug(message, extra) {
      write('DEBUG', message, extra);
    },
    error(message, extra) {
      write('ERROR', message, extra);
    },
    info(message, extra) {
      write('INFO', message, extra);
    },
    warn(message, extra) {
      write('WARN', message, extra);
    },
  };
}

/**
 * 记录指标事件，供后续分析会话表现与风控情况。
 */
export function writeMetric(
  paths: AutomationRuntimePaths,
  event: string,
  payload: Record<string, any>,
) {
  const metricsFile = path.join(paths.metricsDir, `metrics_${getLocalDateStr()}.jsonl`);
  fs.appendFileSync(
    metricsFile,
    `${JSON.stringify({ event, timestamp: new Date().toISOString(), ...payload })}\n`,
  );
}

/**
 * 清理过期日志、指标和调试截图。
 */
export function cleanOldAutomationLogs(paths: AutomationRuntimePaths, days = 7) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  for (const dir of [paths.logsDir, paths.metricsDir, paths.debugDir]) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (stat.isFile() && stat.mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
      }
    }
  }
}
