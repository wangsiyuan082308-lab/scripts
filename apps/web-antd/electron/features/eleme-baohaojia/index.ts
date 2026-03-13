import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';

import { readExcel } from '../../utils/excel-helper';

// 商品总表路径
const PRODUCT_MASTER_PATH = path.join(__dirname, '../data/product-master.json');

interface BaohaojiaOptions {
  fileBuffer: Buffer;
  initialStock?: number;
}

interface ProductMaster {
  sku: string;
  upc: string;
  productName: string;
  specification: string;
  suggestedRetailPrice: number;
  currentRetailPrice: number;
  procurementCost: number;  // 采购价
  cartonSize: string;
}

// 加载商品总表
function loadProductMaster(): Map<string, ProductMaster> {
  try {
    if (!fs.existsSync(PRODUCT_MASTER_PATH)) {
      console.warn('商品总表不存在:', PRODUCT_MASTER_PATH);
      return new Map();
    }
    
    const data = JSON.parse(fs.readFileSync(PRODUCT_MASTER_PATH, 'utf-8')) as ProductMaster[];
    const map = new Map<string, ProductMaster>();
    
    for (const item of data) {
      if (item.upc) {
        map.set(item.upc, item);
      }
    }
    
    console.log(`商品总表加载完成: ${map.size} 条记录`);
    return map;
  } catch (error) {
    console.error('加载商品总表失败:', error);
    return new Map();
  }
}

