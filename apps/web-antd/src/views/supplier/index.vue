<script lang="tsx" setup>
import type { Supplier } from '#/api/supplier';
import {
  addSupplier,
  addSuppliers,
  deleteSupplier,
  getSupplierList,
  updateSupplier,
} from '#/api/supplier';
import { parseSupplierImportExcel } from '#/api/system-settings-import';
import { Button, message, Popconfirm, Upload } from 'ant-design-vue';
import { h, ref } from 'vue';

// @ts-expect-error no .vue type declaration
import BaseModelForm from '#/components/base/BaseModelForm/index.vue';
import SimpleTemplate from '#/components/base/SimpleTemplate/index.vue';

// 搜索配置
const searchFormItems = [
  {
    label: '供应商名称',
    child:{
      valueKey: 'supplierName',
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
  { dataIndex: 'supplierId', title: '供应商ID', width: 100 },
  { dataIndex: 'supplierName', title: '供应商名称', minWidth: 150 },
  { dataIndex: 'type', title: '类型', width: 100 },
  { dataIndex: 'contact', title: '联系人', width: 100 },
  { dataIndex: 'phone', title: '电话', width: 120 },
  { dataIndex: 'minOrder', title: '起订值', width: 100 },
  { dataIndex: 'settlementType', title: '结算方式', width: 100 },
  { dataIndex: 'address', title: '地址', minWidth: 150 },
  { dataIndex: 'status', title: '状态', width: 80, render: (text: string) => text === '启用' ? '启用' : '禁用' },
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
    show:isUpdate.value,
    child:{
      valueKey: 'supplierId',
      renderType:'input'
    }
  },
  {
    label: '供应商名称',
    child:{
      valueKey: 'supplierName',
      renderType:'input'
    }
  },
  {
    label: '类型',
    child:{
      valueKey: 'type',
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

  {
    label: '起订值',
    child:{
      valueKey: 'minOrder',
      renderType:'input'
    }
  },
  {
    label: '结算方式',
    child:{
      valueKey: 'settlementType',
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
    label: '状态',
    child:{
      valueKey: 'status',
      renderType:'switch',
      checkedChildren: '启用',
      unCheckedChildren: '禁用',
      checkedValue: '启用',
      unCheckedValue: '禁用',
    }
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
  showModal.value = true;
}

function handleEdit(row: Supplier) {
  isUpdate.value = true;
  currentId.value = row.supplierId;
  formModel.value = { ...row };
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
  <div class="supplier-page">
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
  </div>
</template>
