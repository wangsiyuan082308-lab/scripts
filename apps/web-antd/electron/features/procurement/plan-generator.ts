import { Buffer } from 'node:buffer';

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

function createAoxiangWorksheet(workbook: ExcelJS.Workbook) {
  const worksheet = workbook.addWorksheet('采购计划');

  worksheet.columns = [
    { header: '', key: 'col1', width: 25 },
    { header: '', key: 'col2', width: 25 },
    { header: '', key: 'col3', width: 25 },
    {
      header: '',
      key: 'col4',
      width: 25,
    },
    {
      header: '',
      key: 'col5',
      width: 45,
    },
    {
      header: '',
      key: 'col6',
      width: 27,
    },
    { header: '', key: 'col7', width: 27 },
    { header: '', key: 'col8', width: 28 },
    { header: '', key: 'col9', width: 25 },
    { header: '', key: 'col10', width: 25 },
    { header: '', key: 'col11', width: 25 },
    { header: '', key: 'col12', width: 25 },
    { header: '', key: 'col13', width: 45 },
    { header: '', key: 'col14', width: 45 },
  ];

  worksheet.mergeCells('A1:N5');
  worksheet.mergeCells('F6:G6');

  worksheet.getCell('A6').value = '必填（可在门店管理查询）';
  worksheet.getCell('B6').value = '必填（可在供应商管理查询）';
  worksheet.getCell('C6').value = '必填（可在门店商品查询）';
  worksheet.getCell('D6').value = '必填（采购数量不能小于最小起订量）';
  worksheet.getCell('E6').value =
    '选填（请下拉选项选择填入，不填则默认为采购单位。库存单位为最小售卖单位，采购单位为箱规，例如：农夫山泉矿泉水500ml，库存单位为瓶，采购单位为箱）';
  worksheet.getCell('F6').value =
    '选填（单价、金额只填其中1个，另外1个系统自动计算填入；如果2个都填写，系统只取金额；如果都不填，系统默认取最近一次采购价自动填入）';

  const headerRow = worksheet.getRow(7);
  const headerValues = [
    '*仓库/门店编码',
    '*供应商编码',
    '*商品编码',
    '*采购数量',
    '单位',
    '采购单价（元）',
    '采购金额（元）',
    '物流单号',
    '商品名称',
    '规格',
    '网采订单留言',
    '数据来源',
    '是否创建外部订单',
    '外部采购账号',
  ];
  headerValues.forEach((value, index) => {
    worksheet.getCell(7, index + 1).value = value;
  });

  const descriptionStyle = {
    alignment: {
      horizontal: 'center' as const,
      vertical: 'center' as const,
      wrapText: true,
    },
    border: {
      top: { style: 'thin' as const },
      left: { style: 'thin' as const },
      bottom: { style: 'thin' as const },
      right: { style: 'thin' as const },
    },
    fill: {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD3D3D3' },
    },
    font: { bold: true },
  };

  ['A6', 'B6', 'C6', 'D6', 'E6', 'F6'].forEach((cell) => {
    Object.assign(worksheet.getCell(cell), descriptionStyle);
  });

  headerRow.eachCell((cell) => {
    Object.assign(cell, descriptionStyle);
  });

  worksheet.dataValidations.add('E8:E3001', {
    type: 'list',
    allowBlank: true,
    formulae: ['"采购单位,库存单位"'],
  });
  worksheet.dataValidations.add('M8:M3001', {
    type: 'list',
    allowBlank: true,
    formulae: ['"是,否"'],
  });

  return worksheet;
}

async function readPlanRows(buffers: Buffer[]): Promise<PlanRow[]> {
  const allData: PlanRow[] = [];

  for (const buffer of buffers) {
    const result = await readExcelWithSchema(buffer, [...INPUT_SCHEMA]);

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
        supplierCode: toTrimmedText(getFieldValue(row, result.fieldMap, 'supplierCode')),
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

    const workbook = new ExcelJS.Workbook();
    const worksheet = createAoxiangWorksheet(workbook);

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
