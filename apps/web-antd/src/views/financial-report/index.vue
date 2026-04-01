<script lang="ts" setup>
import type { UploadFile } from 'ant-design-vue';
import type {
  FinanceCompareMetricRow,
  FinanceRawMetricRow,
  FinanceReportDetail,
  FinanceReportItem,
  FinanceStoreConfig,
  FinanceValueFormat,
} from '#/api/finance';
import type {
  FinanceTaskFileKind,
  FinanceTaskRecord,
} from '#/api/finance-task-repo';

import { computed, h, onMounted, reactive, ref } from 'vue';

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
  Space,
  Table,
  Tabs,
  Tag,
  message,
} from 'ant-design-vue';

import {
  getFinanceReportDetail,
  getFinanceReports,
  getFinanceStores,
} from '#/api/finance';
import {
  buildUploadFile,
  listFinanceTaskFiles,
  listFinanceTasks,
  removeFinanceTask,
  replaceFinanceTaskFile,
  saveFinanceTask,
} from '#/api/finance-task-repo';
import BaseUpload from '#/components/base/BaseUpload/index.vue';
import SimpleTemplate from '#/components/base/SimpleTemplate/index.vue';

type DetailTabKey = 'compare' | 'raw' | 'sheet' | 'preview';
type ProfitStatus = 'break_even' | 'loss' | 'profit' | 'unknown';
type StoreStatus = 'configured' | 'unknown' | 'unconfigured';

type FinanceReportSummary = {
  marketingRate: number | null;
  netProfit: number | null;
  netProfitRate: number | null;
  orderCount: number | null;
  profitStatus: ProfitStatus;
};

type FinanceWorkbenchRow = {
  attachmentSummary: string;
  fileName: string;
  id: string;
  month: string;
  netProfit: number | null;
  netProfitRate: number | null;
  orderCount: number | null;
  profitStatus: ProfitStatus;
  profitStatusLabel: string;
  reportRelativePath?: string;
  rowType: 'report' | 'task';
  statusLabel: string;
  storeName: string;
  storeStatus: StoreStatus;
  storeStatusLabel: string;
  taskId?: string;
  taskName: string;
  updatedAt: string;
};

const loading = ref(false);
const detailLoading = ref(false);
const modalLoading = ref(false);
const taskModalOpen = ref(false);
const detailDrawerOpen = ref(false);

const reports = ref<FinanceReportItem[]>([]);
const tasks = ref<FinanceTaskRecord[]>([]);
const stores = ref<FinanceStoreConfig[]>([]);
const reportDetail = ref<FinanceReportDetail | null>(null);
const reportSummaryMap = ref<Record<string, FinanceReportSummary>>({});
const reportDetailMap = ref<Record<string, FinanceReportDetail>>({});

const currentTaskId = ref('');
const activeDetailTab = ref<DetailTabKey>('compare');

const taskForm = reactive({
  month: '',
  notes: '',
  reportFileName: '',
  reportRelativePath: '',
  source: 'manual' as 'manual' | 'regenerate',
  status: 'draft' as 'draft' | 'ready' | 'regenerating',
  storeName: '',
  taskName: '',
});

const uploadState = reactive<Record<FinanceTaskFileKind, UploadFile[]>>({
  aoxiang: [],
  eleme_promo: [],
  meituan_promo: [],
  qianniuhua: [],
});

const searchFormModel = ref({
  month: '',
  page: 1,
  pageSize: 20,
  profitStatus: '' as '' | ProfitStatus,
  rowStatus: '',
});

const metricColumns = [
  { dataIndex: 'group', key: 'group', title: '分类', width: 90 },
  { dataIndex: 'label', key: 'label', title: '指标', width: 150 },
  { dataIndex: 'currentValue', key: 'currentValue', title: '本月', width: 140 },
  { dataIndex: 'previousValue', key: 'previousValue', title: '上月', width: 140 },
  { dataIndex: 'diffValue', key: 'diffValue', title: '变化额', width: 140 },
  { dataIndex: 'diffRate', key: 'diffRate', title: '变化率', width: 120 },
];

const rawMetricColumns = [
  { dataIndex: 'label', key: 'label', title: '指标', width: 160 },
  { dataIndex: 'rawValue', key: 'rawValue', title: '原始值', width: 140 },
  { dataIndex: 'sourceSheet', key: 'sourceSheet', title: '工作表', width: 140 },
  { dataIndex: 'sourceLabel', key: 'sourceLabel', title: '源字段', width: 160 },
  { dataIndex: 'sourceCell', key: 'sourceCell', title: '源位置', width: 120 },
];

