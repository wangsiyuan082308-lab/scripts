<script lang="ts" setup>
import type { Account, AccountForm } from '#/api/account';
import type { Merchant } from '#/api/merchant';

import { computed, h, ref } from 'vue';

import { Button, message, Popconfirm, Tag } from 'ant-design-vue';

import {
  addAccount,
  deleteAccount,
  getAccountList,
  updateAccount,
} from '#/api/account';
import { getMerchantList } from '#/api/merchant';
// @ts-expect-error no .vue type declaration
import BaseModelForm from '#/components/base/BaseModelForm/index.vue';
import SimpleTemplate from '#/components/base/SimpleTemplate/index.vue';

const ROLE_LABEL_MAP: Record<string, string> = {
  merchant_admin: '商户管理员',
  operator: '操作员',
  super_admin: '超级管理员',
  viewer: '只读',
};

const searchFormItems = [
  {
    label: '用户名',
    child: {
      renderType: 'input',
      valueKey: 'username',
    },
  },
  {
    label: '手机号',
    child: {
      renderType: 'input',
      valueKey: 'phone',
    },
  },
  {
    label: '状态',
    child: {
      renderType: 'select',
      valueKey: 'status',
      options: [
        { label: '启用', value: 'active' },
        { label: '禁用', value: 'inactive' },
      ],
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

const columns = [
  { dataIndex: 'username', title: '用户名', width: 160 },
  { dataIndex: 'phone', title: '手机号', width: 160 },
  { dataIndex: 'realName', title: '姓名', width: 140 },
  {
    dataIndex: 'roleCode',
    title: '角色',
    width: 120,
    render: (_h: any, { row }: { row: Account }) =>
      ROLE_LABEL_MAP[row.roleCode] || row.roleCode || '-',
  },
  {
    dataIndex: 'merchantNames',
    title: '所属商户',
    minWidth: 240,
    render: (_h: any, { row }: { row: Account }) =>
      Array.isArray(row.merchantNames) && row.merchantNames.length > 0
        ? row.merchantNames.join('，')
        : '-',
  },
  {
    dataIndex: 'status',
    title: '状态',
    width: 100,
    render: (_h: any, { row }: { row: Account }) =>
      h(
        Tag,
        { color: row.status === 'active' ? 'success' : 'default' },
        () => (row.status === 'active' ? '启用' : '禁用'),
      ),
  },
  {
    title: '操作',
    width: 160,
    render: (h: any, { row }: { row: Account }) =>
      h('div', [
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
      ]),
  },
];

const headerOptions = [
  {
    label: '添加账户',
    renderType: 'button',
    type: 'primary',
    click: handleAdd,
  },
];

const showModal = ref(false);
const isUpdate = ref(false);
const currentId = ref('');
const formModel = ref<Partial<AccountForm>>({
  merchantIds: [],
  roleCode: 'merchant_admin',
  status: 'active',
});
const merchantOptions = ref<{ label: string; value: string }[]>([]);
const tableRef = ref();

const formItems = computed(() => [
  {
    label: '用户名',
    child: {
      valueKey: 'username',
      renderType: 'input',
    },
    rules: [{ required: true, message: '请输入用户名' }],
  },
  {
    label: '姓名',
    child: {
      valueKey: 'realName',
      renderType: 'input',
    },
    rules: [{ required: true, message: '请输入姓名' }],
  },
  {
    label: '手机号',
    child: {
      valueKey: 'phone',
      renderType: 'input',
    },
  },
  {
    label: isUpdate.value ? '重置密码' : '密码',
    child: {
      valueKey: 'password',
      renderType: 'password',
    },
    rules: isUpdate.value ? [] : [{ required: true, message: '请输入密码' }],
  },
  {
    label: '角色',
    child: {
      valueKey: 'roleCode',
      renderType: 'select',
      options: [
        { label: '超级管理员', value: 'super_admin' },
        { label: '商户管理员', value: 'merchant_admin' },
        { label: '操作员', value: 'operator' },
        { label: '只读', value: 'viewer' },
      ],
    },
    rules: [{ required: true, message: '请选择角色' }],
  },
  {
    label: '所属商户',
    child: {
      valueKey: 'merchantIds',
      renderType: 'select',
      options: merchantOptions.value,
      mode: 'multiple',
      showSearch: true,
      optionFilterProp: 'label',
    },
    show: formModel.value.roleCode !== 'super_admin',
    rules:
      formModel.value.roleCode === 'super_admin'
        ? []
        : [{ required: true, message: '请选择所属商户' }],
  },
  {
    label: '状态',
    child: {
      valueKey: 'status',
      renderType: 'switch',
      checkedChildren: '启用',
      unCheckedChildren: '禁用',
      checkedValue: 'active',
      unCheckedValue: 'inactive',
    },
  },
]);

async function ensureMerchantOptions() {
  const merchants = await getMerchantList({ page: 1, pageSize: 1000 });
  merchantOptions.value = merchants.map((item: Merchant) => ({
    label: item.name,
    value: item.id,
  }));
}

const serveMethods = async (params: any) => {
  const data = await getAccountList(params);
  return {
    list: data,
    total: data.length,
    totalPages: 1,
  };
};

async function handleAdd() {
  isUpdate.value = false;
  currentId.value = '';
  await ensureMerchantOptions();
  formModel.value = {
    merchantIds: [],
    password: '',
    phone: '',
    realName: '',
    roleCode: 'merchant_admin',
    status: 'active',
    username: '',
  };
  showModal.value = true;
}

async function handleEdit(row: Account) {
  isUpdate.value = true;
  currentId.value = row.id;
  await ensureMerchantOptions();
  formModel.value = {
    id: row.id,
    merchantIds: [...(row.merchantIds || [])],
    password: '',
    phone: row.phone || '',
    realName: row.realName,
    roleCode: row.roleCode,
    status: row.status,
    username: row.username,
  };
  showModal.value = true;
}

async function handleDelete(row: Account) {
  try {
    await deleteAccount(row.id);
    message.success('删除成功');
    tableRef.value?.search();
  } catch (error: any) {
    message.error(error?.message || '删除失败');
  }
}

const handleSubmit = async (model: AccountForm) => {
  try {
    const payload = {
      ...model,
      merchantIds:
        model.roleCode === 'super_admin'
          ? []
          : Array.isArray(model.merchantIds)
            ? model.merchantIds
            : [],
    };

    if (isUpdate.value) {
      await updateAccount({
        ...payload,
        id: currentId.value,
      });
      message.success('更新成功');
    } else {
      await addAccount(payload);
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
  <div class="account-page">
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
      :title="isUpdate ? '编辑账户' : '添加账户'"
      :form-items="formItems"
      v-model:model="formModel"
      :submit="handleSubmit"
      width="640px"
    />
  </div>
</template>
