import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  extractSharedAiConfig,
  getSharedAiConfig,
  saveSharedAiConfig,
} from '../../shared/ai-config';
import {
  ensureProductMasterIndex,
  type ProductMasterIndex,
  type ProductMasterRecord,
  type ProductMasterStoreRecord,
} from '../product-master/index';
import { readExcelWithSchema } from '../../utils/excel-helper';

export type ProductCompareSourceMode = 'custom' | 'productMaster';
export type ProductCompareMatchType = 'ai_fuzzy' | 'unmatched' | 'upc_exact';
export type ProductCompareResultType =
  | 'invalid'
  | 'new_product_candidate'
  | 'price_compare'
  | 'unmatched_pending';
export type ProductCompareCheaperSide =
  | 'equal'
  | 'reference'
  | 'target'
  | 'unknown';

export interface ProductCompareAiConfig {
  apiKey: string;
  baseUrl: string;
  matchPromptTemplate: string;
  model: string;
  newProductMonthlySalesThreshold: number;
}

export interface ProductCompareRunPayload {
  referenceBuffer?: Buffer;
  sourceMode: ProductCompareSourceMode;
  targetBuffer: Buffer;
}

export interface ProductCompareRecordSide {
  monthlySales?: null | number;
  procurementCost?: null | number;
  productName: string;
  purchaseUnit?: string;
  rawData: Record<string, any>;
  sku: string;
  sourceLabel: string;
  specification: string;
  supplierCode?: string;
  supplierName?: string;
  supplierProductLink?: string;
  supplierProductName?: string;
  supplierProductSpec?: string;
  upc: string;
}

export interface ProductCompareResult {
  cheaperSide: ProductCompareCheaperSide;
  comparisonName: string;
  conclusion: string;
  id: string;
  matchConfidence?: null | number;
  matchReason?: string;
  matchType: ProductCompareMatchType;
  priceDiff?: null | number;
  reference?: null | ProductCompareRecordSide;
  resultType: ProductCompareResultType;
  target: ProductCompareRecordSide;
}

export interface ProductCompareRunStats {
  aiMatchedCount: number;
  aiNoMatchCount: number;
  aiSkippedCount: number;
  candidateCount: number;
  exactMatchedCount: number;
  invalidCount: number;
  newProductCandidateCount: number;
  priceCompareCount: number;
  targetCount: number;
  unmatchedPendingCount: number;
}

export interface ProductCompareRunResult {
  aiConfig: ProductCompareAiConfig;
  results: ProductCompareResult[];
  stats: ProductCompareRunStats;
  summary: string;
}

interface RuntimePaths {
  configPath: string;
  dataDir: string;
}

interface ParsedCompareRow {
  monthlySales: null | number;
  procurementCost: null | number;
  productName: string;
  purchaseUnit: string;
  rawData: Record<string, any>;
  rowId: string;
  sku: string;
  specification: string;
  supplierCode: string;
  supplierName: string;
  supplierProductLink: string;
  supplierProductName: string;
  supplierProductSpec: string;
  upc: string;
}

interface ComparisonCandidate extends ParsedCompareRow {
  candidateId: string;
  sourceLabel: string;
}

interface AICandidateSelection {
  candidateId: string;
  confidence?: number;
  matched: boolean;
  reason?: string;
}

const PRODUCT_COMPARE_DIRNAME = 'product-compare';
const PRODUCT_COMPARE_CONFIG_FILENAME = 'ai-config.json';

const DEFAULT_MATCH_PROMPT_TEMPLATE = [
  '你是商品比对助手。',
  '请从候选商品中为目标商品选择最可能的同款商品，只允许返回 JSON，不要返回 Markdown。',
  '判断时只考虑这些字段：商品名称、规格、供应商商品名称、供应商商品规格、供应商名称。',
  '如果没有把握，请返回 unmatched=false。',
  '',
  '目标商品：',
  '{{target}}',
  '',
  '候选商品列表：',
  '{{candidates}}',
  '',
  '仅返回如下 JSON：',
  '{"matched":true,"candidateId":"候选ID","confidence":0.91,"reason":"匹配理由"}',
  '或',
  '{"matched":false,"candidateId":"","confidence":0.2,"reason":"未找到足够可信的候选"}',
].join('\n');

