import { Buffer } from 'node:buffer';
import process from 'node:process';

import * as ExcelJS from 'exceljs';

import { readExcelWithSchema } from '../../utils/excel-helper';

export type ProductMasterLookupRecord = {
  aoxiangConversionFactor?: null | number;
  baseUnitProcurementCost?: null | number;
  cartonProcurementCost?: null | number;
  cartonSize?: string;
  procurementCost?: null | number;
  productName?: string;
  sku?: string;
  upc?: string;
};

export interface BaohaojiaTransformOptions {
  fileBuffer: Buffer;
  initialStock?: number;
  productMasterRecords?: ProductMasterLookupRecord[];
}

type RowRecord = Record<string, any>;

const BAOHAOJIA_SCHEMA = [
  {
    key: 'barcode',
    aliases: ['商品UPC', 'UPC', '商品条码', '条码', '条形码', 'UPC条形码'],
  },
  {
    key: 'activityPrice',
    aliases: ['活动价上限', '活动价不高于', '活动价', '价格'],
  },
  { key: 'isPackage', aliases: ['是否组包', '组包'], required: false },
  {
    key: 'packageCount',
    aliases: ['组包件数', '组包数', '件数'],
    required: false,
  },
  { key: 'productName', aliases: ['商品名称', '名称'], required: false },
  { key: 'cartonSize', aliases: ['箱规', '包装规格'], required: false },
] as const;

type HeaderKey = (typeof BAOHAOJIA_SCHEMA)[number]['key'];

export type BaohaojiaBaseRow = {
  activityPrice: null | number;
  cartonProcurementCost?: null | number;
  cartonSize?: string;
  isPackage: string;
  packageCount: number | string;
  procurementCost: null | number;
  productName: string;
  stock: number;
  upc: string;
};

export type BaohaojiaUploadRow = Pick<
  BaohaojiaBaseRow,
  'isPackage' | 'packageCount' | 'stock' | 'upc'
> & {
  price: '' | number;
};

export type BaohaojiaQualifiedRow = BaohaojiaBaseRow & {
  id: string;
  price: null | number;
  reasons?: string[];
};

export type BaohaojiaReviewRow = BaohaojiaBaseRow & {
  id: string;
  price: '' | number;
  reasons: string[];
};

export type BaohaojiaExcludedRow = Omit<BaohaojiaBaseRow, 'stock'> & {
  id: string;
  profitMargin: string;
  reason: string;
};

export type BaohaojiaAnalysisMetrics = {
  excludedCount: number;
  invalidPriceCount: number;
  notFoundCount: number;
  qualifiedCount: number;
  reviewCount: number;
  totalCount: number;
  zeroCostCount: number;
};

export type BaohaojiaAnalysisResult = {
  excludedRows: BaohaojiaExcludedRow[];
  metrics: BaohaojiaAnalysisMetrics;
  qualifiedRows: BaohaojiaQualifiedRow[];
  reviewRows: BaohaojiaReviewRow[];
  summary: string;
  uploadRows: BaohaojiaUploadRow[];
};

export type BaohaojiaTransformArtifacts = {
  analysis: BaohaojiaAnalysisResult;
  auditBuffer: Buffer;
  uploadBuffer: Buffer;
};

function createRowId(prefix: string, upc: string, index: number) {
  return `${prefix}_${upc || 'unknown'}_${index}`;
}

function getFieldValue(
  row: RowRecord,
  fieldMap: Record<string, string>,
  key: HeaderKey,
) {
  const header = fieldMap[key];
  return header ? row[header] : undefined;
}