const sheetColumns = [
  { dataIndex: 'name', key: 'name', title: '工作表', width: 220 },
  { dataIndex: 'rowCount', key: 'rowCount', title: '行数', width: 120 },
  { dataIndex: 'columnCount', key: 'columnCount', title: '列数', width: 120 },
];

const attachmentConfigs: Array<{
  key: FinanceTaskFileKind;
  label: string;
  tip: string;
}> = [
  { key: 'qianniuhua', label: '牵牛花 Excel', tip: '保留门店汇总与原始指标输入。' },
  { key: 'aoxiang', label: '翱象 Excel', tip: '长兴店、安吉店等翱象门店输入。' },
  { key: 'eleme_promo', label: '饿了么推广费 Excel', tip: '用于匹配饿了么推广费。' },
  { key: 'meituan_promo', label: '美团推广费 Excel', tip: '用于匹配美团推广费。' },
];

function normalizeStoreNameKey(value?: string) {
  return `${value || ''}`.replace(/\s+/g, '').toLowerCase();
}

function toMetricRow(record: Record<string, any>) {
  return record as FinanceCompareMetricRow;
}

function getMetricValue(detail: FinanceReportDetail, label: string) {
  return detail.storeMetrics?.find((item) => item.label === label)?.currentValue ?? null;
}

function toProfitStatus(netProfit: null | number): ProfitStatus {
  if (netProfit == null) return 'unknown';
  if (Math.abs(netProfit) < 0.01) return 'break_even';
  return netProfit > 0 ? 'profit' : 'loss';
}

function formatTaskStatus(status: FinanceTaskRecord['status']) {
  switch (status) {
    case 'ready':
      return '已保存';
    case 'regenerating':
      return '待重生成';
    default:
      return '草稿';
  }
}

function formatProfitStatus(status: ProfitStatus) {
  switch (status) {
    case 'profit':
      return '盈利';
    case 'loss':
      return '亏损';
    case 'break_even':
      return '持平';
    default:
      return '待分析';
  }
}

function formatStoreStatus(status: StoreStatus) {
  switch (status) {
    case 'configured':
      return '已配置';
    case 'unconfigured':
      return '未配置';
    default:
      return '未识别';
  }
}

function buildReportSummary(detail: FinanceReportDetail): FinanceReportSummary {
  const netProfit = getMetricValue(detail, '净利润');
  return {
    marketingRate: getMetricValue(detail, '营销活动费用费率'),
    netProfit,
    netProfitRate: getMetricValue(detail, '净利润率'),
    orderCount: getMetricValue(detail, '订单数量'),
    profitStatus: toProfitStatus(netProfit),
  };
}

const storeAliasMap = computed(() => {
  const aliases = new Map<string, FinanceStoreConfig>();
  for (const store of stores.value) {
    const values = [store.name, store.shortName, store.elemeName].filter(Boolean);
    for (const alias of values) {
      aliases.set(normalizeStoreNameKey(alias), store);
    }
  }
  return aliases;
});

function resolveStoreConfig(storeName?: string) {
  const normalized = normalizeStoreNameKey(storeName);
  if (!normalized) return null;

  const exact = storeAliasMap.value.get(normalized);
  if (exact) return exact;

  for (const [alias, store] of storeAliasMap.value.entries()) {
    if (alias.includes(normalized) || normalized.includes(alias)) {
      return store;
    }
  }

  return null;
}

function resolveStoreStatus(storeName?: string): StoreStatus {
  if (!`${storeName || ''}`.trim()) return 'unknown';
  return resolveStoreConfig(storeName) ? 'configured' : 'unconfigured';
}

function statusTagColor(statusLabel: string) {
  switch (statusLabel) {
    case '已有报表':
      return 'success';
    case '待重生成':
      return 'warning';
    case '已保存':
      return 'blue';
    default:
      return 'default';
  }
}

function profitTagColor(status: ProfitStatus) {
  switch (status) {
    case 'profit':
      return 'success';
    case 'loss':
      return 'error';
    case 'break_even':
      return 'gold';
    default:
      return 'default';
  }
}

function storeTagColor(status: StoreStatus) {
  switch (status) {
    case 'configured':
      return 'cyan';
    case 'unconfigured':
      return 'warning';
    default:
      return 'default';
  }
}

