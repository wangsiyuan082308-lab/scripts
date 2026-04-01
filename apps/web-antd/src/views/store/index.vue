<script lang="tsx" setup>
import type { Merchant } from '#/api/merchant';
import type { Store } from '#/api/store';
import { getMerchantList } from '#/api/merchant';
import {
  addStore,
  addStores,
  deleteStore,
  getStoreList,
  updateStore,
} from '#/api/store';
import { parseStoreImportExcel } from '#/api/system-settings-import';
import { Button, message, Popconfirm, Upload } from 'ant-design-vue';
import { computed, h, onMounted, ref } from 'vue';

// @ts-expect-error no .vue type declaration
import BaseModelForm from '#/components/base/BaseModelForm/index.vue';
import SimpleTemplate from '#/components/base/SimpleTemplate/index.vue';

// 搜索配置
type MerchantOption = {
  label: string;
  value: string;
};

const merchantOptions = ref<MerchantOption[]>([]);

const searchFormItems = computed(() => [
  {
    label: '所属商户',
    child: {
      options: merchantOptions.value,
      renderType: 'select',
      valueKey: 'merchantId',
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
]);

// 表格列配置
const columns = [
  { dataIndex: 'merchantName', title: '所属商户', minWidth: 140 },
  { dataIndex: 'storeId', title: '门店ID', width: 100 },
  { dataIndex: 'storeName', title: '门店名称', minWidth: 150 },
  {
    dataIndex: 'platform',
    title: '平台',
    width: 120,
    render: (_h: any, ctx: { text?: string }) =>
      ctx?.text === 'Qianniuhua' ? '牵牛花' : ctx?.text === 'Aoxiang' ? '翱象' : (ctx?.text || '-'),
  },
  { dataIndex: 'contact', title: '联系人', width: 100 },
  { dataIndex: 'phone', title: '联系电话', width: 140 },
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
const currentMerchantId = ref<string>('');
const formModel = ref<Partial<Store>>({});
const tableRef = ref();

// 表单配置
const formItems = computed(() => [
  {
    label: '所属商户',
    child: {
      options: merchantOptions.value,
      renderType: 'select',
      valueKey: 'merchantId',
    },
    rules: [{ required: true, message: '请选择所属商户' }],
  },
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
        { label: '翱象', value: 'Aoxiang' },
        { label: '牵牛花', value: 'Qianniuhua' },
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

async function loadMerchants() {
  try {
    const merchants = await getMerchantList({ page: 1, pageSize: 500 });
    merchantOptions.value = (merchants || []).map((item: Merchant) => ({
      label: item.name,
      value: item.id,
    }));
  } catch (error) {
    console.error(error);
    message.error('加载商户列表失败');
  }
}

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
async function handleAdd() {
  await loadMerchants();
  isUpdate.value = false;
  currentId.value = '';
  currentMerchantId.value = '';
  formModel.value = {};
  // 启用门店ID输入
  showModal.value = true;
}

async function handleEdit(row: Store) {
  await loadMerchants();
  isUpdate.value = true;
  currentId.value = row.storeId;
  currentMerchantId.value = row.merchantId || '';
  formModel.value = { ...row };
  // 禁用门店ID输入
  showModal.value = true;
}

async function handleDelete(row: Store) {
  try {
    await deleteStore(row.storeId, row.merchantId);
    message.success('删除成功');
    tableRef.value?.search();
  } catch (error: any) {
    if (!error?.response) {
      message.error(error?.message || '删除失败');
    }
  }
}

// 表单提交
const handleSubmit = async (model: any) => {
  try {
    if (isUpdate.value) {
      await updateStore({
        ...model,
        merchantId: model.merchantId || currentMerchantId.value,
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
    if (!error?.response) {
      message.error(error?.message || (isUpdate.value ? '更新失败' : '添加失败'));
    }
    return false;
  }
};

onMounted(() => {
  loadMerchants();
});
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
    :title="isUpdate ? '编辑门店' : '添加门店'"
    :form-items="formItems"
    v-model:model="formModel"
    :submit="handleSubmit"
    width="600px"
  />
</template>
