import { app } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const DEFAULT_TARGET_URL =
  'https://nr.ele.me/app/eleme-nr-bfe-newretail/common-next#/pc/orderProcessingPc/tab';
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * 商户侧可配置的自动提现参数集合。
 */
export interface AutomationMerchantConfig {
  automation?: Record<string, any>;
  elemeAutomation?: Record<string, any>;
  elemeWithdrawal?: Record<string, any>;
  elemeWithdrawalPassword?: string;
  elemeWithdrawalStoreMappings?: Record<string, string>;
  elemeWithdrawalTargetUrl?: string;
  elemeWithdrawalUserAgent?: string;
  elemeWithdrawalEnabled?: boolean;
  elemeWithdrawalMinAmount?: number | string;
  id?: string;
  minWithdrawAmount?: number | string;
  name?: string;
  withdrawalPassword?: string;
  [key: string]: any;
}

/**
 * 自动化运行过程中的演化配置。
 * 用于记录学习到的按钮文案、等待时间和风控阈值。
 */
export interface AutomationEvolutionConfig {
  actionHints?: {
    confirmSubmitText?: string;
    withdrawEntryText?: string;
  };
  baseWaitTime: number;
  failureThreshold: number;
  maxWaitTime: number;
  userAgent: string;
}

/**
 * 自动化运行时依赖的目录与文件路径。
 */
export interface AutomationRuntimePaths {
  coordsFile: string;
  debugDir: string;
  evolutionFile: string;
  logsDir: string;
  merchantDir: string;
  metricsDir: string;
  profileDir: string;
  runtimeRoot: string;
}

/**
 * 解析后的最终自动化配置。
 * 已融合商户配置、默认值和演化配置。
 */
export interface ResolvedAutomationConfig {
  baseWaitTime: number;
  chromeChannel: string;
  /** 底部确认提现按钮的外部选择器，支持按商户覆盖 */
  confirmSubmitSelectors: string[];
  enabled: boolean;
  loginTimeoutMs: number;
  manualLoginTimeoutMs: number;
  maxWaitTime: number;
  minWithdrawAmount: number;
  paymentPassword?: string;
  scheduledLoginTimeoutMs: number;
  storeNameMappings: Record<string, string>;
  targetUrl: string;
  userAgent: string;
}

/**
 * 历史记录的门店坐标缓存。
 */
export interface SavedCoords {
  [storeName: string]: Array<{ x: number; y: number }>;
}

/**
 * 将文本转换为适合目录/文件名的安全值。
 */
function normalizeTextValue(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * 规范化门店名称，统一括号、空格等差异。
 */
export function normalizeStoreName(value?: string) {
  return String(value || '')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 提取门店别名；若无括号后缀则返回原门店名。
 */
export function getStoreAlias(value?: string) {
  const normalized = normalizeStoreName(value);
  const matched = normalized.match(/\(([^()]+)\)$/);
  return matched?.[1]?.trim() || normalized;
}

/**
 * 清洗路径片段，避免目录名包含非法字符。
 */
function sanitizeSegment(value: string) {
  return normalizeTextValue(value);
}

/**
 * 安全解析数字，失败时回退到默认值。
 */
function asFiniteNumber(value: unknown, fallback: number) {
  const num = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(num) ? num : fallback;
}

/**
 * 安全将未知值收敛为对象字典。
 */
function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? (value as Record<string, any>) : {};
}

/**
 * 从多个候选值中取第一个非空字符串。
 */
function pickFirstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}


function resolvePaymentPasswordFromSource(source: Record<string, any> | undefined) {
  const automation = asRecord(source?.automation);
  const elemeAutomation = asRecord(source?.elemeAutomation);
  const elemeWithdrawal = asRecord(source?.elemeWithdrawal);

  return pickFirstString(
    elemeWithdrawal.paymentPassword,
    elemeAutomation.paymentPassword,
    automation.elemeWithdrawalPassword,
    automation.withdrawalPassword,
    source?.elemeWithdrawalPassword,
    source?.withdrawalPassword,
  );
}

/**
 * 从多个候选值中取第一个布尔值。
 */
function pickFirstBoolean(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'boolean') {
      return value;
    }
  }
  return undefined;
}

/**
 * 从多个候选值中取第一个对象字典。
 */
function pickFirstRecord(...values: unknown[]) {
  for (const value of values) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, string>;
    }
  }
  return {};
}