function normalizeText(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeCode(value: unknown) {
  return normalizeText(value).replaceAll(/\s+/g, '');
}

function parseNumber(value: unknown): null | number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const parsed = Number.parseFloat(
    normalizeText(value).replaceAll(/[^\d.-]/g, ''),
  );
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePositivePackageCount(value: unknown) {
  const parsed = parseNumber(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function formatPackageCount(value: null | number) {
  if (value === null) {
    return '';
  }
  return Number.isInteger(value) ? value : Number(value.toFixed(4));
}

function parseCartonFactor(value: unknown): null | number {
  const text = normalizeText(value);
  if (!text) {
    return null;
  }
  const matched = text.match(/(\d+(?:\.\d+)?)/);
  if (!matched) {
    return null;
  }
  const parsed = Number.parseFloat(matched[1] || '');
  return Number.isFinite(parsed) && parsed > 1 ? parsed : null;
}

function normalizePackageFlag(value: unknown): '' | '否' | '是' {
  const text = normalizeText(value).replaceAll(/\s+/g, '').toLowerCase();
  if (!text) {
    return '';
  }

  if (
    ['0', 'false', 'n', 'no', '否'].includes(text) ||
    text.includes('否') ||
    text.includes('不组包')
  ) {
    return '否';
  }

  if (
    ['1', 'true', 'y', 'yes', '是'].includes(text) ||
    text.includes('是') ||
    text.includes('组包')
  ) {
    return '是';
  }

  return '';
}

function getDerivedPackageCount(
  row: RowRecord,
  fieldMap: Record<string, string>,
  masterProduct: null | ProductMasterLookupRecord,
) {
  const rowCartonFactor = parseCartonFactor(
    getFieldValue(row, fieldMap, 'cartonSize'),
  );
  if (rowCartonFactor !== null) {
    return rowCartonFactor;
  }

  const masterConversion =
    masterProduct?.aoxiangConversionFactor !== null &&
    masterProduct?.aoxiangConversionFactor !== undefined &&
    masterProduct.aoxiangConversionFactor > 1
      ? masterProduct.aoxiangConversionFactor
      : null;
  if (masterConversion !== null) {
    return masterConversion;
  }

  return parseCartonFactor(masterProduct?.cartonSize);
}

function resolvePackageFields(
  row: RowRecord,
  fieldMap: Record<string, string>,
  masterProduct: null | ProductMasterLookupRecord,
) {
  const explicitFlag = normalizePackageFlag(
    getFieldValue(row, fieldMap, 'isPackage'),
  );
  const explicitPackageCount = parsePositivePackageCount(
    getFieldValue(row, fieldMap, 'packageCount'),
  );
  const derivedPackageCount = getDerivedPackageCount(
    row,
    fieldMap,
    masterProduct,
  );

  if (explicitFlag === '是') {
    return {
      isPackage: '是',
      packageCount:
        explicitPackageCount === null
          ? formatPackageCount(derivedPackageCount)
          : formatPackageCount(explicitPackageCount),
    };
  }

  if (explicitFlag === '否') {
    return {
      isPackage: '否',
      packageCount:
        explicitPackageCount === null
          ? ''
          : formatPackageCount(explicitPackageCount),
    };
  }

  if (explicitPackageCount !== null) {
    return {
      isPackage: explicitPackageCount > 1 ? '是' : '否',
      packageCount: formatPackageCount(explicitPackageCount),
    };
  }

  if (derivedPackageCount !== null) {
    return {
      isPackage: '是',
      packageCount: formatPackageCount(derivedPackageCount),
    };
  }

  return {
    isPackage: '否',
    packageCount: '',
  };
}

function workbookBufferToNodeBuffer(buffer: ArrayBuffer | Buffer) {
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
}

function buildExternalProductMasterIndex(records: ProductMasterLookupRecord[]) {
  const byCode = new Map<string, ProductMasterLookupRecord>();

  records.forEach((record) => {
    [record.upc, record.sku]
      .map((value) => normalizeCode(value))
      .filter(Boolean)
      .forEach((key) => {
        byCode.set(key, record);
      });
  });

  return byCode;
}

async function resolveProductMasterLookup(
  codes: string[],
  records?: ProductMasterLookupRecord[],
) {
  if (Array.isArray(records)) {
    const byCode = buildExternalProductMasterIndex(records);
    return {
      findByBarcode(barcode: string) {
        return byCode.get(normalizeCode(barcode)) || null;
      },
      hasRecords: records.length > 0,
      source: 'backend' as const,
    };
  }

  const backendRecords = await lookupProductMasterRecordsFromBackend(codes);
  const byCode = buildExternalProductMasterIndex(backendRecords);

  return {
    findByBarcode(barcode: string) {
      return byCode.get(normalizeCode(barcode)) || null;
    },
    hasRecords: backendRecords.length > 0,
    source: 'backend' as const,
  };
}

function getPricingFromLookupRecord(record: null | ProductMasterLookupRecord) {
  return {
    baseUnitProcurementCost:
      record?.baseUnitProcurementCost ?? record?.procurementCost ?? null,
    cartonProcurementCost: record?.cartonProcurementCost ?? null,
    cartonSize: record?.cartonSize || '',
  };
}

function getBackendBaseUrl() {
  const proxyTarget = normalizeText(process.env.VITE_DEV_PROXY_TARGET);
  if (proxyTarget) {
    return proxyTarget.replace(/\/api\/?$/u, '');
  }

  const explicitBaseUrl = normalizeText(process.env.ELECTRON_BACKEND_BASE_URL);
  if (explicitBaseUrl) {
    return explicitBaseUrl.replace(/\/+$/u, '');
  }

  return 'http://120.55.244.232';
}

async function lookupProductMasterRecordsFromBackend(codes: string[]) {
  if (codes.length === 0) {
    return [];
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const response = await fetch(
      `${getBackendBaseUrl()}/api/product/master/lookup`,
      {
        body: JSON.stringify({ codes }),
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'POST',
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      throw new Error(`后端商品总表查询失败 (${response.status})`);
    }

    const payload = (await response.json()) as {
      data?: { items?: ProductMasterLookupRecord[] };
      message?: string;
    };

    if (payload?.message) {
      throw new Error(payload.message);
    }

    return Array.isArray(payload?.data?.items) ? payload.data.items : [];
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error('后端商品总表查询超时');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function pickUploadRows(
  analysis: BaohaojiaAnalysisResult,
): BaohaojiaUploadRow[] {
  return [...analysis.qualifiedRows, ...analysis.reviewRows].map((row) => ({
    isPackage: row.isPackage,
    packageCount: row.packageCount,
    price: row.price ?? '',
    stock: row.stock,
    upc: row.upc,
  }));
}

function buildSummary(metrics: BaohaojiaAnalysisMetrics) {
  return `处理完成，总商品数: ${metrics.totalCount}
可报名: ${metrics.qualifiedCount}
待确认: ${metrics.reviewCount}
已过滤: ${metrics.excludedCount}
商品未命中: ${metrics.notFoundCount}
活动价异常: ${metrics.invalidPriceCount}
采购价为0: ${metrics.zeroCostCount}`;
}

function buildUploadWorkbook(rows: BaohaojiaUploadRow[]) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('爆好价报名');
  worksheet.columns = [
    { header: 'UPC条形码', key: 'upc', width: 20 },
    { header: '活动价', key: 'price', width: 12 },
    { header: '活动初始库存', key: 'stock', width: 12 },
    { header: '是否组包', key: 'isPackage', width: 10 },
    { header: '组包件数', key: 'packageCount', width: 10 },
  ];
  rows.forEach((row) => worksheet.addRow(row));
  return workbook;
}

function buildCombinedWorkbook(analysis: BaohaojiaAnalysisResult) {
  const workbook = new ExcelJS.Workbook();
  const outputSheet = workbook.addWorksheet('爆好价报名');
  outputSheet.columns = [
    { header: 'UPC条形码', key: 'upc', width: 20 },
    { header: '活动价', key: 'price', width: 12 },
    { header: '活动初始库存', key: 'stock', width: 12 },
    { header: '是否组包', key: 'isPackage', width: 10 },
    { header: '组包件数', key: 'packageCount', width: 10 },
    { header: '采购价', key: 'procurementCost', width: 10 },
    { header: '商品名称', key: 'productName', width: 40 },
  ];

  [...analysis.qualifiedRows, ...analysis.reviewRows].forEach((row) => {
    outputSheet.addRow({
      isPackage: row.isPackage,
      packageCount: row.packageCount,
      price: row.price ?? '',
      procurementCost: row.procurementCost,
      productName: row.productName,
      stock: row.stock,
      upc: row.upc,
    });
  });

  if (analysis.excludedRows.length > 0) {
    const excludedSheet = workbook.addWorksheet('排除商品');
    excludedSheet.columns = [
      { header: '条码', key: 'upc', width: 20 },
      { header: '商品名称', key: 'productName', width: 40 },
      { header: '活动价', key: 'activityPrice', width: 12 },
      { header: '采购价', key: 'procurementCost', width: 12 },
      { header: '毛利率', key: 'profitMargin', width: 10 },
      { header: '排除原因', key: 'reason', width: 30 },
    ];
    analysis.excludedRows.forEach((row) => excludedSheet.addRow(row));
  }

  if (analysis.metrics.zeroCostCount > 0) {
    const zeroCostSheet = workbook.addWorksheet('⚠️采购价为0');
    zeroCostSheet.columns = [
      { header: '条码', key: 'upc', width: 20 },
      { header: '商品名称', key: 'productName', width: 40 },
      { header: '活动价', key: 'price', width: 12 },
      { header: '采购价', key: 'procurementCost', width: 12 },
      { header: '风险', key: 'risk', width: 20 },
    ];

    analysis.reviewRows
      .filter((row) => row.reasons.includes('采购价为0，需人工复核'))
      .forEach((row) => {
        zeroCostSheet.addRow({
          price: row.price ?? '',
          procurementCost: row.procurementCost,
          productName: row.productName,
          risk: '采购价未设置，无法准确判断毛利',
          upc: row.upc,
        });
      });
  }

  return workbook;
}

function buildAuditWorkbook(analysis: BaohaojiaAnalysisResult) {
  const workbook = new ExcelJS.Workbook();
  const noteMap = new Map<string, string>();

  [...analysis.qualifiedRows, ...analysis.reviewRows].forEach((row) => {
    if (row.reasons?.length) {
      noteMap.set(row.id, row.reasons.join('；'));
    }
  });

  const summarySheet = workbook.addWorksheet('处理摘要');
  summarySheet.columns = [
    { header: '指标', key: 'label', width: 22 },
    { header: '数值', key: 'value', width: 16 },
    { header: '说明', key: 'note', width: 44 },
  ];
  [
    {
      label: '总商品数',
      note: '活动表中识别到的有效商品数。',
      value: analysis.metrics.totalCount,
    },
    {
      label: '可报名',
      note: '可以直接进入上传文件的商品数。',
      value: analysis.metrics.qualifiedCount,
    },
    {
      label: '待确认',
      note: '会保留在上传文件中，但需要运营关注说明的商品数。',
      value: analysis.metrics.reviewCount,
    },
    {
      label: '已过滤',
      note: '采购价高于活动价，已从上传文件中剔除。',
      value: analysis.metrics.excludedCount,
    },
    {
      label: '商品未命中',
      note: '商品总表未命中，按当前口径保留报名并标记说明。',
      value: analysis.metrics.notFoundCount,
    },
    {
      label: '活动价异常',
      note: '活动价无效，保留到上传文件但价格留空。',
      value: analysis.metrics.invalidPriceCount,
    },
    {
      label: '采购价为0',
      note: '保留到上传文件，同时单独列到风险 sheet。',
      value: analysis.metrics.zeroCostCount,
    },
  ].forEach((row) => summarySheet.addRow(row));
  summarySheet.addRow({
    label: '摘要',
    note: analysis.summary,
    value: '',
  });

  const uploadSheet = workbook.addWorksheet('上传文件预览');
  uploadSheet.columns = [
    { header: 'UPC条形码', key: 'upc', width: 20 },
    { header: '活动价', key: 'price', width: 12 },
    { header: '活动初始库存', key: 'stock', width: 12 },
    { header: '是否组包', key: 'isPackage', width: 10 },
    { header: '组包件数', key: 'packageCount', width: 10 },
    { header: '说明', key: 'note', width: 36 },
  ];
  [...analysis.qualifiedRows, ...analysis.reviewRows].forEach((row) => {
    uploadSheet.addRow({
      isPackage: row.isPackage,
      note: noteMap.get(row.id) || '',
      packageCount: row.packageCount,
      price: row.price ?? '',
      stock: row.stock,
      upc: row.upc,
    });
  });

  const qualifiedSheet = workbook.addWorksheet('可报名商品');
  qualifiedSheet.columns = [
    { header: 'UPC', key: 'upc', width: 20 },
    { header: '商品名称', key: 'productName', width: 40 },
    { header: '活动价', key: 'activityPrice', width: 12 },
    { header: '报名价', key: 'price', width: 12 },
    { header: '活动初始库存', key: 'stock', width: 12 },
    { header: '最小单位采购价', key: 'procurementCost', width: 14 },
    { header: '箱规采购价', key: 'cartonProcurementCost', width: 14 },
    { header: '箱规', key: 'cartonSize', width: 18 },
    { header: '是否组包', key: 'isPackage', width: 10 },
    { header: '组包件数', key: 'packageCount', width: 10 },
    { header: '标记', key: 'reasons', width: 36 },
  ];
  analysis.qualifiedRows.forEach((row) =>
    qualifiedSheet.addRow({
      ...row,
      reasons: row.reasons?.join('；') || '',
    }),
  );

  const reviewSheet = workbook.addWorksheet('待确认商品');
  reviewSheet.columns = [
    { header: 'UPC', key: 'upc', width: 20 },
    { header: '商品名称', key: 'productName', width: 40 },
    { header: '活动价', key: 'activityPrice', width: 12 },
    { header: '报名价', key: 'price', width: 12 },
    { header: '活动初始库存', key: 'stock', width: 12 },
    { header: '最小单位采购价', key: 'procurementCost', width: 14 },
    { header: '箱规采购价', key: 'cartonProcurementCost', width: 14 },
    { header: '箱规', key: 'cartonSize', width: 18 },
    { header: '是否组包', key: 'isPackage', width: 10 },
    { header: '组包件数', key: 'packageCount', width: 10 },
    { header: '原因', key: 'reasons', width: 36 },
  ];
  analysis.reviewRows.forEach((row) =>
    reviewSheet.addRow({
      ...row,
      reasons: row.reasons.join('；'),
    }),
  );

  const excludedSheet = workbook.addWorksheet('排除商品');
  excludedSheet.columns = [
    { header: 'UPC', key: 'upc', width: 20 },
    { header: '商品名称', key: 'productName', width: 40 },
    { header: '活动价', key: 'activityPrice', width: 12 },
    { header: '最小单位采购价', key: 'procurementCost', width: 14 },
    { header: '箱规采购价', key: 'cartonProcurementCost', width: 14 },
    { header: '箱规', key: 'cartonSize', width: 18 },
    { header: '是否组包', key: 'isPackage', width: 10 },
    { header: '组包件数', key: 'packageCount', width: 10 },
    { header: '毛利率', key: 'profitMargin', width: 10 },
    { header: '排除原因', key: 'reason', width: 36 },
  ];
  analysis.excludedRows.forEach((row) => excludedSheet.addRow(row));

  if (analysis.metrics.zeroCostCount > 0) {
    const zeroCostSheet = workbook.addWorksheet('⚠️采购价为0');
    zeroCostSheet.columns = [
      { header: 'UPC', key: 'upc', width: 20 },
      { header: '商品名称', key: 'productName', width: 40 },
      { header: '活动价', key: 'price', width: 12 },
      { header: '采购价', key: 'procurementCost', width: 12 },
      { header: '风险', key: 'risk', width: 24 },
    ];

    analysis.reviewRows
      .filter((row) => row.reasons.includes('采购价为0，需人工复核'))
      .forEach((row) => {
        zeroCostSheet.addRow({
          price: row.price ?? '',
          procurementCost: row.procurementCost,
          productName: row.productName,
          risk: '采购价未设置，无法准确判断毛利',
          upc: row.upc,
        });
      });
  }

  return workbook;
}

export async function extractBaohaojiaCodes(fileBuffer: Buffer) {
  const readResult = await readExcelWithSchema(fileBuffer, [
    ...BAOHAOJIA_SCHEMA,
  ]);
  if (readResult.fieldMap.barcode === undefined) {
    throw new Error('未找到条码列');
  }

  return [
    ...new Set(
      readResult.data
        .map((row) =>
          normalizeCode(getFieldValue(row, readResult.fieldMap, 'barcode')),
        )
        .filter(Boolean),
    ),
  ];
}

export async function analyzeBaohaojiaBuffer(
  fileBuffer: Buffer,
  initialStock = 9999,
  productMasterRecords?: ProductMasterLookupRecord[],
): Promise<BaohaojiaAnalysisResult> {
  const readResult = await readExcelWithSchema(fileBuffer, [
    ...BAOHAOJIA_SCHEMA,
  ]);
  if (readResult.data.length === 0) {
    throw new Error('上传的文件为空或无法识别数据');
  }

  if (readResult.fieldMap.barcode === undefined) {
    throw new Error('未找到条码列');
  }

  if (readResult.fieldMap.activityPrice === undefined) {
    throw new Error('未找到活动价列');
  }

  const codes = [
    ...new Set(
      readResult.data
        .map((row) =>
          normalizeCode(getFieldValue(row, readResult.fieldMap, 'barcode')),
        )
        .filter(Boolean),
    ),
  ];
  const productLookup = await resolveProductMasterLookup(
    codes,
    productMasterRecords,
  );
  if (!productLookup.hasRecords) {
    throw new Error('请先导入后端商品总表');
  }

  const excludedRows: BaohaojiaExcludedRow[] = [];
  const qualifiedRows: BaohaojiaQualifiedRow[] = [];
  const reviewRows: BaohaojiaReviewRow[] = [];

  let invalidPriceCount = 0;
  let notFoundCount = 0;

  readResult.data.forEach((row, index) => {
    const upc = normalizeCode(
      getFieldValue(row, readResult.fieldMap, 'barcode'),
    );
    if (!upc) {
      return;
    }

    const activityPrice = parseNumber(
      getFieldValue(row, readResult.fieldMap, 'activityPrice'),
    );
    const sourceProductName = normalizeText(
      getFieldValue(row, readResult.fieldMap, 'productName'),
    );
    const masterProduct = productLookup.findByBarcode(upc);
    const pricing = getPricingFromLookupRecord(masterProduct);
    const procurementCost =
      pricing?.baseUnitProcurementCost ??
      masterProduct?.procurementCost ??
      null;
    const packageFields = resolvePackageFields(
      row,
      readResult.fieldMap,
      masterProduct,
    );
    const productName = sourceProductName || masterProduct?.productName || '';
    const baseRow: BaohaojiaBaseRow = {
      activityPrice,
      cartonProcurementCost: pricing?.cartonProcurementCost,
      cartonSize:
        pricing?.cartonSize ||
        normalizeText(getFieldValue(row, readResult.fieldMap, 'cartonSize')),
      isPackage: packageFields.isPackage,
      packageCount: packageFields.packageCount,
      procurementCost,
      productName,
      stock: initialStock,
      upc,
    };

    if (
      activityPrice !== null &&
      activityPrice > 0 &&
      procurementCost !== null &&
      procurementCost > activityPrice
    ) {
      excludedRows.push({
        ...baseRow,
        id: createRowId('excluded', upc, index + 1),
        procurementCost,
        profitMargin: `${(((activityPrice - procurementCost) / activityPrice) * 100).toFixed(1)}%`,
        reason: `采购价(${procurementCost}) > 活动价(${activityPrice})`,
      });
      return;
    }

    const reviewReasons: string[] = [];
    if (!masterProduct) {
      notFoundCount += 1;
      reviewReasons.push('商品总表未命中，已按当前口径保留报名');
    }

    if (activityPrice === null || activityPrice <= 0) {
      invalidPriceCount += 1;
      reviewReasons.push('活动价无效');
    }

    if (procurementCost === 0) {
      reviewReasons.push('采购价为0，需人工复核');
    }

    if (reviewReasons.length > 0) {
      reviewRows.push({
        ...baseRow,
        id: createRowId('review', upc, index + 1),
        price:
          activityPrice === null || activityPrice <= 0 ? '' : activityPrice,
        reasons: reviewReasons,
      });
      return;
    }

    qualifiedRows.push({
      ...baseRow,
      id: createRowId('qualified', upc, index + 1),
      price: activityPrice,
    });
  });

  const metrics: BaohaojiaAnalysisMetrics = {
    excludedCount: excludedRows.length,
    invalidPriceCount,
    notFoundCount,
    qualifiedCount: qualifiedRows.length,
    reviewCount: reviewRows.length,
    totalCount: qualifiedRows.length + reviewRows.length + excludedRows.length,
    zeroCostCount: reviewRows.filter((row) =>
      row.reasons.includes('采购价为0，需人工复核'),
    ).length,
  };

  const analysis: BaohaojiaAnalysisResult = {
    excludedRows,
    metrics,
    qualifiedRows,
    reviewRows,
    summary: buildSummary(metrics),
    uploadRows: [],
  };
  analysis.uploadRows = pickUploadRows(analysis);
  return analysis;
}

export async function transformBaohaojiaArtifacts(
  fileBuffer: Buffer,
  initialStock = 9999,
  productMasterRecords?: ProductMasterLookupRecord[],
): Promise<BaohaojiaTransformArtifacts> {
  const analysis = await analyzeBaohaojiaBuffer(
    fileBuffer,
    initialStock,
    productMasterRecords,
  );
  const uploadWorkbook = buildUploadWorkbook(analysis.uploadRows);
  const auditWorkbook = buildAuditWorkbook(analysis);

  return {
    analysis,
    auditBuffer: workbookBufferToNodeBuffer(
      await auditWorkbook.xlsx.writeBuffer(),
    ),
    uploadBuffer: workbookBufferToNodeBuffer(
      await uploadWorkbook.xlsx.writeBuffer(),
    ),
  };
}

export async function transformBaohaojiaBuffer({
  fileBuffer,
  initialStock = 9999,
  productMasterRecords,
}: BaohaojiaTransformOptions): Promise<{
  buffer: Buffer;
  summary: string;
}> {
  const analysis = await analyzeBaohaojiaBuffer(
    fileBuffer,
    initialStock,
    productMasterRecords,
  );
  const combinedWorkbook = buildCombinedWorkbook(analysis);
  const buffer = workbookBufferToNodeBuffer(
    await combinedWorkbook.xlsx.writeBuffer(),
  );

  return {
    buffer,
    summary: analysis.summary,
  };
}
