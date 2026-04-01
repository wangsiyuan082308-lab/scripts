import { describe, expect, it } from 'vitest';

import { compareMigrationMetrics } from '../migration-audit';

describe('finance migration audit', () => {
  it('flags mismatches between baseline metrics and generated metrics', () => {
    const baselineMetrics = new Map<string, number | null>([
      ['订单数量', 11997],
      ['总收入', 303782],
      ['配送费', 66618.35],
    ]);

    const comparison = compareMigrationMetrics(baselineMetrics, [
      { label: '订单数量', currentValue: 11966 },
      { label: '总收入', currentValue: 303860.16 },
      { label: '配送费', currentValue: 66574.72 },
    ]);

    expect(comparison.totalComparedMetrics).toBe(3);
    expect(comparison.matchedMetrics).toBe(0);
    expect(comparison.mismatchedMetrics).toHaveLength(3);
    expect(comparison.mismatchedMetrics[0]).toMatchObject({
      baselineValue: 11997,
      generatedValue: 11966,
      label: '订单数量',
      matches: false,
    });
    expect(comparison.mismatchedMetrics[0]?.diffValue).toBe(-31);
    expect(comparison.mismatchedMetrics[1]).toMatchObject({
      baselineValue: 303782,
      generatedValue: 303860.16,
      label: '总收入',
      matches: false,
    });
    expect(comparison.mismatchedMetrics[1]?.diffValue || 0).toBeCloseTo(78.16, 6);
    expect(comparison.mismatchedMetrics[2]).toMatchObject({
      baselineValue: 66618.35,
      generatedValue: 66574.72,
      label: '配送费',
      matches: false,
    });
    expect(comparison.mismatchedMetrics[2]?.diffValue || 0).toBeCloseTo(-43.63, 6);
  });
});
