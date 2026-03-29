import * as ExcelJS from 'exceljs';

import { readExcelWithSchema } from '../../utils/excel-helper';

interface ProcurementOptions {
  listBuffer: Buffer;
  refBuffer: Buffer;
  mode?: string; // 'week' | 'month' | 'none'
}

type ProcurementMode = 'week' | 'month' | 'none';

type RowRecord = Record<string, any>;

const LIST_SCHEMA = [
  { key: 'status', aliases: ['检查状态', '*检查状态'] },
  { key: 'link', aliases: ['供应商商品链接', '商品链接', '供应商链接'] },
  { key: 'upc', aliases: ['商品UPC', 'UPC', '商品条码', '条码'] },
  { key: 'sku', aliases: ['商品SKU', 'SKU', 'SKU编码'] },
  { key: 'storeCode', aliases: ['收货方编码', '门店编码', '门店/仓编码'] },
  { key: 'storeName', aliases: ['收货方名称', '门店名称', '门店/仓名称'], required: false },
  { key: 'supplierCode', aliases: ['发货方编码', '供应商编码'] },
  { key: 'purchaseUnit', aliases: ['采购单位', '补货单位'] },
  {
    key: 'purchaseQty',
    aliases: [
      '采购补货量',
      '采购补货数量',
      '采购量',
      '采购建议补货量',
      '补货量（采购单位）',
      '补货量(采购单位)',
      '补货量采购单位',
    ],
  },
  {
    key: 'adviceQty',
    aliases: [
      '建议补货量',
      '基础补货量',
      '建议补货数量',
      '基础补货数量',
      '建议量（采购单位）',
      '建议量(采购单位)',
      '建议量采购单位',
    ],
    required: false,
  },
] as const;

const REF_SCHEMA = [
  { key: 'upc', aliases: ['商品UPC', 'UPC', '商品条码', '条码'] },
  { key: 'weeklySales', aliases: ['周销', '7天销量', '近7天销量', '7日销量'] },
  { key: 'monthlySales', aliases: ['月销', '30天销量', '近30天销量', '30日销量'] },
  { key: 'conversionRate', aliases: ['换算关系', '采购换算关系'] },
  { key: 'minOrderQty', aliases: ['起订量（采购单位）', '起订量(采购单位)', '起订量采购单位', '起订量'] },
] as const;

function normalizeUpc(value: unknown): string {
  if (value == null) return '';
  let text = String(value).replaceAll(/\s+/g, '').trim();
  if (!text) return '';
  if (/^\d+\.0+$/.test(text)) {
    text = text.replace(/\.0+$/, '');
  }
  return text;
}

