// @vitest-environment node
import ExcelJS from 'exceljs';
import { afterEach, describe, expect, it, vi } from 'vitest';

const originalHome = process.env.PRODUCT_MASTER_HOME;
const originalSource = process.env.PRODUCT_MASTER_SOURCE_PATH;
const tempDirs: string[] = [];

async function createTempDir(prefix: string) {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function createInputWorkbookBuffer() {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('导出商品');
  worksheet.addRow(['UPC条形码', '活动价上限', '是否组包', '组包件数', '商品名称']);
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
  const fs = await import('node:fs');
  process.env.PRODUCT_MASTER_HOME = originalHome;
  process.env.PRODUCT_MASTER_SOURCE_PATH = originalSource;
  vi.resetModules();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

describe('eleme baohaojia transform', () => {
  it('builds strict upload workbook and separate audit workbook', async () => {
    const runtimeDir = await createTempDir('baohaojia-transform-');
    process.env.PRODUCT_MASTER_HOME = runtimeDir;

    const productMasterModule = await import('../../product-master/index');
    const transformModule = await import(
      '../../eleme-activity/automation/transform-baohao'
    );

    await productMasterModule.importProductMasterJson(
      Buffer.from(
        JSON.stringify([
          { procurementCost: 5, productName: '可报商品', upc: 'UPC-KEEP' },
          { procurementCost: 0, productName: '零成本商品', upc: 'UPC-ZERO' },
          { procurementCost: 12, productName: '过滤商品', upc: 'UPC-BLOCK' },
          { cartonSize: '12瓶/箱', procurementCost: 10.8, productName: '箱规换算商品', upc: 'UPC-CARTON' },
          { procurementCost: 7, productName: '无效活动价商品', upc: 'UPC-INVALID' },
        ]),
        'utf8',
      ),
      'product-master.json',
    );

    const { analysis, auditBuffer, uploadBuffer } =
      await transformModule.transformBaohaojiaBuffer(
        await createInputWorkbookBuffer(),
        1234,
      );

    expect(analysis.metrics.totalCount).toBe(6);
    expect(analysis.metrics.qualifiedCount).toBe(3);
    expect(analysis.metrics.reviewCount).toBe(2);
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
      [2, 3, 4, 5, 6].map((rowNumber) =>
        uploadWorkbook.worksheets[0]?.getCell(`A${rowNumber}`).value,
      ),
    ).toEqual([
      'UPC-KEEP',
      'UPC-MISSING',
      'UPC-CARTON',
      'UPC-ZERO',
      'UPC-INVALID',
    ]);
    expect(uploadWorkbook.worksheets[0]?.getCell('B4').value).toBe(0.95);
    expect(uploadWorkbook.worksheets[0]?.getCell('C2').value).toBe(1234);

    const auditWorkbook = new ExcelJS.Workbook();
    await auditWorkbook.xlsx.load(auditBuffer);
    expect(auditWorkbook.worksheets.map((sheet) => sheet.name)).toEqual([
      '处理摘要',
      '上传文件预览',
      '可报名商品',
      '待确认商品',
      '已过滤商品',
    ]);

    const reviewSheet = auditWorkbook.getWorksheet('待确认商品');
    const excludedSheet = auditWorkbook.getWorksheet('已过滤商品');
    expect(reviewSheet?.rowCount).toBe(3);
    expect(reviewSheet?.getCell('K2').value).toBe('采购价为0，需人工复核');
    expect(reviewSheet?.getCell('K3').value).toBe('活动价无效');
    expect(excludedSheet?.getCell('J2').value).toBe('采购价(12) > 活动价(10)');
  });
});