/**
 * 将单个字符串或字符串数组规整为字符串数组。
 */
function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return [];
}

/**
 * 从多个候选值中取第一组有效字符串数组。
 */
function pickFirstStringArray(...values: unknown[]) {
  for (const value of values) {
    const normalized = asStringArray(value);
    if (normalized.length > 0) {
      return normalized;
    }
  }
  return [];
}

/**
 * 生成指定商户的自动化运行目录结构。
 */
export function getAutomationRuntimePaths(merchantId?: string): AutomationRuntimePaths {
  const runtimeRoot = path.join(app.getPath('userData'), 'withdrawal-runtime');
  const merchantDir = path.join(runtimeRoot, sanitizeSegment(merchantId || 'default'));
  return {
    coordsFile: path.join(merchantDir, 'coords.json'),
    debugDir: path.join(merchantDir, 'debug'),
    evolutionFile: path.join(merchantDir, 'evolution.json'),
    logsDir: path.join(merchantDir, 'logs'),
    merchantDir,
    metricsDir: path.join(merchantDir, 'logs', 'metrics'),
    profileDir: path.join(merchantDir, 'profile'),
    runtimeRoot,
  };
}

/**
 * 确保自动化运行所需目录全部存在。
 */
export async function ensureAutomationRuntime(paths: AutomationRuntimePaths) {
  await Promise.all([
    fs.mkdir(paths.runtimeRoot, { recursive: true }),
    fs.mkdir(paths.merchantDir, { recursive: true }),
    fs.mkdir(paths.profileDir, { recursive: true }),
    fs.mkdir(paths.logsDir, { recursive: true }),
    fs.mkdir(paths.metricsDir, { recursive: true }),
    fs.mkdir(paths.debugDir, { recursive: true }),
  ]);
}

/**
 * 读取演化配置；若文件不存在则返回默认配置。
 */
export async function loadEvolutionConfig(paths: AutomationRuntimePaths): Promise<AutomationEvolutionConfig> {
  const fallback: AutomationEvolutionConfig = {
    actionHints: {},
    baseWaitTime: 1000,
    failureThreshold: 3,
    maxWaitTime: 10_000,
    userAgent: DEFAULT_USER_AGENT,
  };

  try {
    const content = await fs.readFile(paths.evolutionFile, 'utf8');
    const parsed = JSON.parse(content);
    return {
      actionHints:
        parsed?.actionHints && typeof parsed.actionHints === 'object'
          ? {
              confirmSubmitText: pickFirstString(parsed?.actionHints?.confirmSubmitText),
              withdrawEntryText: pickFirstString(parsed?.actionHints?.withdrawEntryText),
            }
          : {},
      baseWaitTime: asFiniteNumber(parsed?.baseWaitTime, fallback.baseWaitTime),
      failureThreshold: asFiniteNumber(parsed?.failureThreshold, fallback.failureThreshold),
      maxWaitTime: asFiniteNumber(parsed?.maxWaitTime, fallback.maxWaitTime),
      userAgent: pickFirstString(parsed?.userAgent, fallback.userAgent) || fallback.userAgent,
    };
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return fallback;
    }
    throw error;
  }
}

/**
 * 持久化演化配置。
 */
export async function saveEvolutionConfig(
  paths: AutomationRuntimePaths,
  config: AutomationEvolutionConfig,
) {
  await fs.writeFile(paths.evolutionFile, JSON.stringify(config, null, 2), 'utf8');
}

/**
 * 读取门店坐标缓存。
 */
export async function loadCoords(paths: AutomationRuntimePaths): Promise<SavedCoords> {
  try {
    const content = await fs.readFile(paths.coordsFile, 'utf8');
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return {};
    }
    throw error;
  }
}

/**
 * 保存门店坐标缓存。
 */
export async function saveCoords(paths: AutomationRuntimePaths, coords: SavedCoords) {
  await fs.writeFile(paths.coordsFile, JSON.stringify(coords, null, 2), 'utf8');
}

/**
 * 融合商户配置、默认值与演化配置，得到最终执行参数。
 */
