export interface RetryOptions {
    maxRetries: number;
    baseDelayMs: number;
    maxDelayMs: number;
    backoffFactor: number;
}
/**
 * 带指数退避的重试执行器
 */
export declare function retryWithBackoff<T>(fn: () => Promise<T>, label: string, options?: Partial<RetryOptions>): Promise<T>;
export declare enum RiskLevel {
    NORMAL = 0,// 正常运行
    LEVEL1 = 1,// 增加操作间隔 +50%
    LEVEL2 = 2,// 暂停 30 分钟
    LEVEL3 = 3
}
/**
 * 获取当前风控等级
 */
export declare function getRiskLevel(): RiskLevel;
/**
 * 根据执行结果更新风控等级
 */
export declare function updateRiskLevel(result: 'success' | 'fail' | 'blocked'): RiskLevel;
/**
 * 根据当前风控等级获取操作延迟倍率
 */
export declare function getDelayMultiplier(): number;
/**
 * 执行风控冷却等待
 * 返回 true 表示可以继续，false 表示应该停止
 */
export declare function cooldownIfNeeded(): Promise<boolean>;
