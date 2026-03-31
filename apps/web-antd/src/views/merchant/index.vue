<script lang="ts" setup>
import type { Merchant } from '#/api/merchant';

import { computed, ref } from 'vue';

import { useUserStore } from '@vben/stores';

import { Button, message, Popconfirm } from 'ant-design-vue';

import {
  addMerchant,
  deleteMerchant,
  getMerchantList,
  updateMerchant,
} from '#/api/merchant';
// @ts-expect-error no .vue type declaration
import BaseModelForm from '#/components/base/BaseModelForm/index.vue';
import SimpleTemplate from '#/components/base/SimpleTemplate/index.vue';

const userStore = useUserStore();
const isAdmin = computed(() => {
  const userInfo = (userStore.userInfo || {}) as Record<string, any>;
  const roleList = Array.isArray(userInfo.roles)
    ? userInfo.roles
    : userInfo.role
      ? [userInfo.role]
      : [];

  const normalizedRoles = roleList
    .map((role) => String(role).toLowerCase())
    .filter(Boolean);

  return (
    String(userInfo.username || '').toLowerCase() === 'admin' ||
    normalizedRoles.includes('super_admin') ||
    normalizedRoles.includes('admin')
  );
});

// 搜索配置
const searchFormItems = [
  {
    label: '商户名称',
    child: {
      renderType: 'input',
      valueKey: 'name',
    },
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
const columns = computed(() => [
  { dataIndex: 'id', title: '商户ID', width: 100 },
  { dataIndex: 'name', title: '商户名称', minWidth: 150 },
  { dataIndex: 'contact', title: '联系人', width: 100 },
  { dataIndex: 'phone', title: '电话', width: 120 },
  { dataIndex: 'address', title: '地址', minWidth: 150 },
  {
    title: '操作',
    width: 150,
    fixed: 'right',
    show: isAdmin.value, // 控制列显示
    render: (h: any, { row }: { row: Merchant }) => {
      // 只有管理员可以编辑和删除
      if (!isAdmin.value) return null;
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
]);

// 头部操作按钮
const headerOptions = computed(() => {
  if (!isAdmin.value) return [];
  return [
    {
      label: '添加商户',
      renderType: 'button',
      type: 'primary',
      click: handleAdd,
    },
  ];
});

// 状态管理
const showModal = ref(false);
const isUpdate = ref(false);
const currentId = ref<string>('');
const formModel = ref<Partial<Merchant>>({});
const tableRef = ref();

// 表单配置
const formItems = [
  {
    label: '商户名称',
    child: {
      renderType: 'input',
      valueKey: 'name',
    },
    rules: [{ required: true, message: '请输入商户名称' }],
  },
  // ID 隐藏，但在提交时需要
  {
    label: '商户ID',
    child: {
      renderType: 'input',
      valueKey: 'id',
    },
    show: false,
  },
  {
    label: '联系人',
    child: {
      renderType: 'input',
      valueKey: 'contact',
    },
  },
  {
    label: '电话',
    child: {
      renderType: 'input',
      valueKey: 'phone',
    },
  },
  {
    label: '地址',
    child: {
      renderType: 'input',
      valueKey: 'address',
    },
  },
];

// 数据请求
const serveMethods = async (params: any) => {
  const data = await getMerchantList(params);
  // SimpleTemplate 默认期望返回结构，或者通过 afterResponse 处理
  // 这里直接返回 { list, total } 格式
  return {
    list: data,
    total: data.length,
    totalPages: 1, // 本地存储暂无分页
  };
};

// 操作处理
function handleAdd() {
  isUpdate.value = false;
  currentId.value = '';
  // 自动生成 ID
  const generatedId = `M${Date.now().toString(36).toUpperCase()}${Math.floor(
    Math.random() * 1000,
  )
    .toString()
    .padStart(3, '0')}`;

  formModel.value = {
    id: generatedId,
    name: '',
    contact: '',
    phone: '',
    address: '',
  };
  showModal.value = true;
}

function handleEdit(row: Merchant) {
  isUpdate.value = true;
  currentId.value = row.id;
  formModel.value = { ...row };
  showModal.value = true;
}

async function handleDelete(row: Merchant) {
  try {
    await deleteMerchant(row.id);
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
      await updateMerchant({ ...model, id: currentId.value } as Merchant);
      message.success('更新成功');
    } else {
      await addMerchant(model as Merchant);
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
  <div class="merchant-page">
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
      :title="isUpdate ? '编辑商户' : '添加商户'"
      :form-items="formItems"
      v-model:model="formModel"
      :submit="handleSubmit"
      width="600px"
    />
  </div>
</template>
