<script lang="ts" setup>
import { computed, h, ref } from 'vue';
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
import BaseModelForm from '#/components/base/BaseModelForm/index.vue';

interface SupplierOption {
  label: string;
  value: string;
}

interface StoreOption {
  label: string;
  value: string;
}

// 搜索配置
const searchFormItems = [
  {
    label: '平台',
    renderType: 'select',
    valueKey: 'platform',
    options: [
      { label: '翱象', value: 'Aoxiang' },
      { label: '牵牛花', value: 'Qianniuhua' },
    ],
  },
  {
    label: '状态',
    renderType: 'select',
    valueKey: 'status',
    options: [
      { label: '待处理', value: 'Pending' },
      { label: '进行中', value: 'InProgress' },
      { label: '已完成', value: 'Completed' },
      { label: '失败', value: 'Failed' },
    ],
  },
  {
    renderType: 'suffixButton',
    options: [
      {
        renderType: 'search',
        label: '搜索',
        type: 'primary',
      },
      {
        renderType: 'reset',
        label: '重置',
      },
    ],
  },
];

// 表格列配置
const columns = [
  { dataIndex: 'taskId', title: '任务ID', width: 100 },
  {
    dataIndex: 'platform',
    title: '平台',
    width: 120,
    render: (h: any, { row }: { row: ProcurementTask }) => {
      let color = 'default';
      let text: string = row.platform;
      if (row.platform === 'Aoxiang') {
        color = 'blue';
        text = '翱象';
      } else if (row.platform === 'Qianniuhua') {
        color = 'cyan';
        text = '牵牛花';
      }
      return h(Tag, { color }, () => text);
    },
  },
  { dataIndex: 'supplierName', title: '供应商', minWidth: 150 },
  {
    dataIndex: 'status',
    title: '状态',
    width: 100,
    render: (h: any, { row }: { row: ProcurementTask }) => {
      let color = 'default';
      let text: string = row.status;
      switch (row.status) {
        case 'Pending':
          color = 'orange';
          text = '待处理';
          break;
        case 'InProgress':
          color = 'processing';
          text = '进行中';
          break;
        case 'Completed':
          color = 'success';
          text = '已完成';
          break;
        case 'Failed':
          color = 'error';
          text = '失败';
          break;
      }
      return h(Tag, { color }, () => text);
    },
  },
  {
    dataIndex: 'schedule',
    title: '调度',
    width: 150,
    customRender: ({ record }: { record: ProcurementTask }) => {
      if (record.scheduleType === 'Instant') return '即时执行';
      if (record.scheduleType === 'Weekly') return `每周 ${record.weekDay}`;
      return record.schedule || '-';
    },
  },
  { dataIndex: 'lastRunTime', title: '上次运行时间', width: 180 },
  {
    title: '操作',
    width: 150,
    fixed: 'right',
    render: (h: any, { row }: { row: ProcurementTask }) => {
      return h('div', [
        h(
          Button,
          {
            type: 'link',
            onClick: () => handleExecute(row),
          },
          () => '执行',
        ),
        h(
          Popconfirm,
          {
            title: '确认删除?',
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
                () => '删除',
              ),
          },
        ),
      ]);
    },
  },
];

// 头部操作按钮
const headerOptions = [
  {
    label: '新建任务',
    renderType: 'button',
    type: 'primary',
    click: handleCreate,
  },
];

// 状态管理
const showModal = ref(false);
const formModel = ref<Partial<ProcurementTask>>({
  scheduleType: 'Instant',
});
const tableRef = ref();

const supplierOptions = ref<SupplierOption[]>([]);
const allStoreOptions = ref<StoreOption[]>([]);