const DEFAULT_AI_CONFIG: ProductCompareAiConfig = {
  apiKey: '',
  baseUrl: 'https://coding.dashscope.aliyuncs.com/v1/chat/completions',
  matchPromptTemplate: DEFAULT_MATCH_PROMPT_TEMPLATE,
  model: 'qwen3.5-plus',
  newProductMonthlySalesThreshold: 10,
};

const COMPARE_SCHEMA = [
  { key: 'upc', aliases: ['商品UPC', 'UPC', '商品条码', '条码', '商品条形码'] },
  { key: 'sku', aliases: ['商品SKU', 'SKU', '商品编码', 'SKU编码'], required: false },
  { key: 'productName', aliases: ['商品名称', '名称'], required: false },
  { key: 'specification', aliases: ['规格', '商品规格'], required: false },
  {
    key: 'procurementCost',
    aliases: ['采购价(门店采购价)', '采购价', '门店采购价', '进价', '采购单价'],
    required: false,
  },
  {
    key: 'monthlySales',
    aliases: ['月销', '月销量', '30天销量', '近30天销量', '30日销量'],
    required: false,
  },
  { key: 'supplierName', aliases: ['供应商名称', '供应商', '发货方名称'], required: false },
  { key: 'supplierCode', aliases: ['供应商编码', '发货方编码'], required: false },
  {
    key: 'supplierProductName',
    aliases: ['供应商商品名称', '货盘商品名称', '供应商货品名称'],
    required: false,
  },
  {
    key: 'supplierProductSpec',
    aliases: ['供应商商品规格', '货盘商品规格', '供应商货品规格'],
    required: false,
  },
  {
    key: 'supplierProductLink',
    aliases: ['采购链接', '供应商商品链接', '商品链接', '供应商链接'],
    required: false,
  },
  { key: 'purchaseUnit', aliases: ['采购单位', '补货单位', '单位'], required: false },
] as const;

