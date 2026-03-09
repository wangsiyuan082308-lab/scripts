import { Buffer } from 'node:buffer';

import ExcelJS from 'exceljs';

export interface Store {
  id: string;
  storeId: string;
  storeName: string;
  platform: string;
  region: string;
  address: string;
  contact: string;
  phone: string;
}

export const StoreMasterFeature = {
  async importStores(fileBuffer: Buffer): Promise<Store[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer);
    const worksheet = workbook.worksheets[0];

    if (!worksheet) {
      throw new Error('Excel 文件中没有工作表');
    }

    const stores: Store[] = [];
    const headers: { [key: string]: number } = {};

    let headerRowIndex = 1;
    let foundHeader = false;

    worksheet.eachRow((row, rowNumber) => {
      if (foundHeader || rowNumber > 10) return;

      const rowValues: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        const val = cell.value ? String(cell.value).trim() : '';
        rowValues.push(val);
      });

      // Look for key columns: Store ID, Store Name
      // Update: "门店名称", "门店编码"
      if (
        rowValues.some((v) => v.includes('门店名称') && v.includes('门店编码'))
      ) {
        headerRowIndex = rowNumber;
        foundHeader = true;
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          const val = cell.value ? String(cell.value).trim() : '';
          const cleanVal = val.replaceAll('*', '').trim();
          if (cleanVal) headers[cleanVal] = colNumber;
        });
      }
    });

    if (!foundHeader) {
      // Fallback: Assume first row is header
      const firstRow = worksheet.getRow(1);
      firstRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const val = cell.value ? String(cell.value).trim() : '';
        const cleanVal = val.replaceAll('*', '').trim();
        if (cleanVal) headers[cleanVal] = colNumber;
      });
    }

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber <= headerRowIndex) return;

      const getVal = (name: string) => {
        const colIndex = headers[name];
        if (!colIndex) return '';

        const cell = row.getCell(colIndex);
        let val = cell.value;

        if (val && typeof val === 'object') {
          if ('text' in val) val = (val as any).text;
          else if ('result' in val) val = (val as any).result;
        }
        return val ? String(val).trim() : '';
      };

      const storeId = getVal('门店编码');
      const store: Store = {
        id: storeId,
        storeId,
        storeName: getVal('门店名称'),
        platform: getVal('平台'), // Optional, might be empty
        region: getVal('区域'),
        address: getVal('详细地址'),
        contact: getVal('联系人'),
        phone: getVal('联系电话'),
      };

      if (store.storeId || store.storeName) {
        stores.push(store);
      }
    });

    return stores;
  },
};
