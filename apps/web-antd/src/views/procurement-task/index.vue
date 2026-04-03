<script setup lang="ts">
import { computed, h, onMounted, reactive, ref } from 'vue';

import { Page } from '@vben/common-ui';
import { useAccessStore } from '@vben/stores';

import {
  Button,
  Card,
  Descriptions,
  Drawer,
  Form,
  Input,
  message,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Table,
  Tag,
} from 'ant-design-vue';

import {
  cancelProcurementRun,
  createProcurementTask,
  deleteProcurementTask,
  executeProcurementTask,
  getProcurementAlertEvents,
  getProcurementReportDetail,
  getProcurementTags,
  getProcurementTaskDetail,
  getProcurementTaskRuns,
  getProcurementTasks,
  getProcurementRunLogs,
  type ProcurementAlertEvent,
  type ProcurementReport,
  type ProcurementRun,
  type ProcurementTag,
  type ProcurementTask,
  updateProcurementTask,
} from '#/api/procurement';
import { getStoreList } from '#/api/store';
import { getSupplierList } from '#/api/supplier';
import SimpleTemplate from '#/components/base/SimpleTemplate/index.vue';

const accessStore = useAccessStore();
const suppliers = ref<Array<{ label: string; value: string }>>([]);
const stores = ref<Array<{ label: string; value: string }>>([]);
const tags = ref<ProcurementTag[]>([]);
const tableRef = ref();
const modalOpen = ref(false);
const drawerOpen = ref(false);
const runDrawerOpen = ref(false);
const editingId = ref('');
const currentTaskDetail = ref<any>(null);
const currentRuns = ref<ProcurementRun[]>([]);
const currentAlerts = ref<ProcurementAlertEvent[]>([]);
const currentLogs = ref<any[]>([]);
const currentReport = ref<null | ProcurementReport>(null);
const currentRun = ref<null | ProcurementRun>(null);

const filters = reactive({
  page: 1,
  pageSize: 10,
  platform: '',
  status: '',
  storeId: '',
  supplierId: '',
  tagId: '',
});

const form = reactive({
  autoRetryEnabled: true,
  maxItems: 500,
  platform: 'Aoxiang',
  scheduleType: 'Instant',
  storeIds: [] as string[],
  supplierIds: [] as string[],
  tagIds: [] as string[],
  weekDay: '',
});

const statusOptions = [
  { label: '草稿', value: 'draft' },
  { label: '待采购', value: 'pending' },
  { label: '采购中', value: 'running' },
  { label: '部分成功', value: 'partial_success' },
  { label: '失败', value: 'failed' },
  { label: '待重试', value: 'waiting_retry' },
  { label: '采购结束', value: 'succeeded' },
  { label: '已关闭', value: 'closed' },
  { label: '已取消', value: 'cancelled' },
];

function statusColor(status: string) {
  switch (status) {
    case 'succeeded':
      return 'success';
    case 'failed':
      return 'error';
    case 'running':
      return 'processing';
    case 'waiting_retry':
      return 'warning';
    case 'partial_success':
      return 'gold';
    default:
      return 'default';
  }
}

function refreshList() {
  tableRef.value?.search?.();
}

function resetForm() {
  form.autoRetryEnabled = true;
  form.maxItems = 500;
  form.platform = 'Aoxiang';
  form.scheduleType = 'Instant';
  form.storeIds = [];
  form.supplierIds = [];
  form.tagIds = [];
  form.weekDay = '';
}

async function fetchBaseOptions() {
  const [supplierRes, storeRes, tagRes] = await Promise.all([
    getSupplierList({}),
    getStoreList({}),
    getProcurementTags(),
  ]);
  suppliers.value = (supplierRes || []).map((item: any) => ({
    label: item.supplierName,
    value: item.supplierId,
  }));
  stores.value = (storeRes || []).map((item: any) => ({
    label: item.storeName,
    value: item.storeId,
  }));
  tags.value = tagRes || [];
}

function handleCreate() {
  editingId.value = '';
  resetForm();
  modalOpen.value = true;
}

function handleEdit(task: ProcurementTask) {
  editingId.value = task.id;
  form.autoRetryEnabled = task.autoRetryEnabled;
  form.maxItems = task.maxItems;
  form.platform = task.platform;
  form.scheduleType = task.scheduleType;
  form.storeIds = [...task.storeIds];
  form.supplierIds = [...task.supplierIds];
  form.tagIds = [...task.tagIds];
  form.weekDay = task.weekDay || '';
  modalOpen.value = true;
}

