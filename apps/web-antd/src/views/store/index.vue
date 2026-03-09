<script lang="tsx" setup>
import type { Store } from '#/api/store';
import {
  addStore,
  addStores,
  deleteStore,
  getStoreList,
  updateStore,
} from '#/api/store';
import { parseStoreImportExcel } from '#/api/system-settings-import';
import { Button, message, Popconfirm, Upload } from 'ant-design-vue';
import { h, ref } from 'vue';

import BaseModelForm from '#/components/base/BaseModelForm/index.vue';
import SimpleTemplate from '#/components/base/SimpleTemplate/index.vue';

// 搜索配置
const searchFormItems = [
  {
    label: '门店名称',
    child:{
      valueKey: 'storeName',
      renderType:'input'
    }
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
  { dataIndex: 'storeId', title: '门店ID', width: 100 },
  { dataIndex: 'storeName', title: '门店名称', minWidth: 150 },
  { dataIndex: 'platform', title: '平台', width: 120 },
  { dataIndex: 'contact', title: '联系人', width: 100 },
  { dataIndex: 'address', title: '地址', minWidth: 150 },
  {
    title: '操作',
    width: 150,
    render: (_h: any, ctx: { record?: Store; row?: Store }) => {
      const row = ctx?.row || ctx?.record;
      if (!row) return null;
      return (
        <div>
          <Button type="link" onClick={() => handleEdit(row)}>编辑</Button>
          <Popconfirm title="确认删除?" onConfirm={() => handleDelete(row)}>
            <Button type="link" danger>删除</Button>
          </Popconfirm>
        </div>
      )
    },
  },
];

const handleUpload = async (file: File) => {
  try {
    const stores = await parseStoreImportExcel(await file.arrayBuffer());
    if (!Array.isArray(stores) || stores.length === 0) {
      message.warning('未解析到数据或数据为空');
      return false;
    }

    await addStores(stores);
    message.success(`导入成功，共 ${stores.length} 条`);
    tableRef.value?.search();
  } catch (error) {
    console.error(error);
    message.error((error as Error)?.message || '导入失败');
  }
  return false;
};

// 头部操作按钮
const headerOptions = [
  {
    label: '添加门店',
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
    label: '门店ID',
    show:isUpdate.value,
    child:{
      valueKey: 'storeId',
      renderType:'input',
    },
  },
  {
    label: '门店名称',
    child:{
      valueKey: 'storeName',
      renderType:'input'
    }
  },
  {
    label: '平台',
    child:{
      valueKey: 'platform',
      renderType:'select',
      options: [
        { label: '翱象', value: '翱象' },
        { label: '牵牛花', value: '牵牛花' },
      ],
    },
  },
  {
    label: '区域',
    child:{
      valueKey: 'region',
      renderType:'input'
    }
  },
  {
    label: '地址',
    child:{
      valueKey: 'address',
      renderType:'input'
    }
  },
  {
    label: '联系人',
    child:{
      valueKey: 'contact',
      renderType:'input'
    }
  },
  {
    label: '电话',
    child:{
      valueKey: 'phone',
      renderType:'input'
    }
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
  // 启用门店ID输入
  showModal.value = true;
}

function handleEdit(row: Store) {
  isUpdate.value = true;
  currentId.value = row.storeId;
  formModel.value = { ...row };
  // 禁用门店ID输入
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
      await updateStore({
        ...model,
        id: currentId.value,
        storeId: model.storeId || currentId.value,
      } as Store);
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
    :title="isUpdate ? '编辑门店' : '添加门店'"
    :form-items="formItems"
    v-model:model="formModel"
    :submit="handleSubmit"
    width="600px"
  />
</template>