function toTrimmedText(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function parseStrictNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const text = String(value).replaceAll(/,/g, '').trim();
  if (!text) return null;
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function getRequiredKeys(
  fieldMap: Record<string, string>,
  requiredKeys: string[],
  label: string,
  headers: string[],
) {
  const missing = requiredKeys.filter((key) => !fieldMap[key]);
  if (missing.length > 0) {
    throw new Error(
      `${label}缺少必需列: ${missing.join('、')}。当前识别到的表头: [${headers.join(', ')}]`,
    );
  }
}

function getFieldValue(row: RowRecord, fieldMap: Record<string, string>, key: string): any {
  const header = fieldMap[key];
  return header ? row[header] : undefined;
}

function parseMode(mode: string | undefined): ProcurementMode {
  return mode === 'month' || mode === 'none' ? mode : 'week';
}

export const ProcurementAnalyzer = {
  async run({
    listBuffer,
    refBuffer,
    mode = 'week',
  }: ProcurementOptions): Promise<{
    buffer: Buffer;
    storeNames: string[];
    summary: string;
  }> {
    const normalizedMode = parseMode(String(mode).trim());
    const isNoCompare = normalizedMode === 'none';

    const listResult = await readExcelWithSchema(listBuffer, [...LIST_SCHEMA]);
    const refResult = isNoCompare
      ? { data: [], fieldMap: {}, headerRowIndex: 1, headers: [] }
      : await readExcelWithSchema(refBuffer, [...REF_SCHEMA]);

    if (listResult.data.length === 0) {
      throw new Error('补货清单内容为空或无法识别表头');
    }

    getRequiredKeys(
      listResult.fieldMap,
      [
        'status',
        'link',
        'upc',
        'sku',
        'storeCode',
        'supplierCode',
        'purchaseUnit',
        'purchaseQty',
      ],
      '补货清单',
      listResult.headers,
    );

    if (!isNoCompare) {
      if (refResult.data.length === 0) {
        throw new Error('补货参考内容为空或无法识别表头');
      }
      getRequiredKeys(
        refResult.fieldMap,
        ['upc', 'weeklySales', 'monthlySales', 'conversionRate', 'minOrderQty'],
        '补货参考',
        refResult.headers,
      );
    }

    const storeNamesSet = new Set<string>();
    const refMap = new Map<string, RowRecord>();

    if (!isNoCompare) {
      refResult.data.forEach((row) => {
        const upc = normalizeUpc(getFieldValue(row, refResult.fieldMap, 'upc'));
        if (!upc || refMap.has(upc)) return;
        refMap.set(upc, row);
      });
    }

    const wbOutput = new ExcelJS.Workbook();
    const wsOutput = wbOutput.addWorksheet('补货建议');

    wsOutput.columns = [
      { header: '*门店/仓编码', key: 'storeCode', width: 15 },
      { header: '*SKU编码', key: 'skuCode', width: 15 },
      { header: '补货量', key: 'quantity', width: 12 },
      { header: '商品名称', key: 'name', width: 30 },
      { header: '补货单价(元）', key: 'price', width: 12 },
      { header: '供应商编码', key: 'supplierCode', width: 15 },
      { header: '补货单位', key: 'unit', width: 10 },
    ];

    const stats = {
      totalScanned: listResult.data.length,
      candidateCount: 0,
      exportedCount: 0,
      filteredByStatus: 0,
      filteredByMissingLink: 0,
      filteredByMissingUpc: 0,
      skippedByMissingReference: 0,
      skippedByInvalidConversionRate: 0,
      skippedByInvalidPurchaseQty: 0,
      filteredByFinalQty: 0,
      yellowMarked: 0,
    };

    for (const row of listResult.data) {
      const status = toTrimmedText(getFieldValue(row, listResult.fieldMap, 'status'));
      if (status !== '已通过') {
        stats.filteredByStatus++;
        continue;
      }

      const link = toTrimmedText(getFieldValue(row, listResult.fieldMap, 'link'));
      if (!link) {
        stats.filteredByMissingLink++;
        continue;
      }

      stats.candidateCount++;

      const upc = normalizeUpc(getFieldValue(row, listResult.fieldMap, 'upc'));
      if (!upc) {
        stats.filteredByMissingUpc++;
        continue;
      }

      const storeName = toTrimmedText(getFieldValue(row, listResult.fieldMap, 'storeName'));
      if (storeName) {
        storeNamesSet.add(storeName);
      }

      const skuCode = toTrimmedText(getFieldValue(row, listResult.fieldMap, 'sku'));
      const storeCode = toTrimmedText(getFieldValue(row, listResult.fieldMap, 'storeCode'));
      const supplierCode = toTrimmedText(getFieldValue(row, listResult.fieldMap, 'supplierCode'));
      const unit = toTrimmedText(getFieldValue(row, listResult.fieldMap, 'purchaseUnit'));
      const purchaseQty = parseStrictNumber(getFieldValue(row, listResult.fieldMap, 'purchaseQty'));

      if (purchaseQty == null) {
        stats.skippedByInvalidPurchaseQty++;
        continue;
      }

      let finalQty = purchaseQty;
      let bgColor: null | string = null;

      if (!isNoCompare) {
        const refRow = refMap.get(upc);
        if (!refRow) {
          stats.skippedByMissingReference++;
          continue;
        }

        const comparisonValue = parseStrictNumber(
          getFieldValue(
            refRow,
            refResult.fieldMap,
            normalizedMode === 'month' ? 'monthlySales' : 'weeklySales',
          ),
        );
        const conversionRate = parseStrictNumber(
          getFieldValue(refRow, refResult.fieldMap, 'conversionRate'),
        );
        const minOrderQty = parseStrictNumber(
          getFieldValue(refRow, refResult.fieldMap, 'minOrderQty'),
        );

        if (conversionRate == null || conversionRate <= 0) {
          stats.skippedByInvalidConversionRate++;
          continue;
        }

        const normalizedComparisonValue = comparisonValue == null ? 0 : comparisonValue;
        const normalizedMinOrderQty = minOrderQty != null && minOrderQty > 0 ? minOrderQty : 0;

        finalQty = Math.ceil(normalizedComparisonValue / conversionRate);
        if (finalQty < normalizedMinOrderQty) {
          finalQty = normalizedMinOrderQty;
        }

        const purchaseQtyInBaseUnit = purchaseQty * conversionRate;
        if (purchaseQtyInBaseUnit > normalizedComparisonValue * 1.5) {
          bgColor = 'FFFF00';
          stats.yellowMarked++;
        }
      }

      if (finalQty <= 0) {
        stats.filteredByFinalQty++;
        continue;
      }

      stats.exportedCount++;
      const newRow = wsOutput.addRow({
        storeCode,
        skuCode,
        quantity: finalQty,
        name: '',
        price: '',
        supplierCode,
        unit,
      });

      newRow.getCell('name').value = '';
      newRow.getCell('price').value = '';

      if (bgColor) {
        newRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: bgColor },
        };
      }
    }

    const buffer = (await wbOutput.xlsx.writeBuffer()) as Buffer;
    const modeLabel =
      normalizedMode === 'none'
        ? '不比对'
        : normalizedMode === 'month'
          ? '按月'
          : '按周';
    const summary = [
      `处理完成！(模式: ${modeLabel})`,
      `总扫描数: ${stats.totalScanned}`,
      `通过状态且有链接的候选数: ${stats.candidateCount}`,
      `成功导出数: ${stats.exportedCount}`,
      `因状态过滤数: ${stats.filteredByStatus}`,
      `因缺少链接过滤数: ${stats.filteredByMissingLink}`,
      `因缺少 UPC 过滤数: ${stats.filteredByMissingUpc}`,
      `因参考表未匹配跳过数: ${stats.skippedByMissingReference}`,
      `因换算关系非法跳过数: ${stats.skippedByInvalidConversionRate}`,
      `因采购量无效跳过数: ${stats.skippedByInvalidPurchaseQty}`,
      `因最终数量 <= 0 过滤数: ${stats.filteredByFinalQty}`,
      `黄标数: ${stats.yellowMarked}`,
    ].join('\n');

    return { buffer: buffer as Buffer, summary, storeNames: [...storeNamesSet] };
  },
};
