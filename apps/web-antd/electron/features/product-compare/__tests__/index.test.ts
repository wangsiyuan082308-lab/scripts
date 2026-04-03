// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import ExcelJS from 'exceljs';

const originalCompareHome = process.env.PRODUCT_COMPARE_HOME;
const originalProductMasterHome = process.env.PRODUCT_MASTER_HOME;
const originalAiConfigHome = process.env.SCRIPTAI_AI_CONFIG_HOME;
const originalFetch = global.fetch;
const tempDirs: string[] = [];

async function createTempDir(prefix: string) {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function workbookToBuffer(rows: Array<Record<string, any>>) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Sheet1');
  const headers = Object.keys(rows[0] || {});
  worksheet.addRow(headers);
  rows.forEach((row) => {
    worksheet.addRow(headers.map((header) => row[header]));
  });
  return Buffer.from((await workbook.xlsx.writeBuffer()) as ArrayBuffer);
}

async function setupRuntimeHomes(options?: { withProductMaster?: boolean }) {
  process.env.PRODUCT_COMPARE_HOME = await createTempDir('product-compare-home-');
  process.env.SCRIPTAI_AI_CONFIG_HOME = await createTempDir('ai-config-home-');
  if (options?.withProductMaster) {
    process.env.PRODUCT_MASTER_HOME = await createTempDir('product-master-home-');
  }
}

afterEach(async () => {
  const fs = await import('node:fs');
  process.env.PRODUCT_COMPARE_HOME = originalCompareHome;
  process.env.PRODUCT_MASTER_HOME = originalProductMasterHome;
  process.env.SCRIPTAI_AI_CONFIG_HOME = originalAiConfigHome;
  global.fetch = originalFetch;
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

describe('product compare runner', () => {
  it('rejects product master mode when product master is missing', async () => {
    await setupRuntimeHomes({ withProductMaster: true });

    const { runProductCompare } = await import('../index');
    const targetBuffer = await workbookToBuffer([
      {
        UPC: '123456',
        商品名称: '可乐',
        规格: '500ml',
      },
    ]);

    await expect(
      runProductCompare({
        sourceMode: 'productMaster',
        targetBuffer,
      }),
    ).rejects.toThrow('请先导入商品总表');
  });

  it('requires reference file in custom mode', async () => {
    await setupRuntimeHomes();

    const { runProductCompare } = await import('../index');
    const targetBuffer = await workbookToBuffer([
      {
        UPC: '123456',
        商品名称: '可乐',
        规格: '500ml',
      },
    ]);

    await expect(
      runProductCompare({
        sourceMode: 'custom',
        targetBuffer,
      }),
    ).rejects.toThrow('必须上传比对货盘');
  });

  it('normalizes UPC and matches exact product in custom mode', async () => {
    await setupRuntimeHomes();

    const { runProductCompare } = await import('../index');
    const targetBuffer = await workbookToBuffer([
      {
        UPC: '1234567890.0',
        商品名称: '可乐',
        规格: '500ml',
        采购价: 6.5,
        月销: 20,
      },
    ]);
    const referenceBuffer = await workbookToBuffer([
      {
        UPC: '1234567890',
        商品名称: '可口可乐',
        规格: '500ml',
        采购价: 5.2,
      },
    ]);

    const result = await runProductCompare({
      referenceBuffer,
      sourceMode: 'custom',
      targetBuffer,
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.matchType).toBe('upc_exact');
    expect(result.results[0]?.resultType).toBe('price_compare');
    expect(result.results[0]?.cheaperSide).toBe('reference');
    expect(result.results[0]?.reference?.procurementCost).toBe(5.2);
  });

  it('picks the lowest procurement candidate from product master', async () => {
    await setupRuntimeHomes({ withProductMaster: true });

    const { importProductMasterJson } = await import('../../product-master/index');
    const { runProductCompare } = await import('../index');

    await importProductMasterJson(
      Buffer.from(
        JSON.stringify([
          {
            productName: '无糖可乐',
            procurementCost: 6.2,
            stores: [
              {
                procurementCost: 6.2,
                storeCode: 'S1',
                storeName: '一店',
                supplierCode: 'SUP-1',
                supplierName: '供应商A',
                supplierProductLink: 'https://a.example.com',
                supplierProductName: '无糖可乐A',
              },
              {
                procurementCost: 5.1,
                storeCode: 'S2',
                storeName: '二店',
                supplierCode: 'SUP-2',
                supplierName: '供应商B',
                supplierProductLink: 'https://b.example.com',
                supplierProductName: '无糖可乐B',
              },
            ],
            upc: '888001',
          },
        ]),
        'utf8',
      ),
      'product-master.json',
    );

    const targetBuffer = await workbookToBuffer([
      {
        UPC: '888001',
        商品名称: '无糖可乐',
        规格: '500ml',
        采购价: 6.8,
        月销: 12,
      },
    ]);

    const result = await runProductCompare({
      sourceMode: 'productMaster',
      targetBuffer,
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.reference?.supplierName).toBe('供应商B');
    expect(result.results[0]?.reference?.procurementCost).toBe(5.1);
    expect(result.results[0]?.cheaperSide).toBe('reference');
  });

  it('classifies unmatched products with monthly sales above threshold as new product candidates', async () => {
    await setupRuntimeHomes();

    const { runProductCompare } = await import('../index');
    const targetBuffer = await workbookToBuffer([
      {
        UPC: '900001',
        商品名称: '新品薯片',
        规格: '80g',
        月销: 18,
      },
    ]);
    const referenceBuffer = await workbookToBuffer([
      {
        UPC: '111111',
        商品名称: '老薯片',
        规格: '100g',
      },
    ]);

    const result = await runProductCompare({
      referenceBuffer,
      sourceMode: 'custom',
      targetBuffer,
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.resultType).toBe('new_product_candidate');
    expect(result.results[0]?.conclusion).toBe('新品引入候选');
  });

  it('falls back to unmatched pending when AI response is invalid', async () => {
    await setupRuntimeHomes();

    const { runProductCompare, saveProductCompareAiConfig } = await import('../index');
    await saveProductCompareAiConfig({
      apiKey: 'test-key',
    });

    global.fetch = vi.fn().mockResolvedValue({
      json: async () => ({
        choices: [
          {
            message: {
              content: 'not json',
            },
          },
        ],
      }),
      ok: true,
    } as Response);

    const targetBuffer = await workbookToBuffer([
      {
        UPC: '700001',
        商品名称: '小面包',
        规格: '250g',
        月销: 5,
      },
    ]);
    const referenceBuffer = await workbookToBuffer([
      {
        UPC: '700009',
        商品名称: '小面包原味',
        规格: '250g',
        供应商名称: '供应商甲',
      },
    ]);

    const result = await runProductCompare({
      referenceBuffer,
      sourceMode: 'custom',
      targetBuffer,
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.resultType).toBe('unmatched_pending');
    expect(result.results[0]?.matchReason).toContain('AI比对失败');
  });
});