function workbenchRowClassName(record: FinanceWorkbenchRow) {
  if (
    record.statusLabel === '待重生成' ||
    record.profitStatus === 'loss' ||
    record.storeStatus === 'unconfigured'
  ) {
    return 'finance-row-risk';
  }

  if (
    record.statusLabel === '草稿' ||
    record.profitStatus === 'unknown' ||
    record.storeStatus === 'unknown'
  ) {
    return 'finance-row-pending';
  }

  return '';
}

function formatMetricValue(value: null | number, format: FinanceValueFormat) {
  if (value == null) return '--';
  if (format === 'percent') return `${(value * 100).toFixed(2)}%`;
  if (format === 'int') return `${Math.round(value)}`;
  return value.toLocaleString('zh-CN', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

function formatMoney(value: null | number) {
  return formatMetricValue(value, 'money');
}

function formatDatetime(value?: string) {
  return value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '--';
}

function formatFinanceTaskMonth(month?: string) {
  const normalized = `${month || ''}`.trim();
  const matched = normalized.match(/^\d{4}-(\d{1,2})$/);
  if (!matched) return '';

  const monthNumber = Number(matched[1]);
  return Number.isFinite(monthNumber) && monthNumber > 0
    ? `${monthNumber}月份`
    : '';
}

function buildFinanceTaskName(month?: string) {
  const monthLabel = formatFinanceTaskMonth(month);
  return monthLabel ? `Oby-${monthLabel}-财务报表` : 'Oby-财务报表';
}

function formatChangeTone(row: FinanceCompareMetricRow) {
  if (row.diffValue == null) return '';
  if (row.diffValue > 0) return 'is-positive';
  if (row.diffValue < 0) return 'is-negative';
  return '';
}

function formatRawValue(row: FinanceRawMetricRow) {
  const value = typeof row.rawValue === 'number' ? row.rawValue : null;
  if (value != null) {
    return formatMetricValue(value, row.format);
  }
  return `${row.rawValue || '--'}`;
}

function previewColumnsFor(rows: Array<Record<string, any>>) {
  const firstRow = rows[0];
  if (!firstRow) return [];

  return Object.keys(firstRow)
    .filter((key) => key !== '__sourceRow')
    .map((key) => ({
      dataIndex: key,
      key,
      title: key,
      width: 150,
    }));
}

function buildActionButtons(row: FinanceWorkbenchRow) {
  const buttons = [
    h(
      Button,
      {
        size: 'small',
        onClick: () => openDetail(row.reportRelativePath),
      },
      () => '查看详情',
    ),
    h(
      Button,
      {
        size: 'small',
        type: 'primary',
        onClick: () =>
          openNewTask(
            reports.value.find((item) => item.relativePath === row.reportRelativePath),
            resolveTaskByRow(row),
          ),
      },
      () => (row.rowType === 'report' ? '重新生成' : '编辑任务'),
    ),
  ];

  if (row.taskId) {
    buttons.push(
      h(
        Popconfirm,
        {
          title: '确认删除这个财务任务吗？',
          onConfirm: () => handleDeleteTask(row.taskId),
        },
        {
          default: () =>
            h(
              Button,
              {
                danger: true,
                size: 'small',
              },
              () => '删除任务',
            ),
        },
      ),
    );
  }

  return h(
    Space,
    {
      size: 'small',
      wrap: true,
    },
    () => buttons,
  );
}

const workbenchRows = computed<FinanceWorkbenchRow[]>(() => {
  const taskMap = new Map<string, FinanceTaskRecord>();
  for (const task of tasks.value) {
    if (task.reportRelativePath) {
      taskMap.set(task.reportRelativePath, task);
    }
  }

  const reportRows = reports.value.map((report) => {
    const task = taskMap.get(report.relativePath);
    const summary = reportSummaryMap.value[report.relativePath];
    const storeStatus = resolveStoreStatus(report.storeName);

    return {
      attachmentSummary: task ? '已保留上传文件' : '未上传',
      fileName: report.fileName,
      id: task?.id || `report:${report.relativePath}`,
      month: report.month,
      netProfit: summary?.netProfit ?? null,
      netProfitRate: summary?.netProfitRate ?? null,
      orderCount: summary?.orderCount ?? null,
      profitStatus: summary?.profitStatus ?? 'unknown',
      profitStatusLabel: formatProfitStatus(summary?.profitStatus ?? 'unknown'),
      reportRelativePath: report.relativePath,
      rowType: 'report' as const,
      statusLabel: task ? formatTaskStatus(task.status) : '已有报表',
      storeName: report.storeName,
      storeStatus,
      storeStatusLabel: formatStoreStatus(storeStatus),
      taskId: task?.id,
      taskName: task?.taskName || report.fileName,
      updatedAt: task?.updatedAt || report.createdAt,
    };
  });

  const manualTaskRows = tasks.value
    .filter((task) => !task.reportRelativePath)
    .map((task) => {
      const storeStatus = resolveStoreStatus(task.storeName);
      return {
        attachmentSummary: '已保留上传文件',
        fileName: task.reportFileName || '--',
        id: task.id,
        month: task.month,
        netProfit: null,
        netProfitRate: null,
        orderCount: null,
        profitStatus: 'unknown' as const,
        profitStatusLabel: formatProfitStatus('unknown'),
        rowType: 'task' as const,
        statusLabel: formatTaskStatus(task.status),
        storeName: task.storeName || '--',
        storeStatus,
        storeStatusLabel: formatStoreStatus(storeStatus),
        taskId: task.id,
        taskName: task.taskName,
        updatedAt: task.updatedAt,
      };
    });

  return [...manualTaskRows, ...reportRows].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );
});

const profitStatusOptions = [
  { label: '盈利', value: 'profit' },
  { label: '亏损', value: 'loss' },
  { label: '持平', value: 'break_even' },
  { label: '待分析', value: 'unknown' },
];

const searchFormItems = computed(() => [
  {
    label: '月份',
    child: {
      renderType: 'monthPicker',
      valueKey: 'month',
      allowClear: true,
      placeholder: '选择月份',
    },
  },
  {
    label: '盈利状态',
    child: {
      renderType: 'select',
      valueKey: 'profitStatus',
      allowClear: true,
      options: profitStatusOptions,
      placeholder: '全部盈利',
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

const tableColumns = computed(() => [
  {
    dataIndex: 'taskName',
    key: 'taskName',
    title: '任务 / 报表',
    width: 260,
  },
  { dataIndex: 'month', key: 'month', title: '月份', width: 110 },
  { dataIndex: 'storeName', key: 'storeName', title: '门店', width: 130 },
  {
    dataIndex: 'statusLabel',
    key: 'statusLabel',
    title: '任务状态',
    width: 120,
    render: (_h: any, { text }: { text: string }) =>
      h(
        Tag,
        {
          color: statusTagColor(text),
        },
        () => text,
      ),
  },
  {
    dataIndex: 'profitStatusLabel',
    key: 'profitStatusLabel',
    title: '盈利状态',
    width: 120,
    render: (_h: any, { row, text }: { row: FinanceWorkbenchRow; text: string }) =>
      h(
        Tag,
        {
          color: profitTagColor(row.profitStatus),
        },
        () => text,
      ),
  },
  {
    dataIndex: 'netProfit',
    key: 'netProfit',
    title: '净利润',
    width: 140,
    render: (_h: any, { row }: { row: FinanceWorkbenchRow }) =>
      h(
        'span',
        {
          class:
            row.netProfit == null ? '' : row.netProfit >= 0 ? 'is-positive' : 'is-negative',
        },
        formatMoney(row.netProfit),
      ),
  },
  {
    dataIndex: 'attachmentSummary',
    key: 'attachmentSummary',
    title: '上传文件',
    width: 150,
  },
  {
    dataIndex: 'updatedAt',
    key: 'updatedAt',
    title: '更新时间',
    width: 170,
    render: (_h: any, { text }: { text: string }) => formatDatetime(text),
  },
  {
    key: 'action',
    title: '操作',
    width: 280,
    fixed: 'right' as const,
    render: (_h: any, { row }: { row: FinanceWorkbenchRow }) => buildActionButtons(row),
  },
]);

const headerOptions = computed(() => [
  {
    label: '新建任务',
    renderType: 'button',
    type: 'primary',
    click: () => openNewTask(),
  },
]);

const drawerTitle = computed(() => {
  if (!reportDetail.value) return '财务报表详情';
  return `${reportDetail.value.report.storeName} ${reportDetail.value.report.month}`;
});

const currentDetailSummary = computed(() => {
  if (!reportDetail.value) return null;
  return (
    reportSummaryMap.value[reportDetail.value.report.relativePath] ||
    buildReportSummary(reportDetail.value)
  );
});

const currentStoreConfig = computed(() => {
  return reportDetail.value
    ? resolveStoreConfig(reportDetail.value.report.storeName)
    : null;
});

const currentStoreStatus = computed<StoreStatus>(() => {
  return reportDetail.value
    ? resolveStoreStatus(reportDetail.value.report.storeName)
    : 'unknown';
});

const currentPreviewColumns = computed(() =>
  reportDetail.value?.tablePreview?.rows
    ? previewColumnsFor(reportDetail.value.tablePreview.rows)
    : [],
);

const generatedTaskName = computed(() => buildFinanceTaskName(taskForm.month));

function resetTaskForm() {
  currentTaskId.value = '';
  taskForm.month = '';
  taskForm.notes = '';
  taskForm.reportFileName = '';
  taskForm.reportRelativePath = '';
  taskForm.source = 'manual';
  taskForm.status = 'draft';
  taskForm.storeName = '';
  taskForm.taskName = buildFinanceTaskName('');
  uploadState.qianniuhua = [];
  uploadState.aoxiang = [];
  uploadState.eleme_promo = [];
  uploadState.meituan_promo = [];
}

async function loadTaskAttachments(taskId: string) {
  const files = await listFinanceTaskFiles(taskId);
  for (const config of attachmentConfigs) {
    const file = files.find((item) => item.kind === config.key);
    uploadState[config.key] = file ? [buildUploadFile(file)] : [];
  }
}

async function persistCurrentTask() {
  const task = await saveFinanceTask({
    id: currentTaskId.value || undefined,
    month: taskForm.month,
    notes: taskForm.notes,
    reportFileName: taskForm.reportFileName,
    reportRelativePath: taskForm.reportRelativePath,
    source: taskForm.source,
    status: taskForm.status,
    storeName: taskForm.storeName,
    taskName: taskForm.taskName,
  });
  currentTaskId.value = task.id;

  await Promise.all(
    attachmentConfigs.map(async (config) => {
      const currentFile = uploadState[config.key]?.[0]?.originFileObj as
        | File
        | undefined;
      await replaceFinanceTaskFile(task.id, config.key, currentFile || null);
    }),
  );

  return task;
}

async function hydrateReportSummaries(list: FinanceReportItem[]) {
  const missing = list.filter((item) => !reportSummaryMap.value[item.relativePath]);
  if (missing.length === 0) return;

  const settled = await Promise.allSettled(
    missing.map((item) => getFinanceReportDetail(item.relativePath)),
  );

  const nextSummaryMap = { ...reportSummaryMap.value };
  const nextDetailMap = { ...reportDetailMap.value };

  settled.forEach((result, index) => {
    if (result.status !== 'fulfilled') return;
    const detail = result.value;
    const relativePath = missing[index]?.relativePath;
    if (!relativePath) return;
    nextDetailMap[relativePath] = detail;
    nextSummaryMap[relativePath] = buildReportSummary(detail);
  });

  reportDetailMap.value = nextDetailMap;
  reportSummaryMap.value = nextSummaryMap;
}

async function fetchAll(selectedMonth = '') {
  loading.value = true;
  try {
    const [reportRes, taskRes, storeRes] = await Promise.all([
      getFinanceReports({
        month: selectedMonth || undefined,
        type: 'store',
      }),
      listFinanceTasks(),
      getFinanceStores(),
    ]);

    reports.value = reportRes.list || [];
    tasks.value = taskRes;
    stores.value = storeRes.list || [];

    await hydrateReportSummaries(reportRes.list || []);
  } catch (error: any) {
    message.error(error?.message || '加载财务工作台失败');
  } finally {
    loading.value = false;
  }
}

async function serveMethods(params: any) {
  const month = `${params?.data?.month || ''}`.trim();
  const page = Math.max(1, Number(params?.data?.page || 1));
  const pageSize = Math.max(1, Number(params?.data?.pageSize || 20));
  const profitStatus = `${params?.data?.profitStatus || ''}`.trim();
  const rowStatus = `${params?.data?.rowStatus || ''}`.trim();

  await fetchAll(month);

  const filteredRows = workbenchRows.value.filter((item) => {
    const matchesMonth = !month || item.month === month;
    const matchesRowStatus = !rowStatus || item.statusLabel === rowStatus;
    const matchesProfitStatus = !profitStatus || item.profitStatus === profitStatus;

    return (
      matchesMonth &&
      matchesRowStatus &&
      matchesProfitStatus
    );
  });

  const start = (page - 1) * pageSize;

  return {
    list: filteredRows.slice(start, start + pageSize),
    total: filteredRows.length,
    totalPages: filteredRows.length,
  };
}

async function openDetail(relativePath?: string) {
  if (!relativePath) {
    message.warning('当前没有可查看的报表');
    return;
  }

  detailDrawerOpen.value = true;
  activeDetailTab.value = 'compare';

  const cached = reportDetailMap.value[relativePath];
  if (cached) {
    reportDetail.value = cached;
    return;
  }

  detailLoading.value = true;
  try {
    const detail = await getFinanceReportDetail(relativePath);
    reportDetail.value = detail;
    reportDetailMap.value = {
      ...reportDetailMap.value,
      [relativePath]: detail,
    };
    reportSummaryMap.value = {
      ...reportSummaryMap.value,
      [relativePath]: buildReportSummary(detail),
    };
  } catch (error: any) {
    reportDetail.value = null;
    message.error(error?.message || '读取财务报表详情失败');
  } finally {
    detailLoading.value = false;
  }
}

async function openNewTask(report?: FinanceReportItem, existingTask?: FinanceTaskRecord) {
  resetTaskForm();

  if (existingTask) {
    currentTaskId.value = existingTask.id;
    taskForm.month = existingTask.month;
    taskForm.notes = existingTask.notes || '';
    taskForm.reportFileName = existingTask.reportFileName || '';
    taskForm.reportRelativePath = existingTask.reportRelativePath || '';
    taskForm.source = existingTask.source;
    taskForm.status = existingTask.status;
    taskForm.storeName = existingTask.storeName;
    taskForm.taskName = buildFinanceTaskName(existingTask.month);
    await loadTaskAttachments(existingTask.id);
  } else if (report) {
    taskForm.month = report.month;
    taskForm.reportFileName = report.fileName;
    taskForm.reportRelativePath = report.relativePath;
    taskForm.source = 'regenerate';
    taskForm.status = 'regenerating';
    taskForm.storeName = report.storeName;
    taskForm.taskName = buildFinanceTaskName(report.month);
  } else {
    taskForm.status = 'draft';
    taskForm.taskName = buildFinanceTaskName('');
  }

  taskModalOpen.value = true;
}

async function handleTaskModalOk() {
  if (!taskForm.month.trim()) {
    message.warning('请输入月份');
    return;
  }

  taskForm.taskName = buildFinanceTaskName(taskForm.month);

  modalLoading.value = true;
  try {
    await persistCurrentTask();
    await fetchAll();
    taskModalOpen.value = false;
    message.success('财务任务已保存，当前上传的计算 Excel 已保留');
  } catch (error: any) {
    message.error(error?.message || '保存财务任务失败');
  } finally {
    modalLoading.value = false;
  }
}

async function handleUploadChange(kind: FinanceTaskFileKind, fileList: UploadFile[]) {
  uploadState[kind] = fileList;
  const task = await persistCurrentTask();
  const latestFiles = await listFinanceTaskFiles(task.id);
  const matched = latestFiles.find((item) => item.kind === kind);
  uploadState[kind] = matched ? [buildUploadFile(matched)] : [];
  await fetchAll();
}

async function handleDeleteTask(taskId?: string) {
  if (!taskId) return;
  await removeFinanceTask(taskId);
  await fetchAll();
  message.success('任务已删除');
}

function resolveTaskByRow(row: FinanceWorkbenchRow) {
  return tasks.value.find((item) => item.id === row.taskId);
}

onMounted(() => {
  void fetchAll();
});
</script>

<template>
  <Page title="财务管理">
    <div class="finance-workbench">
      <SimpleTemplate
        v-model="searchFormModel"
        row-key="id"
        :search-form-items="searchFormItems"
        :columns="tableColumns"
        :serve-methods="serveMethods"
        :header-options="headerOptions"
        :row-class-name="workbenchRowClassName"
        :show-page="true"
      />

      <Drawer
        v-model:open="detailDrawerOpen"
        :width="1080"
        destroy-on-close
        :title="drawerTitle"
      >
        <div v-if="reportDetail" class="detail-layout">
          <div class="detail-topbar">
            <Space wrap>
              <Tag :color="storeTagColor(currentStoreStatus)">
                门店状态：{{ formatStoreStatus(currentStoreStatus) }}
              </Tag>
              <Tag :color="profitTagColor(currentDetailSummary?.profitStatus || 'unknown')">
                {{
                  `是否盈利：${formatProfitStatus(
                    currentDetailSummary?.profitStatus || 'unknown',
                  )}`
                }}
              </Tag>
              <Tag v-if="currentStoreConfig" color="blue">
                固定成本 {{ formatMoney(currentStoreConfig.totalFixedCost) }}
              </Tag>
            </Space>
            <Space>
              <Button
                v-if="reportDetail.previousReport"
                size="small"
                @click="openDetail(reportDetail.previousReport.relativePath)"
              >
                查看上月报表
              </Button>
              <Button
                size="small"
                type="primary"
                @click="
                  openNewTask(
                    reportDetail.report,
                    tasks.find(
                      (item) =>
                        item.reportRelativePath === reportDetail?.report.relativePath,
                    ),
                  )
                "
              >
                生成重跑任务
              </Button>
            </Space>
          </div>

          <div class="headline-grid">
            <div class="headline-card">
              <div class="headline-label">净利润</div>
              <div
                class="headline-value"
                :class="
                  currentDetailSummary?.netProfit == null
                    ? ''
                    : currentDetailSummary.netProfit >= 0
                      ? 'is-positive'
                      : 'is-negative'
                "
              >
                {{ formatMoney(currentDetailSummary?.netProfit ?? null) }}
              </div>
            </div>
            <div class="headline-card">
              <div class="headline-label">净利率</div>
              <div class="headline-value">
                {{ formatMetricValue(currentDetailSummary?.netProfitRate ?? null, 'percent') }}
              </div>
            </div>
            <div class="headline-card">
              <div class="headline-label">订单数</div>
              <div class="headline-value">
                {{ formatMetricValue(currentDetailSummary?.orderCount ?? null, 'int') }}
              </div>
            </div>
            <div class="headline-card">
              <div class="headline-label">营销费率</div>
              <div class="headline-value">
                {{ formatMetricValue(currentDetailSummary?.marketingRate ?? null, 'percent') }}
              </div>
            </div>
          </div>

          <Card :bordered="false" class="detail-section">
            <Descriptions :column="2" size="small">
              <Descriptions.Item label="报表文件">
                {{ reportDetail.report.fileName }}
              </Descriptions.Item>
              <Descriptions.Item label="更新时间">
                {{ formatDatetime(reportDetail.report.createdAt) }}
              </Descriptions.Item>
              <Descriptions.Item label="工作表数量">
                {{ reportDetail.sheetSummaries.length }}
              </Descriptions.Item>
              <Descriptions.Item label="上月对比">
                {{
                  reportDetail.previousReport
                    ? `${reportDetail.previousReport.month} / ${reportDetail.previousReport.fileName}`
                    : '暂无'
                }}
              </Descriptions.Item>
              <Descriptions.Item v-if="currentStoreConfig" label="饿了么门店名">
                {{ currentStoreConfig.elemeName || '--' }}
              </Descriptions.Item>
              <Descriptions.Item v-if="currentStoreConfig" label="美团门店 ID">
                {{ currentStoreConfig.meituanId || '--' }}
              </Descriptions.Item>
            </Descriptions>
          </Card>

          <Tabs v-model:activeKey="activeDetailTab" class="detail-tabs">
            <Tabs.TabPane key="compare" tab="指标对比">
              <Table
                v-if="reportDetail.storeMetrics"
                :columns="metricColumns"
                :data-source="reportDetail.storeMetrics"
                :loading="detailLoading"
                :pagination="{ pageSize: 12 }"
                :scroll="{ x: 860 }"
                row-key="label"
                class="finance-table"
              >
                <template #bodyCell="{ column, record, text }">
                  <template
                    v-if="
                      column.key === 'currentValue' ||
                      column.key === 'previousValue' ||
                      column.key === 'diffValue'
                    "
                  >
                    <span
                      :class="
                        column.key === 'diffValue'
                          ? formatChangeTone(toMetricRow(record))
                          : ''
                      "
                    >
                      {{
                        formatMetricValue(
                          text as number | null,
                          toMetricRow(record).format,
                        )
                      }}
                    </span>
                  </template>
                  <template v-else-if="column.key === 'diffRate'">
                    <span :class="formatChangeTone(toMetricRow(record))">
                      {{ formatMetricValue(text as number | null, 'percent') }}
                    </span>
                  </template>
                </template>
              </Table>
              <Empty v-else description="暂无指标对比数据" />
            </Tabs.TabPane>

            <Tabs.TabPane key="raw" tab="原始取数">
              <Table
                v-if="reportDetail.storeRawMetrics?.length"
                :columns="rawMetricColumns"
                :data-source="reportDetail.storeRawMetrics"
                :pagination="{ pageSize: 10 }"
                :scroll="{ x: 860 }"
                row-key="label"
                class="finance-table"
              >
                <template #bodyCell="{ column, record }">
                  <template v-if="column.key === 'rawValue'">
                    {{ formatRawValue(record as FinanceRawMetricRow) }}
                  </template>
                  <template v-else-if="column.key === 'sourceCell'">
                    {{
                      `${(record as FinanceRawMetricRow).sourceColumn}${
                        (record as FinanceRawMetricRow).sourceRow
                      }`
                    }}
                  </template>
                </template>
              </Table>
              <Empty v-else description="暂无原始取数字段" />
            </Tabs.TabPane>

            <Tabs.TabPane key="sheet" tab="工作表概览">
              <Table
                :columns="sheetColumns"
                :data-source="reportDetail.sheetSummaries"
                :pagination="false"
                row-key="name"
                class="finance-table"
              />
            </Tabs.TabPane>

            <Tabs.TabPane key="preview" tab="表格预览">
              <Table
                v-if="reportDetail.tablePreview?.rows?.length"
                :columns="currentPreviewColumns"
                :data-source="reportDetail.tablePreview.rows"
                :pagination="{ pageSize: 8 }"
                :scroll="{ x: 960 }"
                row-key="__sourceRow"
                class="finance-table"
              />
              <Empty v-else description="暂无可预览表格" />
            </Tabs.TabPane>
          </Tabs>
        </div>

        <Empty v-else description="暂无财务报表详情" />
      </Drawer>

      <Modal
        v-model:open="taskModalOpen"
        :confirm-loading="modalLoading"
        destroy-on-close
        ok-text="保存任务"
        title="财务任务"
        width="720px"
        @ok="handleTaskModalOk"
      >
        <Form layout="vertical">
          <Form.Item label="任务名称">
            <Input
              :value="generatedTaskName"
              disabled
              placeholder="系统自动生成"
            />
          </Form.Item>
          <div class="form-grid">
            <Form.Item label="月份" required>
              <Input v-model:value="taskForm.month" placeholder="YYYY-MM" />
            </Form.Item>
            <Form.Item label="门店">
              <Input v-model:value="taskForm.storeName" placeholder="例如：济阳店" />
            </Form.Item>
          </div>
          <Form.Item label="备注">
            <Input.TextArea
              v-model:value="taskForm.notes"
              :rows="3"
              placeholder="记录这次重生成的说明、输入来源或注意事项"
            />
          </Form.Item>

          <div class="upload-grid">
            <div
              v-for="config in attachmentConfigs"
              :key="config.key"
              class="upload-item"
            >
              <div class="upload-title">{{ config.label }}</div>
              <div class="upload-tip">{{ config.tip }}</div>
              <BaseUpload
                v-model:file-list="uploadState[config.key]"
                accept=".xlsx,.xls"
                :auto-upload="false"
                :max-count="1"
                :show-upload-button="true"
                button-text="选择文件"
                list-type="text"
                @change="handleUploadChange(config.key, uploadState[config.key])"
              />
            </div>
          </div>
        </Form>
      </Modal>
    </div>
  </Page>
</template>

<style scoped>
.finance-workbench {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.detail-section {
  border-radius: 18px;
}

:deep(.detail-section .ant-card-body) {
  padding: 18px;
}

.summary-grid,
.headline-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
  margin-top: 16px;
}

.summary-card,
.headline-card {
  border: 1px solid rgb(226 232 240);
  border-radius: 16px;
  padding: 14px 16px;
  background:
    linear-gradient(180deg, rgb(255 255 255 / 100%), rgb(248 250 252 / 100%));
}

.summary-label,
.headline-label {
  color: rgb(100 116 139);
  font-size: 13px;
}

.summary-value,
.headline-value {
  margin-top: 8px;
  color: rgb(15 23 42);
  font-size: 24px;
  font-weight: 700;
}

.finance-table {
  margin-top: 16px;
}

.detail-layout {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.detail-topbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.detail-tabs {
  margin-top: 4px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.upload-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.upload-item {
  border: 1px solid rgb(226 232 240);
  border-radius: 14px;
  padding: 14px;
}

.upload-title {
  color: rgb(15 23 42);
  font-size: 14px;
  font-weight: 700;
}

.upload-tip {
  margin: 6px 0 10px;
  color: rgb(100 116 139);
  font-size: 12px;
  line-height: 1.5;
}

.is-positive {
  color: rgb(21 128 61);
  font-weight: 600;
}

.is-negative {
  color: rgb(220 38 38);
  font-weight: 600;
}

:deep(.finance-row-risk td) {
  background: rgb(255 247 237 / 70%) !important;
}

:deep(.finance-row-pending td) {
  background: rgb(248 250 252 / 85%) !important;
}

@media (max-width: 1100px) {
  .summary-grid,
  .headline-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 900px) {
  .form-grid,
  .upload-grid,
  .summary-grid,
  .headline-grid {
    grid-template-columns: 1fr;
  }
}
</style>
