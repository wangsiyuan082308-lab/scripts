<script lang="tsx" setup>
import type {
  CreateWithdrawalTaskPayload,
  WithdrawalScheduleFrequency,
  WithdrawalTaskHistory,
  WithdrawalTask,
  WithdrawalTaskResult,
} from '#/api/withdrawal-task';

import { computed, onMounted, onUnmounted, ref, toRaw, watch } from 'vue';

import {
  Button,
  Descriptions,
  Drawer,
  Empty,
  message,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Table,
  Tag,
} from 'ant-design-vue';
import dayjs from 'dayjs';

import { getStoreList } from '#/api/store';
import {
  createWithdrawalTask,
  deleteWithdrawalTask,
  getWithdrawalTaskDetail,
  getWithdrawalTaskLogs,
  getWithdrawalTaskList,
  retryWithdrawalTask,
  runWithdrawalTask,
  updateWithdrawalTask,
} from '#/api/withdrawal-task';
// @ts-expect-error project-wide Vue SFC typings are incomplete for this legacy base component
import BaseForm from '#/components/base/BaseForm/BaseForm.vue';
import SimpleTemplate from '#/components/base/SimpleTemplate/index.vue';

interface StoreOption {
  alias: string;
  fullLabel: string;
  label: string;
  value: string;
}

