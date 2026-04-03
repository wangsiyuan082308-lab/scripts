// @vitest-environment node
import { Buffer } from 'node:buffer';
import process from 'node:process';

import * as ExcelJS from 'exceljs';
import { afterEach, describe, expect, it } from 'vitest';

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
  const productMaster = await import('../../product-master/index');
  return { core, productMaster };
}

afterEach(async () => {
  const fs = await import('node:fs');
  process.env.PRODUCT_MASTER_HOME = originalHome;
  process.env.PRODUCT_MASTER_SOURCE_PATH = originalSource;
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

describe('baohaojia transform core', () => {
  it('falls back to product master carton info when package fields are missing', async () => {
    const runtimeDir = await createTempDir('baohaojia-runtime-');
    process.env.PRODUCT_MASTER_HOME = runtimeDir;

    const { core, productMaster } = await loadBaohaojiaModules();
    await productMaster.importProductMasterJson(
      Buffer.from(
        JSON.stringify([
          {
            aoxiangConversionFactor: 24,
            cartonSize: '24瓶/箱',
            procurementCost: 3.2,
            productName: '测试可乐',
            upc: 'UPC-24',
          },
        ]),
        'utf8',
      ),
      'manual.json',
    );

    const inputBuffer = await createWorkbookBuffer(
      ['UPC', '活动价', '商品名称'],
      [['UPC-24', '5.5', '测试可乐']],
    );

    const result = await core.transformBaohaojiaBuffer({
      fileBuffer: inputBuffer,
      initialStock: 9999,
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer);
    const worksheet = workbook.getWorksheet('爆好价报名');

    expect(worksheet?.getCell('D2').value).toBe('是');
    expect(worksheet?.getCell('E2').value).toBe(24);
    expect(worksheet?.getCell('F2').value).toBe(3.2);
  });

  it('keeps explicit package flag when the source row already says no package', async () => {
    const runtimeDir = await createTempDir('baohaojia-runtime-');
    process.env.PRODUCT_MASTER_HOME = runtimeDir;

    const { core, productMaster } = await loadBaohaojiaModules();
    await productMaster.importProductMasterJson(
      Buffer.from(
        JSON.stringify([
          {
            aoxiangConversionFactor: 12,
            cartonSize: '12瓶/箱',
            procurementCost: 2.5,
            productName: '测试雪碧',
            upc: 'UPC-NO-PACK',
          },
        ]),
        'utf8',
      ),
      'manual.json',
    );

    const inputBuffer = await createWorkbookBuffer(
      ['UPC', '活动价', '是否组包'],
      [['UPC-NO-PACK', '6', '否']],
    );

    const result = await core.transformBaohaojiaBuffer({
      fileBuffer: inputBuffer,
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer);
    const worksheet = workbook.getWorksheet('爆好价报名');

    expect(worksheet?.getCell('D2').value).toBe('否');
    expect(worksheet?.getCell('E2').value).toBe('');
  });

  it('moves rows into the excluded sheet when procurement cost is higher than activity price', async () => {
    const runtimeDir = await createTempDir('baohaojia-runtime-');
    process.env.PRODUCT_MASTER_HOME = runtimeDir;

    const { core, productMaster } = await loadBaohaojiaModules();
    await productMaster.importProductMasterJson(
      Buffer.from(
        JSON.stringify([
          {
            procurementCost: 8,
            productName: '高采购价商品',
            upc: 'UPC-EXCLUDED',
          },
        ]),
        'utf8',
      ),
      'manual.json',
    );

    const inputBuffer = await createWorkbookBuffer(
      ['UPC', '活动价'],
      [['UPC-EXCLUDED', '6']],
    );

    const result = await core.transformBaohaojiaBuffer({
      fileBuffer: inputBuffer,
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
