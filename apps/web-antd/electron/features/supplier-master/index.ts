import { Buffer } from 'node:buffer';
import ExcelJS from 'exceljs';

export interface Supplier {
  supplierId: string;
  supplierName: string;
  contact: string;
  phone: string;
  address: string;
  type: string;
  status: string;
  minOrder: string;
  settlementType: string;
}

export class SupplierMasterFeature {
  static async importSuppliers(fileBuffer: Buffer): Promise<Supplier[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(fileBuffer);
    const worksheet = workbook.worksheets[0];

    if (!worksheet) {
      throw new Error('Excel 文件中没有工作表');
    }

    const suppliers: Supplier[] = [];
    const headers: { [key: string]: number } = {};

    // 1. 查找表头（通常在第一行，但也可能在前几行）
    let headerRowIndex = 1;
    let foundHeader = false;

    worksheet.eachRow((row, rowNumber) => {
      if (foundHeader || rowNumber > 10) return;

      const rowValues: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        const val = cell.value ? String(cell.value).trim() : '';
        rowValues.push(val);
      });

      // 只要包含关键字段 "供应商名称" 和 "供应商编码" 就认为是表头行
      if (rowValues.some(v => v.includes('供应商名称') && v.includes('供应商编码'))) {
        headerRowIndex = rowNumber;
        foundHeader = true;
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          const val = cell.value ? String(cell.value).trim() : '';
          // 移除星号和其他符号，标准化表头
          const cleanVal = val.replace(/\*/g, '').trim();
          if (cleanVal) headers[cleanVal] = colNumber;
        });
      }
    });

    if (!foundHeader) {
      // 兜底：假设第一行是表头
      const firstRow = worksheet.getRow(1);
      firstRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        const val = cell.value ? String(cell.value).trim() : '';
        const cleanVal = val.replace(/\*/g, '').trim();
        if (cleanVal) headers[cleanVal] = colNumber;
      });
    }

    // 2. 读取数据
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber <= headerRowIndex) return;

      const getVal = (name: string) => {
        const colIndex = headers[name];
        if (!colIndex) return '';
        
        const cell = row.getCell(colIndex);
        let val = cell.value;
        
        // 处理对象类型（如超链接、公式）
        if (val && typeof val === 'object') {
           if ('text' in val) val = (val as any).text;
           else if ('result' in val) val = (val as any).result;
        }
        return val ? String(val).trim() : '';
      };

      const supplier: Supplier = {
        supplierName: getVal('供应商名称'),
        supplierId: getVal('供应商编码'),
        type: getVal('供应商类型'),
        contact: getVal('联系人'),
        phone: getVal('联系电话'),
        address: getVal('地址'),
        status: getVal('供应商状态'),
        minOrder: getVal('最小起订值'),
        settlementType: getVal('结算方式'),
      };

      // 只有当有 ID 或 名称 时才添加
      if (supplier.supplierId || supplier.supplierName) {
        suppliers.push(supplier);
      }
    });

    return suppliers;
  }
}