function normalizeStoreName(value?: string) {
  return String(value || '')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getStoreAlias(value?: string) {
  const normalized = normalizeStoreName(value);
  const matched = normalized.match(/\(([^()]+)\)$/);
  return matched?.[1]?.trim() || normalized;
}

function formatStoreOptionLabel(value?: string) {
  const normalized = normalizeStoreName(value);
  const alias = getStoreAlias(normalized);
  if (!alias || alias === normalized) {
    return {
      alias: normalized,
      fullLabel: normalized,
      label: normalized,
    };
  }
  return {
    alias,
    fullLabel: normalized,
    label: `${alias} · ${normalized}`,
  };
}

const weekdayOptions = [
  { label: '周日', value: 0 },
  { label: '周一', value: 1 },
  { label: '周二', value: 2 },
  { label: '周三', value: 3 },
  { label: '周四', value: 4 },
  { label: '周五', value: 5 },
  { label: '周六', value: 6 },
];

const tableRef = ref<any>(null);
const createFormRef = ref<any>(null);
const submitLoading = ref(false);
const actionLoading = ref<Record<string, boolean>>({});
const tasks = ref<WithdrawalTask[]>([]);
const storeOptions = ref<StoreOption[]>([]);
const editingTaskId = ref<string>();
const createFormModel = ref<{
  scheduleFrequency: WithdrawalScheduleFrequency;
  scheduleTime?: string;
  scheduleWeekday?: number;
  storeIds: string[];
  triggerMode: 'daily' | 'manual';
}>({
  scheduleFrequency: 'daily',
  scheduleTime: '06:00',
  scheduleWeekday: 1,
  storeIds: [],
  triggerMode: 'manual',
});
const createTaskVisible = ref(false);
const detailVisible = ref(false);
const detailLoading = ref(false);
const currentDetail = ref<null | WithdrawalTask>(null);
const liveLogVisible = ref(false);
const liveLogLoading = ref(false);
const liveLogTaskId = ref('');
const liveLogSince = ref('');
const liveLogs = ref<Array<{
  level: string;
  message: string;
  store?: string;
  timestamp: string;
}>>([]);
let liveLogTimer: ReturnType<typeof setInterval> | null = null;

const searchModel = ref({
  page: 1,
  pageSize: 20,
  status: undefined as string | undefined,
  taskId: '',
});

const statusConfig: Record<
  WithdrawalTask['status'],
  { color: string; description: string; text: string }
> = {
  cancelled: {
    color: 'default',
    description: '任务已取消，不会再参与调度。',
    text: '已取消',
  },
  draft: {
    color: 'default',
    description: '任务已创建但尚未进入执行队列。',
    text: '草稿',
  },
  deleted: {
    color: 'default',
    description: '任务已删除，仅保留记录用于状态追踪。',
    text: '已删除',
  },
  failed: {
    color: 'error',
    description: '本次执行失败，可查看详情后重试。',
    text: '失败',
  },
  partial_success: {
    color: 'warning',
    description: '部分门店执行成功，剩余门店需要补偿处理。',
    text: '部分成功',
  },
  paused: {
    color: 'default',
    description: '任务已暂停，恢复后会继续参与调度。',
    text: '已暂停',
  },
  pending: {
    color: 'processing',
    description: '任务待执行，立即触发任务会自动启动，定时任务等待调度。',
    text: '待执行',
  },
  running: {
    color: 'blue',
    description: '任务执行中，暂不支持重复触发或删除。',
    text: '执行中',
  },
  success: {
    color: 'success',
    description: '最近一次执行成功。',
    text: '成功',
  },
};

const statusFilterOptions = [
  { label: '全部状态', value: undefined },
  ...Object.entries(statusConfig).map(([value, config]) => ({
    label: config.text,
    value,
  })),
];

const searchFormItems = [
  {
    label: '任务编号',
    child: {
      renderType: 'input',
      valueKey: 'taskId',
    },
  },
  {
    label: '状态',
    child: {
      renderType: 'select',
      valueKey: 'status',
      options: statusFilterOptions,
      allowClear: true,
      optionLabelProp: 'label',
      optionValueProp: 'value',
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

const createFormItems = computed(() => [
  {
    label: '选择门店',
    child: {
      allowClear: true,
      mode: 'multiple',
      optionFilterProp: 'label',
      options: storeOptions.value,
      placeholder: '请选择一个或多个门店',
      renderType: 'select',
      showSearch: true,
      style: { width: '100%' },
      valueKey: 'storeIds',
    },
    rules: [{ message: '请选择门店', required: true }],
  },
  {
    label: '触发方式',
    child: {
      options: [
        { label: '立即触发', value: 'manual' },
        { label: '定时触发', value: 'daily' },
      ],
      renderType: 'select',
      style: { width: '100%' },
      valueKey: 'triggerMode',
    },
    rules: [{ message: '请选择触发方式', required: true }],
  },
  {
    label: '定时频率',
    show: createFormModel.value.triggerMode === 'daily',
    child: {
      options: [
        { label: '每天', value: 'daily' },
        { label: '每周', value: 'weekly' },
      ],
      renderType: 'select',
      style: { width: '100%' },
      valueKey: 'scheduleFrequency',
    },
    rules:
      createFormModel.value.triggerMode === 'daily'
        ? [{ message: '请选择定时频率', required: true }]
        : [],
  },
  {
    label: '每周执行日',
    show:
      createFormModel.value.triggerMode === 'daily' &&
      createFormModel.value.scheduleFrequency === 'weekly',
    child: {
      options: weekdayOptions,
      renderType: 'select',
      style: { width: '100%' },
      valueKey: 'scheduleWeekday',
    },
    rules:
      createFormModel.value.triggerMode === 'daily' &&
      createFormModel.value.scheduleFrequency === 'weekly'
        ? [{ message: '请选择每周执行日', required: true }]
        : [],
  },
  {
    label: '定时执行时间',
    show: createFormModel.value.triggerMode === 'daily',
    child: {
      format: 'HH:mm',
      renderType: 'timePicker',
      style: { width: '100%' },
      valueFormat: 'HH:mm',
      valueKey: 'scheduleTime',
    },
    rules:
      createFormModel.value.triggerMode === 'daily'
        ? [{ message: '请选择定时执行时间', required: true }]
        : [],
  },
]);

function formatDateTime(value?: string) {
  if (!value) return '-';
  return dayjs(value).format('YYYY-MM-DD HH:mm:ss');
}

function formatTerminalLine(log: {
  level: string;
  message: string;
  store?: string;
  timestamp: string;
}) {
  const time = formatDateTime(log.timestamp);
  const store = log.store ? `[${log.store}] ` : '';
  return `${time} [${log.level.toUpperCase()}] ${store}${log.message}`;
}

function getWeekdayLabel(value?: number) {
  return weekdayOptions.find((item) => item.value === value)?.label || '周一';
}

function formatScheduleText(task: Pick<WithdrawalTask, 'scheduleFrequency' | 'scheduleTime' | 'scheduleWeekday' | 'triggerMode'>) {
  if (task.triggerMode !== 'daily') return '手动执行';
  const scheduleTime = task.scheduleTime || '06:00';
  const scheduleFrequency = task.scheduleFrequency || 'daily';
  if (scheduleFrequency === 'weekly') {
    return `每周 ${getWeekdayLabel(task.scheduleWeekday)} ${scheduleTime}`;
  }
  return `每天 ${scheduleTime}`;
}

function statusTag(status: WithdrawalTask['status']) {
  return (
    statusConfig[status] || {
      color: 'default',
      description: status,
      text: status,
    }
  );
}

function canRunTask(task: WithdrawalTask) {
  if (task.status === 'running') return false;
  if (task.triggerMode === 'daily') {
    return !['cancelled', 'deleted', 'draft', 'paused'].includes(task.status);
  }
  return !['cancelled', 'deleted'].includes(task.status);
}

function canRetryTask(task: WithdrawalTask) {
  return !['deleted', 'running'].includes(task.status) && task.failedCount > 0;
}

function canPauseTask(task: WithdrawalTask) {
  return (
    task.triggerMode === 'daily' &&
    !['cancelled', 'deleted', 'paused', 'running'].includes(task.status)
  );
}

function canResumeTask(task: WithdrawalTask) {
  return task.triggerMode === 'daily' && task.status === 'paused';
}

function canEditTask(task: WithdrawalTask) {
  return !['deleted', 'running'].includes(task.status);
}

function canDeleteTask(task: WithdrawalTask) {
  return !['deleted', 'running'].includes(task.status);
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
  const preview = task.storeNames
    .map((item) => getStoreAlias(item))
    .slice(0, 2)
    .join('、');
  if (task.storeNames.length <= 2) return preview;
  return `${preview} 等 ${task.storeNames.length} 家`;
}


const headerOptions = computed(() => [
  {
    renderType: 'render',
    position: 'left',
    render: () => (
      <div class="text-sm text-gray-500">
        <span>任务总数 </span>
        <span class="font-medium text-gray-900">{tasks.value.length}</span>
      </div>
    ),
  },
  {
    renderType: 'button',
    label: '创建提现任务',
    name: '创建提现任务',
    type: 'primary',
    click: () => {
      editingTaskId.value = undefined;
      resetCreateForm();
      createTaskVisible.value = true;
    },
  },
]);

const columns = [
  { title: '任务编号', dataIndex: 'taskId', key: 'taskId', width: 180 },
  {
    title: '执行方式',
    key: 'triggerMode',
    width: 120,
    render: (_h: any, { row }: { row: WithdrawalTask }) => (
      <div>
        <Tag color={row.triggerMode === 'daily' ? 'purple' : 'blue'}>
          {row.triggerMode === 'daily' ? '定时触发' : '立即触发'}
        </Tag>
        {row.scheduleTime ? (
          <div class="mt-1 text-xs text-gray-400">{formatScheduleText(row)}</div>
        ) : null}
      </div>
    ),
  },
  {
    title: '门店',
    key: 'stores',
    width: 220,
    render: (_h: any, { row }: { row: WithdrawalTask }) => (
      <div>
        <div class="font-medium">{showStoreNames(row)}</div>
        <div class="text-xs text-gray-400">共 {row.storeCount} 家门店</div>
      </div>
    ),
  },
  {
    title: '状态',
    key: 'status',
    width: 220,
    render: (_h: any, { row }: { row: WithdrawalTask }) => (
      <div>
        <Tag color={statusTag(row.status).color}>
          {statusTag(row.status).text}
        </Tag>
        <div class="mt-1 text-xs text-gray-400 leading-5">
          {statusTag(row.status).description}
        </div>
      </div>
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
    render: (_h: any, { row }: { row: WithdrawalTask }) => (
      <div>
        <span class="text-green-600">{row.successCount}</span>
        <span class="mx-1 text-gray-300">/</span>
        <span class="text-red-500">{row.failedCount}</span>
      </div>
    ),
  },
  { title: '摘要', dataIndex: 'summary', key: 'summary', ellipsis: true },
  {
    title: '操作',
    key: 'actions',
    width: 320,
    fixed: 'right',
    render: (_h: any, { row }: { row: WithdrawalTask }) => (
      <Space wrap>
        <Button type="link" size="small" onClick={() => openDetail(row.taskId)}>
          详情
        </Button>
        {canEditTask(row) ? (
          <Button
            type="link"
            size="small"
            onClick={() => openEditModal(row)}
          >
            编辑
          </Button>
        ) : null}
        <Button
          type="link"
          size="small"
          loading={isActionLoading(row.taskId, 'run')}
          disabled={!canRunTask(row)}
          onClick={() => handleRun(row)}
        >
          {row.lastRunAt
            ? row.triggerMode === 'daily'
              ? '立即执行'
              : '重新执行'
            : '立即执行'}
        </Button>
        {canRetryTask(row) ? (
          <Button
            type="link"
            size="small"
            loading={isActionLoading(row.taskId, 'retry')}
            onClick={() => handleRetry(row)}
          >
            重试失败门店
          </Button>
        ) : null}
        {canPauseTask(row) ? (
          <Button
            type="link"
            size="small"
            loading={isActionLoading(row.taskId, 'pause')}
            onClick={() => handlePause(row)}
          >
            暂停
          </Button>
        ) : null}
        {canResumeTask(row) ? (
          <Button
            type="link"
            size="small"
            loading={isActionLoading(row.taskId, 'resume')}
            onClick={() => handleResume(row)}
          >
            恢复
          </Button>
        ) : null}
        <Popconfirm
          title="确认删除该任务？"
          description="删除后无法恢复。"
          onConfirm={() => handleDelete(row)}
        >
          <Button
            type="link"
            size="small"
            danger
            loading={isActionLoading(row.taskId, 'delete')}
            disabled={!canDeleteTask(row)}
          >
            删除
          </Button>
        </Popconfirm>
      </Space>
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

const historyColumns = [
  { title: '执行批次', dataIndex: 'historyId', key: 'historyId', width: 170 },
  { title: '触发来源', key: 'triggerReason', width: 110 },
  { title: '开始时间', key: 'startedAt', width: 180 },
  { title: '完成时间', key: 'finishedAt', width: 180 },
  { title: '结果', key: 'status', width: 100 },
  { title: '统计', key: 'counts', width: 110 },
  { title: '摘要', dataIndex: 'summary', key: 'summary' },
];

async function fetchStores() {
  const list = await getStoreList({ page: 1, pageSize: 500 });
  storeOptions.value = list.map((item) => {
    const display = formatStoreOptionLabel(item.storeName || item.storeId);
    return {
      alias: display.alias,
      fullLabel: display.fullLabel,
      label: display.label,
      value: item.storeId,
    };
  });
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
  editingTaskId.value = undefined;
  createFormModel.value = {
    scheduleFrequency: 'daily',
    scheduleTime: '06:00',
    scheduleWeekday: 1,
    storeIds: [],
    triggerMode: 'manual',
  };
  createFormRef.value?.resetModel?.();
}


function closeCreateTaskModal() {
  createTaskVisible.value = false;
  resetCreateForm();
}

watch(
  () => createFormModel.value.triggerMode,
  (value) => {
    if (value !== 'daily') {
      createFormModel.value = {
        ...createFormModel.value,
        scheduleFrequency: 'daily',
        scheduleTime: '06:00',
        scheduleWeekday: 1,
      };
    }
  },
);

watch(
  () => createFormModel.value.scheduleFrequency,
  (value) => {
    if (value !== 'weekly') {
      createFormModel.value = {
        ...createFormModel.value,
        scheduleWeekday: 1,
      };
    }
  },
);

async function handleCreateTask() {
  const valid = await createFormRef.value?.validate?.();
  if (valid === false) {
    message.warning('请检查创建表单');
    return;
  }

  submitLoading.value = true;
  try {
    const rawStoreIds = Array.isArray(createFormModel.value.storeIds)
      ? [...toRaw(createFormModel.value.storeIds)]
      : [];
    const storeNameMap = new Map(
      storeOptions.value.map((item) => [item.value, item.label]),
    );
    const payload: CreateWithdrawalTaskPayload = {
      scheduleFrequency:
        createFormModel.value.triggerMode === 'daily'
          ? `${createFormModel.value.scheduleFrequency}` as WithdrawalScheduleFrequency
          : undefined,
      scheduleTime:
        createFormModel.value.triggerMode === 'daily'
          ? (createFormModel.value.scheduleTime
              ? String(createFormModel.value.scheduleTime)
              : undefined)
          : undefined,
      scheduleWeekday:
        createFormModel.value.triggerMode === 'daily' &&
        createFormModel.value.scheduleFrequency === 'weekly'
          ? Number(createFormModel.value.scheduleWeekday)
          : undefined,
      storeIds: rawStoreIds.map((storeId) => String(storeId)),
      storeNames: rawStoreIds.map(
        (storeId) =>
          getStoreAlias(
            storeOptions.value.find((item) => item.value === storeId)?.fullLabel ||
            storeNameMap.get(storeId) ||
            storeId,
          ),
      ),
      triggerMode: createFormModel.value.triggerMode === 'daily' ? 'daily' : 'manual',
    };

    if (editingTaskId.value) {
      await updateWithdrawalTask({
        taskId: editingTaskId.value,
        scheduleFrequency: payload.scheduleFrequency,
        scheduleTime: payload.scheduleTime,
        scheduleWeekday: payload.scheduleWeekday,
        storeIds: payload.storeIds,
        storeNames: payload.storeNames,
      });
      message.success('任务已更新');
    } else {
      const task = await createWithdrawalTask(payload);
      message.success(
        createFormModel.value.triggerMode === 'daily'
          ? '定时任务创建成功'
          : '任务已创建，2 秒后开始执行',
      );
      if (createFormModel.value.triggerMode === 'manual') {
        openLiveLog(task.taskId);
      }
    }

    closeCreateTaskModal();
    tableRef.value?.search();
  } catch (error: any) {
    console.error(error);
    message.error(error.message || '创建任务失败');
  } finally {
    submitLoading.value = false;
  }
}

function openEditModal(task: WithdrawalTask) {
  editingTaskId.value = task.taskId;
  createFormModel.value = {
    scheduleFrequency: task.scheduleFrequency || 'daily',
    scheduleTime: task.scheduleTime || '06:00',
    scheduleWeekday: task.scheduleWeekday ?? 1,
    storeIds: [...task.storeIds],
    triggerMode: task.triggerMode,
  };
  createTaskVisible.value = true;
}

async function fetchLiveLogs(taskId: string) {
  liveLogLoading.value = true;
  try {
    const res = await getWithdrawalTaskLogs(taskId, 200);
    const logs = Array.isArray(res.list) ? res.list : [];
    liveLogs.value = liveLogSince.value
      ? logs.filter((item) => {
          const logTime = new Date(item.timestamp || '').getTime();
          const sinceTime = new Date(liveLogSince.value).getTime();
          if (Number.isNaN(logTime) || Number.isNaN(sinceTime)) {
            return false;
          }
          return logTime >= sinceTime;
        })
      : logs;
  } catch (error) {
    console.error(error);
  } finally {
    liveLogLoading.value = false;
  }
}

function closeLiveLog() {
  liveLogVisible.value = false;
  liveLogTaskId.value = '';
  liveLogSince.value = '';
  liveLogs.value = [];
  if (liveLogTimer) {
    clearInterval(liveLogTimer);
    liveLogTimer = null;
  }
}

function openLiveLog(taskId: string, since = new Date().toISOString()) {
  liveLogTaskId.value = taskId;
  liveLogSince.value = since;
  liveLogVisible.value = true;
  void fetchLiveLogs(taskId);
  if (liveLogTimer) {
    clearInterval(liveLogTimer);
  }
  liveLogTimer = setInterval(() => {
    if (!liveLogTaskId.value) return;
    void fetchLiveLogs(liveLogTaskId.value);
  }, 2000);
}

async function handleRun(task: WithdrawalTask, silent = false) {
  setActionLoading(task.taskId, 'run', true);
  try {
    openLiveLog(task.taskId);
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
    openLiveLog(task.taskId);
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
    const list = await deleteWithdrawalTask(task.taskId);
    const runningCount = list.filter((item) => item.status === 'running').length;
    message.success(
      runningCount > 0
        ? `任务已删除，当前仍有 ${runningCount} 个任务在执行`
        : '任务已删除',
    );
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

function historyStatusColor(status: WithdrawalTask['status']) {
  return statusTag(status).color;
}

function historyTriggerReasonText(reason: WithdrawalTaskHistory['triggerReason']) {
  switch (reason) {
    case 'retry':
      return '失败重试';
    case 'recover':
      return '异常恢复';
    case 'manual':
      return '手动触发';
    default:
      return '自动触发';
  }
}

function formatWithdrawAmount(value?: number) {
  return typeof value === 'number' ? `¥${value.toFixed(2)}` : '-';
}

function asTaskResultRecord(record: Record<string, any>) {
  return record as WithdrawalTaskResult;
}

function asTaskHistoryRecord(record: Record<string, any>) {
  return record as WithdrawalTaskHistory;
}

onMounted(async () => {
  try {
    await fetchStores();
  } catch (error) {
    console.error(error);
  }
});

onUnmounted(() => {
  if (liveLogTimer) {
    clearInterval(liveLogTimer);
    liveLogTimer = null;
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
    :title="editingTaskId ? '编辑提现任务' : '创建提现任务'"
    :ok-text="editingTaskId ? '保存修改' : '确定创建'"
    cancel-text="取消"
    :confirm-loading="submitLoading"
    @ok="handleCreateTask"
    @cancel="closeCreateTaskModal"
  >
    <BaseForm
      ref="createFormRef"
      layout="vertical"
      :form-items="createFormItems"
      v-model:model="createFormModel"
    />
  </Modal>

  <Modal
    v-model:open="liveLogVisible"
    title="执行日志"
    width="900px"
    :footer="null"
    @cancel="closeLiveLog"
  >
    <div class="mb-3 flex items-center justify-between">
      <div class="text-xs text-gray-500">
        任务编号：{{ liveLogTaskId || '-' }}
      </div>
      <Button size="small" @click="liveLogTaskId && fetchLiveLogs(liveLogTaskId)">
        刷新日志
      </Button>
    </div>
    <div class="terminal-shell">
      <Spin :spinning="liveLogLoading">
        <div class="terminal-body">
          <div v-if="liveLogs.length === 0" class="terminal-empty">
            等待日志输出...
          </div>
          <pre v-else class="terminal-pre">{{
            liveLogs.map(formatTerminalLine).join('\n')
          }}</pre>
        </div>
      </Spin>
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
          {{ currentDetail.triggerMode === 'daily' ? '定时触发' : '立即触发' }}
        </Descriptions.Item>
        <Descriptions.Item label="状态">
          <Space direction="vertical" :size="4">
            <Tag :color="statusTag(currentDetail.status).color">
              {{ statusTag(currentDetail.status).text }}
            </Tag>
            <span class="text-xs text-gray-400">
              {{ statusTag(currentDetail.status).description }}
            </span>
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label="门店数">
          {{ currentDetail.storeCount }}
        </Descriptions.Item>
        <Descriptions.Item label="调度时间">
          {{
            currentDetail.triggerMode === 'daily'
              ? formatScheduleText(currentDetail)
              : '-'
          }}
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
          {{
            currentDetail.storeNames
              .map((item) => `${getStoreAlias(item)} (${normalizeStoreName(item)})`)
              .join('、')
          }}
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

      <div class="mt-4 mb-2 text-sm font-medium text-gray-700">历史执行记录</div>
      <Table
        :columns="historyColumns"
        :data-source="currentDetail.histories || []"
        :pagination="false"
        size="small"
        :row-key="
          (record: WithdrawalTaskHistory) =>
            `${record.historyId}`
        "
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'triggerReason'">
            {{ historyTriggerReasonText(asTaskHistoryRecord(record).triggerReason) }}
          </template>
          <template v-else-if="column.key === 'startedAt'">
            {{ formatDateTime(asTaskHistoryRecord(record).startedAt) }}
          </template>
          <template v-else-if="column.key === 'finishedAt'">
            {{ formatDateTime(asTaskHistoryRecord(record).finishedAt) }}
          </template>
          <template v-else-if="column.key === 'status'">
            <Tag :color="historyStatusColor(asTaskHistoryRecord(record).status)">
              {{ statusTag(asTaskHistoryRecord(record).status).text }}
            </Tag>
          </template>
          <template v-else-if="column.key === 'counts'">
            <span class="text-green-600">
              {{ asTaskHistoryRecord(record).successCount }}
            </span>
            <span class="mx-1 text-gray-300">/</span>
            <span class="text-red-500">
              {{ asTaskHistoryRecord(record).failedCount }}
            </span>
          </template>
        </template>

        <template #expandedRowRender="{ record }">
          <Table
            :columns="detailResultColumns"
            :data-source="asTaskHistoryRecord(record).results"
            :pagination="false"
            size="small"
            :row-key="
              (item: WithdrawalTaskResult) =>
                `${item.storeId}-${item.executedAt}-${asTaskHistoryRecord(record).historyId}`
            "
          >
            <template #bodyCell="{ column: childColumn, record: childRecord }">
              <template v-if="childColumn.key === 'status'">
                <Tag :color="resultColor(asTaskResultRecord(childRecord).status)">
                  {{
                    asTaskResultRecord(childRecord).status === 'success'
                      ? '成功'
                      : '失败'
                  }}
                </Tag>
              </template>
              <template v-else-if="childColumn.key === 'withdrawAmount'">
                {{
                  formatWithdrawAmount(asTaskResultRecord(childRecord).withdrawAmount)
                }}
              </template>
              <template v-else-if="childColumn.key === 'executedAt'">
                {{ formatDateTime(asTaskResultRecord(childRecord).executedAt) }}
              </template>
            </template>
          </Table>
        </template>
      </Table>
    </template>
    <Empty v-else description="暂无详情" />
  </Drawer>
</template>

<style scoped>
.terminal-shell {
  border: 1px solid #1f2937;
  border-radius: 12px;
  background: #0b1220;
  overflow: hidden;
}

.terminal-body {
  min-height: 420px;
  max-height: 60vh;
  overflow: auto;
  padding: 16px;
}

.terminal-pre {
  margin: 0;
  color: #d1fae5;
  font-family: Consolas, 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

.terminal-empty {
  color: #94a3b8;
  font-family: Consolas, 'Courier New', monospace;
  font-size: 12px;
}
</style>
