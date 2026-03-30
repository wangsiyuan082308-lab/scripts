<script lang="ts" setup>
import { computed, ref } from 'vue';
import { Button, message, Popconfirm, Tag } from 'ant-design-vue';
import type { ProcurementTask } from '#/api/procurement-task';
import {
  addProcurementTask,
  deleteProcurementTask,
  getProcurementTaskList,
  updateProcurementTask,
} from '#/api/procurement-task';
import { getStoreList } from '#/api/store';
import { getSupplierList } from '#/api/supplier';

import SimpleTemplate from '#/components/base/SimpleTemplate/index.vue';
// @ts-expect-error no .vue type declaration
import BaseModelForm from '#/components/base/BaseModelForm/index.vue';

interface SupplierOption {
  label: string;
  value: string;
}

interface StoreOption {
  label: string;
  value: string;
}

type ProcurementFormModel = Partial<ProcurementTask> & {
  supplierIds?: string[];
  storeIds?: string[];
};

const PROCUREMENT_LIMIT = 500;

const searchFormItems = [
  {
    label: '\u5e73\u53f0',
    renderType: 'select',
    valueKey: 'platform',
    options: [
      { label: '\u7ff1\u8c61', value: 'Aoxiang' },
      { label: '\u5343\u725b\u82b1', value: 'Qianniuhua' },
    ],
  },
  {
    label: '\u72b6\u6001',
    renderType: 'select',
    valueKey: 'status',
    options: [
      { label: '\u5f85\u5904\u7406', value: 'Pending' },
      { label: '\u8fdb\u884c\u4e2d', value: 'InProgress' },
      { label: '\u5df2\u5b8c\u6210', value: 'Completed' },
      { label: '\u5931\u8d25', value: 'Failed' },
    ],
  },
  {
    renderType: 'suffixButton',
    options: [
      {
        renderType: 'search',
        label: '\u641c\u7d22',
        type: 'primary',
      },
      {
        renderType: 'reset',
        label: '\u91cd\u7f6e',
      },
    ],
  },
];

const columns = [
  { dataIndex: 'taskId', title: '\u4efb\u52a1ID', width: 180 },
  {
    dataIndex: 'platform',
    title: '\u5e73\u53f0',
    width: 120,
    render: (h: any, { row }: { row: ProcurementTask }) => {
      let color = 'default';
      let text: string = row.platform;

      if (row.platform === 'Aoxiang') {
        color = 'blue';
        text = '\u7ff1\u8c61';
      } else if (row.platform === 'Qianniuhua') {
        color = 'cyan';
        text = '\u5343\u725b\u82b1';
      }

      return h(Tag, { color }, () => text);
    },
  },
  { dataIndex: 'supplierName', title: '\u4f9b\u5e94\u5546', minWidth: 160 },
  {
    dataIndex: 'storeNames',
    title: '\u95e8\u5e97',
    minWidth: 220,
    customRender: ({ record }: { record: ProcurementTask }) =>
      Array.isArray(record.storeNames) && record.storeNames.length > 0
        ? record.storeNames.join('\u3001')
        : '-',
  },
  { dataIndex: 'maxItems', title: '\u6700\u5927\u91c7\u8d2d\u6570', width: 120 },
  {
    dataIndex: 'status',
    title: '\u72b6\u6001',
    width: 100,
    render: (h: any, { row }: { row: ProcurementTask }) => {
      let color = 'default';
      let text: string = row.status;

      switch (row.status) {
        case 'Pending':
          color = 'orange';
          text = '\u5f85\u5904\u7406';
          break;
        case 'InProgress':
          color = 'processing';
          text = '\u8fdb\u884c\u4e2d';
          break;
        case 'Completed':
          color = 'success';
          text = '\u5df2\u5b8c\u6210';
          break;
        case 'Failed':
          color = 'error';
          text = '\u5931\u8d25';
          break;
      }

      return h(Tag, { color }, () => text);
    },
  },
  {
    dataIndex: 'schedule',
    title: '\u8c03\u5ea6',
    width: 150,
    customRender: ({ record }: { record: ProcurementTask }) => {
      if (record.scheduleType === 'Instant') return '\u5373\u65f6\u6267\u884c';
      if (record.scheduleType === 'Weekly') return `\u6bcf\u5468 ${record.weekDay}`;
      return record.schedule || '-';
    },
  },
  { dataIndex: 'lastRunTime', title: '\u4e0a\u6b21\u8fd0\u884c\u65f6\u95f4', width: 180 },
  {
    title: '\u64cd\u4f5c',
    width: 150,
    fixed: 'right',
    render: (h: any, { row }: { row: ProcurementTask }) =>
      h('div', [
        h(
          Button,
          {
            type: 'link',
            onClick: () => handleExecute(row),
          },
          () => '\u6267\u884c',
        ),
        h(
          Popconfirm,
          {
            title: '\u786e\u8ba4\u5220\u9664\uff1f',
            onConfirm: () => handleDelete(row),
          },
          {
            default: () =>
              h(
                Button,
                {
                  type: 'link',
                  danger: true,
                },
                () => '\u5220\u9664',
              ),
          },
        ),
      ]),
  },
];