async function handleSubmit() {
  const payload = {
    autoRetryEnabled: form.autoRetryEnabled,
    maxItems: form.maxItems,
    platform: form.platform,
    scheduleType: form.scheduleType,
    storeIds: form.storeIds,
    supplierIds: form.supplierIds,
    tagIds: form.tagIds,
    weekDay: form.scheduleType === 'Weekly' ? form.weekDay : '',
  };

  if (editingId.value) {
    await updateProcurementTask(editingId.value, payload);
    message.success('采购任务已更新');
  } else {
    await createProcurementTask(payload);
    message.success('采购任务已创建，状态将由系统在执行时自动更新');
  }

  modalOpen.value = false;
  resetForm();
  refreshList();
}

async function handleDelete(task: ProcurementTask) {
  await deleteProcurementTask(task.id);
  message.success('采购任务已删除');
  refreshList();
}

async function handleExecute(task: ProcurementTask) {
  const run = await executeProcurementTask(task.id, { triggerSource: 'ui' });
  if (window.ipcRenderer) {
    const electronPayload = {
      accessToken: `${accessStore.accessToken || ''}`,
      maxItems: task.maxItems,
      platform: task.platform,
      runId: run.id,
      storeIds: [...(task.storeIds || [])],
      storeNames: [...(task.storeNames || [])],
      supplierId: task.supplierIds[0] || '',
      supplierIds: [...(task.supplierIds || [])],
      supplierName: task.supplierNames[0] || '',
      supplierNames: [...(task.supplierNames || [])],
      taskId: task.id,
      taskName: `${task.taskName || ''}`,
    };
    const result = await window.ipcRenderer.invoke('execute-procurement-task', {
      ...electronPayload,
    });
    message.success(result?.message || '桌面端已接管采购执行');
  } else {
    message.success('已创建采购执行实例，等待桌面端接管执行');
  }
  refreshList();
  if (drawerOpen.value && currentTaskDetail.value?.id === task.id) {
    await openTaskDetail(task.id);
  }
}

async function openTaskDetail(taskId: string) {
  drawerOpen.value = true;
  const detail = await getProcurementTaskDetail(taskId);
  currentTaskDetail.value = detail;
  const [runsRes, alertRes] = await Promise.all([
    getProcurementTaskRuns(taskId),
    getProcurementAlertEvents({ taskId }),
  ]);
  currentRuns.value = runsRes.items || [];
  currentAlerts.value = alertRes.items || [];
  currentReport.value = null;
}

async function openRunDetail(run: ProcurementRun) {
  currentRun.value = run;
  runDrawerOpen.value = true;
  const [logsRes, report] = await Promise.all([
    getProcurementRunLogs(run.id),
    run.reportId ? getProcurementReportDetail(run.reportId) : Promise.resolve(null),
  ]);
  currentLogs.value = logsRes.items || [];
  currentReport.value = report;
}

async function handleCancelRun(run: ProcurementRun) {
  await cancelProcurementRun(run.id);
  message.success('运行已取消');
  if (currentTaskDetail.value?.id) {
    await openTaskDetail(currentTaskDetail.value.id);
  } else {
    refreshList();
  }
}

const tagSelectOptions = computed(() =>
  tags.value.map((item) => ({
    label: item.tagName,
    value: item.id,
  })),
);

const supplierNameMap = computed(
  () => new Map(suppliers.value.map((item) => [item.value, item.label])),
);

const storeNameMap = computed(
  () => new Map(stores.value.map((item) => [item.value, item.label])),
);

const generatedTaskName = computed(() => {
  const platformLabel = form.platform === 'Qianniuhua' ? '牵牛花' : '翱象';
  const supplierNames = form.supplierIds.map(
    (id) => supplierNameMap.value.get(id) || id,
  );
  const storeNames = form.storeIds.map((id) => storeNameMap.value.get(id) || id);
  const supplierLabel =
    supplierNames.length === 0
      ? '全部供应商'
      : supplierNames.length === 1
        ? supplierNames[0]
        : `${supplierNames[0]}等${supplierNames.length}个供应商`;
  const storeLabel =
    storeNames.length === 0
      ? '全部门店'
      : storeNames.length === 1
        ? storeNames[0]
        : `${storeNames[0]}等${storeNames.length}家门店`;

  return `${platformLabel}-${supplierLabel}-${storeLabel}采购`;
});

