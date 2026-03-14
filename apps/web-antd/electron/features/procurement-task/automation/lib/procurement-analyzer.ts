import * as fs from 'node:fs';

import * as ExcelJS from 'exceljs';

import { readExcel } from './excel-helper';

interface StoreFilterConfig {
  name: string;
  maxItems: number; // 0 = 不限制
}

interface ProcurementOptions {
  listBuffer: Buffer;
  refBuffer: Buffer;
  mode?: string; // 'week' | 'month' | 'none'
  supplierFilter?: string; // 按供应商名称过滤
  storeFilter?: string[] | StoreFilterConfig[]; // 门店名称列表或带 maxItems 的配置
}

interface ProcurementFromFilesOptions {
  listFile: string;    // 补货清单Excel路径
  refFile: string;     // 补货参考Excel路径
  outputFile: string;  // 输出补货计划Excel路径
  mode?: string;       // 'week' | 'month' | 'none'
  supplierFilter?: string; // 按供应商名称过滤
  storeFilter?: string[] | StoreFilterConfig[]; // 门店名称列表或带 maxItems 的配置
}

export class ProcurementAnalyzer {
  static async runFromFiles(options: ProcurementFromFilesOptions): Promise<{
    summary: string;
    storeNames: string[];
    outputFile: string;
  }> {
    const listBuffer = fs.readFileSync(options.listFile) as Buffer;
    const refBuffer = fs.readFileSync(options.refFile) as Buffer;

    const result = await ProcurementAnalyzer.run({
      listBuffer,
      refBuffer,
      mode: options.mode,
      supplierFilter: options.supplierFilter,
      storeFilter: options.storeFilter,
    });

    fs.writeFileSync(options.outputFile, result.buffer);

    return {
      summary: result.summary,
      storeNames: result.storeNames,
      outputFile: options.outputFile,
    };
  }

