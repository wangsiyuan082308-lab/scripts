/**
 * v4 飞书通知
 *
 * 当前仓库直接使用 webhook 发文本消息。
 */
import { PurchaseReport, FailedOrder } from './types-v4';
import { log } from './utils';

/** 发送飞书文本消息 */
export async function sendWebhook(webhookUrl: string, text: string): Promise<void> {
  if (!webhookUrl) return;
  try {
    const response = await fetch(webhookUrl, {
      body: JSON.stringify({
        content: { text },
        msg_type: 'text',
      }),
      headers: {
        'Content-Type': 'application/json',
      },
      method: 'POST',
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    log('  📨 飞书通知已发送');
  } catch (e: any) {
    log('  ⚠️ 通知失败: ' + e.message);
  }
}

/** 格式化采购报告为飞书文本 */
export function formatReport(report: PurchaseReport): string {
  const status = report.failedCount === 0 ? '✅ 采购完成' : `⚠️ 采购完成（${report.failedCount}单失败）`;
  const lines = [
    status,
    `供应商: ${report.supplier}`,
    `日期: ${report.date}`,
    `商品: ${report.totalItems}种`,
    `成功: ${report.successCount}单`,
  ];
  if (report.failedCount > 0) lines.push(`失败: ${report.failedCount}单`);
  if (report.planOrderId) lines.push(`计划单: ${report.planOrderId}`);
  lines.push(`耗时: ${report.durationMinutes}分钟`);
  if (report.errorMessage) lines.push(`错误: ${report.errorMessage}`);
  return lines.join('\n');
}

/** 格式化门店群通知（简洁版，只含付款信息） */
export function formatStoreNotification(supplier: string, orders: any[]): string {
  const lines = [`【${supplier}】采购单已生成，请付款\n`];
  const byStore: Record<string, { amount: number; account: string }> = {};
  for (const o of orders) {
    const store = o.storeName || '未知门店';
    if (!byStore[store]) byStore[store] = { amount: 0, account: o.account || '' };
    byStore[store].amount += o.amount || 0;
  }
  lines.push('门店 | 金额 | 1688账号');
  for (const [store, info] of Object.entries(byStore)) {
    lines.push(`${store} | ¥${info.amount.toFixed(2)} | ${info.account}`);
  }
  lines.push('\n请各店登录1688完成付款');
  return lines.join('\n');
}
