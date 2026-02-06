import { Buffer } from 'node:buffer';

import * as ExcelJS from 'exceljs';

/**
 * 通用 Excel 读取工具 (Node.js Buffer 版)
 * 自动识别前 10 行中的表头
 */
export async function readExcel(buffer: Buffer): Promise<any[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];

  if (!worksheet) return [];

  let headers: string[] = [];
  let headerRowIndex = 1;
  const data: any[] = [];

  // 1. 扫描前 10 行寻找表头
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber > 10) return;
    if (headers.length > 0) return;

    // 清洗表头
    const rowValues: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const val = cell.value;
      const text =
        val && typeof val === 'object' && 'result' in val ? val.result : val;
      rowValues[colNumber - 1] = text
        ? String(text)
            .replaceAll(/[\r\n]+/g, '')
            .trim()
        : '';
    });

    // 判断依据：包含 "UPC" 或 "条码" 或 "SKU" 或 "门店"
    const isHeader = rowValues.some(
      (v) =>
        /UPC/i.test(v) ||
        v.includes('条码') ||
        v.includes('商品条码') ||
        v.includes('SKU') ||
        v.includes('门店'),
    );

    if (isHeader) {
      headers = rowValues;
      headerRowIndex = rowNumber;
    }
  });

  // 默认回退
  if (headers.length === 0) {
    const firstRow = worksheet.getRow(1);
    firstRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const val = cell.value;
      const text =
        val && typeof val === 'object' && 'result' in val ? val.result : val;
      headers[colNumber - 1] = text ? String(text).trim() : '';
    });
    headerRowIndex = 1;
  }

  // 2. 读取数据
  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber <= headerRowIndex) return;

    const rowData: any = {};
    row.eachCell((cell, colNumber) => {
      const header = headers[colNumber - 1];
      if (header) {
        let val = cell.value;
        if (val && typeof val === 'object') {
          if ('result' in val) val = val.result;
          else if ('text' in val) val = val.text;
        }
        rowData[header] = val;
      }
    });
    data.push(rowData);
  });
  return data;
}
