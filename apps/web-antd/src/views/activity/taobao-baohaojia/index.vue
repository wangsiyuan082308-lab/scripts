<script setup lang="tsx">
import type {
  TaobaoBaohaojiaTaskActivityResult,
  TaobaoBaohaojiaTaskDetailRecord,
  TaobaoBaohaojiaTaskItem,
  TaobaoBaohaojiaTaskRecord,
  TaobaoBaohaojiaTaskRun,
  TaobaoBaohaojiaSignupMode,
  TaobaoBaohaojiaTaskStatus,
} from '#/api/taobao-baohaojia-task-repo';

import { computed, nextTick, onBeforeUnmount, reactive, ref } from 'vue';

import { Page } from '@vben/common-ui';

import dayjs from 'dayjs';
import {
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Form,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  message,
} from 'ant-design-vue';

import {
  continueTaobaoBaohaojiaTaskReview,
  createTaobaoBaohaojiaTask,
  deleteTaobaoBaohaojiaTask,
  executeTaobaoBaohaojiaTask,
  getTaobaoBaohaojiaTaskDetail,
  getTaobaoBaohaojiaTaskRuns,
  getTaobaoBaohaojiaTasks,
} from '#/api/taobao-baohaojia';
import SimpleTemplate from '#/components/base/SimpleTemplate/index.vue';

type DetailTabKey = 'analysis' | 'files' | 'logs' | 'runs';

const tableRef = ref();
const modalOpen = ref(false);
const modalLoading = ref(false);
const drawerOpen = ref(false);
const detailLoading = ref(false);
const activeTab = ref<DetailTabKey>('files');
const executeTerminalOpen = ref(false);
const executeTerminalRunning = ref(false);
const activeTerminalTaskId = ref('');
const activeTerminalRunId = ref('');
const terminalRef = ref<HTMLElement>();

const tasks = ref<TaobaoBaohaojiaTaskRecord[]>([]);
const currentTask = ref<null | TaobaoBaohaojiaTaskRecord>(null);
const currentDetail = ref<null | TaobaoBaohaojiaTaskDetailRecord>(null);
const currentRuns = ref<TaobaoBaohaojiaTaskRun[]>([]);
const terminalTask = ref<null | TaobaoBaohaojiaTaskRecord>(null);
const terminalDetail = ref<null | TaobaoBaohaojiaTaskDetailRecord>(null);
const terminalRuns = ref<TaobaoBaohaojiaTaskRun[]>([]);

let terminalPollTimer: null | ReturnType<typeof setInterval> = null;

const searchFormModel = ref({
  page: 1,
  pageSize: 10,
  status: '',
});

const taskForm = reactive({
  initialStock: 9999,
  requiresManualReview: false,
  signupMode: 'all' as TaobaoBaohaojiaSignupMode,
});

const signupModeOptions = [
  { label: '全部模式', value: 'all' },
  { label: '未报名模式', value: 'unsigned_only' },
  { label: '重复报名模式', value: 'repeat_only' },
];

function formatSignupMode(mode?: TaobaoBaohaojiaSignupMode) {
  return (
    {
      all: '全部模式',
      repeat_only: '重复报名模式',
      unsigned_only: '未报名模式',
    }[mode || 'all'] || mode || '全部模式'
  );
}

function parseActivityDisplay(raw?: string) {
  const text = `${raw || ''}`.replace(/\s+/g, ' ').trim();
  if (!text) {
    return {
      extraText: '',
      name: '-',
      timeText: '',
    };
  }

  const markerMatch = text.match(/(活动时间：|活动介绍：|具体玩法：|温馨提示：|报名截止|活动中)/u);
  const markerIndex = markerMatch?.index ?? -1;
  const name = (markerIndex >= 0 ? text.slice(0, markerIndex) : text).trim() || text;

  const timeMatch = text.match(/活动时间：([^活动温馨具体报名]+?(?:~|-)[^活动温馨具体报名]+)/u);
  const timeText = timeMatch?.[1]?.trim() || '';

  let extraText = text;
  if (name && extraText.startsWith(name)) {
    extraText = extraText.slice(name.length).trim();
  }
  if (timeMatch?.[0]) {
    extraText = extraText.replace(timeMatch[0], '').trim();
  }
  extraText = extraText.replace(/\s+/g, ' ').trim();

  return {
    extraText,
    name,
    timeText,
  };
}

function formatActivityDisplayName(raw?: string) {
  return parseActivityDisplay(raw).name;
}

