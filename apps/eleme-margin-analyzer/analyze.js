const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

// 配置
const CONFIG = {
  targetMargin: 30, // 目标毛利率30%
  inputFile: '/Users/mac/Downloads/导出订单列表+明细20260209_173622.xlsx',
  outputDir: '/Users/mac/Downloads'
};

// 颜色输出
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function analyzeExcel() {
  log('\n' + '='.repeat(80), 'cyan');
  log('📊 商品毛利率分析工具 (Node.js版)', 'cyan');
  log('='.repeat(80), 'cyan');
  log(`\n📁 输入文件: ${CONFIG.inputFile}\n`, 'blue');

  try {
    // 读取Excel文件
    const workbook = xlsx.readFile(CONFIG.inputFile);
    
    // 获取所有sheet名称
    const sheetNames = workbook.SheetNames;
    log(`📄 找到 ${sheetNames.length} 个Sheet: ${sheetNames.join(', ')}\n`, 'green');

    // 读取订单明细sheet
    const sheetName = '订单明细';
    if (!sheetNames.includes(sheetName)) {
      log(`❌ 错误: 找不到Sheet "${sheetName}"`, 'red');
      return;
    }

    const worksheet = workbook.Sheets[sheetName];
    
    // 转换为JSON数据
    const data = xlsx.utils.sheet_to_json(worksheet);
    log(`✅ 成功读取 ${data.length} 行数据\n`, 'green');

    // 分析商品毛利率
    analyzeProducts(data);

  } catch (error) {
    log(`\n❌ 错误: ${error.message}`, 'red');
    log(`\n💡 提示: 请确保安装了xlsx库: npm install xlsx\n`, 'yellow');
  }
}

function analyzeProducts(data) {
  log('📈 开始分析商品毛利率...\n', 'cyan');

  // 按商品名称分组统计
  const productMap = new Map();

  data.forEach(row => {
    const productName = row['商品名称'];
    const salePrice = parseFloat(row['商品售价']) || 0;
    const originalPrice = parseFloat(row['商品原价']) || 0;
    const quantity = parseFloat(row['商品销售数量']) || 0;

    if (!productMap.has(productName)) {
      productMap.set(productName, {
        totalSales: 0,
        totalRevenue: 0,
        totalCost: 0,
        prices: [],
        costs: []
      });
    }

    const product = productMap.get(productName);
    product.totalSales += quantity;
    product.totalRevenue += salePrice * quantity;
    product.totalCost += originalPrice * quantity;
    product.prices.push(salePrice);
    product.costs.push(originalPrice);
  });

  // 计算每个商品的毛利率
  const products = [];
  let lowMarginCount = 0;

  for (const [name, stats] of productMap) {
    const avgPrice = stats.totalSales > 0 ? stats.totalRevenue / stats.totalSales : 0;
    const avgCost = stats.totalSales > 0 ? stats.totalCost / stats.totalSales : 0;
    
    // 计算毛利率: (售价 - 原价) / 售价 * 100%
    const grossMargin = avgPrice > 0 ? ((avgPrice - avgCost) / avgPrice) * 100 : 0;

    products.push({
      name,
      grossMargin,
      avgPrice,
      avgCost,
      totalSales: stats.totalSales,
      totalRevenue: stats.totalRevenue
    });

    if (grossMargin < CONFIG.targetMargin) {
      lowMarginCount++;
    }
  }

  // 按毛利率排序
  products.sort((a, b) => a.grossMargin - b.grossMargin);

  // 显示结果
  displayResults(products, lowMarginCount);
}

