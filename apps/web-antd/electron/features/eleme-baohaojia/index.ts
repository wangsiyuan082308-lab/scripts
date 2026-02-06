import * as ExcelJS from 'exceljs';
import { readExcel } from '../../utils/excel-helper';

interface BaohaojiaOptions {
  fileBuffer: Buffer;
  initialStock?: number;
}

export class ElemeBaohaojiaAnalyzer {
  static async run({
    fileBuffer,
    initialStock = 9999,
  }: BaohaojiaOptions): Promise<{
    buffer: Buffer;
    summary: string;
  }> {
    // 1. 读取数据
    const rawData = await readExcel(fileBuffer);

    if (rawData.length === 0) {
      throw new Error('上传的文件为空或无法识别数据');
    }

    // 2. 识别列索引
    // 我们取第一行数据（通常readExcel返回的是对象数组，key是表头）
    // 但readExcel的具体实现可能已经处理了表头。假设rawData是对象数组。
    // 我们需要遍历所有key来匹配列名。
    
    // 为了更准确，我们可以检查第一条数据的key，或者在遍历时动态查找
    
    const processedRows: any[] = [];
    let successCount = 0;
    let skipCount = 0;

    rawData.forEach((row: any) => {
      const keys = Object.keys(row);
      
      // 查找各列对应的Key
      const barcodeKey = keys.find(k => /条码|条形码|UPC/i.test(k));
      const priceKey = keys.find(k => /活动价上限|活动价/i.test(k));
      const isPackageKey = keys.find(k => /是否组包/i.test(k));
      const packageCountKey = keys.find(k => /组包件数/i.test(k));

      // 必须有条码
      if (!barcodeKey || !row[barcodeKey]) {
        skipCount++;
        return;
      }

      const barcode = String(row[barcodeKey]).trim();
      const price = priceKey ? row[priceKey] : '';
      const isPackage = isPackageKey ? row[isPackageKey] : '否';
      const packageCount = packageCountKey ? row[packageCountKey] : '';

      processedRows.push({
        upc: barcode,
        price: price,
        stock: initialStock,
        isPackage: isPackage,
        packageCount: packageCount
      });
      successCount++;
    });

    // 3. 生成结果 Workbook
    const wbOutput = new ExcelJS.Workbook();
    const wsOutput = wbOutput.addWorksheet('爆好价报名');

    wsOutput.columns = [
      { header: 'UPC条形码', key: 'upc', width: 20 },
      { header: '活动价', key: 'price', width: 15 },
      { header: '活动初始库存', key: 'stock', width: 15 },
      { header: '是否组包', key: 'isPackage', width: 10 },
      { header: '组包件数', key: 'packageCount', width: 10 },
    ];

    processedRows.forEach(row => {
      wsOutput.addRow(row);
    });

    // @ts-ignore
    const buffer = await wbOutput.xlsx.writeBuffer();
    const summary = `处理完成！共扫描 ${rawData.length} 条数据，成功转换 ${successCount} 条，跳过 ${skipCount} 条（缺失条码）。`;

    return { buffer: buffer as Buffer, summary };
  }
}
