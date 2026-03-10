import type { AutomationEvolutionConfig, AutomationRuntimePaths } from './config';
import { saveEvolutionConfig } from './config';
import { delay } from './browser';
import type { AutomationLogger } from './logger';

/**
 * 重试与退避参数。
 */
export interface RetryOptions {
  backoffFactor: number;
  baseDelayMs: number;
  maxDelayMs: number;
  maxRetries: number;
}

const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  backoffFactor: 2,
  baseDelayMs: 1500,
  maxDelayMs: 20_000,
  maxRetries: 3,
};

/**
 * 当前风控强度等级。
 */
export enum RiskLevel {
  NORMAL = 0,
  LEVEL1 = 1,
  LEVEL2 = 2,
  LEVEL3 = 3,
}

/**
 * 风控控制器。
 * 负责根据连续阻断次数动态提升等待时间与是否继续执行。
 */
export class RiskController {
  private consecutiveBlocks = 0;

  private currentRiskLevel = RiskLevel.NORMAL;

  constructor(
    private evolution: AutomationEvolutionConfig,
    private paths: AutomationRuntimePaths,
    private logger: AutomationLogger,
  ) {}

  /**
   * 返回当前风控等级对应的延时倍率。
   */
  getDelayMultiplier() {
    switch (this.currentRiskLevel) {
      case RiskLevel.LEVEL1:
        return 1.5;
      case RiskLevel.LEVEL2:
        return 2.5;
      case RiskLevel.LEVEL3:
        return 4;
      default:
        return 1;
    }
  }

  /**
   * 获取当前风控等级。
   */
  getLevel() {
    return this.currentRiskLevel;
  }

  /**
   * 根据单次执行结果更新风控状态，并同步演化配置。
   */
  async update(result: 'blocked' | 'fail' | 'success') {
    if (result === 'success') {
      if (this.consecutiveBlocks > 0) {
        this.consecutiveBlocks = Math.max(0, this.consecutiveBlocks - 1);
      }
      if (this.consecutiveBlocks === 0) {
        this.currentRiskLevel = RiskLevel.NORMAL;
      }
      return this.currentRiskLevel;
    }

    if (result !== 'blocked') {
      return this.currentRiskLevel;
    }

    this.consecutiveBlocks += 1;
    if (this.consecutiveBlocks >= 3) {
      this.currentRiskLevel = RiskLevel.LEVEL3;
    } else if (this.consecutiveBlocks >= 2) {
      this.currentRiskLevel = RiskLevel.LEVEL2;
    } else {
      this.currentRiskLevel = RiskLevel.LEVEL1;
    }

    this.evolution.baseWaitTime = Math.min(
      (this.evolution.baseWaitTime || 1000) + 1000 * this.consecutiveBlocks,
      this.evolution.maxWaitTime || 10_000,
    );
    await saveEvolutionConfig(this.paths, this.evolution);
    this.logger.warn(`风控等级提升为 ${RiskLevel[this.currentRiskLevel]}`);
    return this.currentRiskLevel;
  }

  /**
   * 判断当前风控等级下是否允许继续执行后续门店。
   */
  canContinue() {
    return this.currentRiskLevel !== RiskLevel.LEVEL3;
  }

  /**
   * 在中等级风控下执行一次短暂退避，降低连续触发概率。
   */
  async cooldownIfNeeded() {
    if (this.currentRiskLevel === RiskLevel.LEVEL2) {
      this.logger.warn('检测到连续风控，本次只做短暂退避，不进行长时间阻塞等待');
      await delay(Math.min(this.evolution.baseWaitTime * 3, 10_000));
    }
    return this.canContinue();
  }
}

/**
 * 以指数退避方式执行重试。
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  label: string,
  logger: AutomationLogger,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const opts = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 1; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt >= opts.maxRetries) {
        break;
      }

      const delayMs = Math.min(
        opts.baseDelayMs * Math.pow(opts.backoffFactor, attempt - 1),
        opts.maxDelayMs,
      );
      const jittered = Math.round(delayMs * (0.8 + Math.random() * 0.4));
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`[${label}] 第 ${attempt} 次失败：${message}，${jittered}ms 后重试`);
      await delay(jittered);
    }
  }

  throw lastError;
}