const taskStatusOptions = [
  { label: '草稿', value: 'draft' },
  { label: '排队中', value: 'queued' },
  { label: '执行中', value: 'running' },
  { label: '待人工审核', value: 'waiting_review' },
  { label: '执行成功', value: 'succeeded' },
  { label: '部分成功', value: 'partial_success' },
  { label: '执行失败', value: 'failed' },
  { label: '审核驳回', value: 'review_rejected' },
];

const searchFormItems = computed(() => [
  {
    label: '任务状态',
    child: {
      options: taskStatusOptions,
      renderType: 'select',
      valueKey: 'status',
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
]);

function formatTaskStatus(status: TaobaoBaohaojiaTaskStatus) {
  return (
    {
      draft: '草稿',
      failed: '执行失败',
      partial_success: '部分成功',
      queued: '排队中',
      review_rejected: '审核驳回',
      running: '执行中',
      succeeded: '执行成功',
      waiting_review: '待人工审核',
    }[status] || status
  );
}

function taskStatusColor(status: TaobaoBaohaojiaTaskStatus) {
  return (
    {
      draft: 'default',
      failed: 'error',
      partial_success: 'gold',
      queued: 'blue',
      review_rejected: 'volcano',
      running: 'processing',
      succeeded: 'success',
      waiting_review: 'purple',
    }[status] || 'default'
  );
}

function runStatusColor(status?: string) {
  return (
    {
      failed: 'error',
      partial_success: 'gold',
      queued: 'blue',
      running: 'processing',
      succeeded: 'success',
      waiting_review: 'purple',
    }[status || ''] || 'default'
  );
}

function activityStatusColor(status?: string) {
  return (
    {
      failed: 'error',
      partial_success: 'gold',
      running: 'processing',
      succeeded: 'success',
      waiting_review: 'purple',
    }[status || ''] || 'default'
  );
}

function formatTime(value?: string) {
  return value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '-';
}

function formatTerminalTimestamp(value?: string) {
  return value ? dayjs(value).format('MM-DD HH:mm:ss') : '--';
}

function openCreateModal() {
  taskForm.initialStock = 9999;
  taskForm.requiresManualReview = false;
  taskForm.signupMode = 'all';
  modalOpen.value = true;
}

const headerOptions = [
  {
    click: openCreateModal,
    label: '新建任务',
    renderType: 'button',
    type: 'primary',
  },
];

async function fetchTasks() {
  const response = await getTaobaoBaohaojiaTasks();
  tasks.value = response.items || [];
  return tasks.value;
}

function refreshList() {
  tableRef.value?.search?.();
}

function stopTerminalPolling() {
  if (terminalPollTimer) {
    clearInterval(terminalPollTimer);
    terminalPollTimer = null;
  }
}

function scrollTerminalToBottom() {
  nextTick(() => {
    if (terminalRef.value) {
      terminalRef.value.scrollTop = terminalRef.value.scrollHeight;
    }
  });
}

async function syncTerminalState(taskId: string) {
  if (!taskId) return;
  const [detailResponse, runsResponse] = await Promise.all([
    getTaobaoBaohaojiaTaskDetail(taskId),
    getTaobaoBaohaojiaTaskRuns(taskId).catch(() => ({ items: [], total: 0 })),
  ]);

  terminalTask.value = detailResponse.task;
  terminalDetail.value = detailResponse.detail;
  terminalRuns.value = runsResponse.items || [];

  if (currentTask.value?.id === taskId) {
    currentTask.value = detailResponse.task;
    currentDetail.value = detailResponse.detail;
    currentRuns.value = runsResponse.items || [];
  }

  const latestRun = detailResponse.detail?.latestRun;
  activeTerminalRunId.value = latestRun?.id || detailResponse.task.latestRunId || activeTerminalRunId.value;
  executeTerminalRunning.value = ['queued', 'running'].includes(latestRun?.status || detailResponse.task.status);
  scrollTerminalToBottom();

  if (!executeTerminalRunning.value) {
    stopTerminalPolling();
    refreshList();
  }
}

function startTerminalPolling(taskId: string) {
  stopTerminalPolling();
  terminalPollTimer = setInterval(() => {
    void syncTerminalState(taskId).catch((error: any) => {
      stopTerminalPolling();
      executeTerminalRunning.value = false;
      message.error(error?.message || '刷新爆好价执行日志失败');
    });
  }, 1500);
}

async function openExecuteTerminal(taskId: string, runId?: string) {
  activeTerminalTaskId.value = taskId;
  activeTerminalRunId.value = runId || '';
  executeTerminalOpen.value = true;
  executeTerminalRunning.value = true;
  await syncTerminalState(taskId);
  if (executeTerminalRunning.value) {
    startTerminalPolling(taskId);
  }
}

const terminalLogEntries = computed(() => terminalDetail.value?.recentLogs || []);
const terminalFormattedLines = computed(() =>
  terminalLogEntries.value.map((entry) =>
    [
      formatTerminalTimestamp(entry.createdAt),
      `[${(entry.level || 'info').toUpperCase()}]`,
      `[${entry.stage || 'desktop_executor'}]`,
      entry.message,
    ].join(' '),
  ),
);
const detailFormattedLines = computed(() =>
  (currentDetail.value?.recentLogs || []).map((entry) =>
    [
      formatTerminalTimestamp(entry.createdAt),
      `[${(entry.level || 'info').toUpperCase()}]`,
      `[${entry.stage || 'desktop_executor'}]`,
      entry.message,
    ].join(' '),
  ),
);
const terminalStatusText = computed(() => {
  const status = terminalDetail.value?.latestRun?.status || terminalTask.value?.status || 'draft';
  return formatTaskStatus(status as TaobaoBaohaojiaTaskStatus);
});
const terminalStatusColor = computed(() => {
  const status = terminalDetail.value?.latestRun?.status || terminalTask.value?.status || 'draft';
  return runStatusColor(status);
});

async function copyTerminalLogs() {
  try {
    await navigator.clipboard.writeText(terminalFormattedLines.value.join('\n'));
    message.success('日志已复制');
  } catch (error: any) {
    message.error(error?.message || '复制日志失败');
  }
}

async function copyDetailLogs() {
  try {
    await navigator.clipboard.writeText(detailFormattedLines.value.join('\n'));
    message.success('日志已复制');
  } catch (error: any) {
    message.error(error?.message || '复制日志失败');
  }
}

async function serveMethods(params: any) {
  const allTasks = await fetchTasks();
  const query = params?.data ?? params ?? {};
  const page = Number(query.page || 1);
  const pageSize = Number(query.pageSize || 10);

  let list = [...allTasks];
  if (`${query.status || ''}`.trim()) {
    list = list.filter((item) => item.status === query.status);
  }

  const total = list.length;
  const start = (page - 1) * pageSize;
  const pageList = list.slice(start, start + pageSize);

  return {
    list: pageList,
    total,
    totalPages: total,
  };
}

async function handleCreateTask() {
  modalLoading.value = true;
  try {
    const created = await createTaobaoBaohaojiaTask({
      initialStock: taskForm.initialStock,
      requiresManualReview: taskForm.requiresManualReview,
      signupMode: taskForm.signupMode,
      taskName: `爆好价活动报名任务-${dayjs().format('YYYYMMDD-HHmmss')}`,
    });
    modalOpen.value = false;
    await handleExecuteTask(created.task);
  } catch (error: any) {
    message.error(error?.message || '创建爆好价任务失败');
  } finally {
    modalLoading.value = false;
  }
}

async function openTaskDetail(task: TaobaoBaohaojiaTaskRecord) {
  drawerOpen.value = true;
  detailLoading.value = true;
  currentTask.value = task;
  try {
    const [detailResponse, runsResponse] = await Promise.all([
      getTaobaoBaohaojiaTaskDetail(task.id),
      getTaobaoBaohaojiaTaskRuns(task.id).catch(() => ({ items: [], total: 0 })),
    ]);
    currentTask.value = detailResponse.task;
    currentDetail.value = detailResponse.detail;
    currentRuns.value = runsResponse.items || [];

    const detail = detailResponse.detail;
    if (detail?.activityResults?.length) {
      activeTab.value = 'files';
    } else if (detail?.recentLogs?.length) {
      activeTab.value = 'logs';
    } else {
      activeTab.value = 'runs';
    }
  } catch (error: any) {
    currentDetail.value = null;
    currentRuns.value = [];
    message.error(error?.message || '加载任务详情失败');
  } finally {
    detailLoading.value = false;
  }
}

async function handleExecuteTask(task: TaobaoBaohaojiaTaskRecord) {
  try {
    const [detailResponse, runsResponse] = await Promise.all([
      getTaobaoBaohaojiaTaskDetail(task.id),
      getTaobaoBaohaojiaTaskRuns(task.id).catch(() => ({ items: [], total: 0 })),
    ]);
    const recordedActivityResults = buildRecordedActivityPayloads(
      detailResponse.detail,
      runsResponse.items || [],
    );
    const rerunRecorded = recordedActivityResults.length > 0;
    const run = await executeTaobaoBaohaojiaTask(task, { triggerSource: 'ui' });
    await openExecuteTerminal(task.id, run.id);
    if (window.ipcRenderer) {
      const result = await window.ipcRenderer.invoke('execute-taobao-baohaojia-task', {
        action: rerunRecorded ? 'rerun_recorded' : 'execute',
        initialStock: task.initialStock,
        recordedActivityResults: rerunRecorded ? recordedActivityResults : undefined,
        requiresManualReview: task.requiresManualReview ?? false,
        runId: run.id,
        signupMode: task.signupMode || 'all',
        taskId: task.id,
        taskName: task.taskName,
      });
      message.success(
        result?.message || (rerunRecorded ? '桌面端已开始重跑当前任务已记录活动' : '桌面端已接管爆好价自动化执行'),
      );
    } else {
      message.success('任务已进入执行队列，等待桌面端接管');
    }
    refreshList();
    if (drawerOpen.value && currentTask.value?.id === task.id) {
      await openTaskDetail(task);
    }
  } catch (error: any) {
    executeTerminalRunning.value = false;
    stopTerminalPolling();
    message.error(error?.message || '启动爆好价任务失败');
  }
}

async function handleContinueReview(task: TaobaoBaohaojiaTaskRecord) {
  try {
    const waitingActivities = (currentDetail.value?.activityResults || [])
      .filter((item) => item.status === 'waiting_review')
      .map(toReviewActivityPayload);
    if (waitingActivities.length === 0) {
      message.warning('当前没有待审核活动');
      return;
    }
    const run = await continueTaobaoBaohaojiaTaskReview(task);
    await openExecuteTerminal(task.id, run.id);
    if (window.ipcRenderer) {
      const result = await window.ipcRenderer.invoke('continue-taobao-baohaojia-task-review', {
        initialStock: task.initialStock,
        requiresManualReview: false,
        reviewActivityResults: waitingActivities,
        runId: run.id,
        signupMode: task.signupMode || 'all',
        taskId: task.id,
        taskName: task.taskName,
      });
      message.success(result?.message || '桌面端已开始继续提报待审核活动');
    }
    refreshList();
    if (drawerOpen.value && currentTask.value?.id === task.id) {
      await openTaskDetail(task);
    }
  } catch (error: any) {
    executeTerminalRunning.value = false;
    stopTerminalPolling();
    message.error(error?.message || '继续执行爆好价任务失败');
  }
}

async function handleDeleteTask(taskId: string) {
  await deleteTaobaoBaohaojiaTask(taskId);
  if (currentTask.value?.id === taskId) {
    drawerOpen.value = false;
    currentTask.value = null;
    currentDetail.value = null;
    currentRuns.value = [];
  }
  refreshList();
  message.success('任务已删除');
}

function toReviewActivityPayload(activity: TaobaoBaohaojiaTaskActivityResult) {
  return {
    activityId: activity.activityId,
    activityName: activity.activityName,
    sourceTab: activity.sourceTab,
    uploadFile: activity.uploadFile
      ? {
          fileBase64: activity.uploadFile.fileBase64,
          fileName: activity.uploadFile.fileName,
          localPath: activity.uploadFile.localPath,
          mimeType: activity.uploadFile.mimeType,
        }
      : undefined,
  };
}

function isUsableActivityDetailRoute(route?: string) {
  const value = `${route || ''}`.trim();
  return !!value && /activity-detail-v2|activityId=/u.test(value);
}

function buildRecordedActivityPayloads(
  detail: null | TaobaoBaohaojiaTaskDetailRecord,
  runs: TaobaoBaohaojiaTaskRun[],
) {
  const activityMap = new Map<
    string,
    {
      activityId: string;
      activityName: string;
      detailRoute?: string;
      sourceTab?: '已报名活动' | '未报名活动';
    }
  >();

  const applyActivity = (activity?: TaobaoBaohaojiaTaskActivityResult) => {
    if (!activity?.activityId) return;
    const existing = activityMap.get(activity.activityId);
    activityMap.set(activity.activityId, {
      activityId: activity.activityId,
      activityName: activity.activityName || existing?.activityName || activity.activityId,
      detailRoute: isUsableActivityDetailRoute(activity.detailRoute)
        ? activity.detailRoute
        : existing?.detailRoute,
      sourceTab: activity.sourceTab || existing?.sourceTab,
    });
  };

  for (const run of [...runs].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))) {
    for (const activity of run.activityResults || []) {
      applyActivity(activity);
    }
  }

  for (const activity of detail?.activityResults || []) {
    applyActivity(activity);
  }

  return Array.from(activityMap.values());
}