const searchFormItems = computed(() => [
  {
    label: '平台',
    child: {
      valueKey: 'platform',
      renderType: 'select',
      options: [
        { label: '翱象', value: 'Aoxiang' },
        { label: '牵牛花', value: 'Qianniuhua' },
      ],
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
    label: '供应商',
    child: {
      valueKey: 'supplierId',
      renderType: 'select',
      options: suppliers.value,
    },
  },
  {
    label: '门店',
    child: {
      valueKey: 'storeId',
      renderType: 'select',
      options: stores.value,
    },
  },
  {
    label: '商品标签',
    child: {
      valueKey: 'tagId',
      renderType: 'select',
      options: tagSelectOptions.value,
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
]);

const headerOptions = computed(() => [
  {
    label: '新建任务',
    renderType: 'button',
    type: 'primary',
    click: handleCreate,
  },
]);

function normalizeNameList(value?: string | string[]) {
  if (Array.isArray(value)) {
    return value.filter((item) => `${item || ''}`.trim());
  }
  const text = `${value || ''}`.trim();
  return text ? [text] : [];
}

function formatNameList(value?: string | string[]) {
  const list = normalizeNameList(value);
  return list.length > 0 ? list.join('、') : '-';
}

const taskColumns = computed(() => [
  { title: '任务名称', dataIndex: 'taskName', key: 'taskName', width: 220 },
  {
    title: '平台',
    dataIndex: 'platform',
    key: 'platform',
    width: 100,
    render: (_h: any, { text }: { text: string }) =>
      h(
        Tag,
        { color: text === 'Aoxiang' ? 'blue' : 'cyan' },
        { default: () => (text === 'Aoxiang' ? '翱象' : '牵牛花') },
      ),
  },
  {
    title: '供应商',
    dataIndex: 'supplierNames',
    key: 'supplierNames',
    width: 220,
    render: (_h: any, { text }: { text?: string | string[] }) => formatNameList(text),
  },
  {
    title: '门店',
    dataIndex: 'storeNames',
    key: 'storeNames',
    width: 220,
    render: (_h: any, { text }: { text?: string | string[] }) => formatNameList(text),
  },
  {
    title: '标签',
    dataIndex: 'tagNames',
    key: 'tagNames',
    width: 180,
    render: (_h: any, { text }: { text?: string | string[] }) =>
      h(
        Space,
        { wrap: true },
        {
          default: () =>
            normalizeNameList(text).map((tagName) =>
              h(Tag, { key: tagName }, { default: () => tagName }),
            ),
        },
      ),
  },
  {
    title: '状态',
    dataIndex: 'status',
    key: 'status',
    width: 120,
    render: (_h: any, { text }: { text: string }) =>
      h(Tag, { color: statusColor(text) }, { default: () => text }),
  },
  {
    title: '最近运行',
    dataIndex: 'latestRunStatus',
    key: 'latestRunStatus',
    width: 140,
    render: (_h: any, { text }: { text: string }) =>
      h(Tag, { color: statusColor(text || '') }, { default: () => text || '-' }),
  },
  { title: '提醒', dataIndex: 'alertCount', key: 'alertCount', width: 80 },
  { title: '上次执行', dataIndex: 'lastRunAt', key: 'lastRunAt', width: 180 },
  {
    title: '操作',
    key: 'action',
    width: 260,
    fixed: 'right' as const,
    render: (_h: any, { row }: { row: ProcurementTask }) =>
      h(
        Space,
        { wrap: true },
        {
          default: () => [
            h(
              Button,
              {
                type: 'link',
                onClick: () => openTaskDetail(row.id),
              },
              { default: () => '详情' },
            ),
            h(
              Button,
              {
                type: 'link',
                onClick: () => handleExecute(row),
              },
              { default: () => '执行' },
            ),
            h(
              Button,
              {
                type: 'link',
                onClick: () => handleEdit(row),
              },
              { default: () => '编辑' },
            ),
            h(
              Popconfirm,
              {
                title: '确认删除该任务？',
                onConfirm: () => handleDelete(row),
              },
              {
                default: () =>
                  h(
                    Button,
                    {
                      danger: true,
                      type: 'link',
                    },
                    { default: () => '删除' },
                  ),
              },
            ),
          ],
        },
      ),
  },
]);

async function serveMethods(params: Record<string, any>) {
  const response = await getProcurementTasks(params);
  const list = response.items || [];
  return {
    list,
    total: response.total || list.length,
  };
}

const runColumns = [
  { title: '运行ID', dataIndex: 'id', key: 'id', width: 180 },
  { title: '阶段', dataIndex: 'currentStage', key: 'currentStage', width: 140 },
  { title: '状态', dataIndex: 'status', key: 'status', width: 120 },
  { title: '触发来源', dataIndex: 'triggerSource', key: 'triggerSource', width: 100 },
  { title: '开始时间', dataIndex: 'startedAt', key: 'startedAt', width: 180 },
  { title: '结束时间', dataIndex: 'finishedAt', key: 'finishedAt', width: 180 },
  { title: '操作', key: 'action', width: 120 },
];

const alertColumns = [
  { title: '提醒类型', dataIndex: 'alertType', key: 'alertType', width: 140 },
  { title: '状态', dataIndex: 'status', key: 'status', width: 100 },
  { title: '摘要', dataIndex: 'payloadSummary', key: 'payloadSummary' },
  { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 180 },
];

const logColumns = [
  { title: '时间', dataIndex: 'createdAt', key: 'createdAt', width: 180 },
  { title: '级别', dataIndex: 'level', key: 'level', width: 100 },
  { title: '阶段', dataIndex: 'stage', key: 'stage', width: 120 },
  { title: '动作', dataIndex: 'action', key: 'action', width: 120 },
  { title: '消息', dataIndex: 'message', key: 'message' },
];

onMounted(() => {
  void fetchBaseOptions();
});
</script>

<template>
  <Page title="采购任务">
    <SimpleTemplate
      ref="tableRef"
      row-key="id"
      v-model="filters"
      :search-form-items="searchFormItems"
      :columns="taskColumns"
      :serve-methods="serveMethods"
      :header-options="headerOptions"
    />

    <Modal
      v-model:open="modalOpen"
      :title="editingId ? '编辑采购任务' : '新建采购任务'"
      ok-text="保存"
      @ok="handleSubmit"
    >
      <Form layout="vertical">
        <Form.Item label="任务名称">
          <div class="rounded bg-[#f6f8fb] px-3 py-2 text-[13px] text-[#334155]">
            {{ generatedTaskName }}
          </div>
          <div class="mt-2 text-[12px] text-[#64748b]">
            系统会根据平台、供应商和门店范围自动生成，不需要手动填写。
            任务创建后默认待执行，点击“执行”后由系统自动推进状态。
          </div>
        </Form.Item>
        <Form.Item label="平台">
          <Select
            v-model:value="form.platform"
            :options="[
              { label: '翱象', value: 'Aoxiang' },
              { label: '牵牛花', value: 'Qianniuhua' },
            ]"
          />
        </Form.Item>
        <Form.Item label="门店">
          <Select v-model:value="form.storeIds" mode="multiple" :options="stores" />
        </Form.Item>
        <Form.Item label="供应商">
          <Select
            v-model:value="form.supplierIds"
            mode="multiple"
            :options="suppliers"
          />
        </Form.Item>
        <Form.Item label="商品标签">
          <Select
            v-model:value="form.tagIds"
            mode="multiple"
            :options="tagSelectOptions"
          />
        </Form.Item>
        <Form.Item label="调度方式">
          <Select
            v-model:value="form.scheduleType"
            :options="[
              { label: '即时执行', value: 'Instant' },
              { label: '每周定时', value: 'Weekly' },
            ]"
          />
        </Form.Item>
        <Form.Item v-if="form.scheduleType === 'Weekly'" label="每周执行日">
          <Select
            v-model:value="form.weekDay"
            :options="[
              { label: '周一', value: 'Mon' },
              { label: '周二', value: 'Tue' },
              { label: '周三', value: 'Wed' },
              { label: '周四', value: 'Thu' },
              { label: '周五', value: 'Fri' },
            ]"
          />
        </Form.Item>
        <Form.Item label="单次采购限制">
          <Input v-model:value="form.maxItems" type="number" />
        </Form.Item>
        <Form.Item label="自动重试">
          <Switch
            v-model:checked="form.autoRetryEnabled"
            checked-children="启用"
            un-checked-children="禁用"
          />
        </Form.Item>
      </Form>
    </Modal>

    <Drawer
      v-model:open="drawerOpen"
      title="任务详情"
      width="78%"
    >
      <template v-if="currentTaskDetail">
        <Descriptions bordered class="mb-4" :column="2" size="small">
          <Descriptions.Item label="任务名称">
            {{ currentTaskDetail.taskName }}
          </Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag :color="statusColor(currentTaskDetail.status)">
              {{ currentTaskDetail.status }}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="平台">
            {{ currentTaskDetail.platform }}
          </Descriptions.Item>
          <Descriptions.Item label="自动重试">
            {{ currentTaskDetail.autoRetryEnabled ? '启用' : '禁用' }}
          </Descriptions.Item>
          <Descriptions.Item label="供应商">
            {{ formatNameList(currentTaskDetail.supplierNames) }}
          </Descriptions.Item>
          <Descriptions.Item label="门店">
            {{ formatNameList(currentTaskDetail.storeNames) }}
          </Descriptions.Item>
          <Descriptions.Item label="标签">
            {{ formatNameList(currentTaskDetail.tagNames) }}
          </Descriptions.Item>
          <Descriptions.Item label="提醒数">
            {{ currentTaskDetail.alertCount }}
          </Descriptions.Item>
        </Descriptions>

        <Card class="mb-4" title="运行记录">
          <Table
            :columns="runColumns"
            :data-source="currentRuns"
            :pagination="false"
            :row-key="(record: ProcurementRun) => record.id"
            :scroll="{ x: 1100 }"
            size="small"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'status'">
                <Tag :color="statusColor(record.status)">
                  {{ record.status }}
                </Tag>
              </template>
              <template v-else-if="column.key === 'action'">
                <Space>
                  <Button type="link" @click="openRunDetail(record as ProcurementRun)">日志</Button>
                  <Button
                    v-if="record.status === 'running'"
                    danger
                    type="link"
                    @click="handleCancelRun(record as ProcurementRun)"
                  >
                    取消
                  </Button>
                </Space>
              </template>
            </template>
          </Table>
        </Card>

        <Card title="提醒记录">
          <Table
            :columns="alertColumns"
            :data-source="currentAlerts"
            :pagination="false"
            :row-key="(record: ProcurementAlertEvent) => record.id"
            :scroll="{ x: 960 }"
            size="small"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'status'">
                <Tag :color="record.status === 'pending' ? 'warning' : 'success'">
                  {{ record.status }}
                </Tag>
              </template>
            </template>
          </Table>
        </Card>
      </template>
    </Drawer>

    <Drawer
      v-model:open="runDrawerOpen"
      title="运行详情"
      width="68%"
    >
      <template v-if="currentRun">
        <Descriptions bordered class="mb-4" :column="2" size="small">
          <Descriptions.Item label="运行ID">{{ currentRun.id }}</Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag :color="statusColor(currentRun.status)">
              {{ currentRun.status }}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="当前阶段">
            {{ currentRun.currentStage }}
          </Descriptions.Item>
          <Descriptions.Item label="触发来源">
            {{ currentRun.triggerSource }}
          </Descriptions.Item>
          <Descriptions.Item label="开始时间">
            {{ currentRun.startedAt || '-' }}
          </Descriptions.Item>
          <Descriptions.Item label="结束时间">
            {{ currentRun.finishedAt || '-' }}
          </Descriptions.Item>
        </Descriptions>

        <Card class="mb-4" title="运行日志">
          <Table
            :columns="logColumns"
            :data-source="currentLogs"
            :pagination="false"
            :row-key="(record: any) => record.id"
            :scroll="{ x: 980 }"
            size="small"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'level'">
                <Tag
                  :color="
                    record.level === 'error'
                      ? 'error'
                      : record.level === 'warn'
                        ? 'warning'
                        : 'processing'
                  "
                >
                  {{ record.level }}
                </Tag>
              </template>
            </template>
          </Table>
        </Card>

        <Card v-if="currentReport" title="执行报告">
          <Descriptions bordered :column="2" size="small">
            <Descriptions.Item label="供应商">
              {{ currentReport.supplierName || '-' }}
            </Descriptions.Item>
            <Descriptions.Item label="平台">
              {{ currentReport.platform }}
            </Descriptions.Item>
            <Descriptions.Item label="商品数">
              {{ currentReport.itemCount }}
            </Descriptions.Item>
            <Descriptions.Item label="失败数">
              {{ currentReport.failedCount }}
            </Descriptions.Item>
            <Descriptions.Item label="无库存 SKU">
              {{ currentReport.noStockCount }}
            </Descriptions.Item>
            <Descriptions.Item label="金额">
              ¥{{ Number(currentReport.totalAmount || 0).toFixed(2) }}
            </Descriptions.Item>
          </Descriptions>
        </Card>
      </template>
    </Drawer>
  </Page>
</template>
