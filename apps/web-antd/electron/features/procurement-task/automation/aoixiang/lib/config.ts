/**
 * v4 配置加载器
 * 读取 config/purchase-config.json，支持 CLI 覆盖
 */
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { log } from './utils';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface StoreConfig {
  name: string;
  code: string;
  maxItems: number;  // 0 = 不限制
}

export interface TabConfig {
  index: number;
  name: string;
  enabled: boolean;
}

export interface ProcurementRules {
  strict: boolean;
  allowedTabs: string[];
  requireQueryAfterFilter: boolean;
  requireResultVerification: boolean;
  requireNonEmptyCartBeforeOrder: boolean;
  stopOnSupplierMismatch: boolean;
  sortBySales?: boolean;  // 按销量排序（1688平台专用）
}

export interface FailedOrderHandling {
  quantityMismatch: 'adjust' | 'skip';
  mixedBatch: 'split' | 'skip';
  outOfStock: 'skip';
  alreadyOrdered: 'skip';
  maxRetries: number;
}

export interface NotificationConfig {
  webhook: string;
  storeWebhook?: string;  // 门店群webhook（生产通知）
  onSuccess: boolean;
  onFailure: boolean;
}

export interface BrowserConfig {
  headless: boolean;
  userDataDir: string;
}

export interface SupplierRuleMatch {
  id?: string;
  name: string;
  aliases: string[];
  channel?: string;
  allowedTabs?: string[];
}

export interface ProcurementRuleSummary {
  supplierInput: string;
  matchedSupplierRule?: SupplierRuleMatch;
  supplierChannel?: string;
  globalEnabledTabs: string[];
  supplierAllowedTabs: string[];
  finalAllowedTabs: string[];
  strict: boolean;
  requireQueryAfterFilter: boolean;
  requireResultVerification: boolean;
  requireNonEmptyCartBeforeOrder: boolean;
  stopOnSupplierMismatch: boolean;
}

export interface PurchaseConfig {
  supplier: string;
  stores: StoreConfig[];
  tabs: TabConfig[];
  perPage: number;
  cleanCartBefore: boolean;
  procurementRules: ProcurementRules;
  failedOrderHandling: FailedOrderHandling;
  notification: NotificationConfig;
  browser: BrowserConfig;
  procurementRuleSummary: ProcurementRuleSummary;
}

const CONFIG_PATH = path.join(__dirname, '..', 'config', 'purchase-config.json');
const SUPPLIERS_PATH = path.join(__dirname, '..', 'config', 'suppliers.json');

interface SupplierRuleConfig {
  id?: string;
  name: string;
  aliases?: string[];
  channel?: string;
  procurementRules?: Partial<ProcurementRules>;
  enabled?: boolean;
}

interface SupplierRuleResolution {
  matchedSupplierRule?: SupplierRuleMatch;
  procurementRules: Partial<ProcurementRules>;
}

function parseStoreOverride(raw: string): StoreConfig | null {
  const [name, code = '', maxItemsText = '0'] = raw.split('|');
  const normalizedName = `${name || ''}`.trim();
  if (!normalizedName) return null;
  const maxItems = Number.parseInt(`${maxItemsText || '0'}`.trim(), 10);
  return {
    code: `${code || ''}`.trim(),
    maxItems: Number.isFinite(maxItems) ? maxItems : 0,
    name: normalizedName,
  };
}

function normalizeSupplierName(input: string): string {
  return input
    .replace(/[（）()]/g, '')
    .replace(/供应商/g, '')
    .replace(/[\s\-_]/g, '')
    .trim()
    .toLowerCase();
}