function displayResults(products, lowMarginCount) {
  log('='.repeat(80), 'cyan');
  log(`⚠️  毛利率低于${CONFIG.targetMargin}%的商品列表（需要调整定价）`, 'yellow');
  log('='.repeat(80), 'cyan');
  log('');

  if (lowMarginCount === 0) {
    log('✅ 恭喜！所有商品毛利率都高于30%\n', 'green');
    return;
  }

  log(`❌ 发现 ${lowMarginCount} 个商品毛利率低于${CONFIG.targetMargin}%\n`, 'red');

  // 筛选低毛利商品
  const lowMarginProducts = products.filter(p => p.grossMargin < CONFIG.targetMargin);

  lowMarginProducts.forEach((product, index) => {
    const { name, grossMargin, avgPrice, avgCost, totalSales, totalRevenue } = product;
    
    log(`${index + 1}. 【${name}】`, 'magenta');
    log(`   毛利率: ${grossMargin.toFixed(2)}% (目标: ${CONFIG.targetMargin}%)`, 'red');
    log(`   平均售价: ¥${avgPrice.toFixed(2)}`, 'cyan');
    log(`   平均原价: ¥${avgCost.toFixed(2)}`, 'cyan');
    log(`   总销量: ${totalSales}`, 'blue');
    log(`   总销售额: ¥${totalRevenue.toFixed(2)}`, 'blue');

    // 计算建议售价（达到30%毛利率）
    const targetPrice = avgCost / (1 - CONFIG.targetMargin / 100);
    const priceIncrease = targetPrice - avgPrice;
    const increasePercent = avgPrice > 0 ? (priceIncrease / avgPrice) * 100 : 0;

    log(`   💡 建议售价: ¥${targetPrice.toFixed(2)} (需上调 ¥${priceIncrease.toFixed(2)}, +${increasePercent.toFixed(1)}%)`, 'green');
    log('');
  });

  // 导出结果
  exportResults(lowMarginProducts);

  // 显示统计信息
  displayStats(products);
}

function exportResults(lowMarginProducts) {
  const timestamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-');
  const outputFile = path.join(CONFIG.outputDir, `低毛利商品_${timestamp}.csv`);

  const csvData = lowMarginProducts.map(p => ({
    商品名称: p.name,
    毛利率: `${p.grossMargin.toFixed(2)}%`,
    平均售价: `¥${p.avgPrice.toFixed(2)}`,
    平均原价: `¥${p.avgCost.toFixed(2)}`,
    总销量: p.totalSales,
    总销售额: `¥${p.totalRevenue.toFixed(2)}`,
    建议售价: `¥${(p.avgCost / (1 - CONFIG.targetMargin / 100)).toFixed(2)}`
  }));

  // 转换为CSV格式
  const headers = Object.keys(csvData[0]);
  const csvContent = [
    headers.join(','),
    ...csvData.map(row => headers.map(h => `"${row[h]}"`).join(','))
  ].join('\n');

  fs.writeFileSync(outputFile, csvContent, 'utf8');
  log(`📊 结果已导出到: ${outputFile}\n`, 'green');
}

function displayStats(products) {
  log('='.repeat(80), 'cyan');
  log('📈 整体毛利率统计', 'cyan');
  log('='.repeat(80), 'cyan');
  log('');

  const avgMargin = products.reduce((sum, p) => sum + p.grossMargin, 0) / products.length;
  const maxMargin = Math.max(...products.map(p => p.grossMargin));
  const minMargin = Math.min(...products.map(p => p.grossMargin));

  log(`平均毛利率: ${avgMargin.toFixed(2)}%`, 'blue');
  log(`最高毛利率: ${maxMargin.toFixed(2)}%`, 'green');
  log(`最低毛利率: ${minMargin.toFixed(2)}%`, 'red');
  log('');

  // 毛利率分布
  const ranges = [
    { min: 0, max: 10, label: '0-10% (严重亏损)' },
    { min: 10, max: 20, label: '10-20% (低毛利)' },
    { min: 20, max: 30, label: '20-30% (需改善)' },
    { min: 30, max: 50, label: '30-50% (健康)' },
    { min: 50, max: 100, label: '50%+ (高毛利)' }
  ];

  log('毛利率分布:', 'yellow');
  ranges.forEach(range => {
    const count = products.filter(p => p.grossMargin >= range.min && p.grossMargin < range.max).length;
    const percentage = (count / products.length) * 100;
    const color = count > 0 ? 'red' : 'gray';
    log(`  ${range.label}: ${count} 个商品 (${percentage.toFixed(1)}%)`, color);
  });

  log('');
  log('='.repeat(80), 'cyan');
  log('✅ 分析完成！', 'green');
  log('='.repeat(80), 'cyan');
  log('');
}

// 运行分析
analyzeExcel();