const tableColumns = [
  { dataIndex: 'taskName', title: '任务名称', minWidth: 220 },
  {
    dataIndex: 'signupMode',
    title: '报名模式',
    width: 120,
    render: (_h: any, ctx: { row?: TaobaoBaohaojiaTaskRecord }) =>
      formatSignupMode(ctx.row?.signupMode),
  },
  {
    dataIndex: 'requiresManualReview',
    title: '审核模式',
    width: 120,
    render: (_h: any, ctx: { row?: TaobaoBaohaojiaTaskRecord }) =>
      ctx.row?.requiresManualReview ? '人工审核' : '全自动',
  },
  {
    dataIndex: 'initialStock',
    title: '初始库存',
    width: 100,
  },
  { dataIndex: 'activityCount', title: '活动数', width: 90 },
  { dataIndex: 'successActivityCount', title: '成功活动', width: 90 },
  { dataIndex: 'failedActivityCount', title: '失败活动', width: 90 },
  { dataIndex: 'actualStoreCount', title: '实际报名门店', width: 110 },
  {
    dataIndex: 'status',
    title: '任务状态',
    width: 120,
    render: (_h: any, ctx: { row?: TaobaoBaohaojiaTaskRecord }) => {
      const row = ctx.row;
      if (!row) return '-';
      return <Tag color={taskStatusColor(row.status)}>{formatTaskStatus(row.status)}</Tag>;
    },
  },
  {
    dataIndex: 'latestRunStatus',
    title: '最近运行',
    width: 120,
    render: (_h: any, ctx: { row?: TaobaoBaohaojiaTaskRecord }) => {
      const status = ctx.row?.latestRunStatus;
      return status ? <Tag color={runStatusColor(status)}>{formatTaskStatus(status as any)}</Tag> : '-';
    },
  },
  {
    dataIndex: 'lastRunAt',
    title: '最近执行时间',
    width: 170,
    render: (_h: any, ctx: { row?: TaobaoBaohaojiaTaskRecord }) =>
      formatTime(ctx.row?.lastRunAt),
  },
  {
    dataIndex: 'updatedAt',
    title: '更新时间',
    width: 170,
    render: (_h: any, ctx: { row?: TaobaoBaohaojiaTaskRecord }) =>
      formatTime(ctx.row?.updatedAt),
  },
  {
    title: '操作',
    width: 260,
    render: (_h: any, ctx: { row?: TaobaoBaohaojiaTaskRecord }) => {
      const row = ctx.row;
      if (!row) return null;
      const running = row.status === 'queued' || row.status === 'running';
      return (
        <Space size="small">
          <Button type="link" disabled={running} onClick={() => handleExecuteTask(row)}>
            执行
          </Button>
          <Button type="link" onClick={() => openTaskDetail(row)}>
            详情
          </Button>
          <Popconfirm title="确认删除这个任务吗？" onConfirm={() => handleDeleteTask(row.id)}>
            <Button danger type="link">
              删除
            </Button>
          </Popconfirm>
        </Space>
      );
    },
  },
];

