<script lang="ts" setup>
import type { Merchant } from '#/api/merchant';

import { computed, h, ref } from 'vue';

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
const tableRef = ref();
const showModal = ref(false);
const isUpdate = ref(false);
const currentId = ref('');
const formModel = ref<Partial<Merchant>>({});

const isAdmin = computed(() => {
  const userInfo = (userStore.userInfo || {}) as Record<string, any>;
  let roleList: unknown[] = [];
  if (Array.isArray(userInfo.roles)) {
    roleList = userInfo.roles;
  } else if (userInfo.role) {
    roleList = [userInfo.role];
  }

  const normalizedRoles = new Set(
    roleList.map((role) => String(role).toLowerCase()).filter(Boolean),
  );

  return (
    String(userInfo.username || '').toLowerCase() === 'admin' ||
    normalizedRoles.has('super_admin') ||
    normalizedRoles.has('admin')
  );
});

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
        label: '搜索',
        renderType: 'search',
        type: 'primary',
      },
      {
        label: '重置',
        renderType: 'reset',
      },
    ],
  },
];

const columns = computed(() => [
  { dataIndex: 'id', title: '商户ID', width: 140 },
  { dataIndex: 'name', title: '商户名称', minWidth: 180 },
  { dataIndex: 'contact', title: '联系人', width: 120 },
  { dataIndex: 'phone', title: '电话', width: 140 },
  { dataIndex: 'address', title: '地址', minWidth: 220 },
  {
    title: '操作',
    width: 150,
    fixed: 'right',
    show: isAdmin.value,
    render: (_value: unknown, ctx: { record?: Merchant; row?: Merchant }) => {
      const row = ctx?.row || ctx?.record;
      if (!isAdmin.value || !row) {
        return null;
      }

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
            title: '确认删除该商户？',
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

const headerOptions = computed(() => {
  if (!isAdmin.value) {
    return [];
  }

  return [
    {
      label: '添加商户',
      renderType: 'button',
      type: 'primary',
      click: handleAdd,
    },
  ];
});

const formItems = computed(() => [
  {
    label: '商户名称',
    rules: [{ required: true, message: '请输入商户名称' }],
    child: {
      renderType: 'input',
      valueKey: 'name',
    },
  },
  {
    label: '商户ID',
    show: isUpdate.value,
    child: {
      disabled: true,
      renderType: 'input',
      valueKey: 'id',
    },
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
]);

const serveMethods = async (params: any) => {
  const data = await getMerchantList(params);
  return {
    list: data,
    total: data.length,
    totalPages: 1,
  };
};

function handleAdd() {
  isUpdate.value = false;
  currentId.value = '';
  formModel.value = {
    address: '',
    contact: '',
    name: '',
    phone: '',
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
  } catch (error: any) {
    if (!error?.response) {
      message.error(error?.message || '删除失败');
    }
  }
}

const handleSubmit = async (model: Merchant) => {
  try {
    if (isUpdate.value) {
      await updateMerchant({ ...model, id: currentId.value });
      message.success('更新成功');
    } else {
      await addMerchant(model);
      message.success('添加成功');
    }

    tableRef.value?.search();
    return true;
  } catch (error: any) {
    console.error(error);
    if (!error?.response) {
      message.error(
        error?.message || (isUpdate.value ? '更新失败' : '添加失败'),
      );
    }
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
    :title="isUpdate ? '编辑商户' : '添加商户'"
    :form-items="formItems"
    v-model:model="formModel"
    :submit="handleSubmit"
    width="600px"
  />
</template>
