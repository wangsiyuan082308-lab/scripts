/**
 * 爆好价Excel转换器 v2 - 采购价过滤版
 * 
 * 功能：
 * 1. 从饿了么导出的商品数据Excel
 * 2. 根据条码查询商品总表的采购价
 * 3. 过滤：采购价 > 活动价 的商品不报名
 * 4. 生成符合报名要求的Excel（含排除商品清单）
 * 
 * 用法：npx ts-node transform-baohao.ts <输入Excel> [初始库存=9999]
 */
import * as ExcelJS from 'exceljs';
import * as fs from 'fs';
import * as path from 'path';

const DATA_DIR = path.join(__dirname, '..', 'data');
const PRODUCT_MASTER_PATH = '/Users/mac/.openclaw/data/product-master.json';

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

export async function transformBaohaojia(inputPath: string, initialStock = 9999): Promise<string> {
  console.log(`\n=== 爆好价转换器 v2 ===`);
  console.log(`读取文件: ${inputPath}`);
  console.log(`初始库存: ${initialStock}`);
  
  // 加载商品总表
  const productMaster = loadProductMaster();
  
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(inputPath);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error('Excel中没有工作表');

  // 找表头行，识别列
  let headerRowNum = 1;
  ws.eachRow((row, rowNumber) => {
    const cell1 = String(row.getCell(1).value || '').trim();
    if (/UPC|条码|条形码/i.test(cell1)) {
      headerRowNum = rowNumber;
    }
  });
  
  const headerRow = ws.getRow(headerRowNum);
  const headers: Record<string, number> = {};
  headerRow.eachCell((cell, colNumber) => {
    const val = String(cell.value || '').trim();
    if (/UPC|条码|条形码/i.test(val)) headers['barcode'] = colNumber;
    if (/活动价上限|活动价不高于|活动价|价格/i.test(val)) headers['price'] = colNumber;
    if (/是否组包/i.test(val)) headers['isPackage'] = colNumber;
    if (/组包件数/i.test(val)) headers['packageCount'] = colNumber;
    if (/商品名称/i.test(val)) headers['productName'] = colNumber;
  });

  console.log(`识别到的列: ${JSON.stringify(headers)}`);
  if (!headers['barcode']) throw new Error('未找到条码列');
  if (!headers['price']) throw new Error('未找到活动价列');

  // 读取并过滤数据
  const includedRows: any[] = [];
  const excludedRows: any[] = [];
  const noPriceRows: any[] = [];
  const notFoundRows: any[] = [];
  
  ws.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowNum) return; // 跳过表头
    
    const barcode = String(row.getCell(headers['barcode']).value || '').trim();
    if (!barcode) return;

    const priceValue = row.getCell(headers['price']).value;
    const activityPrice = typeof priceValue === 'number' ? priceValue : parseFloat(String(priceValue).replace(/[^\d.]/g, ''));
    
    const isPackage = headers['isPackage'] 
      ? String(row.getCell(headers['isPackage']).value || '否').trim() 
      : '否';
    
    const packageCount = headers['packageCount'] 
      ? row.getCell(headers['packageCount']).value 
      : '';

    const productName = headers['productName'] 
      ? String(row.getCell(headers['productName']).value || '').trim() 
      : '';

    // 查询商品总表
    const masterProduct = productMaster.get(barcode);
    
    if (!masterProduct) {
      // 商品总表中未找到
      notFoundRows.push({
        upc: barcode,
        productName,
        activityPrice,
        procurementCost: null,
        reason: '商品总表中未找到',
      });
      // 未找到的也加入输出（无法判断，保守策略：保留）
      includedRows.push({ 
        upc: barcode, 
        price: activityPrice || '', 
        stock: initialStock, 
        isPackage, 
        packageCount,
        procurementCost: null,
        productName,
      });
      return;
    }

    const procurementCost = masterProduct.procurementCost;
    
    if (isNaN(activityPrice) || activityPrice <= 0) {
      // 活动价无效
      noPriceRows.push({
        upc: barcode,
        productName: productName || masterProduct.productName,
        activityPrice,
        procurementCost,
        reason: '活动价无效',
      });
      includedRows.push({
        upc: barcode,
        price: '',
        stock: initialStock,
        isPackage,
        packageCount,
        procurementCost,
        productName: productName || masterProduct.productName,
      });
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
    includedRows.push({
      upc: barcode,
      price: activityPrice,
      stock: initialStock,
      isPackage,
      packageCount,
      procurementCost,
      productName: productName || masterProduct.productName,
    });
  });

  const total = includedRows.length + excludedRows.length;
  
  console.log(`\n=== 过滤结果 ===`);
  console.log(`总商品数: ${total}`);
  console.log(`✅ 保留: ${includedRows.length} (采购价 ≤ 活动价)`);
  console.log(`❌ 排除: ${excludedRows.length} (采购价 > 活动价)`);
  console.log(`🔍 未找到: ${notFoundRows.length} (商品总表中无记录)`);
  console.log(`⚠️ 无活动价: ${noPriceRows.length}`);

  // 生成输出Excel
  const wbOut = new ExcelJS.Workbook();
  
  // Sheet 1: 报名商品
  const wsOut = wbOut.addWorksheet('爆好价报名');
  wsOut.columns = [
    { header: 'UPC条形码', key: 'upc', width: 20 },
    { header: '活动价', key: 'price', width: 12 },
    { header: '活动初始库存', key: 'stock', width: 12 },
    { header: '是否组包', key: 'isPackage', width: 10 },
    { header: '组包件数', key: 'packageCount', width: 10 },
    { header: '采购价', key: 'procurementCost', width: 10 },
    { header: '商品名称', key: 'productName', width: 40 },
  ];
  includedRows.forEach(r => wsOut.addRow(r));

  // Sheet 2: 排除商品（供参考）
  if (excludedRows.length > 0) {
    const wsExcluded = wbOut.addWorksheet('排除商品');
    wsExcluded.columns = [
      { header: '条码', key: 'upc', width: 20 },
      { header: '商品名称', key: 'productName', width: 40 },
      { header: '活动价', key: 'activityPrice', width: 12 },
      { header: '采购价', key: 'procurementCost', width: 12 },
      { header: '毛利率', key: 'profitMargin', width: 10 },
      { header: '排除原因', key: 'reason', width: 30 },
    ];
    excludedRows.forEach(r => wsExcluded.addRow(r));
  }

  // Sheet 3: 采购价为0警告
  const zeroCostRows = includedRows.filter(r => r.procurementCost === 0);
  if (zeroCostRows.length > 0) {
    const wsZeroCost = wbOut.addWorksheet('⚠️采购价为0');
    wsZeroCost.columns = [
      { header: '条码', key: 'upc', width: 20 },
      { header: '商品名称', key: 'productName', width: 40 },
      { header: '活动价', key: 'price', width: 12 },
      { header: '采购价', key: 'procurementCost', width: 12 },
      { header: '风险', key: 'risk', width: 30 },
    ];
    zeroCostRows.forEach(row => {
      wsZeroCost.addRow({
        ...row,
        risk: '采购价未设置，无法判断利润',
      });
    });
  }

  // 保存文件
  const outputName = path.basename(inputPath, path.extname(inputPath)) + '_报名.xlsx';
  const outputPath = path.join(DATA_DIR, outputName);
  await wbOut.xlsx.writeFile(outputPath);
  
  console.log(`\n✅ 输出文件: ${outputPath}`);
  
  return outputPath;
}

// CLI入口
if (require.main === module) {
  const inputFile = process.argv[2];
  const stock = parseInt(process.argv[3] || '9999');
  
  if (!inputFile) {
    console.error('用法: ts-node transform-baohao.ts <输入Excel> [初始库存=9999]');
    console.error('\n功能：');
    console.error('  1. 根据条码查询商品总表采购价');
    console.error('  2. 过滤采购价 > 活动价的商品');
    console.error('  3. 生成报名Excel（含排除商品清单）');
    process.exit(1);
  }
  
  transformBaohaojia(inputFile, stock)
    .then(outputPath => {
      console.log('\n=== 完成 ===');
      console.log(`报名文件: ${outputPath}`);
    })
    .catch(err => {
      console.error('失败:', err.message);
      process.exit(1);
    });
}