const runColumns = [
  {
    dataIndex: 'createdAt',
    title: '创建时间',
    width: 180,
    render: (_h: any, ctx: { row?: TaobaoBaohaojiaTaskRun }) => formatTime(ctx.row?.createdAt),
  },
  {
    dataIndex: 'status',
    title: '状态',
    width: 110,
    render: (_h: any, ctx: { row?: TaobaoBaohaojiaTaskRun }) => {
      const status = ctx.row?.status;
      return status ? <Tag color={runStatusColor(status)}>{formatTaskStatus(status as any)}</Tag> : '-';
    },
  },
  { dataIndex: 'currentStage', title: '当前阶段', width: 180 },
  {
    dataIndex: 'finishedAt',
    title: '结束时间',
    width: 180,
    render: (_h: any, ctx: { row?: TaobaoBaohaojiaTaskRun }) => formatTime(ctx.row?.finishedAt),
  },
  { dataIndex: 'failureReason', title: '失败原因', minWidth: 260 },
];

const analysisColumns = [
  { dataIndex: 'upc', title: 'UPC', width: 160 },
  { dataIndex: 'productName', title: '商品名称', minWidth: 220 },
  {
    dataIndex: 'activityPrice',
    title: '活动价',
    width: 100,
    render: (_h: any, ctx: { row?: TaobaoBaohaojiaTaskItem }) =>
      ctx.row?.activityPrice != null ? `¥${ctx.row.activityPrice}` : '-',
  },
  {
    dataIndex: 'procurementCost',
    title: '最小单位采购价',
    width: 120,
    render: (_h: any, ctx: { row?: TaobaoBaohaojiaTaskItem }) =>
      ctx.row?.procurementCost != null ? `¥${ctx.row.procurementCost}` : '-',
  },
  {
    dataIndex: 'reasons',
    title: '说明',
    minWidth: 220,
    render: (_h: any, ctx: { row?: TaobaoBaohaojiaTaskItem }) =>
      ctx.row?.reasons?.join('；') || ctx.row?.reason || '-',
  },
];

