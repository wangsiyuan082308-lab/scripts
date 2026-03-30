import {
  listSuppliers,
  removeSupplier,
  saveSupplier,
  saveSuppliers,
} from './system-settings-repo';

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

function includesIgnoreCase(value: string, keyword: string) {
  return value.toLowerCase().includes(keyword.toLowerCase());
}

export async function getSupplierList(params: any) {
  const suppliers = await listSuppliers();
  const query = params?.data ?? params ?? {};
  const supplierName = `${query?.supplierName || ''}`.trim();
  const supplierId = `${query?.supplierId || ''}`.trim();

  return suppliers.filter((item) => {
    const matchName = !supplierName || includesIgnoreCase(item.supplierName || '', supplierName);
    const matchId = !supplierId || includesIgnoreCase(item.supplierId || '', supplierId);
    return matchName && matchId;
  });
}

export async function addSupplier(data: Supplier) {
  const supplier = normalizeSupplier(data);
  if (!supplier.supplierId) {
    throw new Error('供应商ID不能为空');
  }

  return saveSupplier(supplier);
}

export async function updateSupplier(data: Supplier) {
  const supplier = normalizeSupplier(data);
  if (!supplier.supplierId) {
    throw new Error('供应商ID不能为空');
  }
  const existing = (await listSuppliers()).find((item) => item.supplierId === supplier.supplierId);
  return saveSupplier({ ...(existing || {}), ...supplier });
}

export async function deleteSupplier(id: string) {
  await removeSupplier(id);
  return listSuppliers();
}

export async function addSuppliers(data: Supplier[]) {
  const suppliers = data
    .map((item) => normalizeSupplier(item))
    .filter((item) => item.supplierId || item.supplierName);
  await saveSuppliers(suppliers);
  return suppliers;
}