function normalizeText(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeKey(value: unknown) {
  return normalizeText(value).replace(/[\s()（）\-_/]/g, '').toLowerCase();
}

function normalizeUpc(value: unknown) {
  let text = normalizeText(value).replace(/\s+/g, '');
  if (!text) return '';
  if (/^\d+\.0+$/.test(text)) {
    text = text.replace(/\.0+$/, '');
  }
  return text;
}

function toNumber(value: unknown): null | number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const text = normalizeText(value).replace(/,/g, '');
  if (!text) return null;
  const parsed = Number.parseFloat(text.replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function uniqueStrings(values: Array<unknown>) {
  return [...new Set(values.map((value) => normalizeText(value)).filter(Boolean))];
}

function buildSummary(stats: ProductCompareRunStats) {
  return [
    '商品比对完成',
    `目标商品数: ${stats.targetCount}`,
    `候选商品数: ${stats.candidateCount}`,
    `UPC精确匹配: ${stats.exactMatchedCount}`,
    `AI模糊匹配: ${stats.aiMatchedCount}`,
    `AI未命中/失败: ${stats.aiNoMatchCount}`,
    `无需AI或无候选: ${stats.aiSkippedCount}`,
    `采购价对比: ${stats.priceCompareCount}`,
    `新品引入候选: ${stats.newProductCandidateCount}`,
    `未匹配待确认: ${stats.unmatchedPendingCount}`,
    `异常数据: ${stats.invalidCount}`,
  ].join('\n');
}

function getDefaultRuntimeRoot() {
  if (process.env.PRODUCT_COMPARE_HOME) {
    return process.env.PRODUCT_COMPARE_HOME;
  }
  return path.join(os.homedir(), '.scriptai', PRODUCT_COMPARE_DIRNAME);
}

function getRuntimePaths(): RuntimePaths {
  const dataDir = getDefaultRuntimeRoot();
  return {
    configPath: path.join(dataDir, PRODUCT_COMPARE_CONFIG_FILENAME),
    dataDir,
  };
}

async function ensureDirectory(dirPath: string) {
  await fs.promises.mkdir(dirPath, { recursive: true });
}

async function writeJsonAtomic(filePath: string, data: unknown) {
  await ensureDirectory(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.promises.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
  await fs.promises.rename(tempPath, filePath);
}

async function readJsonFile<T>(filePath: string): Promise<null | T> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf8');
    return JSON.parse(content) as T;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function normalizeAiFeatureConfig(
  input?: Partial<ProductCompareAiConfig> | null,
): Pick<
  ProductCompareAiConfig,
  'matchPromptTemplate' | 'newProductMonthlySalesThreshold'
> {
  const merged = {
    ...DEFAULT_AI_CONFIG,
    ...(input || {}),
  };

  return {
    matchPromptTemplate:
      normalizeText(merged.matchPromptTemplate) ||
      DEFAULT_AI_CONFIG.matchPromptTemplate,
    newProductMonthlySalesThreshold:
      toNumber(merged.newProductMonthlySalesThreshold) ??
      DEFAULT_AI_CONFIG.newProductMonthlySalesThreshold,
  };
}

function mergeAiConfig(
  sharedConfig: Pick<ProductCompareAiConfig, 'apiKey' | 'baseUrl' | 'model'>,
  featureConfig: Pick<
    ProductCompareAiConfig,
    'matchPromptTemplate' | 'newProductMonthlySalesThreshold'
  >,
): ProductCompareAiConfig {
  return {
    ...DEFAULT_AI_CONFIG,
    ...sharedConfig,
    ...featureConfig,
  };
}

export async function getProductCompareAiConfig() {
  const paths = getRuntimePaths();
  await ensureDirectory(paths.dataDir);
  const rawConfig = await readJsonFile<Partial<ProductCompareAiConfig>>(paths.configPath);
  const sharedConfig = await getSharedAiConfig();
  const featureConfig = normalizeAiFeatureConfig(rawConfig);
  return mergeAiConfig(sharedConfig, featureConfig);
}

export async function saveProductCompareAiConfig(
  config: Partial<ProductCompareAiConfig>,
) {
  const paths = getRuntimePaths();
  const sharedConfig = await saveSharedAiConfig(extractSharedAiConfig(config));
  const featureConfig = normalizeAiFeatureConfig(config);
  await writeJsonAtomic(paths.configPath, featureConfig);
  return mergeAiConfig(sharedConfig, featureConfig);
}

function assertSchemaCapability(
  fieldMap: Record<string, string>,
  headers: string[],
  label: string,
  options?: {
    requireAiText?: boolean;
    requireUpc?: boolean;
  },
) {
  if (options?.requireUpc !== false && !fieldMap.upc) {
    throw new Error(
      `${label}缺少 UPC 字段，当前识别到的表头: [${headers.join(', ')}]`,
    );
  }

  if (
    options?.requireAiText &&
    !fieldMap.productName &&
    !fieldMap.specification &&
    !fieldMap.supplierProductName &&
    !fieldMap.supplierProductSpec
  ) {
    throw new Error(
      `${label}至少需要识别 商品名称/规格/供应商商品名称/供应商商品规格 其中之一，当前表头: [${headers.join(', ')}]`,
    );
  }
}

function getFieldValue(
  row: Record<string, any>,
  fieldMap: Record<string, string>,
  key: string,
) {
  const header = fieldMap[key];
  return header ? row[header] : undefined;
}

function hasMeaningfulRowContent(row: ParsedCompareRow) {
  return Boolean(
    row.upc ||
      row.productName ||
      row.specification ||
      row.supplierProductName ||
      row.supplierProductSpec ||
      row.sku,
  );
}

function toSide(
  row: ParsedCompareRow,
  sourceLabel: string,
): ProductCompareRecordSide {
  return {
    monthlySales: row.monthlySales,
    procurementCost: row.procurementCost,
    productName: row.productName,
    purchaseUnit: row.purchaseUnit,
    rawData: row.rawData,
    sku: row.sku,
    sourceLabel,
    specification: row.specification,
    supplierCode: row.supplierCode,
    supplierName: row.supplierName,
    supplierProductLink: row.supplierProductLink,
    supplierProductName: row.supplierProductName,
    supplierProductSpec: row.supplierProductSpec,
    upc: row.upc,
  };
}

function parseRows(
  rows: Record<string, any>[],
  fieldMap: Record<string, string>,
  prefix: string,
) {
  const validRows: ParsedCompareRow[] = [];
  const invalidRows: Array<{ reason: string; row: ParsedCompareRow }> = [];

  rows.forEach((row, index) => {
    const parsed: ParsedCompareRow = {
      monthlySales: toNumber(getFieldValue(row, fieldMap, 'monthlySales')),
      procurementCost: toNumber(getFieldValue(row, fieldMap, 'procurementCost')),
      productName: normalizeText(getFieldValue(row, fieldMap, 'productName')),
      purchaseUnit: normalizeText(getFieldValue(row, fieldMap, 'purchaseUnit')),
      rawData: row,
      rowId: `${prefix}-${index + 1}`,
      sku: normalizeText(getFieldValue(row, fieldMap, 'sku')),
      specification: normalizeText(getFieldValue(row, fieldMap, 'specification')),
      supplierCode: normalizeText(getFieldValue(row, fieldMap, 'supplierCode')),
      supplierName: normalizeText(getFieldValue(row, fieldMap, 'supplierName')),
      supplierProductLink: normalizeText(
        getFieldValue(row, fieldMap, 'supplierProductLink'),
      ),
      supplierProductName: normalizeText(
        getFieldValue(row, fieldMap, 'supplierProductName'),
      ),
      supplierProductSpec: normalizeText(
        getFieldValue(row, fieldMap, 'supplierProductSpec'),
      ),
      upc: normalizeUpc(getFieldValue(row, fieldMap, 'upc')),
    };

    if (!hasMeaningfulRowContent(parsed)) {
      return;
    }

    if (!parsed.upc) {
      invalidRows.push({
        reason: '缺少 UPC',
        row: parsed,
      });
      return;
    }

    validRows.push(parsed);
  });

  return {
    invalidRows,
    validRows,
  };
}

function buildCandidateFromProductMasterStore(
  record: ProductMasterRecord,
  store: ProductMasterStoreRecord,
  index: number,
): ComparisonCandidate {
  const procurementCost =
    store.procurementCost != null ? store.procurementCost : record.procurementCost ?? null;
  const upc = normalizeUpc(record.upc);
  const sku = normalizeText(store.storeSku || record.sku);
  const productName = normalizeText(store.supplierProductName || record.productName);
  const specification = normalizeText(store.supplierProductSpec || record.specification);

  return {
    candidateId: `pm-${upc || sku || index}`,
    monthlySales: null,
    procurementCost,
    productName,
    purchaseUnit: normalizeText(store.purchaseUnit),
    rawData: {
      ...store,
      productName: record.productName,
      specification: record.specification,
      upc: record.upc,
    },
    rowId: `pm-row-${index}`,
    sku,
    sourceLabel: '商品总表',
    specification,
    supplierCode: normalizeText(store.supplierCode),
    supplierName: normalizeText(store.supplierName),
    supplierProductLink: normalizeText(store.supplierProductLink),
    supplierProductName: normalizeText(store.supplierProductName),
    supplierProductSpec: normalizeText(store.supplierProductSpec),
    upc,
  };
}

function buildProductMasterCandidates(index: ProductMasterIndex) {
  const candidates: ComparisonCandidate[] = [];

  index.records.forEach((record, recordIndex) => {
    const stores = Array.isArray(record.stores) ? record.stores : [];
    if (stores.length > 0) {
      stores.forEach((store, storeIndex) => {
        candidates.push(
          buildCandidateFromProductMasterStore(
            record,
            store,
            recordIndex * 1000 + storeIndex,
          ),
        );
      });
      return;
    }

    candidates.push({
      candidateId: `pm-${normalizeUpc(record.upc) || normalizeText(record.sku) || recordIndex}`,
      monthlySales: null,
      procurementCost: record.procurementCost ?? null,
      productName: normalizeText(record.productName),
      purchaseUnit: '',
      rawData: {
        ...record,
      },
      rowId: `pm-fallback-${recordIndex}`,
      sku: normalizeText(record.sku),
      sourceLabel: '商品总表',
      specification: normalizeText(record.specification),
      supplierCode: '',
      supplierName: '',
      supplierProductLink: '',
      supplierProductName: '',
      supplierProductSpec: '',
      upc: normalizeUpc(record.upc),
    });
  });

  return candidates;
}

function buildReferenceCandidates(rows: ParsedCompareRow[], sourceLabel: string) {
  return rows.map<ComparisonCandidate>((row) => ({
    ...row,
    candidateId: `${sourceLabel}-${row.rowId}`,
    sourceLabel,
  }));
}

function pickBestCandidateByCost(candidates: ComparisonCandidate[]) {
  if (candidates.length === 0) return null;
  const withCost = candidates
    .filter((candidate) => candidate.procurementCost != null)
    .sort(
      (left, right) =>
        (left.procurementCost ?? Number.POSITIVE_INFINITY) -
        (right.procurementCost ?? Number.POSITIVE_INFINITY),
    );
  return withCost[0] || candidates[0];
}

function buildCandidateMap(candidates: ComparisonCandidate[]) {
  const map = new Map<string, ComparisonCandidate[]>();
  for (const candidate of candidates) {
    if (!candidate.upc) continue;
    const list = map.get(candidate.upc) || [];
    list.push(candidate);
    map.set(candidate.upc, list);
  }
  return map;
}

function determineCheaperSide(
  targetCost: null | number,
  referenceCost: null | number,
): ProductCompareCheaperSide {
  if (targetCost == null || referenceCost == null) {
    return 'unknown';
  }
  if (targetCost === referenceCost) {
    return 'equal';
  }
  return targetCost < referenceCost ? 'target' : 'reference';
}

function buildPriceCompareResult(
  id: string,
  matchType: ProductCompareMatchType,
  target: ParsedCompareRow,
  reference: ComparisonCandidate,
  options?: {
    matchConfidence?: null | number;
    matchReason?: string;
  },
): ProductCompareResult {
  const cheaperSide = determineCheaperSide(
    target.procurementCost,
    reference.procurementCost,
  );
  const priceDiff =
    target.procurementCost != null && reference.procurementCost != null
      ? Number((target.procurementCost - reference.procurementCost).toFixed(4))
      : null;

  let conclusion = '采购价信息不完整';
  if (cheaperSide === 'target') {
    conclusion = '目标货盘采购价更低';
  } else if (cheaperSide === 'reference') {
    conclusion = '比对侧采购价更低';
  } else if (cheaperSide === 'equal') {
    conclusion = '双方采购价一致';
  }

  const hasComparablePrice =
    target.procurementCost != null && reference.procurementCost != null;

  return {
    cheaperSide,
    comparisonName:
      reference.productName ||
      reference.supplierProductName ||
      reference.supplierName ||
      reference.upc ||
      '-',
    conclusion,
    id,
    matchConfidence: options?.matchConfidence ?? null,
    matchReason: options?.matchReason,
    matchType,
    priceDiff,
    reference: toSide(reference, reference.sourceLabel),
    resultType: hasComparablePrice ? 'price_compare' : 'invalid',
    target: toSide(target, '目标货盘'),
  };
}

function buildInvalidResult(
  id: string,
  row: ParsedCompareRow,
  reason: string,
): ProductCompareResult {
  return {
    cheaperSide: 'unknown',
    comparisonName: '-',
    conclusion: reason,
    id,
    matchReason: reason,
    matchType: 'unmatched',
    priceDiff: null,
    reference: null,
    resultType: 'invalid',
    target: toSide(row, '目标货盘'),
  };
}

function buildUnmatchedResult(
  id: string,
  row: ParsedCompareRow,
  threshold: number,
  reason?: string,
): ProductCompareResult {
  const monthlySales = row.monthlySales ?? null;
  const isNewProductCandidate =
    monthlySales != null && monthlySales > threshold;

  return {
    cheaperSide: 'unknown',
    comparisonName: '-',
    conclusion: isNewProductCandidate ? '新品引入候选' : '未匹配待确认',
    id,
    matchReason: reason,
    matchType: 'unmatched',
    priceDiff: null,
    reference: null,
    resultType: isNewProductCandidate
      ? 'new_product_candidate'
      : 'unmatched_pending',
    target: toSide(row, '目标货盘'),
  };
}

function buildAIText(row: ParsedCompareRow) {
  return normalizeText(
    [
      row.productName,
      row.specification,
      row.supplierProductName,
      row.supplierProductSpec,
      row.supplierName,
    ]
      .filter(Boolean)
      .join(' '),
  );
}

function buildBigrams(input: string) {
  const normalized = normalizeKey(input);
  if (normalized.length <= 2) {
    return normalized ? [normalized] : [];
  }
  const bigrams: string[] = [];
  for (let index = 0; index < normalized.length - 1; index++) {
    bigrams.push(normalized.slice(index, index + 2));
  }
  return bigrams;
}

function scoreCandidate(target: ParsedCompareRow, candidate: ComparisonCandidate) {
  const targetText = buildAIText(target);
  const candidateText = buildAIText(candidate);
  const targetKey = normalizeKey(targetText);
  const candidateKey = normalizeKey(candidateText);
  if (!targetKey || !candidateKey) return 0;

  let score = 0;
  if (targetKey.includes(candidateKey) || candidateKey.includes(targetKey)) {
    score += 10;
  }
  if (
    target.supplierName &&
    candidate.supplierName &&
    normalizeKey(target.supplierName) === normalizeKey(candidate.supplierName)
  ) {
    score += 3;
  }
  if (
    target.specification &&
    candidate.specification &&
    normalizeKey(target.specification) === normalizeKey(candidate.specification)
  ) {
    score += 4;
  }

  const candidateBigrams = new Set(buildBigrams(candidateText));
  const targetBigrams = buildBigrams(targetText);
  for (const gram of targetBigrams) {
    if (candidateBigrams.has(gram)) {
      score += 1;
    }
  }

  return score;
}

function collectAICandidates(
  target: ParsedCompareRow,
  candidates: ComparisonCandidate[],
  limit = 8,
) {
  return [...candidates]
    .map((candidate) => ({
      candidate,
      score: scoreCandidate(target, candidate),
    }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit)
    .map((item) => item.candidate);
}

function renderPromptTemplate(
  template: string,
  payload: {
    candidates: ComparisonCandidate[];
    target: ParsedCompareRow;
  },
) {
  const targetJson = JSON.stringify(
    {
      productName: payload.target.productName,
      specification: payload.target.specification,
      supplierName: payload.target.supplierName,
      supplierProductName: payload.target.supplierProductName,
      supplierProductSpec: payload.target.supplierProductSpec,
      upc: payload.target.upc,
    },
    null,
    2,
  );

  const candidatesJson = JSON.stringify(
    payload.candidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      productName: candidate.productName,
      specification: candidate.specification,
      supplierName: candidate.supplierName,
      supplierProductName: candidate.supplierProductName,
      supplierProductSpec: candidate.supplierProductSpec,
      upc: candidate.upc,
    })),
    null,
    2,
  );

  return template
    .replace('{{target}}', targetJson)
    .replace('{{candidates}}', candidatesJson);
}

function getConfiguredApiKey(config: ProductCompareAiConfig) {
  return normalizeText(config.apiKey);
}

function extractMessageContent(payload: any) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (typeof item?.text === 'string') return item.text;
        return '';
      })
      .join('\n');
  }
  return '';
}

