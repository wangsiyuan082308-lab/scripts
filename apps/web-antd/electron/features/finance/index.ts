import { Buffer } from 'node:buffer';
import ExcelJS from 'exceljs';

export const FinanceAnalyzer = {
  async run({
    fileBuffer,
    platform,
    rate,
  }: {
    fileBuffer: Buffer;
    platform: 'aoxiang' | 'qianniuhua';
    rate: number;
  }) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer);

    // 假设第一个 sheet 是订单数据
    const worksheet = workbook.getWorksheet(1);
    if (!worksheet) {
      throw new Error('无法读取 Excel 工作表');
    }

    // 统计变量
    let totalSales = 0;
    let orderCount = 0;
    const details: any[] = [];

    // 根据平台确定列名映射
    // 注意：这里需要根据实际报表格式调整列索引或列名查找逻辑
    // 假设：翱象和牵牛花的报表都有“实付金额”或“订单金额”列
    // 简化处理：遍历所有行，尝试查找金额列
    
    // 获取表头行（假设第一行）
    const headerRow = worksheet.getRow(1);
    let amountColIndex = -1;
    let orderNoColIndex = -1;

    headerRow.eachCell((cell, colNumber) => {
      const val = String(cell.value || '').trim();
      if (['实付金额', '订单金额', '支付金额', '销售额', '总金额'].some(k => val.includes(k))) {
        amountColIndex = colNumber;
      }
      if (['订单号', '订单编号', '单号'].some(k => val.includes(k))) {
        orderNoColIndex = colNumber;
      }
    });

    if (amountColIndex === -1) {
      throw new Error('无法在表格中找到“金额”相关的列，请检查表头。');
    }

    // 遍历数据行（从第二行开始）
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;

      const amountVal = row.getCell(amountColIndex).value;
      const orderNoVal = orderNoColIndex > -1 ? row.getCell(orderNoColIndex).value : `Row-${rowNumber}`;
      
      // 解析金额（处理可能的字符串格式，如 "¥100.00"）
      let amount = 0;
      if (typeof amountVal === 'number') {
        amount = amountVal;
      } else if (typeof amountVal === 'string') {
        amount = parseFloat(amountVal.replace(/[¥,￥\s]/g, '')) || 0;
      }

      if (amount > 0) {
        totalSales += amount;
        orderCount++;
        details.push({
          orderNo: orderNoVal,
          amount: amount,
          fee: amount * (rate / 100)
        });
      }
    });

    // 计算管理费
    const managementFee = totalSales * (rate / 100);

    // 生成结果 Excel
    const wbOutput = new ExcelJS.Workbook();
    const wsOutput = wbOutput.addWorksheet('财务报表');

    // 设置列
    wsOutput.columns = [
      { header: '项目', key: 'item', width: 20 },
      { header: '数值', key: 'value', width: 20 },
      { header: '说明', key: 'note', width: 30 },
    ];

    // 添加汇总数据
    wsOutput.addRow({ item: '平台', value: platform === 'aoxiang' ? '翱象' : '牵牛花' });
    wsOutput.addRow({ item: '总订单数', value: orderCount });
    wsOutput.addRow({ item: '总销售额', value: totalSales.toFixed(2) });
    wsOutput.addRow({ item: '管理费率', value: `${rate}%` });
    wsOutput.addRow({ 
      item: '应收管理费', 
      value: managementFee.toFixed(2),
      note: `销售额 * ${rate}%`
    });

    // 样式美化
    wsOutput.getRow(1).font = { bold: true };
    wsOutput.getColumn('value').alignment = { horizontal: 'right' };

    // 添加明细 Sheet（可选）
    const wsDetail = wbOutput.addWorksheet('计算明细');
    wsDetail.columns = [
      { header: '订单号', key: 'orderNo', width: 25 },
      { header: '销售金额', key: 'amount', width: 15 },
      { header: '管理费', key: 'fee', width: 15 },
    ];
    
    details.forEach(d => wsDetail.addRow(d));

    // @ts-ignore
    const buffer = await wbOutput.xlsx.writeBuffer();
    
    return {
      buffer: buffer as Buffer,
      summary: `计算完成！\n平台：${platform === 'aoxiang' ? '翱象' : '牵牛花'}\n总销售额：${totalSales.toFixed(2)}\n应收管理费：${managementFee.toFixed(2)}`,
    };
  },
};
