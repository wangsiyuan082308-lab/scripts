<script lang="tsx" setup>
import type {
  CreateWithdrawalTaskPayload,
  WithdrawalTask,
  WithdrawalTaskResult,
} from '#/api/withdrawal-task';

import { computed, h, onMounted, ref } from 'vue';

import {
  Button,
  Descriptions,
  Drawer,
  Empty,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  TimePicker,
} from 'ant-design-vue';
import dayjs from 'dayjs';

import { getStoreList } from '#/api/store';
import {
  createWithdrawalTask,
  deleteWithdrawalTask,
  getWithdrawalTaskDetail,
  getWithdrawalTaskList,
  retryWithdrawalTask,
  runWithdrawalTask,
  updateWithdrawalTask,
} from '#/api/withdrawal-task';
import SimpleTemplate from '#/components/base/SimpleTemplate/index.vue';

interface StoreOption {
  label: string;
  value: string;
}

const tableRef = ref<any>(null);
const submitLoading = ref(false);
const actionLoading = ref<Record<string, boolean>>({});
const tasks = ref<WithdrawalTask[]>([]);
const storeOptions = ref<StoreOption[]>([]);
const selectedStoreIds = ref<string[]>([]);
const triggerMode = ref<'daily' | 'manual'>('manual');
const scheduleTime = ref<string>();
const createTaskVisible = ref(false);
const detailVisible = ref(false);
const detailLoading = ref(false);
const currentDetail = ref<null | WithdrawalTask>(null);

const searchModel = ref({
  page: 1,
  pageSize: 20,
  status: undefined as string | undefined,
  taskId: '',
});


const statusMap: Record<
  WithdrawalTask['status'],
  { color: string; text: string }
> = {
  cancelled: { color: 'default', text: '已取消' },
  draft: { color: 'default', text: '草稿' },
  failed: { color: 'error', text: '失败' },
  partial_success: { color: 'warning', text: '部分成功' },
  paused: { color: 'default', text: '已暂停' },
  pending: { color: 'processing', text: '待执行' },
  running: { color: 'blue', text: '执行中' },
  success: { color: 'success', text: '成功' },
};

const statusFilterOptions = [
  { label: '全部状态', value: undefined },
  { label: '待执行', value: 'pending' },
  { label: '执行中', value: 'running' },
  { label: '已暂停', value: 'paused' },
  { label: '成功', value: 'success' },
  { label: '部分成功', value: 'partial_success' },
  { label: '失败', value: 'failed' },
  { label: '已取消', value: 'cancelled' },
];

