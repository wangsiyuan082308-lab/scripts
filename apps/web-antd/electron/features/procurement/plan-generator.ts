import { Buffer } from 'node:buffer';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as ExcelJS from 'exceljs';

import {
  readExcelWithSchema,
  type ExcelSchemaField,
} from '../../utils/excel-helper';

interface PlanOptions {
  buffers: Buffer[];
  type: 'aoxiang' | 'qianniuhua';
}

type PlanRow = {
  logisticsNo: string;
  message: string;
  name: string;
  price: number | '';
  quantity: number;
  skuCode: string;
  specification: string;
  storeCode: string;
  supplierCode: string;
  unit: string;
};

const PDD_SUPPLIER_CODE = '2168183';
const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_TEMPLATE_PATH = path.resolve(
  CURRENT_DIR,
  '../../../public/templates/aoxiang-import-template.xlsx',
);

const INPUT_SCHEMA: ExcelSchemaField[] = [
  { key: 'storeCode', aliases: ['*门店/仓编码', '门店/仓编码'] },
  { key: 'skuCode', aliases: ['*SKU编码', 'SKU编码'] },
  { key: 'quantity', aliases: ['*采购量', '采购量'] },
  { key: 'price', aliases: ['采购单价(元)', '采购单价', '单价'], required: false },
  { key: 'supplierCode', aliases: ['供应商编码'], required: false },
  { key: 'unit', aliases: ['采购单位', '单位'], required: false },
  { key: 'name', aliases: ['商品名称', '名称'], required: false },
  { key: 'logisticsNo', aliases: ['物流单号'], required: false },
  { key: 'arrivalDate', aliases: ['预计到货日期'], required: false },
  { key: 'message', aliases: ['网采订单留言内容'], required: false },
];

const AOXIANG_TEMPLATE_SCHEMA: ExcelSchemaField[] = [
  { key: 'storeCode', aliases: ['*仓库/门店编码', '仓库/门店编码'] },
  { key: 'supplierCode', aliases: ['*供应商编码', '供应商编码'] },
  { key: 'skuCode', aliases: ['*商品编码', '商品编码'] },
  { key: 'quantity', aliases: ['*采购数量', '采购数量'] },
];

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

function getFieldValue(
  row: Record<string, unknown>,
  fieldMap: Record<string, string>,
  key: string,
): unknown {
  const header = fieldMap[key];
  return header ? row[header] : undefined;
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

function resolveAoxiangTemplatePath() {
  const runtimeTemplatePath = process.env.VITE_PUBLIC
    ? path.join(process.env.VITE_PUBLIC, 'templates', 'aoxiang-import-template.xlsx')
    : '';

  if (runtimeTemplatePath && fs.existsSync(runtimeTemplatePath)) {
    return runtimeTemplatePath;
  }

  if (fs.existsSync(SOURCE_TEMPLATE_PATH)) {
    return SOURCE_TEMPLATE_PATH;
  }

  throw new Error('未找到翱象采购导入模板文件，请检查 templates/aoxiang-import-template.xlsx 是否存在。');
}

async function loadAoxiangTemplateWorkbook() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(resolveAoxiangTemplatePath());

  const worksheet = workbook.getWorksheet('sheet1') ?? workbook.worksheets[0];
  if (!worksheet) {
    throw new Error('翱象采购导入模板缺少主工作表。');
  }

  return { workbook, worksheet };
}

function clearTemplateSampleRows(worksheet: ExcelJS.Worksheet) {
  for (let rowNumber = 8; rowNumber <= worksheet.rowCount; rowNumber++) {
    for (let colNumber = 1; colNumber <= 14; colNumber++) {
      worksheet.getCell(rowNumber, colNumber).value = null;
    }
  }
}

async function readPlanRows(buffers: Buffer[]): Promise<PlanRow[]> {
  const allData: PlanRow[] = [];

  for (const buffer of buffers) {
    const result = await readExcelWithSchema(buffer, [...INPUT_SCHEMA]);
    const aoxiangResult = await readExcelWithSchema(buffer, [...AOXIANG_TEMPLATE_SCHEMA]);

    if (Object.keys(aoxiangResult.fieldMap).length >= 4) {
      throw new Error(
        '当前上传的是翱象采购导入模板，请上传牵牛花采购计划模版后再生成。',
      );
    }

    if (result.data.length === 0) {
      continue;
    }

    getRequiredKeys(
      result.fieldMap,
      ['storeCode', 'skuCode', 'quantity'],
      '采购计划模版',
      result.headers,
    );

    result.data.forEach((row) => {
      const storeCode = toTrimmedText(getFieldValue(row, result.fieldMap, 'storeCode'));
      const skuCode = toTrimmedText(getFieldValue(row, result.fieldMap, 'skuCode'));
      const quantity = parseStrictNumber(getFieldValue(row, result.fieldMap, 'quantity'));
      const price = parseStrictNumber(getFieldValue(row, result.fieldMap, 'price'));

      if (!storeCode || !skuCode || quantity == null) {
        return;
      }

      allData.push({
        logisticsNo: toTrimmedText(getFieldValue(row, result.fieldMap, 'logisticsNo')),
        message: toTrimmedText(getFieldValue(row, result.fieldMap, 'message')),
        name: toTrimmedText(getFieldValue(row, result.fieldMap, 'name')),
        storeCode,
        skuCode,
        quantity,
        specification: '',
        supplierCode: PDD_SUPPLIER_CODE,
        unit: toTrimmedText(getFieldValue(row, result.fieldMap, 'unit')),
        price: price ?? '',
      });
    });
  }

  return allData;
}

export const ProcurementPlanGenerator = {
  async run({ buffers, type }: PlanOptions) {
    if (type !== 'aoxiang') {
      throw new Error('当前仅支持生成翱象采购计划');
    }

    const allData = await readPlanRows(buffers);

    if (allData.length === 0) {
      throw new Error('未找到有效数据，请检查上传的文件内容');
    }

    const { workbook, worksheet } = await loadAoxiangTemplateWorkbook();
    clearTemplateSampleRows(worksheet);

    allData.forEach((row, index) => {
      const rowNumber = index + 8;
      worksheet.getCell(`A${rowNumber}`).value = row.storeCode;
      worksheet.getCell(`B${rowNumber}`).value = row.supplierCode;
      worksheet.getCell(`C${rowNumber}`).value = row.skuCode;
      worksheet.getCell(`D${rowNumber}`).value = row.quantity;
      worksheet.getCell(`E${rowNumber}`).value = row.unit;
      worksheet.getCell(`F${rowNumber}`).value = row.price;
      worksheet.getCell(`G${rowNumber}`).value = '';
      worksheet.getCell(`H${rowNumber}`).value = row.logisticsNo;
      worksheet.getCell(`I${rowNumber}`).value = row.name;
      worksheet.getCell(`J${rowNumber}`).value = row.specification;
      worksheet.getCell(`K${rowNumber}`).value = row.message;
      worksheet.getCell(`L${rowNumber}`).value = 'PDD机器人采购';
      worksheet.getCell(`M${rowNumber}`).value = '';
      worksheet.getCell(`N${rowNumber}`).value = '';
    });

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const timestamp = new Date()
      .toISOString()
      .replaceAll(/[:.]/g, '-')
      .slice(0, 19);
    const filename = `采购计划_翱象_${timestamp}.xlsx`;

    return {
      buffer,
      summary: `生成成功！\n目标平台：翱象\n共合并 ${buffers.length} 个文件，生成 ${allData.length} 条数据。`,
      outputPath: filename,
    };
  },
};
