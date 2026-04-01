<script lang="tsx" setup>
import type { Account, AccountPayload } from '#/api/account';

import { computed, onMounted, ref } from 'vue';

import { Button, message, Popconfirm } from 'ant-design-vue';

import {
  addAccount,
  deleteAccount,
  getAccountList,
  updateAccount,
} from '#/api/account';
import { getStoreList } from '#/api/store';
// @ts-expect-error no .vue type declaration
import BaseModelForm from '#/components/base/BaseModelForm/index.vue';
import SimpleTemplate from '#/components/base/SimpleTemplate/index.vue';

type StoreOption = {
  label: string;
  merchantId?: string;
  value: string;
};

type AccountFormModel = AccountPayload & {
  statusEnabled?: boolean;
};

const tableRef = ref();
const showModal = ref(false);
const isUpdate = ref(false);
const currentId = ref('');
const formModel = ref<AccountFormModel>({
  phone: '',
  realName: '',
  roleCode: 'merchant_admin',
  status: 'active',
  statusEnabled: true,
  storeIds: [],
  username: '',
});
const storeOptions = ref<StoreOption[]>([]);

const roleOptions = [
  { label: '超级管理员', value: 'super_admin' },
  { label: '商户管理员', value: 'merchant_admin' },
  { label: '操作员', value: 'operator' },
];

const statusOptions = [
  { label: '启用', value: 'active' },
  { label: '禁用', value: 'inactive' },
];