export function resolveAutomationConfig(
  merchant: AutomationMerchantConfig | undefined,
  mode: 'daily' | 'manual',
  evolution: AutomationEvolutionConfig,
): ResolvedAutomationConfig {
  const automation = asRecord(merchant?.automation);
  const elemeAutomation = asRecord(merchant?.elemeAutomation);
  const elemeWithdrawal = asRecord(merchant?.elemeWithdrawal);

  // 提现密码只允许门店维度配置，商户维度不再兜底。
  const paymentPassword = undefined;

  const minWithdrawAmount = asFiniteNumber(
    elemeWithdrawal.minWithdrawAmount ??
      elemeAutomation.minWithdrawAmount ??
      automation.elemeWithdrawalMinAmount ??
      merchant?.elemeWithdrawalMinAmount ??
      merchant?.minWithdrawAmount,
    0,
  );

  const storeNameMappings = pickFirstRecord(
    elemeWithdrawal.storeNameMappings,
    elemeAutomation.storeNameMappings,
    automation.storeNameMappings,
    merchant?.elemeWithdrawalStoreMappings,
  );

  const enabled =
    pickFirstBoolean(
      elemeWithdrawal.enabled,
      elemeAutomation.enabled,
      automation.elemeWithdrawalEnabled,
      merchant?.elemeWithdrawalEnabled,
    ) ?? true;

  const targetUrl =
    pickFirstString(
      elemeWithdrawal.targetUrl,
      elemeAutomation.targetUrl,
      automation.elemeWithdrawalTargetUrl,
      merchant?.elemeWithdrawalTargetUrl,
    ) || DEFAULT_TARGET_URL;

  const userAgent =
    pickFirstString(
      elemeWithdrawal.userAgent,
      elemeAutomation.userAgent,
      automation.elemeWithdrawalUserAgent,
      merchant?.elemeWithdrawalUserAgent,
      evolution.userAgent,
    ) || DEFAULT_USER_AGENT;

  const manualLoginTimeoutMs = asFiniteNumber(
    elemeWithdrawal.manualLoginTimeoutMs ?? elemeAutomation.manualLoginTimeoutMs,
    5 * 60 * 1000,
  );
  const scheduledLoginTimeoutMs = asFiniteNumber(
    elemeWithdrawal.scheduledLoginTimeoutMs ?? elemeAutomation.scheduledLoginTimeoutMs,
    5 * 60 * 1000,
  );
  const confirmSubmitSelectors = pickFirstStringArray(
    elemeWithdrawal.confirmSubmitSelectors,
    elemeWithdrawal.confirmSubmitSelector,
    elemeWithdrawal.actionSelectors?.confirmSubmit,
    elemeAutomation.confirmSubmitSelectors,
    elemeAutomation.confirmSubmitSelector,
    elemeAutomation.actionSelectors?.confirmSubmit,
    automation.elemeWithdrawalConfirmSubmitSelectors,
    automation.elemeWithdrawalConfirmSubmitSelector,
    automation.actionSelectors?.confirmSubmit,
  );

  return {
    baseWaitTime: asFiniteNumber(evolution.baseWaitTime, 1000),
    chromeChannel: pickFirstString(elemeWithdrawal.chromeChannel, elemeAutomation.chromeChannel, 'chrome') || 'chrome',
    confirmSubmitSelectors,
    enabled,
    loginTimeoutMs: mode === 'manual' ? manualLoginTimeoutMs : scheduledLoginTimeoutMs,
    manualLoginTimeoutMs,
    maxWaitTime: asFiniteNumber(evolution.maxWaitTime, 10_000),
    minWithdrawAmount,
    paymentPassword,
    scheduledLoginTimeoutMs,
    storeNameMappings,
    targetUrl,
    userAgent,
  };
}

/**
 * 根据门店 ID、原始门店名和映射关系，解析最终用于页面匹配的目标门店名。
 */

export function resolveStorePaymentPassword(
  store: Record<string, any> | undefined,
) {
  return resolvePaymentPasswordFromSource(store);
}

export function resolveStoreTargetName(
  storeId: string,
  fallbackStoreName: string,
  config: ResolvedAutomationConfig,
) {
  const normalizedStoreId = normalizeStoreName(storeId);
  const normalizedFallbackName = normalizeStoreName(fallbackStoreName);
  const mappingEntry = Object.entries(config.storeNameMappings).find(([key]) => {
    const normalizedKey = normalizeStoreName(key);
    return (
      normalizedKey === normalizedStoreId ||
      normalizedKey === normalizedFallbackName
    );
  });

  const resolved =
    config.storeNameMappings[storeId] ||
    config.storeNameMappings[fallbackStoreName] ||
    mappingEntry?.[1] ||
    fallbackStoreName ||
    storeId;

  return getStoreAlias(resolved);
}
