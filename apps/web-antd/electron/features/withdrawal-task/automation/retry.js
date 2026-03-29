import { createLogger } from './logger';
import { evolutionConfig, saveEvolutionConfig } from './config';
import { delay } from './browser';
const log = createLogger('retry');
const DEFAULT_RETRY_OPTIONS = {
    maxRetries: 3,
    baseDelayMs: 2000,
    maxDelayMs: 30_000,
    backoffFactor: 2,
};
/**
 * 带指数退避的重试执行器
 */
export async function retryWithBackoff(fn, label, options = {}) {
    const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
    let lastError;
    for (let attempt = 1; attempt <= opts.maxRetries; attempt++) {
        try {
            return await fn();
        }
        catch (error) {
            lastError = error;
            if (attempt >= opts.maxRetries)
                break;
            const delayMs = Math.min(opts.baseDelayMs * Math.pow(opts.backoffFactor, attempt - 1), opts.maxDelayMs);
            // 加入随机抖动（±20%），避免多实例同时重试
            const jitter = delayMs * (0.8 + Math.random() * 0.4);
            log.warn(`[${label}] 第${attempt}次失败，${Math.round(jitter)}ms 后重试...`);
            log.obs('WARN', '触发指数退避重试', {
                stage: 'retry.backoff',
                code: 'EAW_RT_BACKOFF_RETRY',
                reason: error instanceof Error ? error.message : String(error),
                retryable: true,
            }, { duration: Math.round(jitter) });
            await delay(jitter);
        }
    }
    throw lastError;
}
// --- 风控降级系统 ---
export var RiskLevel;
(function (RiskLevel) {
    RiskLevel[RiskLevel["NORMAL"] = 0] = "NORMAL";
    RiskLevel[RiskLevel["LEVEL1"] = 1] = "LEVEL1";
    RiskLevel[RiskLevel["LEVEL2"] = 2] = "LEVEL2";
    RiskLevel[RiskLevel["LEVEL3"] = 3] = "LEVEL3";
})(RiskLevel || (RiskLevel = {}));
let currentRiskLevel = RiskLevel.NORMAL;
let consecutiveBlocks = 0;
/**
 * 获取当前风控等级
 */
export function getRiskLevel() {
    return currentRiskLevel;
}
/**
 * 根据执行结果更新风控等级
 */
export function updateRiskLevel(result) {
    if (result === 'blocked') {
        consecutiveBlocks++;
        if (consecutiveBlocks >= 3) {
            currentRiskLevel = RiskLevel.LEVEL3;
            log.error(`风控升级至 LEVEL3：连续 ${consecutiveBlocks} 次被拦截，建议人工介入`);
            log.obs('ERROR', '风控升级至LEVEL3', {
                stage: 'risk.control',
                code: 'EAW_RISK_LEVEL3_STOP',
                reason: `连续${consecutiveBlocks}次拦截`,
                retryable: false,
            });
        }
        else if (consecutiveBlocks >= 2) {
            currentRiskLevel = RiskLevel.LEVEL2;
            log.warn(`风控升级至 LEVEL2：连续 ${consecutiveBlocks} 次被拦截，暂停 30 分钟`);
            log.obs('WARN', '风控升级至LEVEL2', {
                stage: 'risk.control',
                code: 'EAW_RISK_LEVEL2_COOLDOWN',
                reason: `连续${consecutiveBlocks}次拦截`,
                retryable: true,
            });
        }
        else {
            currentRiskLevel = RiskLevel.LEVEL1;
            log.warn(`风控升级至 LEVEL1：增加操作间隔 50%`);
            log.obs('WARN', '风控升级至LEVEL1', {
                stage: 'risk.control',
                code: 'EAW_RISK_LEVEL1_SLOWDOWN',
                reason: `首次触发拦截`,
                retryable: true,
            });
        }
        // 进化：记录风控触发，增加基础等待时间
        evolutionConfig.baseWaitTime = Math.min((evolutionConfig.baseWaitTime || 1000) + 1000 * consecutiveBlocks, evolutionConfig.maxWaitTime || 10_000);
        saveEvolutionConfig(evolutionConfig);
    }
    else if (result === 'success') {
        // 成功后逐步恢复
        if (consecutiveBlocks > 0) {
            consecutiveBlocks = Math.max(0, consecutiveBlocks - 1);
            if (consecutiveBlocks === 0) {
                currentRiskLevel = RiskLevel.NORMAL;
                log.info('风控恢复至 NORMAL：连续成功，解除降级');
            }
        }
    }
    return currentRiskLevel;
}
/**
 * 根据当前风控等级获取操作延迟倍率
 */
export function getDelayMultiplier() {
    switch (currentRiskLevel) {
        case RiskLevel.LEVEL1: return 1.5;
        case RiskLevel.LEVEL2: return 3.0;
        case RiskLevel.LEVEL3: return 5.0;
        default: return 1.0;
    }
}
/**
 * 执行风控冷却等待
 * 返回 true 表示可以继续，false 表示应该停止
 */
export async function cooldownIfNeeded() {
    switch (currentRiskLevel) {
        case RiskLevel.NORMAL:
        case RiskLevel.LEVEL1:
            return true;
        case RiskLevel.LEVEL2:
            log.warn('LEVEL2 冷却：暂停 30 分钟...');
            await delay(30 * 60 * 1000);
            log.info('LEVEL2 冷却结束，恢复执行');
            return true;
        case RiskLevel.LEVEL3:
            log.error('LEVEL3：已停止自动执行，需要人工介入');
            return false;
    }
}
