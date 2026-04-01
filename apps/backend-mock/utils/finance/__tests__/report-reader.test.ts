import { createRequire } from 'node:module';

import { describe, expect, it } from 'vitest';

import {
  buildAbnormalView,
  buildFinanceCompareRows,
  buildSummaryView,
  classifyFinanceReport,
  extractStoreRawMetrics,
  extractStoreMetricMap,
  extractWorksheetTablePreview,
} from '../report-reader';

const requireFromWebAntd = createRequire(
  `${process.cwd()}/apps/web-antd/package.json`,
);
const ExcelJS = requireFromWebAntd('exceljs') as {
  Workbook: new () => {
    addWorksheet: (name: string) => {
      getCell: (row: number, column: number) => { value: unknown };
    };
  };
};

describe('finance report reader', () => {
  it('classifies openclaw finance outputs by filename', () => {
    expect(
      classifyFinanceReport('2026-01月-太仓店-财务报表.xlsx', '太仓店'),
    ).toMatchObject({
      month: '2026-01',
      storeName: '太仓店',
      type: 'store',
    });

    expect(classifyFinanceReport('2026-01月门店总表.xlsx')).toMatchObject({
      month: '2026-01',
      storeName: '汇总',
      type: 'summary',
    });

    expect(classifyFinanceReport('2026-01月毛利异常汇总.xlsx')).toMatchObject({
      month: '2026-01',
      storeName: '毛利异常',
      type: 'abnormal',
    });
  });

  it('extracts metrics from legacy store worksheets', () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('总表');

    worksheet.getCell(3, 2).value = '订单数量';
    worksheet.getCell(3, 3).value = 8918;
    worksheet.getCell(5, 2).value = '收入';
    worksheet.getCell(5, 3).value = 225867.43;
    worksheet.getCell(15, 2).value = '佣金';
    worksheet.getCell(15, 3).value = 14584.13;
    worksheet.getCell(28, 2).value = '净利润率';
    worksheet.getCell(28, 3).value = 0.1285;

    const metrics = extractStoreMetricMap(worksheet as any);

    expect(metrics.get('订单数量')).toBe(8918);
    expect(metrics.get('总收入')).toBe(225867.43);
    expect(metrics.get('平台佣金')).toBe(14584.13);
    expect(metrics.get('净利润率')).toBe(0.1285);
  });

  it('extracts raw metric locations for verification mode', () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('总表');

    worksheet.getCell(5, 2).value = '收入';
    worksheet.getCell(5, 3).value = 225867.43;
    worksheet.getCell(15, 2).value = '佣金';
    worksheet.getCell(15, 3).value = 14584.13;

    const rows = extractStoreRawMetrics(worksheet as any);

    expect(rows.find((item) => item.label === '总收入')).toMatchObject({
      rawValue: 225867.43,
      sourceColumn: 'C',
      sourceLabel: '收入',
      sourceRow: 5,
      sourceSheet: '总表',
    });
    expect(rows.find((item) => item.label === '平台佣金')).toMatchObject({
      rawValue: 14584.13,
      sourceLabel: '佣金',
      sourceRow: 15,
    });
  });

  it('extracts table previews from summary worksheets', () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('门店总表');

    worksheet.getCell(1, 1).value = 'Oby便利超市 2026-01 门店总表';
    worksheet.getCell(3, 1).value = '门店';
    worksheet.getCell(3, 2).value = '订单数量';
    worksheet.getCell(3, 3).value = '总收入';
    worksheet.getCell(4, 1).value = '太仓店';
    worksheet.getCell(4, 2).value = 8918;
    worksheet.getCell(4, 3).value = 225867.43;
    worksheet.getCell(5, 1).value = '中山店';
    worksheet.getCell(5, 2).value = 11966;
    worksheet.getCell(5, 3).value = 303860.16;

    const preview = extractWorksheetTablePreview(worksheet as any);

    expect(preview.columns).toEqual(['门店', '订单数量', '总收入']);
    expect(preview.columnLetters).toMatchObject({
      门店: 'A',
      订单数量: 'B',
      总收入: 'C',
    });
    expect(preview.headerRowIndex).toBe(3);
    expect(preview.rows).toHaveLength(2);
    expect(preview.rows[0]).toMatchObject({
      __sourceRow: 4,
      门店: '太仓店',
      订单数量: 8918,
      总收入: 225867.43,
    });
  });

  it('builds compare rows with correct diffs', () => {
    const currentMetrics = new Map([
      ['订单数量', 120],
      ['净利润率', 0.18],
    ]);
    const previousMetrics = new Map([
      ['订单数量', 100],
      ['净利润率', 0.12],
    ]);

    const rows = buildFinanceCompareRows(currentMetrics, previousMetrics);
    const orderRow = rows.find((item) => item.label === '订单数量');
    const profitRateRow = rows.find((item) => item.label === '净利润率');

    expect(orderRow).toMatchObject({
      currentValue: 120,
      previousValue: 100,
      diffValue: 20,
      diffRate: 0.2,
      format: 'int',
    });
    expect(profitRateRow).toMatchObject({
      currentValue: 0.18,
      previousValue: 0.12,
      diffValue: 0.06,
      diffRate: 0.5,
      format: 'percent',
    });
  });

  it('builds summary view from existing worksheet rows without recalculating', () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('门店总表');

    worksheet.getCell(3, 1).value = '门店';
    worksheet.getCell(3, 2).value = '收入';
    worksheet.getCell(3, 3).value = '净利润';
    worksheet.getCell(4, 1).value = '中山店';
    worksheet.getCell(4, 2).value = 303860.16;
    worksheet.getCell(4, 3).value = 4971.4;
    worksheet.getCell(5, 1).value = '合计';
    worksheet.getCell(5, 2).value = 1454651.21;
    worksheet.getCell(5, 3).value = 25000.12;

    const summary = buildSummaryView(worksheet as any);

    expect(summary.columns).toEqual(['门店', '收入', '净利润']);
    expect(summary.storeRows).toHaveLength(1);
    expect(summary.totalRow).toMatchObject({
      门店: '合计',
      收入: 1454651.21,
      净利润: 25000.12,
    });
  });

  it('builds abnormal view from two sheets', () => {
    const workbook = new ExcelJS.Workbook();
    const summarySheet = workbook.addWorksheet('门店占比汇总');
    const detailSheet = workbook.addWorksheet('异常订单明细');

    summarySheet.getCell(1, 1).value = '门店';
    summarySheet.getCell(1, 2).value = '问题订单占比%';
    summarySheet.getCell(1, 3).value = '问题亏损额';
    summarySheet.getCell(2, 1).value = 'Oby便利超市（江北店）';
    summarySheet.getCell(2, 2).value = 26.81;
    summarySheet.getCell(2, 3).value = -10244.1;

    detailSheet.getCell(1, 1).value = '平台订单号';
    detailSheet.getCell(1, 2).value = '门店';
    detailSheet.getCell(2, 1).value = '美团闪购-1';
    detailSheet.getCell(2, 2).value = 'Oby便利超市（江北店）';

    const abnormal = buildAbnormalView(summarySheet as any, detailSheet as any);

    expect(abnormal.topRiskStore).toMatchObject({
      门店: 'Oby便利超市（江北店）',
      '问题订单占比%': 26.81,
    });
    expect(abnormal.firstAbnormalOrder).toMatchObject({
      平台订单号: '美团闪购-1',
      门店: 'Oby便利超市（江北店）',
    });
  });
});
