import { Buffer } from 'node:buffer';

import * as ExcelJS from 'exceljs';

import { readExcel } from '../../utils/excel-helper';

interface PlanOptions {
  buffers: Buffer[];
  type: 'aoxiang' | 'qianniuhua';
}

export const ProcurementPlanGenerator = {
  async run({ buffers, type }: PlanOptions) {
    // 1. 读取所有文件
    const allData: any[] = [];
    for (const buffer of buffers) {
      const data = await readExcel(buffer);
      allData.push(...data);
    }

    if (allData.length === 0) {
      throw new Error('未找到有效数据，请检查上传的文件内容');
    }

    // 2. 创建输出 Workbook
    const wbOutput = new ExcelJS.Workbook();
    const wsOutput = wbOutput.addWorksheet('采购计划');

    // 定义输出模版
    if (type === 'aoxiang') {
      // 第一行：必填项说明
      wsOutput.columns = [
        { header: '必填', key: 'col1', width: 15 },
        { header: '', key: 'col2', width: 15 },
        { header: '', key: 'col3', width: 12 },
        { header: '非必填\n可通过补货建议列表导出的供应商填入，不填则默认取供货关系设置的默认供应商', key: 'col4', width: 25 },
        { header: '非必填\n下拉选择【库存单位】，【采购单位】，不填则默认取供货关系设置的单位', key: 'col5', width: 15 },
        { header: '非必填\n可通过补货建议列表导出的采购价填入，不填则默认取供货关系设置的采购价', key: 'col6', width: 25 },
      ];
      
      // 添加真正的表头行 (第二行)
      wsOutput.addRow({
        col1: '*仓库/门店编码',
        col2: '*商品编码',
        col3: '*补货量',
        col4: '供应商编码',
        col5: '单位',
        col6: '采购价',
      });

      // 合并第一行的单元格
      // "必填" 覆盖前三列 (A1:C1)
      wsOutput.mergeCells('A1:C1');
      // 后面的非必填说明分别在 D1, E1, F1，不需要合并，但需要设置对齐和换行
      ['A1', 'D1', 'E1', 'F1'].forEach(cell => {
         wsOutput.getCell(cell).alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
         // 可以加个背景色区分
         wsOutput.getCell(cell).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFD3D3D3' } // 浅灰色
         };
         // 边框
         wsOutput.getCell(cell).border = {
            top: {style:'thin'},
            left: {style:'thin'},
            bottom: {style:'thin'},
            right: {style:'thin'}
         };
      });

      // 第二行表头也加边框和背景
      wsOutput.getRow(2).eachCell((cell) => {
         cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFD3D3D3' }
         };
         cell.border = {
            top: {style:'thin'},
            left: {style:'thin'},
            bottom: {style:'thin'},
            right: {style:'thin'}
         };
         cell.alignment = { vertical: 'middle', horizontal: 'center' };
      });
      
    } else {
      // 默认牵牛花模版
      wsOutput.columns = [
        { header: '*门店/仓编码', key: 'storeCode', width: 15 },
        { header: '*SKU编码', key: 'skuCode', width: 15 },
        { header: '补货量', key: 'quantity', width: 12 },
        { header: '商品名称', key: 'name', width: 30 },
        { header: '补货单价(元）', key: 'price', width: 12 },
        { header: '供应商编码', key: 'supplierCode', width: 15 },
        { header: '补货单位', key: 'unit', width: 10 },
      ];
    }

    // 3. 处理数据行
    let count = 0;
    allData.forEach((row) => {
      // 映射逻辑：优先完全匹配，其次模糊匹配
      const getVal = (exact: string, partials: string[] = []) => {
        if (row[exact] !== undefined) return row[exact];
        // 尝试去除 * 号后匹配
        const cleanExact = exact.replaceAll('*', '');
        if (row[cleanExact] !== undefined) return row[cleanExact];

        // 模糊匹配
        const key = Object.keys(row).find((k) =>
          partials.some((kw) => k.includes(kw)),
        );
        return key ? row[key] : undefined;
      };

      const storeCode = getVal('*门店/仓编码', ['门店', '仓编码']);
      const skuCode = getVal('*SKU编码', ['SKU']);
      const quantity = getVal('*采购量', ['采购量']);
      const name = getVal('商品名称', ['商品名称', '名称']);
      const price = getVal('采购单价(元)', ['采购单价', '单价']);
      const supplierCode = getVal('供应商编码', ['供应商']);
      // 补货单位输入中没有，留空

      // 简单验证：必须有 SKU 和 数量
      if (!skuCode) return;

      // 过滤购买状态为成功的
      const status = getVal('购买状态', ['购买状态']);
      if (status !== '成功') return;

      if (type === 'aoxiang') {
        wsOutput.addRow({
          col1: storeCode,
          col2: skuCode,
          col3: quantity || 0,
          col4: supplierCode,
          col5: '',
          col6: price,
        });
      } else {
        wsOutput.addRow({
          storeCode,
          skuCode,
          quantity: quantity || 0, // 确保有数量
          name: '', // 商品名称留空
          price,
          supplierCode,
          unit: '',
        });
      }
      count++;
    });

    // 4. 导出 Buffer
    // @ts-ignore: buffer is compatible with Buffer
    const buffer = await wbOutput.xlsx.writeBuffer();

    // 生成默认文件名
    const timestamp = new Date()
      .toISOString()
      .replaceAll(/[:.]/g, '-')
      .slice(0, 19);
    const platformName = type === 'qianniuhua' ? '牵牛花' : '翱象';
    const filename = `采购计划_${platformName}_${timestamp}.xlsx`;

    return {
      buffer: buffer as Buffer,
      summary: `生成成功！\n目标平台：${platformName}\n共合并 ${buffers.length} 个文件，生成 ${count} 条数据。`,
      outputPath: filename,
    };
  },
};
