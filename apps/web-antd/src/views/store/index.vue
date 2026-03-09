<script lang="ts" setup>
import { h, ref } from 'vue';
import { Button, message, Popconfirm, Upload } from 'ant-design-vue';
import type { Store } from '#/api/store';
import {
  addStore,
  addStores,
  deleteStore,
  getStoreList,
  updateStore,
} from '#/api/store';

import SimpleTemplate from '#/components/base/SimpleTemplate/index.vue';
import BaseModelForm from '#/components/base/BaseModelForm/index.vue';

// 搜索配置
const searchFormItems = [
  {
    label: '店铺名称',
    renderType: 'input',
    valueKey: 'storeName',
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
  { dataIndex: 'storeId', title: '店铺ID', width: 100 },
  { dataIndex: 'storeName', title: '店铺名称', minWidth: 150 },
  { dataIndex: 'platform', title: '平台', width: 120 },
  { dataIndex: 'contact', title: '联系人', width: 100 },
  { dataIndex: 'address', title: '地址', minWidth: 150 },
  {
    title: '操作',
    width: 150,
    fixed: 'right',
    render: (h: any, { row }: { row: Store }) => {
      return h('div', [
        h(
          Button,
          {
            type: 'link',
            onClick: () => handleEdit(row),
          },
          () => '编辑',
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

const handleUpload = async (file: File) => {
  try {
    const buffer = await file.arrayBuffer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (window as any).ipcRenderer.invoke('import-stores', {
      fileBuffer: buffer,
    });

    if (
      !response ||
      !response.success ||
      !Array.isArray(response.data) ||
      response.data.length === 0
    ) {
      message.warning(response?.message || '未解析到数据或数据为空');
      return false;
    }

    await addStores(response.data);
    message.success('导入成功');
    tableRef.value?.search();
  } catch (error) {
    console.error(error);
    message.error('导入失败');
  }
  return false;
};

// 头部操作按钮
const headerOptions = [
  {
    label: '添加店铺',
    renderType: 'button',
    type: 'primary',
    click: handleAdd,
  },
  {
    label: '导入 Excel',
    renderType: 'render',
    render: () =>
      h(
        Upload,
        {
          beforeUpload: handleUpload,
          showUploadList: false,
          accept: '.xlsx',
        },
        {
          default: () =>
            h(
              Button,
              {
                type: 'primary',
                style: { marginLeft: '10px' },
              },
              () => '导入 Excel',
            ),
        },
      ),
  },
];

// 状态管理
const showModal = ref(false);
const isUpdate = ref(false);
const currentId = ref<string>('');
const formModel = ref<Partial<Store>>({});
const tableRef = ref();

// 表单配置
const formItems = ref([
  {
    label: '店铺ID',
    renderType: 'input',
    valueKey: 'storeId',
    rules: [{ required: true, message: '请输入店铺ID' }],
    disabled: false,
  },
  {
    label: '店铺名称',
    renderType: 'input',
    valueKey: 'storeName',
    rules: [{ required: true, message: '请输入店铺名称' }],
  },
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
    label: '区域',
    renderType: 'input',
    valueKey: 'region',
  },
  {
    label: '地址',
    renderType: 'input',
    valueKey: 'address',
  },
  {
    label: '联系人',
    renderType: 'input',
    valueKey: 'contact',
  },
  {
    label: '电话',
    renderType: 'input',
    valueKey: 'phone',
  },
]);

// 数据请求
const serveMethods = async (params: any) => {
  const data = await getStoreList(params);
  return {
    list: data,
    total: data.length,
    totalPages: 1,
  };
};

// 操作处理
function handleAdd() {
  isUpdate.value = false;
  currentId.value = '';
  formModel.value = {};
  // 启用店铺ID输入
  formItems.value[0].disabled = false;
  showModal.value = true;
}

function handleEdit(row: Store) {
  isUpdate.value = true;
  currentId.value = row.id || row.storeId;
  formModel.value = { ...row };
  // 禁用店铺ID输入
  formItems.value[0].disabled = true;
  showModal.value = true;
}

async function handleDelete(row: Store) {
  try {
    await deleteStore(row.storeId);
    message.success('删除成功');
    tableRef.value?.search();
  } catch {
    message.error('删除失败');
  }
}

// 表单提交
const handleSubmit = async (model: any) => {
  try {
    if (isUpdate.value) {
      await updateStore({ ...model, id: currentId.value } as Store);
      message.success('更新成功');
    } else {
      await addStore(model as Store);
      message.success('添加成功');
    }
    showModal.value = false;
    tableRef.value?.search();
    return true;
  } catch (error: any) {
    console.error(error);
    message.error(error.message || (isUpdate.value ? '更新失败' : '添加失败'));
    return false;
  }
};
</script>

<template>
  <SimpleTemplate
    ref="tableRef"
    row-key="storeId"
    :search-form-items="searchFormItems"
    :columns="columns"
    :serve-methods="serveMethods"
    :header-options="headerOptions"
    :show-page="false"
  />

  <BaseModelForm
    v-model:show="showModal"
    :title="isUpdate ? '编辑店铺' : '添加店铺'"
    :form-items="formItems"
    v-model:model="formModel"
    :submit="handleSubmit"
    width="600px"
  />
</template>