function resolveSupplierRule(supplierName: string): SupplierRuleResolution {
  if (!fs.existsSync(SUPPLIERS_PATH)) {
    return { procurementRules: {} };
  }

  try {
    const raw = JSON.parse(fs.readFileSync(SUPPLIERS_PATH, 'utf-8'));
    const normalized = normalizeSupplierName(supplierName);
    const suppliers = Array.isArray(raw?.suppliers) ? raw.suppliers as SupplierRuleConfig[] : [];
    const matched = suppliers.find((supplier) => {
      if (supplier.enabled === false) return false;
      const candidates = [supplier.name, ...(supplier.aliases || [])]
        .map(name => normalizeSupplierName(name))
        .filter(Boolean);
      return candidates.some(name => name === normalized || name.includes(normalized) || normalized.includes(name));
    });

    if (!matched) {
      return { procurementRules: {} };
    }

    return {
      matchedSupplierRule: {
        id: matched.id,
        name: matched.name,
        aliases: matched.aliases || [],
        channel: matched.channel,
        allowedTabs: matched.procurementRules?.allowedTabs,
      },
      procurementRules: matched.procurementRules || {},
    };
  } catch (error) {
    log(`⚠️ 读取供应商规则失败: ${(error as Error).message}`);
    return { procurementRules: {} };
  }
}

function buildProcurementRuleSummary(
  supplierInput: string,
  tabs: TabConfig[],
  matchedSupplierRule: SupplierRuleMatch | undefined,
  procurementRules: ProcurementRules,
): ProcurementRuleSummary {
  const globalEnabledTabs = tabs.filter(t => t.enabled).map(t => t.name);
  return {
    supplierInput,
    matchedSupplierRule,
    supplierChannel: matchedSupplierRule?.channel,
    globalEnabledTabs,
    supplierAllowedTabs: matchedSupplierRule?.allowedTabs || [],
    finalAllowedTabs: procurementRules.allowedTabs,
    strict: procurementRules.strict,
    requireQueryAfterFilter: procurementRules.requireQueryAfterFilter,
    requireResultVerification: procurementRules.requireResultVerification,
    requireNonEmptyCartBeforeOrder: procurementRules.requireNonEmptyCartBeforeOrder,
    stopOnSupplierMismatch: procurementRules.stopOnSupplierMismatch,
  };
}

function mergeProcurementRules(rawRules: Partial<ProcurementRules> | undefined, supplierName: string, tabs: TabConfig[]): {
  procurementRules: ProcurementRules;
  matchedSupplierRule?: SupplierRuleMatch;
} {
  const supplierRuleResolution = resolveSupplierRule(supplierName);
  const supplierRules = supplierRuleResolution.procurementRules;
  const defaultAllowedTabs = tabs.filter(t => t.enabled).map(t => t.name);

  return {
    matchedSupplierRule: supplierRuleResolution.matchedSupplierRule,
    procurementRules: {
      strict: rawRules?.strict ?? supplierRules.strict ?? false,
      allowedTabs: rawRules?.allowedTabs || supplierRules.allowedTabs || defaultAllowedTabs,
      requireQueryAfterFilter: rawRules?.requireQueryAfterFilter ?? supplierRules.requireQueryAfterFilter ?? true,
      requireResultVerification: rawRules?.requireResultVerification ?? supplierRules.requireResultVerification ?? true,
      requireNonEmptyCartBeforeOrder: rawRules?.requireNonEmptyCartBeforeOrder ?? supplierRules.requireNonEmptyCartBeforeOrder ?? true,
      stopOnSupplierMismatch: rawRules?.stopOnSupplierMismatch ?? supplierRules.stopOnSupplierMismatch ?? true,
      sortBySales: rawRules?.sortBySales ?? supplierRules.sortBySales ?? false,
    },
  };
}

function finalizeConfig(config: Omit<PurchaseConfig, 'procurementRuleSummary'>): PurchaseConfig {
  const merged = mergeProcurementRules(config.procurementRules, config.supplier, config.tabs);
  return {
    ...config,
    procurementRules: merged.procurementRules,
    procurementRuleSummary: buildProcurementRuleSummary(
      config.supplier,
      config.tabs,
      merged.matchedSupplierRule,
      merged.procurementRules,
    ),
  };
}

