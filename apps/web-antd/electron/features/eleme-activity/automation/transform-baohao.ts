import fs from 'node:fs/promises';
import ExcelJS from 'exceljs';
import * as path from 'path';
import { fileURLToPath } from 'node:url';

import { isCliEntry } from '../../../utils/is-main-module';
import {
  ensureProductMasterIndex,
  findProductMasterRecord,
  getProductMasterProcurementPricing,
} from '../../product-master/index';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');
const UPLOAD_SHEET_NAME = '爆好价报名';
const UPLOAD_COLUMNS = [
  { header: 'UPC条形码', key: 'upc', width: 20 },
  { header: '活动价', key: 'price', width: 12 },
  { header: '活动初始库存', key: 'stock', width: 12 },
  { header: '是否组包', key: 'isPackage', width: 10 },
  { header: '组包件数', key: 'packageCount', width: 10 },
] as const;


type HeaderKey = 'barcode' | 'isPackage' | 'packageCount' | 'price' | 'productName';

export type BaohaojiaBaseRow = {
  activityPrice: null | number;
  cartonProcurementCost?: null | number;
  cartonSize?: string;
  isPackage: string;
  packageCount: string;
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

export type BaohaojiaTransformPaths = BaohaojiaAnalysisResult & {
  auditPath: string;
  uploadPath: string;
};

function createRowId(prefix: string, upc: string, index: number) {
  return `${prefix}_${upc || 'unknown'}_${index}`;
}

function normalizeText(value: unknown) {
  return String(value ?? '').trim();
}

function parseNumber(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const parsed = Number.parseFloat(normalizeText(value).replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function workbookBufferToNodeBuffer(buffer: ArrayBuffer | Buffer) {
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
}

function pickUploadRows(analysis: BaohaojiaAnalysisResult): BaohaojiaUploadRow[] {
  return [...analysis.qualifiedRows, ...analysis.reviewRows].map((row) => ({
    isPackage: row.isPackage,
    packageCount: row.packageCount,
    price: row.price ?? '',
    stock: row.stock,
    upc: row.upc,
  }));
}

function buildSummary(metrics: BaohaojiaAnalysisMetrics) {
  return `处理完成！
总商品数: ${metrics.totalCount}
✅ 可报名: ${metrics.qualifiedCount}
🟡 待确认: ${metrics.reviewCount}
❌ 已过滤: ${metrics.excludedCount}
🔍 商品未命中: ${metrics.notFoundCount}
⚠️ 活动价异常: ${metrics.invalidPriceCount}
⚠️ 采购价为0: ${metrics.zeroCostCount}`;
}

function buildUploadWorkbook(rows: BaohaojiaUploadRow[]) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet(UPLOAD_SHEET_NAME);
  worksheet.columns = [...UPLOAD_COLUMNS];
  rows.forEach((row) => worksheet.addRow(row));
  return workbook;
}

function buildAuditWorkbook(analysis: BaohaojiaAnalysisResult) {
  const workbook = new ExcelJS.Workbook();
  const reviewNoteMap = new Map(
    analysis.reviewRows.map((row) => [row.upc, row.reasons.join('；')]),
  );

  const summarySheet = workbook.addWorksheet('处理摘要');
  summarySheet.columns = [
    { header: '指标', key: 'label', width: 22 },
    { header: '数值', key: 'value', width: 16 },
    { header: '说明', key: 'note', width: 44 },
  ];
  [
    {
      label: '总商品数',
      note: '平台导出模板中识别到的有效商品行数。',
      value: analysis.metrics.totalCount,
    },
    {
      label: '可报名',
      note: '可直接进入上传文件的商品数。',
      value: analysis.metrics.qualifiedCount,
    },
    {
      label: '待确认',
      note: '仍保留在上传文件，但需要运营关注解释信息的商品数。',
      value: analysis.metrics.reviewCount,
    },
    {
      label: '已过滤',
      note: '采购价高于活动价，已从上传文件剔除。',
      value: analysis.metrics.excludedCount,
    },
    {
      label: '商品未命中',
      note: '商品总表未命中，按当前 scripts 口径保留可报名。',
      value: analysis.metrics.notFoundCount,
    },
    {
      label: '活动价异常',
      note: '活动价无效，保留到上传文件但价格为空。',
      value: analysis.metrics.invalidPriceCount,
    },
    {
      label: '采购价为0',
      note: '保留到上传文件，同时标记到审计结果中。',
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
    ...UPLOAD_COLUMNS,
    { header: '说明', key: 'note', width: 36 },
  ];
  analysis.uploadRows.forEach((row) => {
    uploadSheet.addRow({
      ...row,
      note: reviewNoteMap.get(row.upc) || '',
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

  const excludedSheet = workbook.addWorksheet('已过滤商品');
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
    { header: '过滤原因', key: 'reason', width: 36 },
  ];
  analysis.excludedRows.forEach((row) => excludedSheet.addRow(row));

  return workbook;
}

async function parseWorkbook(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('Excel中没有工作表');
  }
  return worksheet;
}

function resolveHeaderMap(worksheet: ExcelJS.Worksheet) {
  let headerRowNum = 1;
  worksheet.eachRow((row, rowNumber) => {
    const rowTexts = row.values
      .slice(1)
      .map((value) => normalizeText(value))
      .filter(Boolean);
    const hasBarcodeHeader = rowTexts.some((value) => /UPC条?形?码|条码|条形码/i.test(value));
    const hasPriceHeader = rowTexts.some((value) =>
      /活动价上限|活动价不高于|活动价|价格/i.test(value),
    );
    if (hasBarcodeHeader && hasPriceHeader) {
      headerRowNum = rowNumber;
    }
  });

  const headerRow = worksheet.getRow(headerRowNum);
  const headers: Partial<Record<HeaderKey, number>> = {};
  headerRow.eachCell((cell, colNumber) => {
    const value = normalizeText(cell.value);
    if (/UPC|条码|条形码/i.test(value)) headers.barcode = colNumber;
    if (/活动价上限|活动价不高于|活动价|价格/i.test(value)) headers.price = colNumber;
    if (/是否组包/i.test(value)) headers.isPackage = colNumber;
    if (/组包件数/i.test(value)) headers.packageCount = colNumber;
    if (/商品名称/i.test(value)) headers.productName = colNumber;
  });

  if (!headers.barcode) throw new Error('未找到条码列');
  if (!headers.price) throw new Error('未找到活动价列');

  return {
    headerRowNum,
    headers,
  };
}

export async function analyzeBaohaojiaBuffer(
  fileBuffer: Buffer,
  initialStock = 9999,
): Promise<BaohaojiaAnalysisResult> {
  const productMaster = await ensureProductMasterIndex({
    allowLegacySource: true,
  });
  if (productMaster.records.length === 0) {
    throw new Error('请先上传商品总表 JSON');
  }

  const worksheet = await parseWorkbook(fileBuffer);
  const { headerRowNum, headers } = resolveHeaderMap(worksheet);

  const excludedRows: BaohaojiaExcludedRow[] = [];
  const qualifiedRows: BaohaojiaQualifiedRow[] = [];
  const reviewRows: BaohaojiaReviewRow[] = [];

  let invalidPriceCount = 0;
  let notFoundCount = 0;

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowNum) return;

    const upc = normalizeText(row.getCell(headers.barcode!).value);
    if (!upc) return;

    const activityPrice = parseNumber(row.getCell(headers.price!).value);
    const isPackage = headers.isPackage
      ? normalizeText(row.getCell(headers.isPackage).value || '否') || '否'
      : '否';
    const packageCount = headers.packageCount
      ? normalizeText(row.getCell(headers.packageCount).value)
      : '';
    const productName = headers.productName
      ? normalizeText(row.getCell(headers.productName).value)
      : '';

    const masterProduct = findProductMasterRecord(productMaster, { barcode: upc });

    if (!masterProduct) {
      notFoundCount += 1;
      qualifiedRows.push({
        activityPrice,
        id: createRowId('qualified', upc, rowNumber),
        isPackage,
        packageCount,
        price: activityPrice ?? '',
        procurementCost: null,
        productName,
        reasons: ['商品总表未命中，已按当前 scripts 口径保留可报名'],
        stock: initialStock,
        upc,
      });
      return;
    }

    const pricing = getProductMasterProcurementPricing(masterProduct);
    const procurementCost =
      pricing.baseUnitProcurementCost ?? masterProduct.procurementCost ?? null;
    const normalizedName = productName || masterProduct.productName || '';

    if (activityPrice == null || activityPrice <= 0) {
      invalidPriceCount += 1;
      reviewRows.push({
        activityPrice,
        cartonProcurementCost: pricing.cartonProcurementCost,
        cartonSize: pricing.cartonSize,
        id: createRowId('review', upc, rowNumber),
        isPackage,
        packageCount,
        price: '',
        procurementCost,
        productName: normalizedName,
        reasons: ['活动价无效'],
        stock: initialStock,
        upc,
      });
      return;
    }

    if (procurementCost != null && procurementCost > activityPrice) {
      excludedRows.push({
        activityPrice,
        cartonProcurementCost: pricing.cartonProcurementCost,
        cartonSize: pricing.cartonSize,
        id: createRowId('excluded', upc, rowNumber),
        isPackage,
        packageCount,
        procurementCost,
        productName: normalizedName,
        profitMargin: `${(((activityPrice - procurementCost) / activityPrice) * 100).toFixed(1)}%`,
        reason: `采购价(${procurementCost}) > 活动价(${activityPrice})`,
        upc,
      });
      return;
    }

    const reviewReasons: string[] = [];
    if (procurementCost === 0) {
      reviewReasons.push('采购价为0，需人工复核');
    }

    if (reviewReasons.length > 0) {
      reviewRows.push({
        activityPrice,
        cartonProcurementCost: pricing.cartonProcurementCost,
        cartonSize: pricing.cartonSize,
        id: createRowId('review', upc, rowNumber),
        isPackage,
        packageCount,
        price: activityPrice,
        procurementCost,
        productName: normalizedName,
        reasons: reviewReasons,
        stock: initialStock,
        upc,
      });
      return;
    }

    qualifiedRows.push({
      activityPrice,
      cartonProcurementCost: pricing.cartonProcurementCost,
      cartonSize: pricing.cartonSize,
      id: createRowId('qualified', upc, rowNumber),
      isPackage,
      packageCount,
      price: activityPrice,
      procurementCost,
      productName: normalizedName,
      stock: initialStock,
      upc,
    });
  });

  const metrics: BaohaojiaAnalysisMetrics = {
    excludedCount: excludedRows.length,
    invalidPriceCount,
    notFoundCount,
    qualifiedCount: qualifiedRows.length,
    reviewCount: reviewRows.length,
    totalCount: qualifiedRows.length + reviewRows.length + excludedRows.length,
    zeroCostCount: reviewRows.filter((row) => row.reasons.includes('采购价为0，需人工复核')).length,
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

export async function transformBaohaojiaBuffer(
  fileBuffer: Buffer,
  initialStock = 9999,
): Promise<BaohaojiaTransformArtifacts> {
  const analysis = await analyzeBaohaojiaBuffer(fileBuffer, initialStock);
  const uploadWorkbook = buildUploadWorkbook(analysis.uploadRows);
  const auditWorkbook = buildAuditWorkbook(analysis);

  return {
    analysis,
    auditBuffer: workbookBufferToNodeBuffer(await auditWorkbook.xlsx.writeBuffer()),
    uploadBuffer: workbookBufferToNodeBuffer(await uploadWorkbook.xlsx.writeBuffer()),
  };
}

export async function transformBaohaojiaWithArtifacts(
  inputPath: string,
  initialStock = 9999,
): Promise<BaohaojiaTransformPaths> {
  console.log('\n=== 爆好价转换器 ===');
  console.log(`读取文件: ${inputPath}`);
  console.log(`初始库存: ${initialStock}`);

  const sourceBuffer = await fs.readFile(inputPath);
  const { analysis, auditBuffer, uploadBuffer } = await transformBaohaojiaBuffer(
    sourceBuffer,
    initialStock,
  );

  const baseName = path.basename(inputPath, path.extname(inputPath));
  const uploadPath = path.join(DATA_DIR, `${baseName}_报名.xlsx`);
  const auditPath = path.join(DATA_DIR, `${baseName}_审计.xlsx`);

  await Promise.all([
    fs.writeFile(uploadPath, uploadBuffer),
    fs.writeFile(auditPath, auditBuffer),
  ]);

  console.log('\n=== 过滤结果 ===');
  console.log(analysis.summary);
  console.log(`\n✅ 上传文件: ${uploadPath}`);
  console.log(`🧾 审计文件: ${auditPath}`);

  return {
    ...analysis,
    auditPath,
    uploadPath,
  };
}

export async function transformBaohaojia(inputPath: string, initialStock = 9999): Promise<string> {
  const result = await transformBaohaojiaWithArtifacts(inputPath, initialStock);
  return result.uploadPath;
}

if (isCliEntry('transform-baohao.ts', 'transform-baohao.js', 'transform-baohao.mjs', 'transform-baohao.cjs')) {
  const inputFile = process.argv[2];
  const stock = Number.parseInt(process.argv[3] || '9999', 10);

  if (!inputFile) {
    console.error('用法: ts-node transform-baohao.ts <输入Excel> [初始库存=9999]');
    console.error('\n功能：');
    console.error('  1. 根据条码查询商品总表最小单位采购价');
    console.error('  2. 过滤采购价 > 活动价的商品');
    console.error('  3. 输出平台上传文件（严格模板）');
    console.error('  4. 输出审计文件（保留排除/说明信息）');
    process.exit(1);
  }

  transformBaohaojiaWithArtifacts(inputFile, stock)
    .then((result) => {
      console.log('\n=== 完成 ===');
      console.log(`上传文件: ${result.uploadPath}`);
      console.log(`审计文件: ${result.auditPath}`);
    })
    .catch((error) => {
      console.error('失败:', error.message);
      process.exit(1);
    });
}
