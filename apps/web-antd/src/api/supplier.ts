import { requestClient } from '#/api/request';

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

type SupplierListResult = {
  items?: Supplier[];
  total?: number;
};

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
  const result = await requestClient.get<SupplierListResult>('/supplier/list', {
    params: {
      merchantId: `${query?.merchantId || ''}`.trim() || undefined,
      page: query?.page || 1,
      pageSize: query?.pageSize || 1000,
      supplierId: `${query?.supplierId || ''}`.trim(),
      supplierName: `${query?.supplierName || ''}`.trim(),
    },
  });

  return Array.isArray(result?.items) ? result.items : [];
}

export async function addSupplier(data: Supplier) {
  const supplier = normalizeSupplier(data);
  if (!supplier.supplierId) {
    throw new Error('供应商ID不能为空');
  }

  return requestClient.post('/supplier/list', supplier);
}

export async function updateSupplier(data: Supplier) {
  const supplier = normalizeSupplier(data);
  if (!supplier.supplierId) {
    throw new Error('供应商ID不能为空');
  }

  return requestClient.put('/supplier/list', supplier);
}

export async function deleteSupplier(id: string) {
  if (!`${id || ''}`.trim()) {
    throw new Error('供应商ID不能为空');
  }

  return requestClient.delete('/supplier/list', {
    params: { supplierId: id },
  });
}

export async function addSuppliers(data: Supplier[]) {
  const suppliers = data
    .map((item) => normalizeSupplier(item))
    .filter((item) => item.supplierId || item.supplierName);

  return requestClient.post('/supplier/list', suppliers);
}