const headerOptions = [
  {
    label: '\u65b0\u5efa\u4efb\u52a1',
    renderType: 'button',
    type: 'primary',
    click: handleCreate,
  },
];

const showModal = ref(false);
const formModel = ref<ProcurementFormModel>({
  scheduleType: 'Instant',
  maxItems: PROCUREMENT_LIMIT,
});
const tableRef = ref();

const supplierOptions = ref<SupplierOption[]>([]);
const allStoreOptions = ref<StoreOption[]>([]);

const formItems = computed(() => {
  const platform = formModel.value.platform;
  const aoxiangKeywords = ['\u5b89\u5409', '\u6c5f\u5317', '\u957f\u5174'];

  let filteredStores: StoreOption[] = allStoreOptions.value;
  if (platform === 'Aoxiang') {
    filteredStores = allStoreOptions.value.filter((store) =>
      aoxiangKeywords.some((keyword) => store.label.includes(keyword)),
    );
  } else if (platform === 'Qianniuhua') {
    filteredStores = allStoreOptions.value.filter(
      (store) => !aoxiangKeywords.some((keyword) => store.label.includes(keyword)),
    );
  }

  return [
    {
      label: '\u5e73\u53f0',
      renderType: 'select',
      valueKey: 'platform',
      options: [
        { label: '\u7ff1\u8c61', value: 'Aoxiang' },
        { label: '\u5343\u725b\u82b1', value: 'Qianniuhua' },
      ],
      rules: [{ required: true, message: '\u8bf7\u9009\u62e9\u5e73\u53f0' }],
    },
    {
      label: '\u95e8\u5e97',
      renderType: 'select',
      valueKey: 'storeIds',
      options: filteredStores,
      mode: 'multiple',
      rules: [{ required: true, message: '\u8bf7\u9009\u62e9\u95e8\u5e97' }],
    },
    {
      label: '\u4f9b\u5e94\u5546',
      renderType: 'select',
      valueKey: 'supplierIds',
      options: supplierOptions.value,
      mode: 'multiple',
      showSearch: true,
      optionFilterProp: 'label',
      rules: [{ required: true, message: '\u8bf7\u9009\u62e9\u4f9b\u5e94\u5546' }],
    },
    {
      label: '\u8c03\u5ea6\u7c7b\u578b',
      renderType: 'radioGroup',
      valueKey: 'scheduleType',
      options: [
        { optionLabel: '\u5373\u65f6\u6267\u884c', optionValue: 'Instant' },
        { optionLabel: '\u6bcf\u5468\u5b9a\u65f6', optionValue: 'Weekly' },
      ],
      rules: [{ required: true, message: '\u8bf7\u9009\u62e9\u8c03\u5ea6\u7c7b\u578b' }],
    },
    {
      label: '\u6267\u884c\u65f6\u95f4',
      renderType: 'select',
      valueKey: 'weekDay',
      options: [
        { label: '\u5468\u4e00', value: 'Mon' },
        { label: '\u5468\u4e8c', value: 'Tue' },
        { label: '\u5468\u4e09', value: 'Wed' },
        { label: '\u5468\u56db', value: 'Thu' },
        { label: '\u5468\u4e94', value: 'Fri' },
        { label: '\u5468\u516d', value: 'Sat' },
        { label: '\u5468\u65e5', value: 'Sun' },
      ],
      show: formModel.value.scheduleType === 'Weekly',
      rules: [{ required: true, message: '\u8bf7\u9009\u62e9\u6267\u884c\u65f6\u95f4' }],
    },
  ];
});

const serveMethods = async (params: any) => {
  const data = await getProcurementTaskList(params);
  return {
    list: data,
    total: data.length,
    totalPages: 1,
  };
};

async function handleCreate() {
  formModel.value = {
    scheduleType: 'Instant',
    maxItems: PROCUREMENT_LIMIT,
  };

  try {
    const [supplierRes, storeRes] = await Promise.all([
      getSupplierList({ page: 1, pageSize: 100 }),
      getStoreList({ page: 1, pageSize: 100 }),
    ]);

    const supplierItems = Array.isArray(supplierRes)
      ? supplierRes
      : (supplierRes as any)?.items || [];
    supplierOptions.value = supplierItems.map((item: any) => ({
      label: item.supplierName,
      value: item.supplierId,
    }));

    const storeItems = Array.isArray(storeRes)
      ? storeRes
      : (storeRes as any)?.items || [];
    allStoreOptions.value = storeItems.map((item: any) => ({
      label: item.storeName,
      value: item.storeId,
    }));

    showModal.value = true;
  } catch (error) {
    console.error(error);
    message.error('\u83b7\u53d6\u5217\u8868\u5931\u8d25');
  }
}

