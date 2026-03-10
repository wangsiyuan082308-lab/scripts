import { app } from 'electron';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const DEFAULT_TARGET_URL =
  'https://nr.ele.me/app/eleme-nr-bfe-newretail/common-next#/pc/orderProcessingPc/tab';
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

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

export interface ResolvedAutomationConfig {
  baseWaitTime: number;
  chromeChannel: string;
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

export interface SavedCoords {
  [storeName: string]: Array<{ x: number; y: number }>;
}

function normalizeTextValue(value: string) {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function normalizeStoreName(value?: string) {
  return String(value || '')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getStoreAlias(value?: string) {
  const normalized = normalizeStoreName(value);
  const matched = normalized.match(/\(([^()]+)\)$/);
  return matched?.[1]?.trim() || normalized;
}

function sanitizeSegment(value: string) {
  return normalizeTextValue(value);
}

function asFiniteNumber(value: unknown, fallback: number) {
  const num = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(num) ? num : fallback;
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? (value as Record<string, any>) : {};
}

function pickFirstString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function pickFirstBoolean(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === 'boolean') {
      return value;
    }
  }
  return undefined;
}

function pickFirstRecord(...values: unknown[]) {
  for (const value of values) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, string>;
    }
  }
  return {};
}

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

export async function saveEvolutionConfig(
  paths: AutomationRuntimePaths,
  config: AutomationEvolutionConfig,
) {
  await fs.writeFile(paths.evolutionFile, JSON.stringify(config, null, 2), 'utf8');
}

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

export async function saveCoords(paths: AutomationRuntimePaths, coords: SavedCoords) {
  await fs.writeFile(paths.coordsFile, JSON.stringify(coords, null, 2), 'utf8');
}

export function resolveAutomationConfig(
  merchant: AutomationMerchantConfig | undefined,
  mode: 'daily' | 'manual',
  evolution: AutomationEvolutionConfig,
): ResolvedAutomationConfig {
  const automation = asRecord(merchant?.automation);
  const elemeAutomation = asRecord(merchant?.elemeAutomation);
  const elemeWithdrawal = asRecord(merchant?.elemeWithdrawal);

  const paymentPassword = pickFirstString(
    elemeWithdrawal.paymentPassword,
    elemeAutomation.paymentPassword,
    automation.elemeWithdrawalPassword,
    automation.withdrawalPassword,
    merchant?.elemeWithdrawalPassword,
    merchant?.withdrawalPassword,
  );

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
    20 * 1000,
  );

  return {
    baseWaitTime: asFiniteNumber(evolution.baseWaitTime, 1000),
    chromeChannel: pickFirstString(elemeWithdrawal.chromeChannel, elemeAutomation.chromeChannel, 'chrome') || 'chrome',
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
