/**
 * v2 配置加载器
 * 读取 config/purchase-config.json，并合并 suppliers.json 中的供应商规则
 */
import * as fs from 'fs';
import * as path from 'path';
import { log } from './utils';
import { SupplierConfig, StoreConfig } from './types-v2';

export interface TimeoutConfig {
  loginWait: number;
  stockCheckTimeout: number;
  orderProcessWait: number;
  exportPollInterval: number;
  exportMaxWait: number;
  pageReady: number;
}

export interface BrowserConfig {
  headless: boolean;
  viewport: { width: number; height: number };
  cdpPort: number;
  userDataDir: string;
}

export interface NotificationConfig {
  webhook: string;
  storeWebhook?: string;
  onSuccess: boolean;
  onFailure: boolean;
}

export interface TaskCenterConfig {
  adviceExportQueryType: string;
  cartExportQueryTypes: string[];
}

export interface ProcurementRules {
  strict: boolean;
  allowedTabs: string[];
  requiredSuggestionFilters: string[];
  requireQueryAfterFilter: boolean;
  requireResultVerification: boolean;
  requireNonEmptyCartBeforeOrder: boolean;
  stopOnSupplierMismatch: boolean;
  allowedCartStatuses: string[];
  allowedOrderStatuses: string[];
  allowedManualSubmittedStatuses: string[];
  allowedWorkflowRoutes: string[];
}

export interface PurchaseConfig {
  supplier: string;
  suppliers: Record<string, SupplierConfig>;
  stores: StoreConfig[];
  maxItems: number;
  analyzerMode: string;
  timeouts: TimeoutConfig;
  retry: { maxRetries: number };
  browser: BrowserConfig;
  notification: NotificationConfig;
  taskCenter: TaskCenterConfig;
  baseUrl: string;
  procurementRules: ProcurementRules;
}

const CONFIG_PATH = path.join(__dirname, '..', '..', 'config', 'purchase-config.json');
const SUPPLIERS_PATH = path.join(__dirname, '..', '..', 'config', 'suppliers.json');

export interface SupplierRuleConfig {
  id?: string;
  name: string;
  aliases?: string[];
  enabled?: boolean;
  procurementRules?: Partial<ProcurementRules>;
}

function normalizeSupplierName(input: string): string {
  return input
    .replace(/[（）()]/g, '')
    .replace(/供应商/g, '')
    .replace(/平台/g, '')
    .replace(/[\s\-_]/g, '')
    .trim()
    .toLowerCase();
}

function readSupplierRuleConfigs(): SupplierRuleConfig[] {
  if (!fs.existsSync(SUPPLIERS_PATH)) return [];

  try {
    const raw = JSON.parse(fs.readFileSync(SUPPLIERS_PATH, 'utf-8'));
    return Array.isArray(raw?.suppliers) ? raw.suppliers as SupplierRuleConfig[] : [];
  } catch (error) {
    log('WARNING: 读取供应商规则失败: ' + (error as Error).message);
    return [];
  }
}

export function findSupplierRule(supplierName: string): SupplierRuleConfig | undefined {
  const normalized = normalizeSupplierName(supplierName);
  const suppliers = readSupplierRuleConfigs();
  return suppliers.find((supplier) => {
    if (supplier.enabled === false) return false;
    const candidates = [supplier.name, ...(supplier.aliases || [])]
      .map((name) => normalizeSupplierName(name))
      .filter(Boolean);
    return candidates.some((name) => name === normalized || name.includes(normalized) || normalized.includes(name));
  });
}

export function getSupplierAliases(config: PurchaseConfig, supplier: string): string[] {
  const aliases = new Set<string>([supplier]);
  const normalized = normalizeSupplierName(supplier);

  for (const key of Object.keys(config.suppliers || {})) {
    const supplierConfig = config.suppliers[key];
    const candidates = [key, supplierConfig?.name, ...(supplierConfig?.aliases || []), supplierConfig?.code]
      .filter((value): value is string => Boolean(value && value.trim()));
    const matched = candidates.some((candidate) => {
      const normalizedCandidate = normalizeSupplierName(candidate);
      return normalizedCandidate === normalized
        || normalizedCandidate.includes(normalized)
        || normalized.includes(normalizedCandidate);
    });
    if (matched) {
      candidates.forEach((candidate) => aliases.add(candidate));
    }
  }

  const supplierRule = findSupplierRule(supplier);
  if (supplierRule) {
    [supplierRule.name, ...(supplierRule.aliases || [])].forEach((alias) => {
      if (alias?.trim()) aliases.add(alias);
    });
  }

  if (normalized.includes('1688') || normalized === '1688') {
    ['1688平台', '1688', '阿里', '阿里巴巴', 'PDD'].forEach(alias => aliases.add(alias));
  }

  return Array.from(aliases).filter(Boolean);
}

function loadSupplierRules(supplierName: string): Partial<ProcurementRules> {
  return findSupplierRule(supplierName)?.procurementRules || {};
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value && value.trim()))));
}

