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
  rawData?: Record<string, any>;
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

export type ProductCompareTaskStatus =
  | 'cancelled'
  | 'failed'
  | 'pending'
  | 'running'
  | 'succeeded';

export interface ProductCompareTaskSummary {
  createdAt: string;
  errorMessage?: string;
  finishedAt?: string;
  matchTypeCounts?: Partial<Record<ProductCompareMatchType, number>>;
  referenceFileName?: string;
  resultCount?: number;
  resultTypeCounts?: Partial<Record<ProductCompareResultType, number>>;
  sourceMode: ProductCompareSourceMode;
  startedAt?: string;
  stats?: ProductCompareRunStats;
  status: ProductCompareTaskStatus;
  summary?: string;
  targetFileName: string;
  taskId: string;
}

export interface ProductCompareTaskDetail extends ProductCompareTaskSummary {
}

export interface ProductCompareTaskResultPage {
  items: ProductCompareResult[];
  page: number;
  pageSize: number;
  total: number;
}

const PRODUCT_COMPARE_TIMEOUT_MS = 10 * 60 * 1000;

async function buildProductComparePayload(payload: {
  referenceFile?: File | null;
  sourceMode: ProductCompareSourceMode;
  targetFile: File;
}) {
  const targetBuffer = await readFileAsBuffer(payload.targetFile);
  const referenceBuffer = payload.referenceFile
    ? await readFileAsBuffer(payload.referenceFile)
    : null;

  return {
    referenceFileBase64: referenceBuffer
      ? arrayBufferToBase64(referenceBuffer)
      : '',
    referenceFileName: payload.referenceFile?.name || '',
    sourceMode: payload.sourceMode,
    targetFileBase64: arrayBufferToBase64(targetBuffer),
    targetFileName: payload.targetFile.name,
  };
}

export async function createProductCompareTask(payload: {
  referenceFile?: File | null;
  sourceMode: ProductCompareSourceMode;
  targetFile: File;
}) {
  return requestClient.post<ProductCompareTaskSummary>(
    '/product/compare/tasks',
    await buildProductComparePayload(payload),
    {
      timeout: PRODUCT_COMPARE_TIMEOUT_MS,
    },
  );
}

export async function listProductCompareTasks(limit = 10) {
  return requestClient.get<ProductCompareTaskSummary[]>('/product/compare/tasks', {
    params: { limit },
  });
}

export async function getProductCompareTask(taskId: string) {
  return requestClient.get<ProductCompareTaskDetail>(
    `/product/compare/tasks/${encodeURIComponent(taskId)}`,
  );
}

export async function updateProductCompareTask(
  taskId: string,
  payload: {
    referenceFile?: File | null;
    sourceMode: ProductCompareSourceMode;
    targetFile?: File | null;
    targetFileName: string;
  },
) {
  const targetBuffer = payload.targetFile
    ? await readFileAsBuffer(payload.targetFile)
    : null;
  const referenceBuffer = payload.referenceFile
    ? await readFileAsBuffer(payload.referenceFile)
    : null;

  return requestClient.put<ProductCompareTaskSummary>(
    `/product/compare/tasks/${encodeURIComponent(taskId)}`,
    {
      referenceFileBase64: referenceBuffer ? arrayBufferToBase64(referenceBuffer) : '',
      referenceFileName: payload.referenceFile?.name || '',
      sourceMode: payload.sourceMode,
      targetFileBase64: targetBuffer ? arrayBufferToBase64(targetBuffer) : '',
      targetFileName: payload.targetFileName,
    },
    {
      timeout: PRODUCT_COMPARE_TIMEOUT_MS,
    },
  );
}

export async function deleteProductCompareTask(taskId: string) {
  return requestClient.delete<{ deleted: boolean; reason: string }>(
    `/product/compare/tasks/${encodeURIComponent(taskId)}`,
  );
}

export async function retryProductCompareTask(
  taskId: string,
  payload?: {
    targetFile?: File | null;
    targetFileName?: string;
  },
) {
  const targetBuffer = payload?.targetFile
    ? await readFileAsBuffer(payload.targetFile)
    : null;

  return requestClient.post<ProductCompareTaskSummary>(
    `/product/compare/tasks/${encodeURIComponent(taskId)}/retry`,
    {
      targetFileBase64: targetBuffer ? arrayBufferToBase64(targetBuffer) : '',
      targetFileName: payload?.targetFileName || '',
    },
    {
      timeout: PRODUCT_COMPARE_TIMEOUT_MS,
    },
  );
}

export async function downloadProductCompareTargetFile(taskId: string) {
  return requestClient.download<Blob>(
    `/product/compare/tasks/${encodeURIComponent(taskId)}/files/target`,
  );
}

export async function getProductCompareTaskResults(params: {
  cheaperSide?: '' | ProductCompareCheaperSide;
  keyword?: string;
  matchType?: '' | ProductCompareMatchType;
  page: number;
  pageSize: number;
  resultType?: '' | ProductCompareResultType;
  taskId: string;
}) {
  const { taskId, ...query } = params;
  return requestClient.get<ProductCompareTaskResultPage>(
    `/product/compare/tasks/${encodeURIComponent(taskId)}/results`,
    {
      params: query,
    },
  );
}

export async function getProductCompareTaskResultDetail(
  taskId: string,
  resultId: string,
) {
  return requestClient.get<ProductCompareResult>(
    `/product/compare/tasks/${encodeURIComponent(taskId)}/results/${encodeURIComponent(resultId)}`,
  );
}

export async function cancelProductCompareTask(taskId: string) {
  return requestClient.post<{ cancelled: boolean; reason: string }>(
    `/product/compare/tasks/${encodeURIComponent(taskId)}/cancel`,
  );
}

export async function runProductCompare(payload: {
  referenceFile?: File | null;
  sourceMode: ProductCompareSourceMode;
  targetFile: File;
}) {

  return requestClient.post<ProductCompareRunResult>(
    '/product/compare/run',
    await buildProductComparePayload(payload),
    {
      timeout: PRODUCT_COMPARE_TIMEOUT_MS,
    },
  );
}
