/**
 * 步骤间上下文持久化
 * 支持单步运行时加载上次的上下文
 */
import * as fs from 'fs';
import * as path from 'path';
import { StepContext, CONTEXT_DIR } from './types-v2';
import { log } from './utils';

const CONTEXT_FILE = path.join(CONTEXT_DIR, 'latest-context.json');

export function saveContext(ctx: StepContext): void {
  if (!fs.existsSync(CONTEXT_DIR)) fs.mkdirSync(CONTEXT_DIR, { recursive: true });
  fs.writeFileSync(CONTEXT_FILE, JSON.stringify(ctx, null, 2));
}

export function loadContext(): StepContext | null {
  if (!fs.existsSync(CONTEXT_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(CONTEXT_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

export function createEmptyContext(supplier: string): StepContext {
  return {
    supplier,
    noStockSkus: [],
    prevRoundNoStockSkus: [],
    round: 1,
    stepResults: [],
  };
}

/** Validate context has required fields for a given step */
export function validateContext(ctx: StepContext, stepNum: number): string | null {
  switch (stepNum) {
    case 1:
      return null;
    case 2:
      return null;
    case 3:
      if (!ctx.adviceFile) return 'step3 需要 adviceFile（来自 step1），请先运行 step 1';
      if (!ctx.cartFile) return 'step3 需要 cartFile（来自 step2），请先运行 step 2';
      return null;
    case 4:
      if (!ctx.replenishListNo) return 'step4 需要 replenishListNo（来自 step1），请先运行 step 1-3';
      if (!ctx.planFile) return 'step4 需要 planFile（来自 step3），请先运行 step 3';
      return null;
    case 5:
      return null;
    default:
      return '未知步骤: ' + stepNum;
  }
}

// --- 全流程熔断计数器 ---

const CIRCUIT_BREAKER_FILE = path.join(CONTEXT_DIR, 'circuit-breaker.json');

interface CircuitBreakerState {
  [key: string]: number;
}

/** 读取今日全流程运行次数 */
export function getFlowRunCount(supplier: string): number {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const key = supplier + '_' + today;
  try {
    if (!fs.existsSync(CIRCUIT_BREAKER_FILE)) return 0;
    const state: CircuitBreakerState = JSON.parse(fs.readFileSync(CIRCUIT_BREAKER_FILE, 'utf-8'));
    return state[key] || 0;
  } catch {
    return 0;
  }
}

/** 递增今日全流程运行次数 */
export function incrementFlowRunCount(supplier: string): number {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const key = supplier + '_' + today;
  if (!fs.existsSync(CONTEXT_DIR)) fs.mkdirSync(CONTEXT_DIR, { recursive: true });

  let state: CircuitBreakerState = {};
  try {
    if (fs.existsSync(CIRCUIT_BREAKER_FILE)) {
      state = JSON.parse(fs.readFileSync(CIRCUIT_BREAKER_FILE, 'utf-8'));
    }
  } catch { /* ignore */ }

  // 清理非今天的旧 key
  for (const k of Object.keys(state)) {
    if (!k.endsWith('_' + today)) delete state[k];
  }

  state[key] = (state[key] || 0) + 1;
  fs.writeFileSync(CIRCUIT_BREAKER_FILE, JSON.stringify(state, null, 2));
  return state[key];
}
