export interface ProcurementTask {
  id?: string;
  taskId: string;
  platform: 'Aoxiang' | 'Qianniuhua';
  supplierIds: string[];
  supplierId?: string;
  supplierName?: string;
  status: 'Completed' | 'Failed' | 'InProgress' | 'Pending';
  scheduleType: 'Instant' | 'Weekly';
  schedule?: string;
  weekDay?: string;
  lastRunTime?: string;
  storeIds?: string[];
  storeNames?: string[];
  maxItems?: number;
}

function buildUnsupportedMessage(task: ProcurementTask) {
  const supplier =
    task.supplierName || task.supplierId || task.supplierIds?.[0] || '\u672a\u6307\u5b9a\u4f9b\u5e94\u5546';
  const stores =
    Array.isArray(task.storeNames) && task.storeNames.length > 0
      ? task.storeNames.join('\u3001')
      : Array.isArray(task.storeIds) && task.storeIds.length > 0
        ? task.storeIds.join('\u3001')
        : '\u672a\u6307\u5b9a\u95e8\u5e97';

  return [
    `\u91c7\u8d2d\u4efb\u52a1 ${task.taskId} \u672a\u6267\u884c\u3002`,
    `\u5e73\u53f0: ${task.platform}`,
    `\u4f9b\u5e94\u5546: ${supplier}`,
    `\u95e8\u5e97: ${stores}`,
    '\u539f\u56e0: \u5df2\u79fb\u9664\u6a21\u62df\u6267\u884c\u903b\u8f91\uff0c\u5f53\u524d\u771f\u5b9e\u91c7\u8d2d\u6267\u884c\u94fe\u8def\u5c1a\u672a\u63a5\u5165 ProcurementTaskRunner\u3002',
  ].join(' ');
}

export const ProcurementTaskRunner = {
  async executeTask(
    task: ProcurementTask,
  ): Promise<{ message: string; success: boolean }> {
    const message = buildUnsupportedMessage(task);
    console.error(`[ProcurementTaskRunner] ${message}`);
    return {
      success: false,
      message,
    };
  },
};
