import ExcelJS from 'exceljs';

import { downloadFileFromBlobPart } from '@vben/utils';

interface ExcelColumn {
  dataIndex: string;
  title: string;
  width?: number;
}

export async function exportToExcel(
  columns: ExcelColumn[],
  data: Record<string, any>[],
  fileName: string,
) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Sheet1');

  sheet.columns = columns.map((c) => ({
    header: c.title,
    key: c.dataIndex,
    width: c.width ?? 20,
  }));

  // 表头加粗
  sheet.getRow(1).font = { bold: true };

  for (const row of data) {
    const rowData: Record<string, any> = {};
    for (const col of columns) {
      rowData[col.dataIndex] = row[col.dataIndex] ?? '';
    }
    sheet.addRow(rowData);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  downloadFileFromBlobPart({
    fileName: `${fileName}.xlsx`,
    source: buffer,
  });
}
