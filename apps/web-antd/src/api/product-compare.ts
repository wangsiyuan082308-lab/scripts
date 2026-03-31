import { requestClient } from '#/api/request';
import { arrayBufferToBase64, readFileAsBuffer } from '#/utils/file';

export type ProductCompareCheaperSide =
  | 'equal'
  | 'reference'
  | 'target'
  | 'unknown';
export type ProductCompareMatchType = 'ai_fuzzy' | 'unmatched' | 'upc_exact';
export type ProductCompareResultType =
  | 'invalid'
  | 'new_product_candidate'
  | 'price_compare'
  | 'unmatched_pending';
export type ProductCompareSourceMode = 'custom' | 'productMaster';

export interface ProductCompareAiConfig {
  apiKey: string;
  baseUrl: string;
  matchPromptTemplate: string;
  model: string;
  newProductMonthlySalesThreshold: number;
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

export async function runProductCompare(payload: {
  referenceFile?: File | null;
  sourceMode: ProductCompareSourceMode;
  targetFile: File;
}) {
  const targetBuffer = await readFileAsBuffer(payload.targetFile);
  const referenceBuffer = payload.referenceFile
    ? await readFileAsBuffer(payload.referenceFile)
    : null;

  return requestClient.post<ProductCompareRunResult>('/product/compare/run', {
    referenceFileBase64: referenceBuffer
      ? arrayBufferToBase64(referenceBuffer)
      : '',
    referenceFileName: payload.referenceFile?.name || '',
    sourceMode: payload.sourceMode,
    targetFileBase64: arrayBufferToBase64(targetBuffer),
    targetFileName: payload.targetFile.name,
  });
}
