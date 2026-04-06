import { ref } from 'vue';

import {
  getProcurementTags,
  getProcurementWorkbench,
  type ProcurementTag,
} from '#/api/procurement';
import { getStoreList } from '#/api/store';
import { getSupplierList } from '#/api/supplier';

export interface ProcurementBaseOption {
  label: string;
  value: string;
}

function mapWorkbenchTagToProcurementTag(tag: {
  color?: string;
  label: string;
  value: string;
}): ProcurementTag {
  return {
    color: tag.color || 'blue',
    createdAt: '',
    description: '',
    id: tag.value,
    status: 'active',
    tagCode: tag.value,
    tagName: tag.label,
    updatedAt: '',
  };
}

export function useProcurementBaseOptions() {
  const loading = ref(false);
  const stores = ref<ProcurementBaseOption[]>([]);
  const suppliers = ref<ProcurementBaseOption[]>([]);
  const tags = ref<ProcurementTag[]>([]);

  async function loadBaseOptions() {
    loading.value = true;
    try {
      const workbench = await getProcurementWorkbench();
      stores.value = workbench.stores || [];
      suppliers.value = workbench.suppliers || [];
      tags.value = (workbench.tags || []).map(mapWorkbenchTagToProcurementTag);
      return { source: 'workbench' as const };
    } catch {
      const [supplierRes, storeRes, tagRes] = await Promise.allSettled([
        getSupplierList({}),
        getStoreList({}),
        getProcurementTags(),
      ]);

      suppliers.value =
        supplierRes.status === 'fulfilled'
          ? (supplierRes.value || []).map((item: any) => ({
              label: item.supplierName,
              value: item.supplierId,
            }))
          : [];
      stores.value =
        storeRes.status === 'fulfilled'
          ? (storeRes.value || []).map((item: any) => ({
              label: item.storeName,
              value: item.storeId,
            }))
          : [];
      tags.value = tagRes.status === 'fulfilled' ? tagRes.value || [] : [];

      return { source: 'fallback' as const };
    } finally {
      loading.value = false;
    }
  }

  return {
    loading,
    loadBaseOptions,
    stores,
    suppliers,
    tags,
  };
}
