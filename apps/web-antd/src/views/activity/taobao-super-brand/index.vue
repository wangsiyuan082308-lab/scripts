<script setup lang="tsx">
import type {
  TaobaoSuperBrandTaskDetailRecord,
  TaobaoSuperBrandTaskRecord,
  TaobaoSuperBrandTaskRun,
  TaobaoSuperBrandTaskStatus,
} from '#/api/taobao-super-brand-task-repo';

import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue';

import { Page } from '@vben/common-ui';

import dayjs from 'dayjs';
import {
  Button,
  Card,
  Descriptions,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  message,
} from 'ant-design-vue';
import { useRoute } from 'vue-router';

import {
  createTaobaoSuperBrandTask,
  deleteTaobaoSuperBrandTask,
  executeTaobaoSuperBrandTask,
  getTaobaoSuperBrandTaskDetail,
  getTaobaoSuperBrandTasks,
  getTaobaoSuperBrandTaskRuns,
} from '#/api/taobao-super-brand';
import SimpleTemplate from '#/components/base/SimpleTemplate/index.vue';
import {
  getTaobaoMarketingTagScene,
  resolveTaobaoMarketingEntryScope,
} from '#/features/taobao-marketing-tag/config';

type DetailTabKey = 'activities' | 'logs' | 'runs';

const route = useRoute();
const sceneKey = computed(
  () => `${route.meta?.sceneKey || route.params?.sceneKey || 'super_brand'}`.trim() || 'super_brand',
);
const SCENE = computed(() => getTaobaoMarketingTagScene(sceneKey.value));

const tableRef = ref();
const modalOpen = ref(false);
const modalLoading = ref(false);
const drawerOpen = ref(false);
const detailLoading = ref(false);
const activeTab = ref<DetailTabKey>('activities');
const executeTerminalOpen = ref(false);
const executeTerminalRunning = ref(false);
const activeTerminalRunId = ref('');
const terminalRef = ref<HTMLElement>();

const tasks = ref<TaobaoSuperBrandTaskRecord[]>([]);
const currentTask = ref<null | TaobaoSuperBrandTaskRecord>(null);
const currentDetail = ref<null | TaobaoSuperBrandTaskDetailRecord>(null);
const currentRuns = ref<TaobaoSuperBrandTaskRun[]>([]);
const terminalTask = ref<null | TaobaoSuperBrandTaskRecord>(null);
const terminalDetail = ref<null | TaobaoSuperBrandTaskDetailRecord>(null);

let terminalPollTimer: null | ReturnType<typeof setInterval> = null;

const searchFormModel = ref({
  marketingTag: '',
  page: 1,
  pageSize: 10,
  status: '',
  taskName: '',
});

const taskForm = reactive({
  marketingTag: SCENE.value.marketingTag,
  taskName: '',
});

const marketingTagOptions = computed(() => [
  { label: SCENE.value.marketingTag, value: SCENE.value.marketingTag },
]);

function formatTaskStatus(status: TaobaoSuperBrandTaskStatus) {
  return (
    {
      draft: '草稿',
      failed: '执行失败',
      partial_success: '部分成功',
      queued: '排队中',
      running: '执行中',
      succeeded: '执行成功',
    }[status] || status
  );
}

function taskStatusColor(status: TaobaoSuperBrandTaskStatus) {
  return (
    {
      draft: 'default',
      failed: 'error',
      partial_success: 'gold',
      queued: 'blue',
      running: 'processing',
      succeeded: 'success',
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
    }[status || ''] || 'default'
  );
}

function formatTime(value?: string) {
  return value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '-';
}

function formatTerminalTimestamp(value?: string) {
  return value ? dayjs(value).format('MM-DD HH:mm:ss') : '--';
}

const taskStatusOptions = [
  { label: '草稿', value: 'draft' },
  { label: '排队中', value: 'queued' },
  { label: '执行中', value: 'running' },
  { label: '执行成功', value: 'succeeded' },
  { label: '部分成功', value: 'partial_success' },
  { label: '执行失败', value: 'failed' },
];

