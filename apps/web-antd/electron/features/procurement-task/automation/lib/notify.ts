import * as https from 'https';
import { PurchaseReport } from './types-v2';
import { log } from './utils';

interface OrderConfirmParams {
  supplier: string;
  orders: Array<{ orderNo: string; amount: string; itemCount: string }>;
  abnormals: Array<{ orderNo: string; qnhAmount: number; aliAmount: number; diff: number; diffPercent: number }>;
  webhookUrl: string;
}

export function sendFeishuNotification(report: PurchaseReport, webhookUrl: string): Promise<void> {
  return new Promise((resolve) => {
    const statusText = report.success ? '✅ 采购成功' : '❌ 采购失败';
    const content = [
      [`${statusText} | ${report.platform === 'qianniuhua' ? '牵牛花' : '翱象'}`],
      [`供应商: ${report.supplier}`],
      [`日期: ${report.date}`],
    ];
    if (report.totalAmount) content.push([`采购金额: ¥${report.totalAmount.toFixed(2)}`]);
    if (report.orderCount) content.push([`采购单数: ${report.orderCount}`]);
    if (report.totalItems) content.push([`商品种类: ${report.totalItems}`]);
    content.push([`轮次: ${report.totalRounds}`]);
    content.push([`耗时: ${report.durationMinutes}分钟`]);
    if (report.outOrderId) content.push([`1688订单: ${report.outOrderId}`]);
    if (report.noStockSkuCount > 0) content.push([`无库存SKU: ${report.noStockSkuCount}种`]);
    if (report.errorMessage) content.push([`错误: ${report.errorMessage}`]);

    const body = JSON.stringify({
      msg_type: 'post',
      content: {
        post: {
          zh_cn: {
            title: `采购通知 - ${report.supplier}`,
            content: content.map(line => [{ tag: 'text', text: line[0] }]),
          },
        },
      },
    });

    const url = new URL(webhookUrl);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { log(`飞书通知已发送: ${res.statusCode}`); resolve(); });
    });
    req.on('error', (e) => { log(`飞书通知失败: ${e.message}`); resolve(); });
    req.write(body);
    req.end();
  });
}

interface StoreOrder {
  orderNo: string;
  amount: string;
  storeName: string;
}

/** 门店群通知：按门店合并订单金额 */
export function sendStoreNotification(
  supplier: string,
  orders: StoreOrder[],
  webhookUrl: string,
): Promise<void> {
  return new Promise((resolve) => {
    // 按门店合并金额
    const byStore: Record<string, number> = {};
    for (const o of orders) {
      const store = o.storeName || '未知门店';
      const amt = parseFloat((o.amount || '0').replace(/[^0-9.]/g, '')) || 0;
      byStore[store] = (byStore[store] || 0) + amt;
    }

    const total = Object.values(byStore).reduce((s, v) => s + v, 0);
    const lines = [
      `【${supplier}】采购单已生成，请付款`,
      ``,
      `门店 | 金额`,
    ];
    for (const [store, amount] of Object.entries(byStore)) {
      lines.push(`${store} | ¥${amount.toFixed(2)}`);
    }
    lines.push(``);
    lines.push(`合计: ¥${total.toFixed(2)}`);
    lines.push(``);
    lines.push(`请前往牵牛花确认并完成付款`);

    const text = lines.join('\n');
    const body = JSON.stringify({ msg_type: 'text', content: { text } });

    const url = new URL(webhookUrl);
    const req = https.request({
      hostname: url.hostname, path: url.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { log(`门店群通知已发送: ${res.statusCode}`); resolve(); });
    });
    req.on('error', (e) => { log(`门店群通知失败: ${e.message}`); resolve(); });
    req.write(body);
    req.end();
  });
}

export function sendOrderConfirmNotification(params: OrderConfirmParams): Promise<void> {
  return new Promise((resolve) => {
    const { supplier, orders, abnormals, webhookUrl } = params;
    const dateStr = new Date().toLocaleDateString('zh-CN');
    const totalAmount = orders.reduce((sum, o) => sum + (parseFloat(o.amount.replace(/[^0-9.]/g, '')) || 0), 0);

    const content: string[][] = [
      [`⚠️ 金额异常 | 牵牛花`],
      [`供应商: ${supplier}`],
      [`日期: ${dateStr}`],
      [`采购单数: ${orders.length} | 异常: ${abnormals.length}`],
      [`牵牛花总金额: ¥${totalAmount.toFixed(2)}`],
      [``],
      [`异常订单明细:`],
    ];

    abnormals.forEach((a, i) => {
      content.push([`${i + 1}. 单号${a.orderNo}`]);
      content.push([`   牵牛花: ¥${a.qnhAmount.toFixed(2)} → 1688: ¥${a.aliAmount.toFixed(2)}`]);
      content.push([`   差额: ¥${a.diff.toFixed(2)} (${a.diffPercent.toFixed(0)}%)`]);
    });

    content.push([``]);
    content.push([`请前往牵牛花核实订单金额`]);

    const body = JSON.stringify({
      msg_type: 'post',
      content: {
        post: {
          zh_cn: {
            title: `⚠️ 采购金额异常 - ${supplier}`,
            content: content.map(line => [{ tag: 'text', text: line[0] }]),
          },
        },
      },
    });

    const url = new URL(webhookUrl);
    const req = https.request({
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { log(`确认通知已发送: ${res.statusCode}`); resolve(); });
    });
    req.on('error', (e) => { log(`确认通知失败: ${e.message}`); resolve(); });
    req.write(body);
    req.end();
  });
}
