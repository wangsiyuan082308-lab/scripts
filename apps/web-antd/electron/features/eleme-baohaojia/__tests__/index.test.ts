// @vitest-environment node
import ExcelJS from 'exceljs';
import { afterEach, describe, expect, it, vi } from 'vitest';

async function createInputWorkbookBuffer() {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('导出商品');
  worksheet.addRow([
    'UPC条形码',
    '活动价上限',
    '是否组包',
    '组包件数',
    '商品名称',
  ]);
  worksheet.addRow(['UPC-KEEP', 6, '否', '', '可报商品']);
  worksheet.addRow(['UPC-ZERO', 5, '否', '', '零成本商品']);
  worksheet.addRow(['UPC-BLOCK', 10, '否', '', '过滤商品']);
  worksheet.addRow(['UPC-MISSING', 8, '否', '', '未命中商品']);
  worksheet.addRow(['UPC-INVALID', '', '否', '', '无效活动价']);
  worksheet.addRow(['UPC-CARTON', 0.95, '否', '', '箱规换算商品']);
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
}

afterEach(async () => {
  vi.resetModules();
});

describe('eleme baohaojia transform', () => {
  it('builds strict upload workbook and separate audit workbook', async () => {
    const transformModule =
      await import('../../eleme-activity/automation/transform-baohao');

    const { analysis, auditBuffer, uploadBuffer } =
      await transformModule.transformBaohaojiaBuffer(
        await createInputWorkbookBuffer(),
        1234,
        [
          { procurementCost: 5, productName: '可报商品', upc: 'UPC-KEEP' },
          { procurementCost: 0, productName: '零成本商品', upc: 'UPC-ZERO' },
          { procurementCost: 12, productName: '过滤商品', upc: 'UPC-BLOCK' },
          {
            baseUnitProcurementCost: 0.9,
            cartonProcurementCost: 10.8,
            cartonSize: '12瓶/箱',
            productName: '箱规换算商品',
            upc: 'UPC-CARTON',
          },
          {
            procurementCost: 7,
            productName: '无效活动价商品',
            upc: 'UPC-INVALID',
          },
        ],
      );

    expect(analysis.metrics.totalCount).toBe(6);
    expect(analysis.metrics.qualifiedCount).toBe(2);
    expect(analysis.metrics.reviewCount).toBe(3);
    expect(analysis.metrics.excludedCount).toBe(1);
    expect(analysis.metrics.notFoundCount).toBe(1);
    expect(analysis.metrics.invalidPriceCount).toBe(1);
    expect(analysis.metrics.zeroCostCount).toBe(1);

    const uploadWorkbook = new ExcelJS.Workbook();
    await uploadWorkbook.xlsx.load(uploadBuffer);
    expect(uploadWorkbook.worksheets).toHaveLength(1);
    expect(uploadWorkbook.worksheets[0]?.name).toBe('爆好价报名');
    expect(uploadWorkbook.worksheets[0]?.getRow(1).values?.slice(1)).toEqual([
      'UPC条形码',
      '活动价',
      '活动初始库存',
      '是否组包',
      '组包件数',
    ]);
    expect(uploadWorkbook.worksheets[0]?.columnCount).toBe(5);
    expect(uploadWorkbook.worksheets[0]?.rowCount).toBe(6);
    expect(
      new Set(
        [2, 3, 4, 5, 6].map(
          (rowNumber) =>
            uploadWorkbook.worksheets[0]?.getCell(`A${rowNumber}`).value,
        ),
      ),
    ).toEqual(
      new Set([
        'UPC-KEEP',
        'UPC-MISSING',
        'UPC-CARTON',
        'UPC-ZERO',
        'UPC-INVALID',
      ]),
    );
    expect(
      [2, 3, 4, 5, 6].map(
        (rowNumber) =>
          uploadWorkbook.worksheets[0]?.getCell(`C${rowNumber}`).value,
      ),
    ).toEqual([1234, 1234, 1234, 1234, 1234]);

    const auditWorkbook = new ExcelJS.Workbook();
    await auditWorkbook.xlsx.load(auditBuffer);
    expect(auditWorkbook.worksheets.map((sheet) => sheet.name)).toEqual([
      '处理摘要',
      '上传文件预览',
      '可报名商品',
      '待确认商品',
      '排除商品',
      '⚠️采购价为0',
    ]);

    const reviewSheet = auditWorkbook.getWorksheet('待确认商品');
    const excludedSheet = auditWorkbook.getWorksheet('排除商品');
    expect(reviewSheet?.rowCount).toBe(4);
    expect(
      new Set(
        [2, 3, 4].map(
          (rowNumber) => reviewSheet?.getCell(`K${rowNumber}`).value,
        ),
      ),
    ).toEqual(
      new Set([
        '商品总表未命中，已按当前口径保留报名',
        '活动价无效',
        '采购价为0，需人工复核',
      ]),
    );
    expect(excludedSheet?.getCell('J2').value).toBe('采购价(12) > 活动价(10)');
  });
});