const searchFormItems = computed(() => [
  {
    label: '任务名称',
    child: {
      placeholder: '搜索任务名称',
      renderType: 'input',
      valueKey: 'taskName',
    },
  },
  {
    label: '营销标签',
    child: {
      options: marketingTagOptions.value,
      renderType: 'select',
      valueKey: 'marketingTag',
    },
  },
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

function openCreateModal() {
  taskForm.marketingTag = SCENE.value.marketingTag;
  taskForm.taskName = '';
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
  const response = await getTaobaoSuperBrandTasks();
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
    getTaobaoSuperBrandTaskDetail(taskId),
    getTaobaoSuperBrandTaskRuns(taskId).catch(() => ({ items: [], total: 0 })),
  ]);

  terminalTask.value = detailResponse.task;
  terminalDetail.value = detailResponse.detail;

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
      message.error(error?.message || `刷新${SCENE.value.pageTitle}执行日志失败`);
    });
  }, 1500);
}

async function openExecuteTerminal(taskId: string, runId?: string) {
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
  return formatTaskStatus(status as TaobaoSuperBrandTaskStatus);
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
  if (`${query.marketingTag || ''}`.trim()) {
    list = list.filter((item) => item.marketingTag === query.marketingTag);
  }
  if (`${query.taskName || ''}`.trim()) {
    const keyword = `${query.taskName}`.trim().toLowerCase();
    list = list.filter((item) => `${item.taskName}`.toLowerCase().includes(keyword));
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
    const created = await createTaobaoSuperBrandTask({
      marketingTag: taskForm.marketingTag,
      entryScope: resolveTaobaoMarketingEntryScope({
        marketingTag: taskForm.marketingTag,
        requestedEntryScope: SCENE.value.entryScope,
        sceneKey: sceneKey.value,
      }),
      taskName:
        `${taskForm.taskName || ''}`.trim() ||
        `${SCENE.value.taskNamePrefix}-${dayjs().format('YYYYMMDD-HHmmss')}`,
    });
    modalOpen.value = false;
    await handleExecuteTask(created.task);
  } catch (error: any) {
    message.error(error?.message || `创建${SCENE.value.pageTitle}任务失败`);
  } finally {
    modalLoading.value = false;
  }
}