export function loadConfig(overrides?: Partial<PurchaseConfig>): PurchaseConfig {
  let config: Omit<PurchaseConfig, 'procurementRuleSummary'>;

  if (fs.existsSync(CONFIG_PATH)) {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    config = {
      supplier: raw.supplier || '1688平台',
      stores: (raw.stores || []).map((s: any) => ({
        name: s.name,
        code: s.code,
        maxItems: s.maxItems || 0,
      })),
      tabs: (raw.tabs || []).map((t: any) => ({
        index: t.index,
        name: t.name,
        enabled: t.enabled !== false,
      })),
      perPage: raw.perPage || 100,
      cleanCartBefore: raw.cleanCartBefore !== false,
      procurementRules: raw.procurementRules || {},
      failedOrderHandling: {
        quantityMismatch: raw.failedOrderHandling?.quantityMismatch || 'adjust',
        mixedBatch: raw.failedOrderHandling?.mixedBatch || 'skip',
        outOfStock: 'skip',
        alreadyOrdered: 'skip',
        maxRetries: raw.failedOrderHandling?.maxRetries || 3,
      },
      notification: {
        webhook: raw.notification?.webhook || '',
        storeWebhook: raw.notification?.storeWebhook || '',
        onSuccess: raw.notification?.onSuccess !== false,
        onFailure: raw.notification?.onFailure !== false,
      },
      browser: {
        headless: raw.browser?.headless || false,
        userDataDir: raw.browser?.userDataDir
          ? path.resolve(path.dirname(CONFIG_PATH), raw.browser.userDataDir)
          : path.join(__dirname, '..', 'config', 'user_data'),
      },
    };
  } else {
    log(`⚠️ 配置文件不存在: ${CONFIG_PATH}，使用默认配置`);
    config = getDefaultConfig();
  }

  // CLI 覆盖
  if (overrides) {
    if (overrides.supplier) config.supplier = overrides.supplier;
    if (overrides.stores) config.stores = overrides.stores;
  }

  return finalizeConfig(config);
}

function getDefaultConfig(): Omit<PurchaseConfig, 'procurementRuleSummary'> {
  return {
    supplier: '1688平台',
    stores: [],
    tabs: [
      { index: 1, name: '动销售罄待补货', enabled: true },
      { index: 2, name: '售罄待补货', enabled: true },
      { index: 3, name: '建议补货', enabled: true },
    ],
    perPage: 100,
    cleanCartBefore: true,
    procurementRules: {
      strict: false,
      allowedTabs: ['动销售罄待补货', '售罄待补货', '建议补货'],
      requireQueryAfterFilter: true,
      requireResultVerification: true,
      requireNonEmptyCartBeforeOrder: true,
      stopOnSupplierMismatch: true,
    },
    failedOrderHandling: {
      quantityMismatch: 'adjust',
      mixedBatch: 'skip',
      outOfStock: 'skip',
      alreadyOrdered: 'skip',
      maxRetries: 3,
    },
    notification: {
      webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/67eb0f65-edbd-416e-ada7-5f254e1813b4',
      storeWebhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/b1d2eb63-2faf-4c79-8807-0402164f8ecb',
      onSuccess: true,
      onFailure: true,
    },
    browser: {
      headless: false,
      userDataDir: path.join(__dirname, '..', 'config', 'user_data'),
    },
  };
}

/** 解析 CLI 参数，返回配置覆盖 + 运行选项 */
export function parseCLI(): { overrides: Partial<PurchaseConfig>; step?: string; dryRun: boolean } {
  const args = process.argv.slice(2);
  const overrides: Partial<PurchaseConfig> = {};
  const storeOverrides: StoreConfig[] = [];
  let step: string | undefined;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--supplier':
        overrides.supplier = args[++i];
        break;
      case '--max-per-store': {
        const max = parseInt(args[++i], 10);
        // 会在运行时覆盖所有 store 的 maxItems
        overrides.stores = [{ name: '*', code: '*', maxItems: max }];
        break;
      }
      case '--store': {
        const store = parseStoreOverride(args[++i] || '');
        if (store) {
          storeOverrides.push(store);
        }
        break;
      }
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

  if (storeOverrides.length > 0) {
    overrides.stores = storeOverrides;
  }

  return { overrides, step, dryRun };
}
