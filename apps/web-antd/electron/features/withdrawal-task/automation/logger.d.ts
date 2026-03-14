export type LogLevel = 'INFO' | 'WARN' | 'ERROR' | 'DEBUG';
export type ObsStage = 'main.run' | 'store.switch' | 'finance.navigate' | 'withdrawal.handle' | 'retry.backoff' | 'risk.control';
export interface ObsFields {
    stage: ObsStage;
    code: string;
    reason: string;
    retryable: boolean;
}
interface LogEntry {
    timestamp: string;
    level: LogLevel;
    module: string;
    store?: string;
    message: string;
    duration?: number;
    error?: string;
    stage?: ObsStage;
    code?: string;
    reason?: string;
    retryable?: boolean;
}
export declare function createLogger(module: string, store?: string): {
    info: (msg: string, extra?: Partial<LogEntry>) => void;
    warn: (msg: string, extra?: Partial<LogEntry>) => void;
    error: (msg: string, extra?: Partial<LogEntry>) => void;
    debug: (msg: string, extra?: Partial<LogEntry>) => void;
    obs: (level: LogLevel, message: string, obs: ObsFields, extra?: Partial<LogEntry>) => void;
    child: (childStore: string) => /*elided*/ any;
};
export interface MetricEvent {
    event: string;
    timestamp: string;
    store?: string;
    [key: string]: any;
}
export declare const metrics: {
    /** 门店切换埋点 */
    storeSwitch(store: string, success: boolean, durationMs: number): void;
    /** 余额检测埋点 */
    balanceCheck(store: string, amount: number | null): void;
    /** 提现操作埋点 */
    withdrawalAttempt(store: string, amount: number | null, result: "success" | "fail" | "blocked" | "skipped", reason?: string): void;
    /** 风控触发埋点 */
    riskControl(level: number, trigger: string, action: string): void;
    /** 选择器命中埋点 */
    selectorHit(store: string, selector: string, hit: boolean): void;
    /** 整体执行摘要埋点 */
    sessionSummary(total: number, success: number, fail: number, blocked: number, durationMs: number): void;
};
export declare function cleanOldLogs(days?: number): void;
export {};
