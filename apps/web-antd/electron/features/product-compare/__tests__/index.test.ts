// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import ExcelJS from 'exceljs';

const originalCompareHome = process.env.PRODUCT_COMPARE_HOME;
const originalProductMasterHome = process.env.PRODUCT_MASTER_HOME;
const originalHome = process.env.HOME;
const originalAliyunApiKey = process.env.ALIYUN_API_KEY;
const originalAliyunDashscopeApiKey = process.env.ALIYUN_DASHSCOPE_API_KEY;
const originalDashscopeApiKey = process.env.DASHSCOPE_API_KEY;
const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
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

afterEach(async () => {
  const fs = await import('node:fs');
  process.env.PRODUCT_COMPARE_HOME = originalCompareHome;
  process.env.PRODUCT_MASTER_HOME = originalProductMasterHome;
  process.env.HOME = originalHome;
  process.env.ALIYUN_API_KEY = originalAliyunApiKey;
  process.env.ALIYUN_DASHSCOPE_API_KEY = originalAliyunDashscopeApiKey;
  process.env.DASHSCOPE_API_KEY = originalDashscopeApiKey;
  process.env.OPENAI_API_KEY = originalOpenAiApiKey;
  global.fetch = originalFetch;
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

describe('product compare runner', () => {
  it('rejects product master mode when product master is missing', async () => {
    const compareHome = await createTempDir('product-compare-home-');
    const productMasterHome = await createTempDir('product-master-home-');
    process.env.PRODUCT_COMPARE_HOME = compareHome;
    process.env.PRODUCT_MASTER_HOME = productMasterHome;

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
    const compareHome = await createTempDir('product-compare-home-');
    process.env.PRODUCT_COMPARE_HOME = compareHome;

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
    ).rejects.toThrow('必须上传对照货盘');
  });

  it('normalizes UPC and matches exact product in custom mode', async () => {
    const compareHome = await createTempDir('product-compare-home-');
    process.env.PRODUCT_COMPARE_HOME = compareHome;

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
    const compareHome = await createTempDir('product-compare-home-');
    const productMasterHome = await createTempDir('product-master-home-');
    process.env.PRODUCT_COMPARE_HOME = compareHome;
    process.env.PRODUCT_MASTER_HOME = productMasterHome;

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
    const compareHome = await createTempDir('product-compare-home-');
    process.env.PRODUCT_COMPARE_HOME = compareHome;

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
    const compareHome = await createTempDir('product-compare-home-');
    process.env.PRODUCT_COMPARE_HOME = compareHome;

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

  it('uses openclaw aliyun config when local AI key is not configured', async () => {
    const compareHome = await createTempDir('product-compare-home-');
    const homeDir = await createTempDir('product-compare-openclaw-home-');
    const fs = await import('node:fs');
    const path = await import('node:path');

    process.env.PRODUCT_COMPARE_HOME = compareHome;
    process.env.HOME = homeDir;
    process.env.ALIYUN_API_KEY = '';
    process.env.ALIYUN_DASHSCOPE_API_KEY = '';
    process.env.DASHSCOPE_API_KEY = '';
    process.env.OPENAI_API_KEY = '';

    const openClawDir = path.join(homeDir, '.openclaw');
    fs.mkdirSync(openClawDir, { recursive: true });
    fs.writeFileSync(
      path.join(openClawDir, '.env'),
      'ALIYUN_DASHSCOPE_API_KEY=openclaw-test-key\n',
      'utf8',
    );
    fs.writeFileSync(
      path.join(openClawDir, 'openclaw.json'),
      JSON.stringify({
        models: {
          providers: {
            aliyun: {
              api: 'openai-completions',
              baseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
              models: ['qwen3.5-plus', 'glm-5'],
            },
          },
        },
      }),
      'utf8',
    );

    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({
        choices: [
          {
            message: {
              content:
                '{"matched":true,"candidateId":"对照货盘-reference-1","confidence":0.93,"reason":"同规格同类商品"}',
            },
          },
        ],
      }),
      ok: true,
    } as Response);
    global.fetch = fetchMock;

    const { getProductCompareAiConfig, runProductCompare } = await import('../index');

    const config = await getProductCompareAiConfig();
    expect(config.baseUrl).toBe('https://coding.dashscope.aliyuncs.com/v1/chat/completions');
    expect(config.model).toBe('qwen3.5-plus');

    const targetBuffer = await workbookToBuffer([
      {
        UPC: '810001',
        商品名称: '可乐经典',
        规格: '500ml',
        采购价: 6.8,
        月销: 5,
        供应商名称: '供应商甲',
      },
    ]);
    const referenceBuffer = await workbookToBuffer([
      {
        UPC: '810009',
        商品名称: '经典可乐',
        规格: '500ml',
        采购价: 6.1,
        供应商名称: '供应商甲',
      },
    ]);

    const result = await runProductCompare({
      referenceBuffer,
      sourceMode: 'custom',
      targetBuffer,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://coding.dashscope.aliyuncs.com/v1/chat/completions',
    );
    expect(fetchMock.mock.calls[0]?.[1]?.headers?.Authorization).toBe(
      'Bearer openclaw-test-key',
    );
    expect(result.results[0]?.matchType).toBe('ai_fuzzy');
    expect(result.results[0]?.resultType).toBe('price_compare');
  });
});