function parseAISelection(content: string): AICandidateSelection {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('AI 返回内容不是合法 JSON');
  }

  const parsed = JSON.parse(jsonMatch[0]) as {
    candidateId?: string;
    confidence?: number;
    matched?: boolean;
    reason?: string;
  };

  return {
    candidateId: normalizeText(parsed.candidateId),
    confidence: toNumber(parsed.confidence) ?? undefined,
    matched: Boolean(parsed.matched),
    reason: normalizeText(parsed.reason),
  };
}

async function callMatchModel(
  config: ProductCompareAiConfig,
  target: ParsedCompareRow,
  candidates: ComparisonCandidate[],
) {
  const apiKey = getConfiguredApiKey(config);
  if (!apiKey) {
    throw new Error('AI API Key 未配置');
  }

  const response = await fetch(config.baseUrl, {
    body: JSON.stringify({
      messages: [
        {
          content: renderPromptTemplate(config.matchPromptTemplate, {
            candidates,
            target,
          }),
          role: 'user',
        },
      ],
      model: config.model,
      temperature: 0,
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`AI 请求失败: ${response.status}`);
  }

  const payload = await response.json();
  if (payload?.error?.message) {
    throw new Error(`AI 请求失败: ${payload.error.message}`);
  }
  const content = extractMessageContent(payload);
  if (!content) {
    throw new Error('AI 未返回可解析内容');
  }
  return parseAISelection(content);
}

async function matchUnmatchedRows(
  aiConfig: ProductCompareAiConfig,
  unmatchedRows: ParsedCompareRow[],
  candidates: ComparisonCandidate[],
  stats: ProductCompareRunStats,
) {
  const resultMap = new Map<string, ProductCompareResult>();
  const candidateMap = new Map(candidates.map((item) => [item.candidateId, item]));

  for (const row of unmatchedRows) {
    const shortlist = collectAICandidates(row, candidates);
    if (shortlist.length === 0) {
      stats.aiSkippedCount++;
      resultMap.set(
        row.rowId,
        buildUnmatchedResult(
          row.rowId,
          row,
          aiConfig.newProductMonthlySalesThreshold,
          '没有足够接近的候选商品',
        ),
      );
      continue;
    }

    try {
      const selection = await callMatchModel(aiConfig, row, shortlist);
      if (!selection.matched || !selection.candidateId) {
        stats.aiNoMatchCount++;
        resultMap.set(
          row.rowId,
          buildUnmatchedResult(
            row.rowId,
            row,
            aiConfig.newProductMonthlySalesThreshold,
            selection.reason || 'AI 未找到可信匹配',
          ),
        );
        continue;
      }

      const candidate = candidateMap.get(selection.candidateId);
      if (!candidate) {
        stats.aiNoMatchCount++;
        resultMap.set(
          row.rowId,
          buildUnmatchedResult(
            row.rowId,
            row,
            aiConfig.newProductMonthlySalesThreshold,
            'AI 返回了无效候选',
          ),
        );
        continue;
      }

      stats.aiMatchedCount++;
      resultMap.set(
        row.rowId,
        buildPriceCompareResult(row.rowId, 'ai_fuzzy', row, candidate, {
          matchConfidence: selection.confidence ?? null,
          matchReason: selection.reason || 'AI 模糊匹配命中',
        }),
      );
    } catch (error: any) {
      stats.aiNoMatchCount++;
      resultMap.set(
        row.rowId,
        buildUnmatchedResult(
          row.rowId,
          row,
          aiConfig.newProductMonthlySalesThreshold,
          `AI比对失败: ${error?.message || '未知错误'}`,
        ),
      );
    }
  }

  return resultMap;
}

function updateStatsFromResults(
  stats: ProductCompareRunStats,
  results: ProductCompareResult[],
) {
  for (const item of results) {
    if (item.resultType === 'price_compare') {
      stats.priceCompareCount++;
    } else if (item.resultType === 'new_product_candidate') {
      stats.newProductCandidateCount++;
    } else if (item.resultType === 'unmatched_pending') {
      stats.unmatchedPendingCount++;
    } else if (item.resultType === 'invalid') {
      stats.invalidCount++;
    }
  }
}

export async function runProductCompare(
  payload: ProductCompareRunPayload,
): Promise<ProductCompareRunResult> {
  const aiConfig = await getProductCompareAiConfig();
  const sourceMode =
    payload.sourceMode === 'productMaster' ? 'productMaster' : 'custom';

  const targetResult = await readExcelWithSchema(payload.targetBuffer, [...COMPARE_SCHEMA]);
  assertSchemaCapability(targetResult.fieldMap, targetResult.headers, '目标货盘', {
    requireAiText: true,
    requireUpc: true,
  });

  const { invalidRows: invalidTargetRows, validRows: validTargetRows } = parseRows(
    targetResult.data,
    targetResult.fieldMap,
    'target',
  );

  if (validTargetRows.length === 0) {
    throw new Error('目标货盘未解析到有效商品数据');
  }

  let referenceCandidates: ComparisonCandidate[] = [];

  if (sourceMode === 'productMaster') {
    const productMasterIndex = await ensureProductMasterIndex();
    if (productMasterIndex.records.length === 0) {
      throw new Error('请先导入商品总表，再使用商品总表比对模式');
    }
    referenceCandidates = buildProductMasterCandidates(productMasterIndex);
  } else {
    if (!payload.referenceBuffer || payload.referenceBuffer.length === 0) {
      throw new Error('自定义双货盘模式必须上传比对货盘');
    }
    const referenceResult = await readExcelWithSchema(
      payload.referenceBuffer,
      [...COMPARE_SCHEMA],
    );
    assertSchemaCapability(referenceResult.fieldMap, referenceResult.headers, '比对货盘', {
      requireAiText: true,
      requireUpc: true,
    });

    const { validRows: referenceRows } = parseRows(
      referenceResult.data,
      referenceResult.fieldMap,
      'reference',
    );
    if (referenceRows.length === 0) {
      throw new Error('比对货盘未解析到有效商品数据');
    }
    referenceCandidates = buildReferenceCandidates(referenceRows, '比对货盘');
  }

  const stats: ProductCompareRunStats = {
    aiMatchedCount: 0,
    aiNoMatchCount: 0,
    aiSkippedCount: 0,
    candidateCount: referenceCandidates.length,
    exactMatchedCount: 0,
    invalidCount: 0,
    newProductCandidateCount: 0,
    priceCompareCount: 0,
    targetCount: validTargetRows.length + invalidTargetRows.length,
    unmatchedPendingCount: 0,
  };

  const exactMap = buildCandidateMap(referenceCandidates);
  const results: ProductCompareResult[] = invalidTargetRows.map((item) =>
    buildInvalidResult(item.row.rowId, item.row, item.reason),
  );

  const aiPendingRows: ParsedCompareRow[] = [];

  for (const row of validTargetRows) {
    const exactCandidates = exactMap.get(row.upc) || [];
    if (exactCandidates.length > 0) {
      const bestCandidate = pickBestCandidateByCost(exactCandidates);
      if (bestCandidate) {
        stats.exactMatchedCount++;
        results.push(
          buildPriceCompareResult(row.rowId, 'upc_exact', row, bestCandidate, {
            matchReason: 'UPC 完全匹配',
          }),
        );
        continue;
      }
    }

    aiPendingRows.push(row);
  }

  const aiResults = await matchUnmatchedRows(
    aiConfig,
    aiPendingRows,
    referenceCandidates,
    stats,
  );
  results.push(...aiPendingRows.map((row) => aiResults.get(row.rowId)!));

  updateStatsFromResults(stats, results);

  return {
    aiConfig,
    results: results.sort((left, right) => left.id.localeCompare(right.id, 'zh-CN')),
    stats,
    summary: buildSummary(stats),
  };
}