function mergeStringList(
  rawValues: string[] | undefined,
  supplierValues: string[] | undefined,
  fallbackValues: string[],
): string[] {
  if (rawValues && rawValues.length > 0) return uniqueStrings(rawValues);
  if (supplierValues && supplierValues.length > 0) return uniqueStrings(supplierValues);
  return uniqueStrings(fallbackValues);
}

function mergeSupplierConfigs(rawSuppliers: Record<string, SupplierConfig> | undefined): Record<string, SupplierConfig> {
  const merged: Record<string, SupplierConfig> = { ...(rawSuppliers || {}) };

  for (const rule of readSupplierRuleConfigs()) {
    if (rule.enabled === false || !rule.name) continue;
    const existingKey = Object.keys(merged).find((key) => normalizeSupplierName(key) === normalizeSupplierName(rule.name));
    const targetKey = existingKey || rule.name;
    const existing = merged[targetKey];
    merged[targetKey] = {
      name: existing?.name || rule.name,
      code: existing?.code,
      aliases: uniqueStrings([...(existing?.aliases || []), ...(rule.aliases || [])]),
      type: existing?.type || '1688线上',
    };
  }

  return merged;
}

function mergeProcurementRules(rawRules: Partial<ProcurementRules> | undefined, supplierName: string): ProcurementRules {
  const supplierRules = loadSupplierRules(supplierName);

  return {
    strict: rawRules?.strict ?? supplierRules.strict ?? true,
    allowedTabs: mergeStringList(rawRules?.allowedTabs, supplierRules.allowedTabs, ['店仓补货', '动销售罄待补货', '售罄待补货']),
    requiredSuggestionFilters: mergeStringList(rawRules?.requiredSuggestionFilters, supplierRules.requiredSuggestionFilters, ['建议量>0', '满足补货点']),
    requireQueryAfterFilter: rawRules?.requireQueryAfterFilter ?? supplierRules.requireQueryAfterFilter ?? true,
    requireResultVerification: rawRules?.requireResultVerification ?? supplierRules.requireResultVerification ?? true,
    requireNonEmptyCartBeforeOrder: rawRules?.requireNonEmptyCartBeforeOrder ?? supplierRules.requireNonEmptyCartBeforeOrder ?? true,
    stopOnSupplierMismatch: rawRules?.stopOnSupplierMismatch ?? supplierRules.stopOnSupplierMismatch ?? true,
    allowedCartStatuses: mergeStringList(rawRules?.allowedCartStatuses, supplierRules.allowedCartStatuses, ['可补货', '待补货', '补货中']),
    allowedOrderStatuses: mergeStringList(rawRules?.allowedOrderStatuses, supplierRules.allowedOrderStatuses, ['待下单', '未下单']),
    allowedManualSubmittedStatuses: mergeStringList(rawRules?.allowedManualSubmittedStatuses, supplierRules.allowedManualSubmittedStatuses, ['待付款', '待支付']),
    allowedWorkflowRoutes: mergeStringList(
      rawRules?.allowedWorkflowRoutes,
      supplierRules.allowedWorkflowRoutes,
      [
        '/purchase/replenishment/refer',
        '/purchase/replenish-dispatch/detail-list',
        '/purchase/replenish-dispatch/order-splitting-preview',
        '/purchase/purchase-order/list',
      ],
    ),
  };
}

function finalizeConfig(config: PurchaseConfig): PurchaseConfig {
  return {
    ...config,
    procurementRules: mergeProcurementRules(config.procurementRules, config.supplier),
  };
}