const searchFormItems = [
  {
    label: '任务编号',
    renderType: 'input',
    valueKey: 'taskId',
  },
  {
    label: '状态',
    renderType: 'select',
    valueKey: 'status',
    options: statusFilterOptions,
    allowClear: true,
    optionLabelProp: 'label',
    optionValueProp: 'value',
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

function formatDateTime(value?: string) {
  if (!value) return '-';
  return dayjs(value).format('YYYY-MM-DD HH:mm:ss');
}

function statusTag(status: WithdrawalTask['status']) {
  return statusMap[status] || { color: 'default', text: status };
}

function isActionLoading(taskId: string, action: string) {
  return Boolean(actionLoading.value[`${taskId}:${action}`]);
}

function setActionLoading(taskId: string, action: string, value: boolean) {
  actionLoading.value = {
    ...actionLoading.value,
    [`${taskId}:${action}`]: value,
  };
}

function showStoreNames(task: WithdrawalTask) {
  if (!task.storeNames?.length) return '-';
  const preview = task.storeNames.slice(0, 2).join('、');
  if (task.storeNames.length <= 2) return preview;
  return `${preview} 等 ${task.storeNames.length} 家`;
}


const headerOptions = computed(() => [
  {
    renderType: 'render',
    label: '任务总数',
  },
]);

const columns = [
  { title: '任务编号', dataIndex: 'taskId', key: 'taskId', width: 180 },
  {
    title: '执行方式',
    key: 'triggerMode',
    width: 120,
    render: (_h: any, { row }: { row: WithdrawalTask }) =>
      h('div', [
        h(
          Tag,
          { color: row.triggerMode === 'daily' ? 'purple' : 'blue' },
          {
            default: () =>
              row.triggerMode === 'daily' ? '每天定时' : '手动执行',
          },
        ),
        row.scheduleTime
          ? h('div', { class: 'mt-1 text-xs text-gray-400' }, row.scheduleTime)
          : null,
      ]),
  },
  {
    title: '门店',
    key: 'stores',
    width: 220,
    render: (_h: any, { row }: { row: WithdrawalTask }) =>
      h('div', [
        h('div', { class: 'font-medium' }, showStoreNames(row)),
        h(
          'div',
          { class: 'text-xs text-gray-400' },
          `共 ${row.storeCount} 家门店`,
        ),
      ]),
  },
  {
    title: '状态',
    key: 'status',
    width: 120,
    render: (_h: any, { row }: { row: WithdrawalTask }) =>
      h(
        Tag,
        { color: statusTag(row.status).color },
        { default: () => statusTag(row.status).text },
      ),
  },
  {
    title: '下次执行',
    dataIndex: 'nextRunAt',
    key: 'nextRunAt',
    width: 180,
    render: (_h: any, { row }: { row: WithdrawalTask }) =>
      formatDateTime(row.nextRunAt),
  },
  {
    title: '上次执行',
    dataIndex: 'lastRunAt',
    key: 'lastRunAt',
    width: 180,
    render: (_h: any, { row }: { row: WithdrawalTask }) =>
      formatDateTime(row.lastRunAt),
  },
  {
    title: '结果统计',
    key: 'counts',
    width: 140,
    render: (_h: any, { row }: { row: WithdrawalTask }) =>
      h('div', [
        h('span', { class: 'text-green-600' }, `${row.successCount}`),
        h('span', { class: 'mx-1 text-gray-300' }, '/'),
        h('span', { class: 'text-red-500' }, `${row.failedCount}`),
      ]),
  },
  { title: '摘要', dataIndex: 'summary', key: 'summary', ellipsis: true },
  {
    title: '操作',
    key: 'actions',
    width: 320,
    fixed: 'right',
    render: (_h: any, { row }: { row: WithdrawalTask }) =>
      h(
        Space,
        { wrap: true },
        {
          default: () => [
            h(
              Button,
              {
                type: 'link',
                size: 'small',
                onClick: () => openDetail(row.taskId),
              },
              { default: () => '详情' },
            ),
            h(
              Button,
              {
                type: 'link',
                size: 'small',
                loading: isActionLoading(row.taskId, 'run'),
                disabled: row.status === 'running',
                onClick: () => handleRun(row),
              },
              {
                default: () =>
                  row.triggerMode === 'daily' ? '立即执行' : '重新执行',
              },
            ),
            row.failedCount > 0
              ? h(
                  Button,
                  {
                    type: 'link',
                    size: 'small',
                    loading: isActionLoading(row.taskId, 'retry'),
                    onClick: () => handleRetry(row),
                  },
                  { default: () => '重试失败门店' },
                )
              : null,
            row.triggerMode === 'daily' && row.status !== 'paused'
              ? h(
                  Button,
                  {
                    type: 'link',
                    size: 'small',
                    loading: isActionLoading(row.taskId, 'pause'),
                    disabled: row.status === 'running',
                    onClick: () => handlePause(row),
                  },
                  { default: () => '暂停' },
                )
              : null,
            row.triggerMode === 'daily' && row.status === 'paused'
              ? h(
                  Button,
                  {
                    type: 'link',
                    size: 'small',
                    loading: isActionLoading(row.taskId, 'resume'),
                    onClick: () => handleResume(row),
                  },
                  { default: () => '恢复' },
                )
              : null,
            h(
              Popconfirm,
              {
                title: '确认删除该任务？',
                description: '删除后无法恢复。',
                onConfirm: () => handleDelete(row),
              },
              {
                default: () =>
                  h(
                    Button,
                    {
                      type: 'link',
                      size: 'small',
                      danger: true,
                      loading: isActionLoading(row.taskId, 'delete'),
                      disabled: row.status === 'running',
                    },
                    { default: () => '删除' },
                  ),
              },
            ),
          ],
        },
      ),
  },
];

const detailResultColumns = [
  { title: '门店', dataIndex: 'storeName', key: 'storeName' },
  { title: '状态', key: 'status', width: 100 },
  { title: '提现金额', key: 'withdrawAmount', width: 120 },
  { title: '执行时间', key: 'executedAt', width: 180 },
  { title: '结果说明', dataIndex: 'message', key: 'message' },
];

async function fetchStores() {
  const list = await getStoreList({ page: 1, pageSize: 500 });
  storeOptions.value = list.map((item) => ({
    label: item.storeName || item.storeId,
    value: item.storeId,
  }));
}

async function serveMethods(params: any) {
  const list = await getWithdrawalTaskList();
  tasks.value = list;

  const taskIdKeyword = String(params?.data?.taskId || '')
    .trim()
    .toLowerCase();
  const status = params?.data?.status as undefined | WithdrawalTask['status'];

  const filtered = list.filter((task) => {
    const matchTaskId = taskIdKeyword
      ? task.taskId.toLowerCase().includes(taskIdKeyword)
      : true;
    const matchStatus = status ? task.status === status : true;
    return matchTaskId && matchStatus;
  });

  return {
    list: filtered,
    total: filtered.length,
    totalPages: filtered.length,
  };
}


function resetCreateForm() {
  selectedStoreIds.value = [];
  triggerMode.value = 'manual';
  scheduleTime.value = undefined;
}


function closeCreateTaskModal() {
  createTaskVisible.value = false;
}

function handleTriggerModeChange(value: 'daily' | 'manual') {
  if (value !== 'daily') {
    scheduleTime.value = undefined;
  }
}

async function handleCreateTask() {
  if (selectedStoreIds.value.length === 0) {
    message.warning('请先选择门店');
    return;
  }
  if (triggerMode.value === 'daily' && !scheduleTime.value) {
    message.warning('请选择每日执行时间');
    return;
  }

  submitLoading.value = true;
  try {
    const storeNameMap = new Map(
      storeOptions.value.map((item) => [item.value, item.label]),
    );
    const payload: CreateWithdrawalTaskPayload = {
      scheduleTime:
        triggerMode.value === 'daily'
          ? (scheduleTime.value ?? undefined)
          : undefined,
      storeIds: selectedStoreIds.value,
      storeNames: selectedStoreIds.value.map(
        (storeId) => storeNameMap.get(storeId) || storeId,
      ),
      triggerMode: triggerMode.value,
    };

    const task = await createWithdrawalTask(payload);
    message.success(
      triggerMode.value === 'daily' ? '定时任务创建成功' : '任务创建成功',
    );

    if (triggerMode.value === 'manual') {
      await handleRun(task, true);
    } else {
      tableRef.value?.search();
    }
    closeCreateTaskModal();
    resetCreateForm();
  } catch (error: any) {
    console.error(error);
    message.error(error.message || '创建任务失败');
  } finally {
    submitLoading.value = false;
  }
}

async function handleRun(task: WithdrawalTask, silent = false) {
  setActionLoading(task.taskId, 'run', true);
  try {
    await runWithdrawalTask(task.taskId);
    if (!silent) {
      message.success('任务执行完成');
    }
    tableRef.value?.search();
    if (currentDetail.value?.taskId === task.taskId) {
      await openDetail(task.taskId);
    }
  } catch (error: any) {
    console.error(error);
    message.error(error.message || '执行任务失败');
  } finally {
    setActionLoading(task.taskId, 'run', false);
  }
}

async function handleRetry(task: WithdrawalTask) {
  setActionLoading(task.taskId, 'retry', true);
  try {
    await retryWithdrawalTask(task.taskId);
    message.success('失败门店已重新执行');
    tableRef.value?.search();
    if (currentDetail.value?.taskId === task.taskId) {
      await openDetail(task.taskId);
    }
  } catch (error: any) {
    console.error(error);
    message.error(error.message || '重试失败');
  } finally {
    setActionLoading(task.taskId, 'retry', false);
  }
}

async function handlePause(task: WithdrawalTask) {
  setActionLoading(task.taskId, 'pause', true);
  try {
    await updateWithdrawalTask({ taskId: task.taskId, status: 'paused' });
    message.success('任务已暂停');
    tableRef.value?.search();
    if (currentDetail.value?.taskId === task.taskId) {
      await openDetail(task.taskId);
    }
  } catch (error: any) {
    console.error(error);
    message.error(error.message || '暂停失败');
  } finally {
    setActionLoading(task.taskId, 'pause', false);
  }
}

async function handleResume(task: WithdrawalTask) {
  setActionLoading(task.taskId, 'resume', true);
  try {
    await updateWithdrawalTask({ taskId: task.taskId, status: 'pending' });
    message.success('任务已恢复');
    tableRef.value?.search();
    if (currentDetail.value?.taskId === task.taskId) {
      await openDetail(task.taskId);
    }
  } catch (error: any) {
    console.error(error);
    message.error(error.message || '恢复失败');
  } finally {
    setActionLoading(task.taskId, 'resume', false);
  }
}

async function handleDelete(task: WithdrawalTask) {
  setActionLoading(task.taskId, 'delete', true);
  try {
    await deleteWithdrawalTask(task.taskId);
    message.success('任务已删除');
    tableRef.value?.search();
    if (currentDetail.value?.taskId === task.taskId) {
      detailVisible.value = false;
      currentDetail.value = null;
    }
  } catch (error: any) {
    console.error(error);
    message.error(error.message || '删除失败');
  } finally {
    setActionLoading(task.taskId, 'delete', false);
  }
}

async function openDetail(taskId: string) {
  detailVisible.value = true;
  detailLoading.value = true;
  try {
    currentDetail.value = await getWithdrawalTaskDetail(taskId);
  } catch (error: any) {
    console.error(error);
    message.error(error.message || '获取任务详情失败');
  } finally {
    detailLoading.value = false;
  }
}

function resultColor(result: WithdrawalTaskResult['status']) {
  return result === 'success' ? 'success' : 'error';
}

function formatWithdrawAmount(value?: number) {
  return typeof value === 'number' ? `¥${value.toFixed(2)}` : '-';
}

function asTaskResultRecord(record: Record<string, any>) {
  return record as WithdrawalTaskResult;
}

onMounted(async () => {
  try {
    await fetchStores();
  } catch (error) {
    console.error(error);
  }
});
</script>

<template>
  <SimpleTemplate
    ref="tableRef"
    row-key="taskId"
    v-model="searchModel"
    :search-form-items="searchFormItems"
    :columns="columns"
    :serve-methods="serveMethods"
    :header-options="headerOptions"
  />

  <Modal
    v-model:open="createTaskVisible"
    title="创建提现任务"
    ok-text="确定创建"
    cancel-text="取消"
    :confirm-loading="submitLoading"
    @ok="handleCreateTask"
    @cancel="closeCreateTaskModal"
  >
    <div class="space-y-4">
      <div>
        <div class="mb-2 text-sm text-gray-500">任务模式</div>
        <Select
          v-model:value="triggerMode"
          :options="[
            { label: '手动提现', value: 'manual' },
            { label: '每天定时', value: 'daily' },
          ]"
          @change="handleTriggerModeChange"
        />
      </div>

      <div>
        <div class="mb-2 text-sm text-gray-500">选择门店</div>
        <Select
          v-model:value="selectedStoreIds"
          mode="multiple"
          allow-clear
          show-search
          :options="storeOptions"
          option-filter-prop="label"
          placeholder="请选择一个或多个门店"
        />
      </div>

      <div v-if="triggerMode === 'daily'">
        <div class="mb-2 text-sm text-gray-500">每日执行时间</div>
        <TimePicker
          v-model:value="scheduleTime"
          format="HH:mm"
          value-format="HH:mm"
          style="width: 100%"
        />
      </div>
    </div>
  </Modal>

  <Drawer
    v-model:open="detailVisible"
    title="任务详情"
    width="820"
    destroy-on-close
  >
    <template v-if="currentDetail">
      <Descriptions bordered :column="2" size="small" class="mb-4">
        <Descriptions.Item label="任务编号">
          {{ currentDetail.taskId }}
        </Descriptions.Item>
        <Descriptions.Item label="执行方式">
          {{ currentDetail.triggerMode === 'daily' ? '每天定时' : '手动执行' }}
        </Descriptions.Item>
        <Descriptions.Item label="状态">
          <Tag :color="statusTag(currentDetail.status).color">
            {{ statusTag(currentDetail.status).text }}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label="门店数">
          {{ currentDetail.storeCount }}
        </Descriptions.Item>
        <Descriptions.Item label="调度时间">
          {{ currentDetail.scheduleTime || '-' }}
        </Descriptions.Item>
        <Descriptions.Item label="下次执行">
          {{ formatDateTime(currentDetail.nextRunAt) }}
        </Descriptions.Item>
        <Descriptions.Item label="上次执行">
          {{ formatDateTime(currentDetail.lastRunAt) }}
        </Descriptions.Item>
        <Descriptions.Item label="完成时间">
          {{ formatDateTime(currentDetail.finishedAt) }}
        </Descriptions.Item>
        <Descriptions.Item label="创建时间">
          {{ formatDateTime(currentDetail.createdAt) }}
        </Descriptions.Item>
        <Descriptions.Item label="更新时间">
          {{ formatDateTime(currentDetail.updatedAt) }}
        </Descriptions.Item>
        <Descriptions.Item label="摘要" :span="2">
          {{ currentDetail.summary || '-' }}
        </Descriptions.Item>
        <Descriptions.Item label="门店列表" :span="2">
          {{ currentDetail.storeNames.join('、') }}
        </Descriptions.Item>
      </Descriptions>

      <Table
        :columns="detailResultColumns"
        :data-source="currentDetail.results"
        :pagination="false"
        size="small"
        :row-key="
          (record: WithdrawalTaskResult) =>
            `${record.storeId}-${record.executedAt}`
        "
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'status'">
            <Tag :color="resultColor(asTaskResultRecord(record).status)">
              {{
                asTaskResultRecord(record).status === 'success'
                  ? '成功'
                  : '失败'
              }}
            </Tag>
          </template>
          <template v-else-if="column.key === 'withdrawAmount'">
            {{
              formatWithdrawAmount(asTaskResultRecord(record).withdrawAmount)
            }}
          </template>
          <template v-else-if="column.key === 'executedAt'">
            {{ formatDateTime(asTaskResultRecord(record).executedAt) }}
          </template>
        </template>
      </Table>
    </template>
    <Empty v-else description="暂无详情" />
  </Drawer>
</template>
