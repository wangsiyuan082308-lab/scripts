type SuperBrandSummaryMetrics = {
  actualStoreCount?: number;
  failedCount?: number;
  foundCount?: number;
  partialCount?: number;
  successCount?: number;
};

function toSafeNumber(value: unknown) {
  return Number(value || 0);
}

export function buildSuperBrandSummaryLines(metrics?: SuperBrandSummaryMetrics) {
  const foundCount = toSafeNumber(metrics?.foundCount);
  const successCount = toSafeNumber(metrics?.successCount);
  const partialCount = toSafeNumber(metrics?.partialCount);
  const failedCount = toSafeNumber(metrics?.failedCount);
  const actualStoreCount = toSafeNumber(metrics?.actualStoreCount);

  if (!foundCount && !successCount && !partialCount && !failedCount) {
    return [];
  }

  const lines = [`命中活动: ${foundCount}`, `执行成功: ${successCount}`];

  // “部分成功” 为 0 时不展示，避免把正常全成功结果渲染成有异常感。
  if (partialCount > 0) {
    lines.push(`部分成功: ${partialCount}`);
  }

  lines.push(`执行失败: ${failedCount}`, `实际报名门店: ${actualStoreCount}`);

  return lines;
}

export function buildSuperBrandSummaryText(metrics?: SuperBrandSummaryMetrics) {
  return buildSuperBrandSummaryLines(metrics).join('\n');
}