export function loadConfig(overrides?: Partial<PurchaseConfig>): PurchaseConfig {
  let config: PurchaseConfig;

  if (fs.existsSync(CONFIG_PATH)) {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    config = {
      supplier: raw.supplier || '集采-十月结晶',
      suppliers: mergeSupplierConfigs(raw.suppliers),
      stores: (raw.stores || []).map((s: any) => ({
        name: s.name,
        maxItems: s.maxItems || 0,
      })),
      maxItems: raw.maxItems || 500,
      analyzerMode: raw.analyzerMode || 'week',
      timeouts: {
        loginWait: raw.timeouts?.loginWait || 60000,
        stockCheckTimeout: raw.timeouts?.stockCheckTimeout || 300000,
        orderProcessWait: raw.timeouts?.orderProcessWait || 60000,
        exportPollInterval: raw.timeouts?.exportPollInterval || 5000,
        exportMaxWait: raw.timeouts?.exportMaxWait || 120000,
        pageReady: raw.timeouts?.pageReady || 15000,
      },
      retry: { maxRetries: raw.retry?.maxRetries || 3 },
      browser: {
        headless: raw.browser?.headless || false,
        viewport: raw.browser?.viewport || { width: 1440, height: 900 },
        cdpPort: raw.browser?.cdpPort || 18792,
        userDataDir: raw.browser?.userDataDir
          ? path.resolve(path.dirname(CONFIG_PATH), raw.browser.userDataDir)
          : path.join(__dirname, '..', '..', '..', 'eleme-activity-assistant', 'user_data'),
      },
      notification: {
        webhook: raw.notification?.webhook || 'https://open.feishu.cn/open-apis/bot/v2/hook/67eb0f65-edbd-416e-ada7-5f254e1813b4',
        storeWebhook: raw.notification?.storeWebhook || '',
        onSuccess: raw.notification?.onSuccess !== false,
        onFailure: raw.notification?.onFailure !== false,
      },
      taskCenter: {
        adviceExportQueryType: raw.taskCenter?.adviceExportQueryType || 'BATCH_EXPORT_REPLENISH_REFERENCE',
        cartExportQueryTypes: raw.taskCenter?.cartExportQueryTypes || ['', 'BATCH_EXPORT_REPLENISH_LIST'],
      },
      baseUrl: raw.baseUrl || 'https://qnh.meituan.com',
      procurementRules: mergeProcurementRules(raw.procurementRules, raw.supplier || '集采-十月结晶'),
    };
  } else {
    log('WARNING: 配置文件不存在: ' + CONFIG_PATH + '，使用默认配置');
    config = getDefaultConfig();
  }

  if (overrides) {
    if (overrides.supplier) config.supplier = overrides.supplier;
    if (overrides.stores && overrides.stores.length > 0) config.stores = overrides.stores;
    if (overrides.maxItems !== undefined) config.maxItems = overrides.maxItems;
    if (overrides.analyzerMode) config.analyzerMode = overrides.analyzerMode;
  }

  return finalizeConfig(config);
}

function getDefaultConfig(): PurchaseConfig {
  return {
    supplier: '集采-十月结晶',
    suppliers: mergeSupplierConfigs({
      '集采-十月结晶': { name: '集采-十月结晶', type: '1688线上' },
      '集采-卫生巾供应商': { name: '集采-卫生巾供应商', code: '20251223', type: '1688线上' },
    }),
    stores: [],
    maxItems: 500,
    analyzerMode: 'week',
    timeouts: {
      loginWait: 60000,
      stockCheckTimeout: 300000,
      orderProcessWait: 60000,
      exportPollInterval: 5000,
      exportMaxWait: 120000,
      pageReady: 15000,
    },
    retry: { maxRetries: 3 },
    browser: {
      headless: false,
      viewport: { width: 1440, height: 900 },
      cdpPort: 18792,
      userDataDir: path.join(__dirname, '..', '..', '..', 'eleme-activity-assistant', 'user_data'),
    },
    notification: {
      webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/67eb0f65-edbd-416e-ada7-5f254e1813b4',
      onSuccess: true,
      onFailure: true,
    },
    taskCenter: {
      adviceExportQueryType: 'BATCH_EXPORT_REPLENISH_REFERENCE',
      cartExportQueryTypes: ['', 'BATCH_EXPORT_REPLENISH_LIST', 'INF_TASK_$$2y85bq$$300003'],
    },
    baseUrl: 'https://qnh.meituan.com',
    procurementRules: {
      strict: true,
      allowedTabs: ['店仓补货', '动销售罄待补货', '售罄待补货'],
      requiredSuggestionFilters: ['建议量>0', '满足补货点'],
      requireQueryAfterFilter: true,
      requireResultVerification: true,
      requireNonEmptyCartBeforeOrder: true,
      stopOnSupplierMismatch: true,
      allowedCartStatuses: ['可补货', '待补货', '补货中'],
      allowedOrderStatuses: ['待下单', '未下单'],
      allowedManualSubmittedStatuses: ['待付款', '待支付'],
      allowedWorkflowRoutes: [
        '/purchase/replenishment/refer',
        '/purchase/replenish-dispatch/detail-list',
        '/purchase/replenish-dispatch/order-splitting-preview',
        '/purchase/purchase-order/list',
      ],
    },
  };
}

/** Parse CLI args, return config overrides + run options */
export function parseCLI(): {
  overrides: Partial<PurchaseConfig>;
  step?: string;
  dryRun: boolean;
} {
  const args = process.argv.slice(2);
  const overrides: Partial<PurchaseConfig> = {};
  let step: string | undefined;
  let dryRun = false;
  const storeNames: string[] = [];

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--supplier':
        overrides.supplier = args[++i];
        break;
      case '--store':
        storeNames.push(args[++i]);
        break;
      case '--max-items': {
        const max = parseInt(args[++i], 10);
        if (!isNaN(max)) overrides.maxItems = max;
        break;
      }
      case '--mode':
        overrides.analyzerMode = args[++i];
        break;
      case '--step':
        step = args[++i];
        break;
      case '--dry-run':
        dryRun = true;
        break;
      default:
        if (!args[i].startsWith('--')) {
          overrides.supplier = args[i];
        }
    }
  }

  if (storeNames.length > 0) {
    overrides.stores = storeNames.map(name => ({ name, maxItems: 0 }));
  }

  return { overrides, step, dryRun };
}