async function handleDelete(row: ProcurementTask) {
  try {
    await deleteProcurementTask(row.id || row.taskId);
    message.success('\u5220\u9664\u6210\u529f');
    tableRef.value?.search();
  } catch {
    message.error('\u5220\u9664\u5931\u8d25');
  }
}

async function handleExecute(row: ProcurementTask) {
  try {
    message.loading({
      content: '\u6b63\u5728\u6267\u884c\u4efb\u52a1...',
      key: 'executeTask',
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (window as any).ipcRenderer.invoke(
      'execute-procurement-task',
      structuredClone(row),
    );

    if (result.success) {
      message.success({
        content: '\u4efb\u52a1\u6267\u884c\u6210\u529f',
        key: 'executeTask',
      });
      await updateProcurementTask({
        ...row,
        status: 'Completed',
        lastRunTime: new Date().toLocaleString(),
      });
    } else {
      message.error({
        content: `\u4efb\u52a1\u6267\u884c\u5931\u8d25: ${result.message}`,
        key: 'executeTask',
      });
      await updateProcurementTask({
        ...row,
        status: 'Failed',
        lastRunTime: new Date().toLocaleString(),
      });
    }

    tableRef.value?.search();
  } catch (error: any) {
    console.error(error);
    message.error({
      content: `\u6267\u884c\u51fa\u9519: ${error.message}`,
      key: 'executeTask',
    });
  }
}

function buildTaskId(index: number) {
  return `procurement_${Date.now()}_${index + 1}`;
}

const handleSubmit = async (model: ProcurementFormModel) => {
  try {
    const supplierIds = Array.isArray(model.supplierIds)
      ? model.supplierIds.filter(Boolean)
      : [];
    const storeIds = Array.isArray(model.storeIds) ? model.storeIds.filter(Boolean) : [];

    if (!model.platform) {
      message.error('\u8bf7\u9009\u62e9\u5e73\u53f0');
      return false;
    }

    if (supplierIds.length === 0) {
      message.error('\u8bf7\u9009\u62e9\u4f9b\u5e94\u5546');
      return false;
    }

    if (storeIds.length === 0) {
      message.error('\u8bf7\u9009\u62e9\u95e8\u5e97');
      return false;
    }

    const selectedSuppliers = supplierOptions.value.filter((option) =>
      supplierIds.includes(option.value),
    );
    const selectedStores = allStoreOptions.value.filter((option) =>
      storeIds.includes(option.value),
    );

    if (selectedSuppliers.length === 0) {
      message.error('\u672a\u627e\u5230\u6709\u6548\u4f9b\u5e94\u5546');
      return false;
    }

    if (selectedStores.length === 0) {
      message.error('\u672a\u627e\u5230\u6709\u6548\u95e8\u5e97');
      return false;
    }

    const schedule =
      model.scheduleType === 'Instant'
        ? 'Instant'
        : `Weekly ${model.weekDay}`;
    const storeNames = selectedStores.map((store) => store.label);

    const tasks: ProcurementTask[] = selectedSuppliers.map((supplier, index) => {
      const taskId = buildTaskId(index);
      return {
        id: taskId,
        taskId,
        platform: model.platform!,
        supplierId: supplier.value,
        supplierIds: [supplier.value],
        supplierName: supplier.label,
        status: 'Pending',
        scheduleType: model.scheduleType || 'Instant',
        schedule,
        weekDay: model.weekDay,
        storeIds,
        storeNames,
        maxItems: PROCUREMENT_LIMIT,
      };
    });

    await Promise.all(tasks.map((task) => addProcurementTask(task)));

    message.success(
      `\u521b\u5efa\u6210\u529f\uff0c\u5df2\u751f\u6210 ${tasks.length} \u6761\u91c7\u8d2d\u4efb\u52a1`,
    );
    showModal.value = false;
    tableRef.value?.search();
    return true;
  } catch (error: any) {
    console.error(error);
    message.error(error.message || '\u521b\u5efa\u5931\u8d25');
    return false;
  }
};
</script>

<template>
  <SimpleTemplate
    ref="tableRef"
    row-key="id"
    :search-form-items="searchFormItems"
    :columns="columns"
    :serve-methods="serveMethods"
    :header-options="headerOptions"
    :show-page="false"
  />

  <BaseModelForm
    v-model:show="showModal"
    v-model:model="formModel"
    title="创建采购任务"
    :form-items="formItems"
    :submit="handleSubmit"
    width="600px"
  />
</template>