export class ElemeBaohaojiaAnalyzer {
  static async run({
    fileBuffer,
    initialStock = 9999,
  }: BaohaojiaOptions): Promise<{
    buffer: Buffer;
    summary: string;
  }> {
    // 1. 加载商品总表
    const productMaster = loadProductMaster();
    
    // 2. 读取数据
    const rawData = await readExcel(fileBuffer);

    if (rawData.length === 0) {
      throw new Error('上传的文件为空或无法识别数据');
    }

    // 3. 识别列索引
    const processedRows: any[] = [];
    const excludedRows: any[] = [];
    const noPriceRows: any[] = [];
    const notFoundRows: any[] = [];
    
    let successCount = 0;
    let skipCount = 0;

    rawData.forEach((row: any) => {
      const keys = Object.keys(row);
      
      // 查找各列对应的Key
      const barcodeKey = keys.find(k => /条码|条形码|UPC/i.test(k));
      const priceKey = keys.find(k => /活动价上限|活动价|价格/i.test(k));
      const isPackageKey = keys.find(k => /是否组包/i.test(k));
      const packageCountKey = keys.find(k => /组包件数/i.test(k));
      const productNameKey = keys.find(k => /商品名称/i.test(k));

      // 必须有条码
      if (!barcodeKey || !row[barcodeKey]) {
        skipCount++;
        return;
      }

      const barcode = String(row[barcodeKey]).trim();
      const priceValue = priceKey ? row[priceKey] : '';
      const activityPrice = typeof priceValue === 'number' 
        ? priceValue 
        : parseFloat(String(priceValue).replace(/[^\d.]/g, ''));
      
      const isPackage = isPackageKey ? String(row[isPackageKey] || '否').trim() : '否';
      const packageCount = packageCountKey ? row[packageCountKey] : '';
      const productName = productNameKey ? String(row[productNameKey] || '').trim() : '';

      // 查询商品总表
      const masterProduct = productMaster.get(barcode);
      
      if (!masterProduct) {
        // 商品总表中未找到，保留（无法判断）
        notFoundRows.push({
          upc: barcode,
          productName,
          activityPrice,
          procurementCost: null,
          reason: '商品总表中未找到',
        });
        
        processedRows.push({
          upc: barcode,
          price: activityPrice || '',
          stock: initialStock,
          isPackage,
          packageCount,
          procurementCost: null,
          productName,
        });
        successCount++;
        return;
      }

      const procurementCost = masterProduct.procurementCost;
      
      if (isNaN(activityPrice) || activityPrice <= 0) {
        // 活动价无效，保留（让用户手动处理）
        noPriceRows.push({
          upc: barcode,
          productName: productName || masterProduct.productName,
          activityPrice,
          procurementCost,
          reason: '活动价无效',
        });
        
        processedRows.push({
          upc: barcode,
          price: '',
          stock: initialStock,
          isPackage,
          packageCount,
          procurementCost,
          productName: productName || masterProduct.productName,
        });
        successCount++;
        return;
      }

      // 采购价 > 活动价 → 排除
      if (procurementCost > activityPrice) {
        excludedRows.push({
          upc: barcode,
          productName: productName || masterProduct.productName,
          activityPrice,
          procurementCost,
          profitMargin: ((activityPrice - procurementCost) / activityPrice * 100).toFixed(1) + '%',
          reason: `采购价(${procurementCost}) > 活动价(${activityPrice})`,
        });
        return;
      }

      // 通过过滤，加入输出
      processedRows.push({
        upc: barcode,
        price: activityPrice,
        stock: initialStock,
        isPackage,
        packageCount,
        procurementCost,
        productName: productName || masterProduct.productName,
      });
      successCount++;
    });

    // 4. 生成结果 Workbook
    const wbOutput = new ExcelJS.Workbook();
    
    // Sheet 1: 报名商品
    const wsOutput = wbOutput.addWorksheet('爆好价报名');
    wsOutput.columns = [
      { header: 'UPC条形码', key: 'upc', width: 20 },
      { header: '活动价', key: 'price', width: 12 },
      { header: '活动初始库存', key: 'stock', width: 12 },
      { header: '是否组包', key: 'isPackage', width: 10 },
      { header: '组包件数', key: 'packageCount', width: 10 },
      { header: '采购价', key: 'procurementCost', width: 10 },
      { header: '商品名称', key: 'productName', width: 40 },
    ];
    processedRows.forEach(row => wsOutput.addRow(row));

    // Sheet 2: 排除商品（供参考）
    if (excludedRows.length > 0) {
      const wsExcluded = wbOutput.addWorksheet('排除商品');
      wsExcluded.columns = [
        { header: '条码', key: 'upc', width: 20 },
        { header: '商品名称', key: 'productName', width: 40 },
        { header: '活动价', key: 'activityPrice', width: 12 },
        { header: '采购价', key: 'procurementCost', width: 12 },
        { header: '毛利率', key: 'profitMargin', width: 10 },
        { header: '排除原因', key: 'reason', width: 30 },
      ];
      excludedRows.forEach(row => wsExcluded.addRow(row));
    }

    // Sheet 3: 采购价为0警告（如有）
    const zeroCostRows = processedRows.filter(r => r.procurementCost === 0);
    if (zeroCostRows.length > 0) {
      const wsZeroCost = wbOutput.addWorksheet('⚠️采购价为0');
      wsZeroCost.columns = [
        { header: '条码', key: 'upc', width: 20 },
        { header: '商品名称', key: 'productName', width: 40 },
        { header: '活动价', key: 'price', width: 12 },
        { header: '采购价', key: 'procurementCost', width: 12 },
        { header: '风险', key: 'risk', width: 20 },
      ];
      zeroCostRows.forEach(row => {
        wsZeroCost.addRow({
          ...row,
          risk: '采购价未设置，无法判断利润',
        });
      });
      
      // 设置警告色
      wsZeroCost.getRow(1).eachCell(cell => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFCC00' },
        };
      });
    }

    const buffer = (await wbOutput.xlsx.writeBuffer()) as Buffer;
    
    // 统计采购价为0的商品
    const zeroCostCount = processedRows.filter(r => r.procurementCost === 0).length;
    
    // 生成摘要
    const total = processedRows.length + excludedRows.length;
    const summary = `处理完成！
总商品数: ${total}
✅ 保留: ${processedRows.length} (采购价 ≤ 活动价)
❌ 排除: ${excludedRows.length} (采购价 > 活动价)
🔍 未找到: ${notFoundRows.length} (商品总表中无记录)
⚠️ 无活动价: ${noPriceRows.length}
⚠️ 采购价为0: ${zeroCostCount} (需核实)

${excludedRows.length > 0 ? '详情请查看"排除商品"Sheet' : ''}
${zeroCostCount > 0 ? '⚠️ 采购价为0的商品请查看"⚠️采购价为0"Sheet' : ''}`;

    return { buffer: buffer as Buffer, summary };
  }
}