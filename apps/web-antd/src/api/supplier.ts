import { requestClient } from './request';

export interface Supplier {
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

function normalizeSupplier(data: Partial<Supplier>): Supplier {
  return {
    address: `${data.address || ''}`.trim(),
    contact: `${data.contact || ''}`.trim(),
    minOrder: `${data.minOrder || ''}`.trim(),
    phone: `${data.phone || ''}`.trim(),
    settlementType: `${data.settlementType || ''}`.trim(),
    status: `${data.status || ''}`.trim(),
    supplierId: `${data.supplierId || data.supplierName || ''}`.trim(),
    supplierName: `${data.supplierName || ''}`.trim(),
    type: `${data.type || ''}`.trim(),
  };
}

export async function getSupplierList(params: any) {
  const query = params?.data ?? params ?? {};
  const response = await requestClient.get<{ items: Supplier[]; total: number }>(
    '/supplier/list',
    {
      params: {
        page: 1,
        pageSize: 500,
        ...query,
      },
    },
  );
  return response.items || [];
}

export async function addSupplier(data: Supplier) {
  const supplier = normalizeSupplier(data);
  if (!supplier.supplierId) {
    throw new Error('供应商ID不能为空');
  }
  return requestClient.post<Supplier>('/supplier/list', supplier);
}

export async function updateSupplier(data: Supplier) {
  const supplier = normalizeSupplier(data);
  if (!supplier.supplierId) {
    throw new Error('供应商ID不能为空');
  }
  return requestClient.put<Supplier>('/supplier/list', supplier);
}

export async function deleteSupplier(id: string) {
  await requestClient.delete<boolean>('/supplier/list', {
    params: { supplierId: id },
  });
  return true;
}

export async function addSuppliers(data: Supplier[]) {
  const suppliers = data
    .map((item) => normalizeSupplier(item))
    .filter((item) => item.supplierId || item.supplierName);
  await requestClient.post<number>('/supplier/list', suppliers);
  return suppliers;
}
