// @vitest-environment node

import { Buffer } from 'node:buffer';

import * as ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

import { ProcurementPlanGenerator } from '../plan-generator';

async function createWorkbookBuffer(headers: string[], rows: Array<Array<string | number>>) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Sheet1');

  worksheet.addRow(headers);
  rows.forEach((row) => worksheet.addRow(row));

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('ProcurementPlanGenerator', () => {
  it('converts qianniuhua source rows into the updated aoxiang import template', async () => {
    const inputBuffer = await createWorkbookBuffer(
      [
        '*门店/仓编码',
        '商品名称',
        '*SKU编码',
        '*采购量',
        '采购单价(元)',
        '供应商编码',
        '物流单号',
        '采购单位',
        '预计到货日期',
        '网采订单留言内容',
      ],
      [
        [
          'OBYCX001',
          '可乐 330ml',
          '1234567890123456789',
          8,
          12.5,
          'SUP001',
          'LOGI001',
          '箱',
          '',
          '请尽快发货',
        ],
      ],
    );

    const result = await ProcurementPlanGenerator.run({
      buffers: [inputBuffer],
      type: 'aoxiang',
    });

    expect(result.summary).toContain('目标平台：翱象');
    expect(result.summary).toContain('共合并 1 个文件，生成 1 条数据。');
    expect(result.outputPath).toMatch(/^采购计划_翱象_/);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer);

    const worksheet = workbook.getWorksheet('采购计划');
    expect(worksheet).toBeDefined();
    expect(worksheet?.getCell('A6').value).toBe('必填（可在门店管理查询）');
    expect(worksheet?.getCell('A7').value).toBe('*仓库/门店编码');
    expect(worksheet?.getCell('B7').value).toBe('*供应商编码');
    expect(worksheet?.getCell('C7').value).toBe('*商品编码');
    expect(worksheet?.getCell('D7').value).toBe('*采购数量');
    expect(worksheet?.getCell('E7').value).toBe('单位');
    expect(worksheet?.getCell('F7').value).toBe('采购单价（元）');
    expect(worksheet?.getCell('G7').value).toBe('采购金额（元）');
    expect(worksheet?.getCell('L7').value).toBe('数据来源');

    expect(worksheet?.getCell('A8').value).toBe('OBYCX001');
    expect(worksheet?.getCell('B8').value).toBe('SUP001');
    expect(worksheet?.getCell('C8').value).toBe('1234567890123456789');
    expect(worksheet?.getCell('D8').value).toBe(8);
    expect(worksheet?.getCell('E8').value).toBe('箱');
    expect(worksheet?.getCell('F8').value).toBe(12.5);
    expect(worksheet?.getCell('G8').value).toBe('');
    expect(worksheet?.getCell('H8').value).toBe('LOGI001');
    expect(worksheet?.getCell('I8').value).toBe('可乐 330ml');
    expect(worksheet?.getCell('K8').value).toBe('请尽快发货');
    expect(worksheet?.getCell('L8').value).toBe('PDD机器人采购');
    expect(worksheet?.getCell('M8').dataValidation?.type).toBe('list');
  });

  it('rejects source files missing required qianniuhua template columns', async () => {
    const inputBuffer = await createWorkbookBuffer(
      ['*门店/仓编码', '商品名称', '*采购量', '采购单价(元)', '供应商编码'],
      [['OBYCX001', '可乐 330ml', 8, 12.5, 'SUP001']],
    );

    await expect(
      ProcurementPlanGenerator.run({
        buffers: [inputBuffer],
        type: 'aoxiang',
      }),
    ).rejects.toThrow(/缺少必需列|未找到有效数据/);
  });

  it('skips empty source files and only exports valid rows with required values', async () => {
    const emptyBuffer = await createWorkbookBuffer(
      [
        '*门店/仓编码',
        '商品名称',
        '*SKU编码',
        '*采购量',
        '采购单价(元)',
        '供应商编码',
      ],
      [],
    );
    const mixedBuffer = await createWorkbookBuffer(
      ['*门店/仓编码', '*SKU编码', '*采购量', '采购单价(元)', '供应商编码'],
      [
        ['OBYCX001', '1234567890123456789', 8, 12.5, 'SUP001'],
        ['', '2234567890123456789', 3, 8.8, 'SUP002'],
        ['OBYCX001', '3234567890123456789', 'abc', 9.9, 'SUP003'],
      ],
    );

    const result = await ProcurementPlanGenerator.run({
      buffers: [emptyBuffer, mixedBuffer],
      type: 'aoxiang',
    });

    expect(result.summary).toContain('共合并 2 个文件，生成 1 条数据。');

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(result.buffer);
    const worksheet = workbook.getWorksheet('采购计划');

    expect(worksheet?.getCell('A8').value).toBe('OBYCX001');
    expect(worksheet?.getCell('C8').value).toBe('1234567890123456789');
    expect(worksheet?.getCell('D8').value).toBe(8);
    expect(worksheet?.getCell('A9').value).toBeNull();
  });

  it('rejects unsupported target types', async () => {
    const inputBuffer = await createWorkbookBuffer(
      ['*门店/仓编码', '*SKU编码', '*采购量'],
      [['OBYCX001', '1234567890123456789', 8]],
    );

    await expect(
      ProcurementPlanGenerator.run({
        buffers: [inputBuffer],
        type: 'qianniuhua' as never,
      }),
    ).rejects.toThrow('当前仅支持生成翱象采购计划');
  });
});
