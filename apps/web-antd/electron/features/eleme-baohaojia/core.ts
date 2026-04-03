import type { ProductMasterRecord } from '../product-master/index';

import { Buffer } from 'node:buffer';

import * as ExcelJS from 'exceljs';

import { readExcelWithSchema } from '../../utils/excel-helper';
import {
  ensureProductMasterIndex,
  findProductMasterRecord,
} from '../product-master/index';

interface BaohaojiaTransformOptions {
  fileBuffer: Buffer;
  initialStock?: number;
}

interface BaohaojiaProcessedRow {
  isPackage: string;
  packageCount: number | string;
  price: number | string;
  procurementCost: null | number;
  productName: string;
  stock: number;
  upc: string;
}

interface BaohaojiaExcludedRow {
  activityPrice: number;
  procurementCost: number;
  productName: string;
  profitMargin: string;
  reason: string;
  upc: string;
}

interface BaohaojiaStats {
  excludedRows: BaohaojiaExcludedRow[];
  noPriceCount: number;
  notFoundCount: number;
  processedRows: BaohaojiaProcessedRow[];
  skippedNoBarcodeCount: number;
  zeroCostCount: number;
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

function getFieldValue(
  row: RowRecord,
  fieldMap: Record<string, string>,
  key: (typeof BAOHAOJIA_SCHEMA)[number]['key'],
) {
  const header = fieldMap[key];
  return header ? row[header] : undefined;
}

function normalizeText(value: unknown) {
  if (value === null || value === undefined) {
    return '';
  }
  return String(value).trim();
}

function normalizeCode(value: unknown) {
  return normalizeText(value).replaceAll(/\s+/g, '');
}

function parseLooseNumber(value: unknown): null | number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const text = normalizeText(value);
  if (!text) {
    return null;
  }
  const parsed = Number.parseFloat(text.replaceAll(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePositivePackageCount(value: unknown) {
  const parsed = parseLooseNumber(value);
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
  masterProduct: null | ProductMasterRecord,
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
  masterProduct: null | ProductMasterRecord,
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

function buildWorkbook(stats: BaohaojiaStats) {
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
  stats.processedRows.forEach((row) => outputSheet.addRow(row));

  if (stats.excludedRows.length > 0) {
    const excludedSheet = workbook.addWorksheet('排除商品');
    excludedSheet.columns = [
      { header: '条码', key: 'upc', width: 20 },
      { header: '商品名称', key: 'productName', width: 40 },
      { header: '活动价', key: 'activityPrice', width: 12 },
      { header: '采购价', key: 'procurementCost', width: 12 },
      { header: '毛利率', key: 'profitMargin', width: 10 },
      { header: '排除原因', key: 'reason', width: 30 },
    ];
    stats.excludedRows.forEach((row) => excludedSheet.addRow(row));
  }

  if (stats.zeroCostCount > 0) {
    const zeroCostSheet = workbook.addWorksheet('⚠️采购价为0');
    zeroCostSheet.columns = [
      { header: '条码', key: 'upc', width: 20 },
      { header: '商品名称', key: 'productName', width: 40 },
      { header: '活动价', key: 'price', width: 12 },
      { header: '采购价', key: 'procurementCost', width: 12 },
      { header: '风险', key: 'risk', width: 20 },
    ];

    stats.processedRows
      .filter((row) => row.procurementCost === 0)
      .forEach((row) => {
        zeroCostSheet.addRow({
          ...row,
          risk: '采购价未设置，无法判断利润',
        });
      });

    zeroCostSheet.getRow(1).eachCell((cell) => {
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFCC00' },
      };
    });
  }

  return workbook;
}

function buildSummary(stats: BaohaojiaStats) {
  const total = stats.processedRows.length + stats.excludedRows.length;
  const lines = [
    `处理完成：总商品数 ${total}`,
    `保留: ${stats.processedRows.length} (采购价 <= 活动价)`,
    `排除: ${stats.excludedRows.length} (采购价 > 活动价)`,
    `未找到: ${stats.notFoundCount} (商品总表中无记录)`,
    `无活动价: ${stats.noPriceCount}`,
    `采购价为0: ${stats.zeroCostCount} (需核实)`,
  ];

  if (stats.skippedNoBarcodeCount > 0) {
    lines.push(`缺少条码已跳过: ${stats.skippedNoBarcodeCount}`);
  }

  if (stats.excludedRows.length > 0) {
    lines.push('详情请查看“排除商品”Sheet');
  }

  if (stats.zeroCostCount > 0) {
    lines.push('采购价为0的商品请查看“⚠️采购价为0”Sheet');
  }

  return lines.join('\n');
}

export async function transformBaohaojiaBuffer({
  fileBuffer,
  initialStock = 9999,
}: BaohaojiaTransformOptions): Promise<{
  buffer: Buffer;
  summary: string;
}> {
  const productMaster = await ensureProductMasterIndex({
    allowLegacySource: true,
  });
  if (productMaster.records.length === 0) {
    throw new Error('请先上传商品总表 JSON');
  }

  const readResult = await readExcelWithSchema(fileBuffer, [
    ...BAOHAOJIA_SCHEMA,
  ]);
  if (readResult.data.length === 0) {
    throw new Error('上传的文件为空或无法识别数据');
  }

  const barcodeHeader = readResult.fieldMap.barcode;
  if (barcodeHeader === undefined) {
    throw new Error('未找到条码列');
  }

  const activityPriceHeader = readResult.fieldMap.activityPrice;
  if (activityPriceHeader === undefined) {
    throw new Error('未找到活动价列');
  }

  const stats: BaohaojiaStats = {
    excludedRows: [],
    noPriceCount: 0,
    notFoundCount: 0,
    processedRows: [],
    skippedNoBarcodeCount: 0,
    zeroCostCount: 0,
  };

  readResult.data.forEach((row) => {
    const barcode = normalizeCode(
      getFieldValue(row, readResult.fieldMap, 'barcode'),
    );
    if (!barcode) {
      stats.skippedNoBarcodeCount++;
      return;
    }

    const activityPrice = parseLooseNumber(
      getFieldValue(row, readResult.fieldMap, 'activityPrice'),
    );
    const productName = normalizeText(
      getFieldValue(row, readResult.fieldMap, 'productName'),
    );
    const masterProduct = findProductMasterRecord(productMaster, { barcode });
    const packageFields = resolvePackageFields(
      row,
      readResult.fieldMap,
      masterProduct,
    );

    if (masterProduct === null) {
      stats.notFoundCount++;
      stats.processedRows.push({
        upc: barcode,
        price: activityPrice ?? '',
        stock: initialStock,
        isPackage: packageFields.isPackage,
        packageCount: packageFields.packageCount,
        procurementCost: null,
        productName,
      });
      return;
    }

    const procurementCost = masterProduct.procurementCost ?? null;
    const resolvedProductName = productName || masterProduct.productName || '';

    if (activityPrice === null || activityPrice <= 0) {
      stats.noPriceCount++;
      stats.processedRows.push({
        upc: barcode,
        price: '',
        stock: initialStock,
        isPackage: packageFields.isPackage,
        packageCount: packageFields.packageCount,
        procurementCost,
        productName: resolvedProductName,
      });
      return;
    }

    if (procurementCost !== null && procurementCost > activityPrice) {
      stats.excludedRows.push({
        upc: barcode,
        productName: resolvedProductName,
        activityPrice,
        procurementCost,
        profitMargin: `${(((activityPrice - procurementCost) / activityPrice) * 100).toFixed(1)}%`,
        reason: `采购价(${procurementCost}) > 活动价(${activityPrice})`,
      });
      return;
    }

    stats.processedRows.push({
      upc: barcode,
      price: activityPrice,
      stock: initialStock,
      isPackage: packageFields.isPackage,
      packageCount: packageFields.packageCount,
      procurementCost,
      productName: resolvedProductName,
    });
  });

  stats.zeroCostCount = stats.processedRows.filter(
    (row) => row.procurementCost === 0,
  ).length;

  const workbook = buildWorkbook(stats);
  const buffer = (await workbook.xlsx.writeBuffer()) as Buffer;

  return {
    buffer: Buffer.from(buffer),
    summary: buildSummary(stats),
  };
}