  static async run({
    listBuffer,
    refBuffer,
    mode = 'week',
    supplierFilter,
    storeFilter,
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

    // 智能查找列名（兼容不同导出格式）
    const findKey = (row: any, ...patterns: string[]) =>
      Object.keys(row).find(k => patterns.some(p => k.includes(p)));

    // 校验补货清单必要列
    if (listData.length > 0) {
      const columns = Object.keys(listData[0]);
      const hasStatus = columns.some(k => k.includes('检查状态'));
      const hasLink = columns.some(k => k.includes('供应商商品链接') || k.includes('供应商商品 链接'));
      const missing: string[] = [];
      if (!hasStatus) missing.push('检查状态');
      if (!hasLink) missing.push('供应商商品链接');
      if (missing.length > 0) {
        console.log('[Procurement] 列名: ' + columns.slice(0, 15).join(', '));
        throw new Error('补货清单缺少必要列: ' + missing.join('、') + '，请确认导出模板是否正确');
      }
    }

    // 按供应商过滤（如果指定了supplierFilter）
    let filteredListData = listData;
    if (supplierFilter) {
      const filtered = listData.filter((row: any) => {
        // 精确匹配列名"供应商"（不是"供应商编码"等）
        const supplierKey = Object.keys(row).find(k => k === '供应商') || Object.keys(row).find(k => k === '供应商名称');
        return supplierKey && String(row[supplierKey]).trim() === supplierFilter;
      });
      // 补货清单导出的"供应商"列可能为空（已按供应商筛选后加入），此时跳过过滤
      if (filtered.length > 0) {
        filteredListData = filtered;
        console.log(`[Procurement] 供应商过滤: "${supplierFilter}" → ${filteredListData.length}/${listData.length} 行`);
      } else {
        console.log(`[Procurement] 供应商列为空，跳过过滤（补货清单已按供应商筛选）: ${listData.length} 行`);
      }
    }

    // 过滤有效数据：有供应商商品链接的行
    let validRows = filteredListData.filter((row: any) => {
      const linkKey = findKey(row, '供应商商品链接', '供应商商品 链接');
      const hasLink = linkKey && row[linkKey] && String(row[linkKey]).trim() !== '';
      return hasLink;
    });
    // 过滤检查状态：只移除明确"未通过"的商品，其他状态（已通过、其他、空）都保留
    const statusKey = validRows.length > 0 ? findKey(validRows[0], '检查状态') : null;
    if (statusKey) {
      const beforeCount = validRows.length;
      const passed = validRows.filter(r => r[statusKey] === '已通过').length;
      const failed = validRows.filter(r => r[statusKey] === '未通过').length;
      const other = beforeCount - passed - failed;
      console.log(`[Procurement] 检查状态: 已通过=${passed}, 未通过=${failed}, 其他=${other}`);
      // 只排除明确"未通过"的行，其余全部保留
      validRows = validRows.filter(r => r[statusKey] !== '未通过');
      console.log(`[Procurement] 排除未通过后: ${validRows.length}/${beforeCount} 行`);
    }
    if (validRows.length === 0) {
      // 打印前3行的key帮助调试
      if (listData.length > 0) {
        console.log('[Procurement] 列名:', Object.keys(listData[0]).slice(0, 15).join(', '));
      }
      throw new Error('No valid data found (需要"供应商商品链接"或"供应商商品 链接"列且非空)');
    }
    console.log(`[Procurement] 有效行: ${validRows.length}/${listData.length}`);

    // 收集唯一的门店名称
    const storeNamesSet = new Set<string>();
    validRows.forEach((row: any) => {
      const storeNameKey = Object.keys(row).find(
        (k) => (k.includes('收货方') || k.includes('门店') || k.includes('仓')) && k.includes('名'),
      );
      if (storeNameKey && row[storeNameKey]) {
        storeNamesSet.add(String(row[storeNameKey]).trim());
      }
    });
    const storeNames = Array.from(storeNamesSet);

    // Filter by store if specified
    let rowsToProcess = validRows;
    if (storeFilter && storeFilter.length > 0) {
      // 标准化为 StoreFilterConfig 格式
      const storeConfigs: StoreFilterConfig[] = storeFilter.map(f =>
        typeof f === 'string' ? { name: f, maxItems: 0 } : f,
      );
      const storeNames = storeConfigs.map(s => s.name);

      // 先按门店名过滤
      const filtered = validRows.filter((row: any) => {
        const storeNameKey = Object.keys(row).find(
          (k) => (k.includes('收货方') || k.includes('门店') || k.includes('仓')) && k.includes('名'),
        );
        if (!storeNameKey) return true;
        const storeName = String(row[storeNameKey]).trim();
        return storeNames.some(f => storeName.includes(f));
      });

      // 按门店分组，每组按销量降序排序后取 top N
      const hasMaxItems = storeConfigs.some(s => s.maxItems > 0);
      if (hasMaxItems) {
        const storeNameKeyForGroup = filtered.length > 0
          ? Object.keys(filtered[0]).find(
              (k) => (k.includes('收货方') || k.includes('门店') || k.includes('仓')) && k.includes('名'),
            )
          : null;

        // 查找销量列（优先周销，其次月销，最后日销）
        const saleKey = filtered.length > 0
          ? (findKey(filtered[0], '周销') || findKey(filtered[0], '月销') || findKey(filtered[0], '日销') || findKey(filtered[0], '销量'))
          : null;

        if (storeNameKeyForGroup) {
          // 按门店分组
          const byStore: Record<string, any[]> = {};
          for (const row of filtered) {
            const store = String(row[storeNameKeyForGroup]).trim();
            if (!byStore[store]) byStore[store] = [];
            byStore[store].push(row);
          }

          rowsToProcess = [];
          for (const [store, rows] of Object.entries(byStore)) {
            // 找到该门店的 maxItems 配置
            const cfg = storeConfigs.find(s => store.includes(s.name));
            const limit = cfg?.maxItems || 0;

            // 按销量降序排序
            if (saleKey) {
              rows.sort((a: any, b: any) => (Number(b[saleKey]) || 0) - (Number(a[saleKey]) || 0));
            }

            const taken = limit > 0 ? rows.slice(0, limit) : rows;
            rowsToProcess.push(...taken);
            if (limit > 0 && rows.length > limit) {
              console.log(`[Procurement] ${store}: 按销量取前 ${limit}/${rows.length} 个`);
            }
          }
        } else {
          rowsToProcess = filtered;
        }
      } else {
        rowsToProcess = filtered;
      }

      console.log(`[Procurement] 门店过滤: [${storeNames.join(', ')}] → ${rowsToProcess.length}/${validRows.length} 行`);
    }

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
    let removedCount = 0;
    // 循环当前的补货清单
    rowsToProcess.forEach((row: any) => {
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
          console.log(
            `[Halved] SKU: ${row['商品SKU']}, Orig: ${originalQty}, Purch: ${purchaseQty}, Comp: ${comparisonValue}, Final: ${finalQty}`,
          );
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
          console.log(
            `[MinOrder] SKU: ${row['商品SKU']}, Final adjusted to MinOrder: ${minOrderQty}`,
          );
        }
      } else {
        finalQty = purchaseQty;
        // 仅在调试时打印部分行，避免日志过多
        if (Math.random() < 0.05) {
          console.log(
            `[NoCompare] SKU: ${row['商品SKU']}, Orig: ${originalQty}, Purch: ${purchaseQty}, Final: ${finalQty}`,
          );
        }
      }

      if (finalQty <= 0) {
        removedCount++;
        return;
      }

      keptCount++;
      const storeCodeKey = findKey(row, '收货方编码', '门店/仓编码', '门店编码');
      const skuKey = findKey(row, '商品SKU', 'SKU编码');
      const supplierCodeKey = findKey(row, '发货方编码', '供应商编码');
      const unitKey = findKey(row, '采购单位');

      const newRow = wsOutput.addRow({
        storeCode: storeCodeKey ? row[storeCodeKey] : '',
        skuCode: skuKey ? row[skuKey] : row['商品SKU'],
        quantity: finalQty,
        name: '',
        price: '',
        supplierCode: supplierCodeKey ? row[supplierCodeKey] : '',
        unit: unitKey ? row[unitKey] : '',
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

    return { buffer: buffer as any, summary, storeNames };
  }
}