async function openTaskDetail(task: TaobaoSuperBrandTaskRecord) {
  drawerOpen.value = true;
  detailLoading.value = true;
  currentTask.value = task;
  try {
    const [detailResponse, runsResponse] = await Promise.all([
      getTaobaoSuperBrandTaskDetail(task.id),
      getTaobaoSuperBrandTaskRuns(task.id).catch(() => ({ items: [], total: 0 })),
    ]);
    currentTask.value = detailResponse.task;
    currentDetail.value = detailResponse.detail;
    currentRuns.value = runsResponse.items || [];

    if (detailResponse.detail?.activityResults?.length) {
      activeTab.value = 'activities';
    } else if (detailResponse.detail?.recentLogs?.length) {
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

async function handleExecuteTask(task: TaobaoSuperBrandTaskRecord) {
  try {
    const run = await executeTaobaoSuperBrandTask(task, { triggerSource: 'ui' });
    await openExecuteTerminal(task.id, run.id);
    if (window.ipcRenderer) {
      const result = await window.ipcRenderer.invoke('execute-taobao-super-brand-task', {
        marketingTag: task.marketingTag || SCENE.value.marketingTag,
        entryScope: resolveTaobaoMarketingEntryScope({
          marketingTag: task.marketingTag || SCENE.value.marketingTag,
          requestedEntryScope: task.entryScope || SCENE.value.entryScope,
          sceneKey: sceneKey.value,
        }),
        runId: run.id,
        taskId: task.id,
        taskName: task.taskName,
      });
      message.success(result?.message || `桌面端已接管${SCENE.value.pageTitle}自动化执行`);
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
    message.error(error?.message || `启动${SCENE.value.pageTitle}任务失败`);
  }
}

async function handleDeleteTask(taskId: string) {
  await deleteTaobaoSuperBrandTask(taskId);
  if (currentTask.value?.id === taskId) {
    drawerOpen.value = false;
    currentTask.value = null;
    currentDetail.value = null;
    currentRuns.value = [];
  }
  refreshList();
  message.success('任务已删除');
}

function formatStoreSnapshot(storeNames?: string[]) {
  return storeNames?.length ? storeNames.join('、') : '-';
}

const tableColumns = [
  { dataIndex: 'taskName', title: '任务名称', minWidth: 220 },
  {
    dataIndex: 'marketingTag',
    title: '营销标签',
    width: 150,
    render: (_h: any, ctx: { row?: TaobaoSuperBrandTaskRecord }) => {
      return <Tag color="blue">{ctx.row?.marketingTag || SCENE.value.marketingTag}</Tag>;
    },
  },
  { dataIndex: 'activityCount', title: '活动数', width: 90 },
  { dataIndex: 'successActivityCount', title: '成功活动', width: 90 },
  { dataIndex: 'failedActivityCount', title: '失败活动', width: 90 },
  { dataIndex: 'actualStoreCount', title: '报名门店数', width: 110 },
  {
    dataIndex: 'status',
    title: '任务状态',
    width: 120,
    render: (_h: any, ctx: { row?: TaobaoSuperBrandTaskRecord }) => {
      const row = ctx.row;
      if (!row) return '-';
      return <Tag color={taskStatusColor(row.status)}>{formatTaskStatus(row.status)}</Tag>;
    },
  },
  {
    dataIndex: 'latestRunStatus',
    title: '最近运行',
    width: 120,
    render: (_h: any, ctx: { row?: TaobaoSuperBrandTaskRecord }) => {
      const status = ctx.row?.latestRunStatus;
      return status ? <Tag color={runStatusColor(status)}>{formatTaskStatus(status as any)}</Tag> : '-';
    },
  },
  {
    dataIndex: 'lastRunAt',
    title: '最近执行时间',
    width: 170,
    render: (_h: any, ctx: { row?: TaobaoSuperBrandTaskRecord }) => formatTime(ctx.row?.lastRunAt),
  },
  {
    dataIndex: 'updatedAt',
    title: '更新时间',
    width: 170,
    render: (_h: any, ctx: { row?: TaobaoSuperBrandTaskRecord }) => formatTime(ctx.row?.updatedAt),
  },
  {
    title: '操作',
    width: 260,
    render: (_h: any, ctx: { row?: TaobaoSuperBrandTaskRecord }) => {
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
    render: (_h: any, ctx: { row?: TaobaoSuperBrandTaskRun }) => formatTime(ctx.row?.createdAt),
  },
  {
    dataIndex: 'status',
    title: '状态',
    width: 110,
    render: (_h: any, ctx: { row?: TaobaoSuperBrandTaskRun }) => {
      const status = ctx.row?.status;
      return status ? <Tag color={runStatusColor(status)}>{formatTaskStatus(status as any)}</Tag> : '-';
    },
  },
  { dataIndex: 'currentStage', title: '当前阶段', width: 180 },
  {
    dataIndex: 'finishedAt',
    title: '结束时间',
    width: 180,
    render: (_h: any, ctx: { row?: TaobaoSuperBrandTaskRun }) => formatTime(ctx.row?.finishedAt),
  },
  { dataIndex: 'failureReason', title: '失败原因', minWidth: 260 },
];

const drawerTitle = computed(() => {
  if (!currentTask.value) return '任务详情';
  return `${currentTask.value.taskName} - 详情`;
});

onBeforeUnmount(() => {
  stopTerminalPolling();
});

watch(
  SCENE,
  (scene) => {
    taskForm.marketingTag = scene.marketingTag;
    searchFormModel.value.marketingTag = scene.marketingTag;
    refreshList();
  },
  { immediate: true },
);
</script>

<template>
  <Page :title="SCENE.pageTitle">
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
      :title="`新建${SCENE.pageTitle}任务`"
      ok-text="确认创建并开始执行"
      :confirm-loading="modalLoading"
      destroy-on-close
      @ok="handleCreateTask"
    >
      <Form layout="vertical">
        <div class="create-tip">
          {{ SCENE.description }}
        </div>
        <Form.Item label="任务名称">
          <Input
            v-model:value="taskForm.taskName"
            placeholder="为空时自动生成任务名称"
          />
        </Form.Item>
        <Form.Item label="活动入口">
          <Input :value="SCENE.entryScope === 'brand_activity' ? '品牌活动' : '未报名活动'" disabled />
        </Form.Item>
        <Form.Item label="营销标签">
          <Select
            v-model:value="taskForm.marketingTag"
            :options="marketingTagOptions"
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
          <Descriptions :column="2" bordered size="small">
            <Descriptions.Item label="活动入口">
              {{ currentTask.entryScope === 'brand_activity' ? '品牌活动' : '未报名活动' }}
            </Descriptions.Item>
            <Descriptions.Item label="营销标签">
              <Tag color="blue">{{ currentTask.marketingTag || SCENE.marketingTag }}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="报名门店数">
              {{ currentTask.actualStoreCount || 0 }}
            </Descriptions.Item>
            <Descriptions.Item label="任务状态">
              <Tag :color="taskStatusColor(currentTask.status)">
                {{ formatTaskStatus(currentTask.status) }}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="最近执行时间">
              {{ formatTime(currentTask.lastRunAt) }}
            </Descriptions.Item>
            <Descriptions.Item label="任务摘要" :span="2">
              <div class="summary-text">{{ currentTask.summaryText || '暂无任务摘要' }}</div>
            </Descriptions.Item>
          </Descriptions>

          <div class="mt-4 flex justify-end gap-2">
            <Button type="primary" @click="handleExecuteTask(currentTask)">执行任务</Button>
          </div>
        </Card>

        <Tabs v-model:activeKey="activeTab">
          <Tabs.TabPane :key="'activities'" :tab="`执行成果 (${currentDetail.activityResults?.length || 0})`">
            <div class="file-group-list">
              <Card
                v-for="activity in currentDetail.activityResults || []"
                :key="activity.activityId"
                size="small"
                class="file-group-card"
              >
                <template #title>
                  <div class="file-group-title">
                    <span>{{ activity.activityName }}</span>
                    <Tag :color="runStatusColor(activity.status)">
                      {{ formatTaskStatus(activity.status as any) }}
                    </Tag>
                  </div>
                </template>

                <Descriptions :column="2" bordered size="small">
                  <Descriptions.Item label="营销标签">
                    <Tag color="blue">{{ activity.marketingTag || currentTask.marketingTag || SCENE.marketingTag }}</Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="来源视图">
                    {{ activity.sourceTab || '品牌活动' }}
                  </Descriptions.Item>
                  <Descriptions.Item label="门店数">
                    {{ activity.storeCount || 0 }}
                  </Descriptions.Item>
                  <Descriptions.Item label="商家出资占比">
                    {{ activity.merchantRatio != null ? `${(activity.merchantRatio * 100).toFixed(1)}%` : '-' }}
                  </Descriptions.Item>
                  <Descriptions.Item label="门店快照" :span="2">
                    {{ formatStoreSnapshot(activity.storeNames) }}
                  </Descriptions.Item>
                  <Descriptions.Item label="结果说明" :span="2">
                    {{ activity.message || '-' }}
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
                  <span class="terminal-title">super-brand-detail-log</span>
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
      :title="executeTerminalRunning ? `${SCENE.pageTitle}运行日志（执行中）` : `${SCENE.pageTitle}运行日志`"
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
            <span class="terminal-title">super-brand-terminal</span>
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
            <Descriptions.Item label="营销标签">
              {{ terminalTask?.marketingTag || SCENE.marketingTag }}
            </Descriptions.Item>
            <Descriptions.Item label="报名门店数">
              {{ terminalTask?.actualStoreCount || 0 }}
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

.detail-empty {
  padding: 48px 0;
  text-align: center;
  color: rgb(115 115 115);
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
