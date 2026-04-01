// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  inferStageFromLine,
  mapQianniuhuaReportToBackendPayload,
} from '../runner';

describe('ProcurementTaskRunner helpers', () => {
  it('maps qianniuhua report to succeeded payload', () => {
    const payload = mapQianniuhuaReportToBackendPayload(
      {
        platform: 'Qianniuhua',
        supplierIds: ['1'],
        supplierName: 'Supplier A',
        taskId: 'task-1',
        storeIds: ['S003'],
        storeNames: ['安吉测试门店'],
      },
      {
        date: '2026-04-01',
        durationMinutes: 2.5,
        endTime: '2026-04-01T11:00:00.000Z',
        errorMessage: '',
        noStockSkuCount: 0,
        noStockSkus: [],
        orderCount: 2,
        outOrderId: 'OUT-1',
        planOrderId: 'PLAN-1',
        platform: 'qianniuhua',
        startTime: '2026-04-01T10:57:30.000Z',
        steps: [],
        success: true,
        supplier: 'Supplier A',
        totalAmount: 168.4,
        totalItems: 12,
        totalRounds: 1,
      },
    );

    expect(payload.status).toBe('succeeded');
    expect(payload.successCount).toBe(12);
    expect(payload.failedCount).toBe(0);
    expect(payload.storeCount).toBe(1);
    expect(payload.totalAmount).toBe(168.4);
  });

  it('maps no stock report to waiting_retry payload', () => {
    const payload = mapQianniuhuaReportToBackendPayload(
      {
        platform: 'Qianniuhua',
        supplierIds: ['1'],
        supplierName: 'Supplier A',
        taskId: 'task-2',
        storeIds: ['S003', 'S004'],
      },
      {
        date: '2026-04-01',
        durationMinutes: 4.2,
        endTime: '2026-04-01T11:04:00.000Z',
        errorMessage: '存在无库存商品',
        noStockSkuCount: 3,
        noStockSkus: [{ sku: 'SKU-1' }, { sku: 'SKU-2' }, { sku: 'SKU-3' }],
        orderCount: 0,
        outOrderId: '',
        planOrderId: 'PLAN-2',
        platform: 'qianniuhua',
        startTime: '2026-04-01T11:00:00.000Z',
        steps: [],
        success: false,
        supplier: 'Supplier A',
        totalAmount: 0,
        totalItems: 10,
        totalRounds: 3,
      },
    );

    expect(payload.status).toBe('waiting_retry');
    expect(payload.noStockCount).toBe(3);
    expect(payload.successCount).toBe(7);
    expect(payload.failedCount).toBeGreaterThanOrEqual(3);
  });

  it('infers run stage from automation output lines', () => {
    expect(inferStageFromLine('--- Step 1: search-and-cart ---')).toBe(
      'search_and_cart',
    );
    expect(inferStageFromLine('--- Step 5: submit-order ---')).toBe(
      'submit_order',
    );
    expect(inferStageFromLine('报告已保存: /tmp/report.json')).toBe(
      'generate_report',
    );
  });
});
