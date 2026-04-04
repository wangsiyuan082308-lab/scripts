// @vitest-environment node
import { Buffer } from 'node:buffer';

import * as ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

async function createWorkbookBuffer(
  headers: string[],
  rows: Array<Array<number | string>>,
) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('sheet1');
  worksheet.addRow(headers);
  rows.forEach((row) => worksheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

async function loadBaohaojiaModules() {
  const core = await import('../core');
  return { core };
}

describe('baohaojia transform core', () => {
  it('falls back to product master carton info when package fields are missing', async () => {
    const { core } = await loadBaohaojiaModules();

    const inputBuffer = await createWorkbookBuffer(
      ['UPC', '活动价', '商品名称'],
      [['UPC-24', '5.5', '测试可乐']],
    );

    const result = await core.transformBaohaojiaBuffer({
      fileBuffer: inputBuffer,
      initialStock: 9999,
      productMasterRecords: [
        {
          aoxiangConversionFactor: 24,
          cartonSize: '24瓶/箱',
          procurementCost: 3.2,
          productName: '测试可乐',
          upc: 'UPC-24',
        },
      ],
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer);
    const worksheet = workbook.getWorksheet('爆好价报名');

    expect(worksheet?.getCell('D2').value).toBe('是');
    expect(worksheet?.getCell('E2').value).toBe(24);
    expect(worksheet?.getCell('F2').value).toBe(3.2);
  });

  it('keeps explicit package flag when the source row already says no package', async () => {
    const { core } = await loadBaohaojiaModules();

    const inputBuffer = await createWorkbookBuffer(
      ['UPC', '活动价', '是否组包'],
      [['UPC-NO-PACK', '6', '否']],
    );

    const result = await core.transformBaohaojiaBuffer({
      fileBuffer: inputBuffer,
      productMasterRecords: [
        {
          aoxiangConversionFactor: 12,
          cartonSize: '12瓶/箱',
          procurementCost: 2.5,
          productName: '测试雪碧',
          upc: 'UPC-NO-PACK',
        },
      ],
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer);
    const worksheet = workbook.getWorksheet('爆好价报名');

    expect(worksheet?.getCell('D2').value).toBe('否');
    expect(worksheet?.getCell('E2').value).toBe('');
  });

  it('moves rows into the excluded sheet when procurement cost is higher than activity price', async () => {
    const { core } = await loadBaohaojiaModules();

    const inputBuffer = await createWorkbookBuffer(
      ['UPC', '活动价'],
      [['UPC-EXCLUDED', '6']],
    );

    const result = await core.transformBaohaojiaBuffer({
      fileBuffer: inputBuffer,
      productMasterRecords: [
        {
          procurementCost: 8,
          productName: '高采购价商品',
          upc: 'UPC-EXCLUDED',
        },
      ],
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer);
    const outputSheet = workbook.getWorksheet('爆好价报名');
    const excludedSheet = workbook.getWorksheet('排除商品');

    expect(outputSheet?.rowCount).toBe(1);
    expect(excludedSheet?.getCell('A2').value).toBe('UPC-EXCLUDED');
    expect(excludedSheet?.getCell('F2').value).toBe('采购价(8) > 活动价(6)');
  });
});
