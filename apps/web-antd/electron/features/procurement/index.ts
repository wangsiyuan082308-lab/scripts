import * as ExcelJS from 'exceljs';
import { readExcel } from '../../utils/excel-helper';

interface ProcurementOptions {
  listBuffer: Buffer;
  refBuffer: Buffer;
  mode?: string; // 'week' | 'month' | 'none'
}

export class ProcurementAnalyzer {
  static async run({
    listBuffer,
    refBuffer,
    mode = 'week',
  }: ProcurementOptions): Promise<{
    buffer: Buffer;
    summary: string;
    storeNames: string[];
  }> {
    // 1. 读取数据
    const normalizedMode = String(mode).trim();
    const isNoCompare = normalizedMode === 'none';

    console.log(`[Procurement] Mode: ${normalizedMode}, IsNoCompare: ${isNoCompare}`);

    const listData = await readExcel(listBuffer);
    const refData = !isNoCompare ? await readExcel(refBuffer) : [];
    // 过滤已通过数据以及有供应商商品链接的数据
    const validRows = listData.filter( (row: any) => row['检查状态'] === '已通过' && row['供应商商品链接'] !== '');
    if (validRows.length === 0) {
      throw new Error('No valid data found (Check Status: Passed/Normal)');
    }

    // 收集唯一的门店名称
    const storeNamesSet = new Set<string>();
    validRows.forEach((row: any) => {
      // 尝试查找门店名称字段，这里假设字段名为 "收货方名称" 或 "门店名称"
      // 根据之前的列名 "收货方编码"，推测可能有对应的名称字段
      // 如果找不到，可以遍历所有key查找包含 "收货方" 且包含 "名" 的字段
      const storeNameKey = Object.keys(row).find(
        (k) => (k.includes('收货方') || k.includes('门店')) && k.includes('名'),
      );
      if (storeNameKey && row[storeNameKey]) {
        storeNamesSet.add(String(row[storeNameKey]).trim());
      }
    });
    const storeNames = Array.from(storeNamesSet);

    // 3. 构建参考表映射
    const refMap = new Map();
    refData.forEach((row: any) => {
      const upcKey = Object.keys(row).find(
        (k) => /UPC/i.test(k) || k.includes('商品UPC'),
      );
      if (upcKey && row[upcKey]) {
        refMap.set(String(row[upcKey]).trim(), row);
      }
    });

    // 4. 生成结果 Workbook
    const wbOutput = new ExcelJS.Workbook();
    const wsOutput = wbOutput.addWorksheet('补货建议');

    wsOutput.columns = [
      { header: '*门店/仓编码', key: 'storeCode', width: 15 },
      { header: '*SKU编码', key: 'skuCode', width: 15 },
      { header: '补货量', key: 'quantity', width: 12 },
      { header: '商品名称', key: 'name', width: 30 },
      { header: '补货单价(元）', key: 'price', width: 12 },
      { header: '供应商编码', key: 'supplierCode', width: 15 },
      { header: '补货单位', key: 'unit', width: 10 },
    ];

    let keptCount = 0;
    let removedCount = 0
    // 循环当前的补货清单
    validRows.forEach((row: any) => {
      const upcKey = Object.keys(row).find((k) => k.includes('商品UPC'));
      const upc = row[upcKey];
      // 补货参考对应的数据
      const refRow = refMap.get(upc);

      const adviceQtyKey = Object.keys(row).find(
        (k) =>
          k.includes('补货量') && (k.includes('基础') || k.includes('建议')),
      );
      // 补货清单的建议补货量
      let originalQty = adviceQtyKey ? Number(row[adviceQtyKey]) : 0;
      if (isNaN(originalQty)) originalQty = 0;

      let finalQty = 0;
      const purchaseQtyKey = Object.keys(row).find(
        (k) => k.includes('补货量') && k.includes('采购'),
      );

      let purchaseQty = purchaseQtyKey ? Number(row[purchaseQtyKey]) : 0;
      if (isNaN(purchaseQty)) purchaseQty = originalQty;

      let bgColor: string | null = null;
      // 如果补货参考存在，且30天月销或7天周销字段存在
      // 只有在非 'none' 模式且找到了对应的参考行时才进行比对
      if (!isNoCompare && refRow) {
        const key30 = Object.keys(refRow).find(
          (k) => k.includes('30天') || k.includes('月销'),
        );
        const key7 = Object.keys(refRow).find(
          (k) => k.includes('7天') || k.includes('周销'),
        );

        const ref30Days = key30 ? Number(refRow[key30]) || 0 : 0;
        const ref7Days = key7 ? Number(refRow[key7]) || 0 : 0;
        
        // 根据模式选择对比基准
        const comparisonValue = normalizedMode === 'month' ? ref30Days : ref7Days;

        // 如果建议补货量大于参考量（周销7天或月销30天），就减少一半
        if (originalQty > comparisonValue) {
          const result = purchaseQty / 2;
          finalQty = result < 1 ? 1 : Math.floor(result);
          bgColor = 'FFFF0000'; // Red
          console.log(`[Halved] SKU: ${row['商品SKU']}, Orig: ${originalQty}, Purch: ${purchaseQty}, Comp: ${comparisonValue}, Final: ${finalQty}`);
        } else {
          finalQty = purchaseQty;
        }

        // 检查起订量逻辑
        // 如果起订量大于建议补货量，则强制使用起订量
        const minOrderQtyKey = Object.keys(refRow).find(
          (k) => k.includes('起订量') && k.includes('采购单位'),
        );
        let minOrderQty = minOrderQtyKey ? Number(refRow[minOrderQtyKey]) : 0;
        if (isNaN(minOrderQty)) minOrderQty = 0;
        // 如果起订量大于建议补货量，要么就是起订量
        if (minOrderQty > finalQty) {
          finalQty = minOrderQty;
          console.log(`[MinOrder] SKU: ${row['商品SKU']}, Final adjusted to MinOrder: ${minOrderQty}`);
        }
      } else {
        finalQty = purchaseQty;
        // 仅在调试时打印部分行，避免日志过多
        if (Math.random() < 0.05) {
             console.log(`[NoCompare] SKU: ${row['商品SKU']}, Orig: ${originalQty}, Purch: ${purchaseQty}, Final: ${finalQty}`);
        }
      }

      if (finalQty <= 0) {
        removedCount++;
        return;
      }

      keptCount++;
      const newRow = wsOutput.addRow({
        storeCode: row['收货方编码'],
        skuCode: row['商品SKU'],
        quantity: finalQty,
        name: '',
        price: '',
        supplierCode: row['发货方编码'],
        unit: row['采购单位'],
      });

      newRow.getCell('name').value = '';
      newRow.getCell('price').value = '';

      if (bgColor) {
        newRow.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: bgColor },
        };
      }
    });

    // @ts-ignore
    const buffer = await wbOutput.xlsx.writeBuffer();
    const summary = `处理完成！(模式: ${isNoCompare ? '不比对' : normalizedMode === 'month' ? '按月' : '按周'})\n共扫描 ${listData.length} 条数据，保留 ${keptCount} 条，已移除 ${
      listData.length - validRows.length + removedCount
    } 条不合规数据`;

    return { buffer: buffer as Buffer, summary, storeNames };
  }
}
