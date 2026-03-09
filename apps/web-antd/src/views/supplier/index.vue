<script lang="ts" setup>
import { h, ref } from 'vue';
import { Button, message, Popconfirm, Upload } from 'ant-design-vue';
import type { Supplier } from '#/api/supplier';
import {
  addSupplier,
  addSuppliers,
  deleteSupplier,
  getSupplierList,
  updateSupplier,
} from '#/api/supplier';
import { parseSupplierImportExcel } from '#/api/system-settings-import';

import SimpleTemplate from '#/components/base/SimpleTemplate/index.vue';
import BaseModelForm from '#/components/base/BaseModelForm/index.vue';

// 搜索配置
const searchFormItems = [
  {
    label: '供应商名称',
    renderType: 'input',
    valueKey: 'supplierName',
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
  { dataIndex: 'supplierId', title: '供应商ID', width: 100 },
  { dataIndex: 'supplierName', title: '供应商名称', minWidth: 150 },
  { dataIndex: 'type', title: '类型', width: 100 },
  { dataIndex: 'contact', title: '联系人', width: 100 },
  { dataIndex: 'phone', title: '电话', width: 120 },
  { dataIndex: 'status', title: '状态', width: 80 },
  { dataIndex: 'minOrder', title: '起订值', width: 100 },
  { dataIndex: 'settlementType', title: '结算方式', width: 100 },
  { dataIndex: 'address', title: '地址', minWidth: 150 },
  {
    title: '操作',
    width: 150,
    fixed: 'right',
    render: (h: any, { row }: { row: Supplier }) => {
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
    const suppliers = await parseSupplierImportExcel(await file.arrayBuffer());
    if (!Array.isArray(suppliers) || suppliers.length === 0) {
      message.warning('未解析到数据或数据为空');
      return false;
    }

    await addSuppliers(suppliers);
    message.success(`导入成功，共 ${suppliers.length} 条`);
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
    label: '添加供应商',
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
const formModel = ref<Partial<Supplier>>({});
const tableRef = ref();

// 表单配置
const formItems = ref([
  {
    label: '供应商ID',
    renderType: 'input',
    valueKey: 'supplierId',
    rules: [{ required: true, message: '请输入供应商ID' }],
    disabled: false,
  },
  {
    label: '供应商名称',
    renderType: 'input',
    valueKey: 'supplierName',
    rules: [{ required: true, message: '请输入供应商名称' }],
  },
  {
    label: '类型',
    renderType: 'input',
    valueKey: 'type',
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
  {
    label: '状态',
    renderType: 'input',
    valueKey: 'status',
  },
  {
    label: '起订值',
    renderType: 'input',
    valueKey: 'minOrder',
  },
  {
    label: '结算方式',
    renderType: 'input',
    valueKey: 'settlementType',
  },
  {
    label: '地址',
    renderType: 'input',
    valueKey: 'address',
  },
]);

// 数据请求
const serveMethods = async (params: any) => {
  const data = await getSupplierList(params);
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
  // 启用供应商ID输入
  formItems.value[0].disabled = false;
  showModal.value = true;
}

function handleEdit(row: Supplier) {
  isUpdate.value = true;
  currentId.value = row.supplierId;
  formModel.value = { ...row };
  // 禁用供应商ID输入
  formItems.value[0].disabled = true;
  showModal.value = true;
}

async function handleDelete(row: Supplier) {
  try {
    await deleteSupplier(row.supplierId);
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
      await updateSupplier({ ...model, supplierId: currentId.value } as Supplier);
      message.success('更新成功');
    } else {
      await addSupplier(model as Supplier);
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
    row-key="supplierId"
    :search-form-items="searchFormItems"
    :columns="columns"
    :serve-methods="serveMethods"
    :header-options="headerOptions"
    :show-page="false"
  />

  <BaseModelForm
    v-model:show="showModal"
    :title="isUpdate ? '编辑供应商' : '添加供应商'"
    :form-items="formItems"
    v-model:model="formModel"
    :submit="handleSubmit"
    width="600px"
  />
</template>