const drawerTitle = computed(() => {
  if (!currentTask.value) return '任务详情';
  return `${currentTask.value.taskName} - 详情`;
});

function formatFileName(fileName?: string) {
  return fileName || '未生成';
}

function formatStoreSnapshot(storeNames?: string[]) {
  return storeNames?.length ? storeNames.join('、') : '-';
}

onBeforeUnmount(() => {
  stopTerminalPolling();
});
</script>

<template>
  <Page title="爆好价活动报名">
    <SimpleTemplate
      ref="tableRef"
      v-model="searchFormModel"
      row-key="id"
      :columns="tableColumns"
      :header-options="headerOptions"
      :search-form-items="searchFormItems"
      :serve-methods="serveMethods"
      :show-page="true"
    />

    <Modal
      v-model:open="modalOpen"
      title="新建爆好价任务"
      ok-text="确认创建并开始执行"
      :confirm-loading="modalLoading"
      destroy-on-close
      @ok="handleCreateTask"
    >
      <Form layout="vertical">
        <div class="create-tip">
          确认后系统会自动生成爆好价任务名称，并立即按当前报名模式开始执行，无需再次点击执行。人工审核默认关闭，只有手动打开时才会停在待审核阶段。
        </div>
        <Form.Item label="报名模式">
          <Select
            v-model:value="taskForm.signupMode"
            :options="signupModeOptions"
          />
        </Form.Item>
        <Form.Item label="是否人工审核">
          <Switch v-model:checked="taskForm.requiresManualReview" />
        </Form.Item>
        <Form.Item label="活动初始库存">
          <InputNumber
            v-model:value="taskForm.initialStock"
            :min="0"
            :precision="0"
            style="width: 100%"
          />
        </Form.Item>
      </Form>
    </Modal>

    <Drawer
      v-model:open="drawerOpen"
      :width="1200"
      destroy-on-close
      :title="drawerTitle"
    >
      <div v-if="currentTask && currentDetail" class="detail-panel">
        <Card size="small" class="mb-4">
          <div class="mt-4 flex justify-end gap-2">
            <Button type="primary" @click="handleExecuteTask(currentTask)">执行任务</Button>
            <Button
              v-if="currentTask.status === 'waiting_review'"
              type="primary"
              ghost
              @click="handleContinueReview(currentTask)"
            >
              审核通过并继续报名
            </Button>
          </div>
        </Card>

        <Tabs v-model:activeKey="activeTab">
          <Tabs.TabPane :key="'files'" :tab="`执行成果 (${currentDetail.activityResults?.length || 0})`">
            <div class="file-group-list">
              <Card
                v-for="activity in currentDetail.activityResults || []"
                :key="activity.activityId"
                size="small"
                class="file-group-card"
              >
                <template #title>
                  <div class="file-group-title">
                    <span>{{ formatActivityDisplayName(activity.activityName) }}</span>
                    <Tag color="blue">
                      {{ [activity.sourceTab || '-', formatTaskStatus(activity.status as any)].join(' · ') }}
                    </Tag>
                  </div>
                </template>

                <Descriptions :column="2" bordered size="small">
                  <Descriptions.Item label="活动时间">
                    {{ parseActivityDisplay(activity.activityName).timeText || '-' }}
                  </Descriptions.Item>
                  <Descriptions.Item label="结果状态">
                    <Tag :color="activityStatusColor(activity.status)">
                      {{ formatTaskStatus(activity.status as any) }}
                    </Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="门店数">
                    {{ activity.storeCount || 0 }}
                  </Descriptions.Item>
                  <Descriptions.Item label="导出商品数">
                    {{ activity.exportedRowCount || 0 }}
                  </Descriptions.Item>
                  <Descriptions.Item label="上传商品数">
                    {{ activity.uploadedRowCount || 0 }}
                  </Descriptions.Item>
                  <Descriptions.Item label="门店快照" :span="2">
                    {{ formatStoreSnapshot(activity.storeNames) }}
                  </Descriptions.Item>
                  <Descriptions.Item label="活动说明" :span="2">
                    {{ parseActivityDisplay(activity.activityName).extraText || '-' }}
                  </Descriptions.Item>
                  <Descriptions.Item label="结果说明" :span="2">
                    {{ activity.message || '-' }}
                  </Descriptions.Item>
                  <Descriptions.Item label="文件产物" :span="2">
                    <div class="result-file-list">
                      <span>导出文件：{{ formatFileName(activity.exportedFile?.fileName) }}</span>
                      <span>上传文件：{{ formatFileName(activity.uploadFile?.fileName) }}</span>
                      <span>审计文件：{{ formatFileName(activity.auditFile?.fileName) }}</span>
                    </div>
                  </Descriptions.Item>
                </Descriptions>
              </Card>
            </div>
            <Empty v-if="!(currentDetail.activityResults?.length)" description="暂无执行成果" />
          </Tabs.TabPane>

          <Tabs.TabPane :key="'logs'" :tab="`执行日志 (${currentDetail.recentLogs?.length || 0})`">
            <div class="log-shell">
              <div class="log-toolbar">
                <Tag :color="terminalStatusColor">{{ terminalStatusText }}</Tag>
                <span class="log-run-id">{{ currentDetail.latestRun?.id || currentTask.latestRunId || '暂无运行记录' }}</span>
                <Button size="small" :disabled="detailFormattedLines.length === 0" @click="copyDetailLogs">
                  复制日志
                </Button>
              </div>

              <div class="terminal-frame">
                <div class="terminal-header">
                  <span class="dot dot-red"></span>
                  <span class="dot dot-amber"></span>
                  <span class="dot dot-green"></span>
                  <span class="terminal-title">baohaojia-detail-log</span>
                </div>
                <div class="terminal-panel terminal-panel-detail">
                  <div
                    v-for="(line, index) in detailFormattedLines"
                    :key="`detail-log-${index}`"
                    class="terminal-line"
                  >
                    {{ line }}
                  </div>
                  <div v-if="detailFormattedLines.length === 0" class="terminal-empty">
                    暂无执行日志。
                  </div>
                </div>
              </div>
            </div>
          </Tabs.TabPane>

          <Tabs.TabPane :key="'runs'" :tab="`运行记录 (${currentRuns.length})`">
            <Table
              :columns="runColumns"
              :data-source="currentRuns"
              :pagination="{ pageSize: 10, showSizeChanger: true }"
              row-key="id"
              :scroll="{ x: 1000 }"
              size="small"
            >
              <template #emptyText>
                <Empty description="暂无运行记录" />
              </template>
            </Table>
          </Tabs.TabPane>

          <Tabs.TabPane :key="'analysis'" :tab="'商品分析'">
            <div class="analysis-section">
              <h4>可报名商品</h4>
              <Table
                :columns="analysisColumns"
                :data-source="currentDetail.qualifiedItems || []"
                :pagination="{ pageSize: 10, showSizeChanger: true }"
                row-key="id"
                :scroll="{ x: 980 }"
                size="small"
              />
            </div>
            <div class="analysis-section">
              <h4>待确认商品</h4>
              <Table
                :columns="analysisColumns"
                :data-source="currentDetail.reviewItems || []"
                :pagination="{ pageSize: 10, showSizeChanger: true }"
                row-key="id"
                :scroll="{ x: 980 }"
                size="small"
              />
            </div>
            <div class="analysis-section">
              <h4>已过滤商品</h4>
              <Table
                :columns="analysisColumns"
                :data-source="currentDetail.excludedItems || []"
                :pagination="{ pageSize: 10, showSizeChanger: true }"
                row-key="id"
                :scroll="{ x: 980 }"
                size="small"
              />
            </div>
          </Tabs.TabPane>
        </Tabs>
      </div>
      <div v-else-if="detailLoading" class="detail-empty">
        正在加载任务详情...
      </div>
      <Empty v-else description="暂无任务详情" />
    </Drawer>

    <Modal
      v-model:open="executeTerminalOpen"
      :destroy-on-close="false"
      :footer="null"
      :title="executeTerminalRunning ? '爆好价运行日志（执行中）' : '爆好价运行日志'"
      width="1040px"
      @cancel="stopTerminalPolling"
    >
      <div class="log-shell">
        <div class="log-toolbar">
          <Tag :color="terminalStatusColor">{{ terminalStatusText }}</Tag>
          <span class="log-run-id">{{ activeTerminalRunId || '等待生成 runId' }}</span>
          <Button size="small" :disabled="terminalFormattedLines.length === 0" @click="copyTerminalLogs">
            复制日志
          </Button>
        </div>

        <div class="terminal-frame">
          <div class="terminal-header">
            <span class="dot dot-red"></span>
            <span class="dot dot-amber"></span>
            <span class="dot dot-green"></span>
            <span class="terminal-title">baohaojia-terminal</span>
          </div>
          <div ref="terminalRef" class="terminal-panel">
            <div
              v-for="(line, index) in terminalFormattedLines"
              :key="`${activeTerminalRunId}_${index}`"
              class="terminal-line"
            >
              {{ line }}
            </div>
            <div v-if="terminalFormattedLines.length === 0" class="terminal-empty">
              运行日志会实时显示在这里。
            </div>
          </div>
        </div>

        <Card size="small" class="terminal-summary-card">
          <Descriptions :column="2" bordered size="small">
            <Descriptions.Item label="审核模式">
              {{ terminalTask?.requiresManualReview ? '人工审核' : '全自动' }}
            </Descriptions.Item>
            <Descriptions.Item label="报名模式">
              {{ formatSignupMode(terminalTask?.signupMode) }}
            </Descriptions.Item>
            <Descriptions.Item label="当前阶段">
              {{ terminalDetail?.latestRun?.currentStage || '-' }}
            </Descriptions.Item>
            <Descriptions.Item label="最近更新时间">
              {{ formatTime(terminalDetail?.latestRun?.updatedAt) }}
            </Descriptions.Item>
            <Descriptions.Item label="失败原因" :span="2">
              {{ terminalDetail?.latestRun?.failureReason || terminalTask?.summaryText || '-' }}
            </Descriptions.Item>
          </Descriptions>
        </Card>
      </div>
    </Modal>
  </Page>
