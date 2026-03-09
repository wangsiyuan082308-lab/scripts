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

async function invokeIpc<T>(channel: string, ...args: any[]): Promise<T> {
  const result = await window.ipcRenderer.invoke(channel, ...args);
  if (result && typeof result === 'object' && 'code' in result && 'data' in result) {
    if (result.code === 0) {
      return result.data;
    }
    throw new Error(result.message || 'IPC Operation Failed');
  }
  return result;
}

export async function getSupplierList(params: any) {
  return invokeIpc<Supplier[]>('get-suppliers', params);
}

export async function addSupplier(data: Supplier) {
  return invokeIpc('add-supplier', data);
}

export async function updateSupplier(data: Supplier) {
  return invokeIpc('update-supplier', data);
}

export async function deleteSupplier(id: string) {
  return invokeIpc('delete-supplier', { supplierId: id });
}

// Batch add if needed.
export async function addSuppliers(data: Supplier[]) {
  // Assuming the backend accepts an array for batch add, similar to the previous implementation
  return Promise.all(data.map(item => invokeIpc('add-supplier', item)));
}
