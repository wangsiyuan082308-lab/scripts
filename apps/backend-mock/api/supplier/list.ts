import { defineEventHandler, getQuery, readBody } from 'h3';

interface Supplier {
  supplierId: string;
  supplierName: string;
  contact: string;
  phone: string;
  address: string;
  type?: string;
  status?: string;
  minOrder?: string;
  settlementType?: string;
}

let suppliers: Supplier[] = [
  {
    supplierId: '1',
    supplierName: 'Supplier A',
    contact: 'John Doe',
    phone: '1234567890',
    address: '123 Main St',
    type: '普通供应商',
    status: '开启',
    minOrder: '100',
    settlementType: '月结',
  },
  {
    supplierId: '2',
    supplierName: 'Supplier B',
    contact: 'Jane Smith',
    phone: '0987654321',
    address: '456 Elm St',
    type: '普通供应商',
    status: '关闭',
    minOrder: '0',
    settlementType: '现结',
  },
];

export default defineEventHandler(async (event) => {
  const method = event.method;

  if (method === 'GET') {
    const query = getQuery(event);
    const { page = 1, pageSize = 10, supplierName, supplierId } = query;
    
    let filtered = suppliers;
    if (supplierName) {
      filtered = filtered.filter((s) => s.supplierName.includes(supplierName as string));
    }
    if (supplierId) {
      filtered = filtered.filter((s) => s.supplierId.includes(supplierId as string));
    }

    const start = (Number(page) - 1) * Number(pageSize);
    const end = start + Number(pageSize);
    const list = filtered.slice(start, end);

    return {
      code: 0,
      data: {
        items: list,
        total: filtered.length,
      },
      message: 'success',
    };
  }

  if (method === 'POST') {
    const body = await readBody(event);
    // If it's an import (array of suppliers)
    if (Array.isArray(body)) {
      const newSuppliers = body.map((s: any) => ({
        ...s,
        supplierId: s.supplierId || String(Date.now() + Math.random()),
      }));
      suppliers = [...suppliers, ...newSuppliers];
      return { code: 0, data: newSuppliers.length, message: 'Import success' };
    } 
    // Single add
    else {
      const newSupplier = {
        ...body,
        supplierId: body.supplierId || String(Date.now()),
      };
      suppliers.push(newSupplier);
      return { code: 0, data: newSupplier, message: 'Add success' };
    }
  }

  if (method === 'DELETE') {
    const query = getQuery(event);
    const supplierId = query.supplierId as string;
    suppliers = suppliers.filter((s) => s.supplierId !== supplierId);
    return { code: 0, data: null, message: 'Delete success' };
  }
});