</template>

<style scoped>
.summary-text {
  white-space: pre-line;
  color: rgb(82 82 91);
}

.activity-name-meta {
  margin-top: 4px;
  color: rgb(113 113 122);
  font-size: 12px;
  line-height: 1.5;
}

.detail-empty {
  padding: 48px 0;
  text-align: center;
  color: rgb(115 115 115);
}

.analysis-section + .analysis-section {
  margin-top: 24px;
}

.file-group-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.file-group-card {
  border-radius: 14px;
}

.file-group-title {
  display: flex;
  align-items: center;
  gap: 12px;
  justify-content: space-between;
}

.result-inline-text {
  word-break: break-all;
}

.result-file-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.analysis-section h4 {
  margin-bottom: 12px;
  font-size: 14px;
  font-weight: 600;
}

.log-shell {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.log-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  justify-content: space-between;
}

.log-run-id {
  flex: 1;
  overflow: hidden;
  color: rgb(82 82 91);
  font-family: 'SFMono-Regular', 'Menlo', monospace;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.terminal-frame {
  overflow: hidden;
  border: 1px solid rgb(228 228 231);
  border-radius: 18px;
  background: rgb(9 9 11);
}

.terminal-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid rgb(39 39 42);
  background: rgb(24 24 27);
}

.terminal-title {
  margin-left: 8px;
  color: rgb(212 212 216);
  font-family: 'SFMono-Regular', 'Menlo', monospace;
  font-size: 12px;
}

.terminal-panel {
  max-height: 420px;
  overflow: auto;
  padding: 16px;
  color: rgb(228 228 231);
  font-family: 'SFMono-Regular', 'Menlo', monospace;
  font-size: 12px;
  line-height: 1.7;
}

.terminal-panel-detail {
  max-height: 520px;
}

.terminal-line + .terminal-line {
  margin-top: 6px;
}

.terminal-empty {
  color: rgb(161 161 170);
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 9999px;
}

.dot-red {
  background: #f87171;
}

.dot-amber {
  background: #fbbf24;
}

.dot-green {
  background: #4ade80;
}

.terminal-summary-card {
  border-radius: 16px;
}

.create-tip {
  margin-bottom: 16px;
  padding: 12px 14px;
  border: 1px solid rgb(229 231 235);
  border-radius: 12px;
  background: rgb(249 250 251);
  color: rgb(75 85 99);
  line-height: 1.6;
}
</style>