const searchFormItems = [
  {
    label: '关键词',
    child: {
      valueKey: 'keyword',
      renderType: 'input',
    },
  },
  {
    label: '状态',
    child: {
      valueKey: 'status',
      renderType: 'select',
      options: statusOptions,
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
  { dataIndex: 'username', title: '用户名', width: 140 },
  { dataIndex: 'realName', title: '姓名', width: 120 },
  { dataIndex: 'phone', title: '电话', width: 140 },
  {
    dataIndex: 'merchantNames',
    title: '所属商户',
    minWidth: 160,
    render: (_h: any, ctx: { text?: string[] }) =>
      Array.isArray(ctx?.text) && ctx.text.length ? ctx.text.join('、') : '-',
  },
  {
    dataIndex: 'roleCode',
    title: '角色',
    width: 120,
    render: (_h: any, ctx: { text?: string }) =>
      roleOptions.find((item) => item.value === ctx?.text)?.label || ctx?.text || '-',
  },
  {
    dataIndex: 'status',
    title: '状态',
    width: 100,
    render: (_h: any, ctx: { text?: string }) =>
      statusOptions.find((item) => item.value === ctx?.text)?.label || ctx?.text || '-',
  },
  {
    dataIndex: 'storeNames',
    title: '关联门店',
    minWidth: 220,
    render: (_h: any, ctx: { text?: string[] }) =>
      Array.isArray(ctx?.text) && ctx.text.length ? ctx.text.join('、') : '-',
  },
  {
    title: '操作',
    width: 150,
    render: (_h: any, ctx: { record?: Account; row?: Account }) => {
      const row = ctx?.row || ctx?.record;
      if (!row) return null;
      return (
        <div>
          <Button type="link" onClick={() => handleEdit(row)}>
            编辑
          </Button>
          <Popconfirm title="确认删除?" onConfirm={() => handleDelete(row)}>
            <Button type="link" danger>
              删除
            </Button>
          </Popconfirm>
        </div>
      );
    },
  },
];

const formItems = computed(() => [
  {
    label: '用户名',
    rules: [{ required: true, message: '请输入用户名' }],
    child: {
      renderType: 'input',
      valueKey: 'username',
    },
  },
  {
    label: '姓名',
    rules: [{ required: true, message: '请输入姓名' }],
    child: {
      renderType: 'input',
      valueKey: 'realName',
    },
  },
  {
    label: isUpdate.value ? '重置密码' : '登录密码',
    rules: isUpdate.value ? [] : [{ required: true, message: '请输入登录密码' }],
    child: {
      placeholder: isUpdate.value ? '留空则不修改密码' : '请输入登录密码',
      renderType: 'password',
      valueKey: 'password',
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
    label: '角色',
    child: {
      options: roleOptions,
      onChange: handleRoleChange,
      renderType: 'select',
      valueKey: 'roleCode',
    },
  },
  {
    label: '状态',
    child: {
      checkedChildren: '启用',
      renderType: 'switch',
      unCheckedChildren: '禁用',
      valueKey: 'statusEnabled',
    },
  },
  {
    label: '关联门店',
    show: formModel.value.roleCode !== 'super_admin',
    rules:
      formModel.value.roleCode === 'super_admin'
        ? []
        : [{ required: true, message: '请至少选择一个门店' }],
    child: {
      mode: 'multiple',
      options: storeOptions.value,
      placeholder: '请选择可操作门店',
      renderType: 'select',
      valueKey: 'storeIds',
    },
  },
]);

async function loadStores() {
  try {
    const stores = await getStoreList({ page: 1, pageSize: 500 });
    storeOptions.value = (stores || []).map((item: any) => ({
      label: item.storeName,
      merchantId: item.merchantId,
      value: item.storeId,
    }));
  } catch (error) {
    console.error(error);
    message.error('加载门店列表失败');
  }
}

function resolveMerchantIdsFromStoreIds(storeIds: string[]) {
  const merchantIds = new Set<string>();
  for (const storeId of storeIds) {
    const option = storeOptions.value.find((item) => item.value === storeId);
    if (option?.merchantId) {
      merchantIds.add(option.merchantId);
    }
  }
  return Array.from(merchantIds);
}

function resolveStoreIdsForLegacyAccount(account: Account) {
  if (Array.isArray(account.storeIds) && account.storeIds.length > 0) {
    return [...account.storeIds];
  }

  if (!Array.isArray(account.merchantIds) || account.merchantIds.length === 0) {
    return [];
  }

  const merchantIdSet = new Set(account.merchantIds);
  return storeOptions.value
    .filter((item) => item.merchantId && merchantIdSet.has(item.merchantId))
    .map((item) => item.value);
}

const serveMethods = async (params: any) => {
  const data = await getAccountList(params);
  return {
    list: data,
    total: data.length,
    totalPages: 1,
  };
};

function handleRoleChange(value: string) {
  formModel.value.roleCode = value;
  if (value === 'super_admin') {
    formModel.value.storeIds = [];
  }
}

async function handleAdd() {
  await loadStores();
  isUpdate.value = false;
  currentId.value = '';
  formModel.value = {
    phone: '',
    realName: '',
    roleCode: 'merchant_admin',
    status: 'active',
    statusEnabled: true,
    storeIds: [],
    username: '',
  };
  showModal.value = true;
}

async function handleEdit(row: Account) {
  await loadStores();
  isUpdate.value = true;
  currentId.value = row.id;
  formModel.value = {
    id: row.id,
    phone: row.phone,
    realName: row.realName,
    roleCode: row.roleCode,
    status: row.status,
    statusEnabled: row.status === 'active',
    storeIds: resolveStoreIdsForLegacyAccount(row),
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
    if (!error?.response) {
      message.error(error?.message || '删除失败');
    }
  }
}

const handleSubmit = async (model: AccountFormModel) => {
  try {
    const payload: AccountPayload = {
      id: currentId.value || model.id,
      merchantIds:
        model.roleCode === 'super_admin'
          ? []
          : resolveMerchantIdsFromStoreIds(
              Array.isArray(model.storeIds) ? model.storeIds : [],
            ),
      phone: model.phone,
      password: model.password,
      realName: model.realName,
      roleCode: model.roleCode,
      status: model.statusEnabled === false ? 'inactive' : 'active',
      storeIds:
        model.roleCode === 'super_admin'
          ? []
          : Array.isArray(model.storeIds)
            ? model.storeIds
            : [],
      username: model.username,
    };

    if (isUpdate.value) {
      await updateAccount(payload);
      message.success('更新成功');
    } else {
      await addAccount(payload);
      message.success('添加成功');
    }

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
  loadStores();
});
</script>

<template>
  <SimpleTemplate
    ref="tableRef"
    row-key="id"
    :search-form-items="searchFormItems"
    :columns="columns"
    :serve-methods="serveMethods"
    :header-options="[
      {
        label: '添加用户',
        renderType: 'button',
        type: 'primary',
        click: handleAdd,
      },
    ]"
    :show-page="false"
  />

  <BaseModelForm
    v-model:show="showModal"
    :title="isUpdate ? '编辑用户' : '添加用户'"
    :form-items="formItems"
    v-model:model="formModel"
    :submit="handleSubmit"
    width="640px"
  />
</template>
