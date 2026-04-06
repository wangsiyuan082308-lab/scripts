// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import ExcelJS from 'exceljs';

const originalCompareHome = process.env.PRODUCT_COMPARE_HOME;
const originalProductMasterHome = process.env.PRODUCT_MASTER_HOME;
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalAliyunApiKey = process.env.ALIYUN_API_KEY;
const originalAliyunDashscopeApiKey = process.env.ALIYUN_DASHSCOPE_API_KEY;
const originalDashscopeApiKey = process.env.DASHSCOPE_API_KEY;
const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
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
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  process.env.ALIYUN_API_KEY = originalAliyunApiKey;
  process.env.ALIYUN_DASHSCOPE_API_KEY = originalAliyunDashscopeApiKey;
  process.env.DASHSCOPE_API_KEY = originalDashscopeApiKey;
  process.env.OPENAI_API_KEY = originalOpenAiApiKey;
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
    ).rejects.toThrow('必须上传对照货盘');
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

  it('matches supplier price list aliases in custom mode', async () => {
    await setupRuntimeHomes();

    const { runProductCompare } = await import('../index');
    const targetBuffer = await workbookToBuffer([
      {
        商品代码: 'P-100',
        商品条码: '22334455',
        客户名称: 'OBY便利',
        货品名称: '茉莉花茶',
        规格名称: '500ml',
        供货价: 4.8,
        月销量: 16,
        销售单位: '箱',
      },
    ]);
    const referenceBuffer = await workbookToBuffer([
      {
        UPC: '22334455',
        商品名称: '茉莉花茶',
        规格: '500ml',
        采购价: 5.4,
      },
    ]);

    const result = await runProductCompare({
      referenceBuffer,
      sourceMode: 'custom',
      targetBuffer,
    });

    expect(result.results[0]?.matchType).toBe('upc_exact');
    expect(result.results[0]?.resultType).toBe('price_compare');
    expect(result.results[0]?.cheaperSide).toBe('target');
    expect(result.results[0]?.target.sku).toBe('P-100');
    expect(result.results[0]?.target.purchaseUnit).toBe('箱');
    expect(result.results[0]?.target.supplierName).toBe('OBY便利');
  });

  it('matches product master export aliases in custom mode', async () => {
    await setupRuntimeHomes();

    const { runProductCompare } = await import('../index');
    const targetBuffer = await workbookToBuffer([
      {
        商品UPC: '55667788',
        门店SKU: 'STORE-8',
        供应商商品名称: '无糖乌龙茶',
        供应商商品规格: '500ml',
        最小单位采购价: 3.6,
        采购链接: 'https://example.com/item/55667788',
      },
    ]);
    const referenceBuffer = await workbookToBuffer([
      {
        UPC: '55667788',
        商品名称: '无糖乌龙茶',
        规格: '500ml',
        采购价: 3.9,
      },
    ]);

    const result = await runProductCompare({
      referenceBuffer,
      sourceMode: 'custom',
      targetBuffer,
    });

    expect(result.results[0]?.matchType).toBe('upc_exact');
    expect(result.results[0]?.resultType).toBe('price_compare');
    expect(result.results[0]?.target.sku).toBe('STORE-8');
    expect(result.results[0]?.target.procurementCost).toBe(3.6);
    expect(result.results[0]?.target.supplierProductLink).toBe(
      'https://example.com/item/55667788',
    );
  });

  it('parses oby statement fields even when procurement cost is absent', async () => {
    await setupRuntimeHomes();

    const { runProductCompare } = await import('../index');
    const targetBuffer = await workbookToBuffer([
      {
        行号: '1',
        单据号: 'WO29219990002832',
        客户名称: 'Oby便利超市（安吉）',
        商品代码: '20',
        商品条码: '6921168504008',
        商品名称: '农夫山泉尖叫蓝色多肽型运动饮料550ml',
        商品规格: '550ml*15瓶/箱',
        单位: '箱',
        销售数量: 1,
        销售价: 47,
        销售金额: 47,
        销售日期: '2026-03-24',
      },
    ]);
    const referenceBuffer = await workbookToBuffer([
      {
        UPC: '6921168504008',
        商品名称: '农夫山泉尖叫蓝色多肽型运动饮料550ml',
        规格: '550ml*15瓶/箱',
        采购价: 38.5,
      },
    ]);

    const result = await runProductCompare({
      referenceBuffer,
      sourceMode: 'custom',
      targetBuffer,
    });

    expect(result.results[0]?.matchType).toBe('upc_exact');
    expect(result.results[0]?.resultType).toBe('invalid');
    expect(result.results[0]?.target.sku).toBe('20');
    expect(result.results[0]?.target.purchaseUnit).toBe('箱');
    expect(result.results[0]?.target.monthlySales).toBe(1);
    expect(result.results[0]?.target.supplierName).toBe('Oby便利超市（安吉）');
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

  it('matches same product by name and spec when UPCs differ', async () => {
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
              content:
                '{"matched":true,"candidateId":"对照货盘-reference-1","confidence":0.96,"reason":"商品名称和规格一致，只是UPC不同"}',
            },
          },
        ],
      }),
      ok: true,
    } as Response);

    const targetBuffer = await workbookToBuffer([
      {
        UPC: '111000',
        商品名称: '绿茶',
        规格: '500ml',
        采购价: 4.6,
      },
    ]);
    const referenceBuffer = await workbookToBuffer([
      {
        UPC: '222000',
        商品名称: '绿茶',
        规格: '500ml',
        采购价: 4.2,
      },
    ]);

    const result = await runProductCompare({
      referenceBuffer,
      sourceMode: 'custom',
      targetBuffer,
    });

    expect(result.results[0]?.matchType).toBe('ai_fuzzy');
    expect(result.results[0]?.resultType).toBe('price_compare');
    expect(result.results[0]?.cheaperSide).toBe('reference');
  });

  it('matches the scream peptide drink from product master by rule before AI', async () => {
    await setupRuntimeHomes({ withProductMaster: true });

    const { importProductMasterJson } = await import('../../product-master/index');
    const { runProductCompare } = await import('../index');
    global.fetch = vi.fn(async () => {
      throw new Error('rule match should not call AI');
    });

    await importProductMasterJson(
      Buffer.from(
        JSON.stringify([
          {
            productName: '农夫山泉 尖叫 多肽型运动饮料 550ml／瓶',
            procurementCost: 47,
            specification: '550ml*1瓶',
            stores: [
              {
                procurementCost: 47,
                storeCode: 'S001',
                storeName: '一店',
                supplierCode: 'SUP-NFSQJ',
                supplierName: '农夫山泉供应商',
                supplierProductName: '农夫山泉 尖叫 多肽型运动饮料 550ml／瓶',
                supplierProductSpec: '550ml*1瓶',
              },
            ],
            upc: '6921168504015',
          },
        ]),
        'utf8',
      ),
      'product-master.json',
    );

    const targetBuffer = await workbookToBuffer([
      {
        UPC: '6921168504008',
        商品名称: '农夫山泉尖叫蓝色多肽型运动饮料550ml',
        规格: '550ml*15瓶/箱',
        采购价: 48.5,
      },
    ]);

    const result = await runProductCompare({
      sourceMode: 'productMaster',
      targetBuffer,
    });

    expect(result.results[0]?.matchType).toBe('ai_fuzzy');
    expect(result.results[0]?.reference?.upc).toBe('6921168504015');
    expect(result.results[0]?.cheaperSide).toBe('reference');
    expect(result.results[0]?.matchReason).toContain('规则匹配命中');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('still compares by AI when target UPC is missing', async () => {
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
              content:
                '{"matched":true,"candidateId":"对照货盘-reference-1","confidence":0.91,"reason":"同类商品，名称和规格匹配"}',
            },
          },
        ],
      }),
      ok: true,
    } as Response);

    const targetBuffer = await workbookToBuffer([
      {
        商品名称: '冰红茶',
        规格: '500ml',
        采购价: 4.9,
      },
    ]);
    const referenceBuffer = await workbookToBuffer([
      {
        UPC: '333000',
        商品名称: '冰红茶',
        规格: '500ml',
        采购价: 4.5,
      },
    ]);

    const result = await runProductCompare({
      referenceBuffer,
      sourceMode: 'custom',
      targetBuffer,
    });

    expect(result.results[0]?.matchType).toBe('ai_fuzzy');
    expect(result.results[0]?.resultType).toBe('price_compare');
    expect(result.results[0]?.target.upc).toBe('');
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

  it('uses openclaw aliyun config when local AI key is not configured', async () => {
    const compareHome = await createTempDir('product-compare-home-');
    const homeDir = await createTempDir('product-compare-openclaw-home-');
    const fs = await import('node:fs');
    const path = await import('node:path');

    process.env.PRODUCT_COMPARE_HOME = compareHome;
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;
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
      {
        UPC: '810019',
        商品名称: '可乐经典版',
        规格: '500ml',
        采购价: 6.15,
        供应商名称: '供应商乙',
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