// 表单配置 - 使用 computed 实现联动
const formItems = computed(() => {
  const platform = formModel.value.platform;
  const keywords = ['安吉', '江北', '长兴'];
  let filteredStores: StoreOption[] = [];

  if (platform === 'Aoxiang') {
    filteredStores = allStoreOptions.value.filter((store) =>
      keywords.some((k) => store.label.includes(k)),
    );
  } else if (platform === 'Qianniuhua') {
    filteredStores = allStoreOptions.value.filter(
      (store) => !keywords.some((k) => store.label.includes(k)),
    );
  } else {
    filteredStores = allStoreOptions.value;
  }

  return [
    {
      label: '平台',
      renderType: 'select',
      valueKey: 'platform',
      options: [
        { label: '翱象', value: 'Aoxiang' },
        { label: '牵牛花', value: 'Qianniuhua' },
      ],
      rules: [{ required: true, message: '请选择平台' }],
    },
    {
      label: '门店',
      renderType: 'select',
      valueKey: 'storeIds',
      options: filteredStores,
      mode: 'multiple', // select mode
      rules: [{ required: true, message: '请选择门店' }],
    },
    {
      label: '供应商',
      renderType: 'select',
      valueKey: 'supplierIds',
      options: supplierOptions.value,
      mode: 'multiple',
      showSearch: true,
      optionFilterProp: 'label',
      rules: [{ required: true, message: '请选择供应商' }],
    },
    {
      label: '调度类型',
      renderType: 'radioGroup',
      valueKey: 'scheduleType',
      options: [
        { optionLabel: '即时执行', optionValue: 'Instant' },
        { optionLabel: '每周定时', optionValue: 'Weekly' },
      ],
      rules: [{ required: true, message: '请选择调度类型' }],
    },
    {
      label: '执行时间',
      renderType: 'select',
      valueKey: 'weekDay',
      options: [
        { label: '周一', value: 'Mon' },
        { label: '周二', value: 'Tue' },
        { label: '周三', value: 'Wed' },
        { label: '周四', value: 'Thu' },
        { label: '周五', value: 'Fri' },
        { label: '周六', value: 'Sat' },
        { label: '周日', value: 'Sun' },
      ],
      show: formModel.value.scheduleType === 'Weekly', // 联动显示
      rules: [{ required: true, message: '请选择执行时间' }],
    },
  ];
});

// 数据请求
const serveMethods = async (params: any) => {
  const data = await getProcurementTaskList(params);
  return {
    list: data,
    total: data.length,
    totalPages: 1,
  };
};

// 操作处理
async function handleCreate() {
  formModel.value = {
    scheduleType: 'Instant',
  };

  // 获取选项数据
  try {
    const [supplierRes, storeRes] = await Promise.all([
      getSupplierList({ page: 1, pageSize: 100 }),
      getStoreList({ page: 1, pageSize: 100 }),
    ]);

    if (supplierRes) {
      const items = Array.isArray(supplierRes)
        ? supplierRes
        : (supplierRes as any).items || [];
      supplierOptions.value = items.map((item: any) => ({
        label: item.supplierName,
        value: item.supplierId,
      }));
    }

    if (storeRes) {
      const items = Array.isArray(storeRes)
        ? storeRes
        : (storeRes as any).items || [];
      allStoreOptions.value = items.map((item: any) => ({
        label: item.storeName,
        value: item.storeId,
      }));
    }
    showModal.value = true;
  } catch (error) {
    console.error(error);
    message.error('获取列表失败');
  }
}

async function handleDelete(row: ProcurementTask) {
  try {
    await deleteProcurementTask(row.taskId);
    message.success('删除成功');
    tableRef.value?.search();
  } catch {
    message.error('删除失败');
  }
}

async function handleExecute(row: ProcurementTask) {
  try {
    message.loading({ content: '正在执行任务...', key: 'executeTask' });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (window as any).ipcRenderer.invoke(
      'execute-procurement-task',
      structuredClone(row),
    );

    if (result.success) {
      message.success({ content: '任务执行成功', key: 'executeTask' });
      await updateProcurementTask({
        ...row,
        status: 'Completed',
        lastRunTime: new Date().toLocaleString(),
      });
    } else {
      message.error({
        content: `任务执行失败: ${result.message}`,
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
      content: `执行出错: ${error.message}`,
      key: 'executeTask',
    });
  }
}

// 表单提交
const handleSubmit = async (model: any) => {
  try {
    const supplierIds = Array.isArray(model.supplierIds)
      ? model.supplierIds
      : [model.supplierIds];
    const selectedSuppliers = supplierOptions.value.filter((opt) =>
      supplierIds.includes(opt.value),
    );

    const payload = {
      ...model,
      supplierIds,
      supplierName: selectedSuppliers.map((s) => s.label).join(', ') || '',
      schedule:
        model.scheduleType === 'Instant'
          ? 'Instant'
          : `Weekly ${model.weekDay}`,
      status: 'Pending',
    };

    await addProcurementTask(payload);
    message.success('创建成功');
    showModal.value = false;
    tableRef.value?.search();
    return true;
  } catch (error: any) {
    console.error(error);
    message.error(error.message || '创建失败');
    return false;
  }
};
</script>

<template>
  <SimpleTemplate
    ref="tableRef"
    row-key="taskId"
    :search-form-items="searchFormItems"
    :columns="columns"
    :serve-methods="serveMethods"
    :header-options="headerOptions"
    :show-page="false"
  />

  <BaseModelForm
    v-model:show="showModal"
    title="创建采购任务"
    :form-items="formItems"
    v-model:model="formModel"
    :submit="handleSubmit"
    width="600px"
  />
</template>
