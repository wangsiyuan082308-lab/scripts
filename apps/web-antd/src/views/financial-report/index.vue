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

import { computed, h, reactive, ref } from 'vue';

import { Page } from '@vben/common-ui';

import dayjs from 'dayjs';
import {
  Button,
  Card,
  DatePicker,
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
  getFinanceStores,
} from '#/api/finance';
import {
  buildUploadFile,
  listFinanceTaskFiles,
  listFinanceTasks,
  removeFinanceTask,
  removeFinanceTasks,
  replaceFinanceTaskFile,
  saveFinanceTask,
} from '#/api/finance-task-repo';
import BaseUpload from '#/components/base/BaseUpload/index.vue';
import SimpleTemplate from '#/components/base/SimpleTemplate/index.vue';

type DetailTabKey = 'compare' | 'raw' | 'sheet' | 'preview';
type ProfitStatus = 'break_even' | 'loss' | 'profit' | 'unknown';
type StoreStatus = 'configured' | 'unknown' | 'unconfigured';

type FinanceWorkbenchRow = {
  id: string;
  month: string;
  resultStatusLabel: string;
  reportRelativePath?: string;
  statusLabel: string;
  taskId: string;
  taskName: string;
  updatedAt: string;
};

const loading = ref(false);
const detailLoading = ref(false);
const modalLoading = ref(false);
const taskModalOpen = ref(false);
const detailDrawerOpen = ref(false);

const tasks = ref<FinanceTaskRecord[]>([]);
const stores = ref<FinanceStoreConfig[]>([]);
const reportDetail = ref<FinanceReportDetail | null>(null);
const reportDetailMap = ref<Record<string, FinanceReportDetail>>({});
const loadedMonth = ref<string | null>(null);
const financeDataReady = ref(false);

const currentTaskId = ref('');
const activeDetailTab = ref<DetailTabKey>('compare');
const selectedRowKeys = ref<string[]>([]);
const currentDetailTask = ref<FinanceTaskRecord | null>(null);
const combinedUploadFiles = ref<UploadFile[]>([]);

const taskForm = reactive({
  anjiMtOrders: undefined as number | undefined,
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

const requiredAttachmentKinds: FinanceTaskFileKind[] = [
  'qianniuhua',
  'aoxiang',
  'eleme_promo',
  'meituan_promo',
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

function formatTaskStatus(task?: Pick<FinanceTaskRecord, 'reportRelativePath' | 'status'> | null) {
  switch (task?.status) {
    case 'ready':
      return task.reportRelativePath ? '已完成' : '待分析';
    case 'regenerating':
      return '待重生成';
    default:
      return '草稿';
  }
}

function formatResultStatus(task?: Pick<FinanceTaskRecord, 'reportRelativePath' | 'status'> | null) {
  if (!task) return '暂无结果';
  if (task.reportRelativePath) return '已生成结果';
  if (task.status === 'regenerating') return '待重新生成';
  return '暂无结果';
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

function buildReportSummary(detail: FinanceReportDetail) {
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
    case '已完成':
      return 'success';
    case '待重生成':
      return 'warning';
    case '待分析':
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
  if (record.statusLabel === '待重生成') {
    return 'finance-row-risk';
  }

  if (record.statusLabel === '草稿' || record.statusLabel === '待分析') {
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

function normalizeAttachmentFileName(fileName?: string) {
  return `${fileName || ''}`.trim().replace(/\s+/g, '').toLowerCase();
}

function classifyAttachmentByFileName(fileName?: string): FinanceTaskFileKind | null {
  const normalized = normalizeAttachmentFileName(fileName);
  if (!normalized) return null;

  if (normalized.includes('饿了么') && normalized.includes('推广')) {
    return 'eleme_promo';
  }

  if (normalized.includes('美团') && normalized.includes('推广')) {
    return 'meituan_promo';
  }

  if (
    normalized.includes('翱翔') ||
    normalized.includes('翱象') ||
    normalized.startsWith('翱')
  ) {
    return 'aoxiang';
  }

  const qianniuhuaIncludes = [
    '经营分析pc端',
    '牵牛花',
    '经营分析.xlsx',
    '经营分析导出门店盈亏',
    '经营分析',
    '导出财务分析订单数据',
  ];
  const qianniuhuaExcludes = [
    '推广',
    '翱象',
    '翱翔品质仓',
    '门店总表',
    '毛利异常',
    '关键指标',
  ];

  if (
    qianniuhuaIncludes.some((keyword) => normalized.includes(keyword)) &&
    !qianniuhuaExcludes.some((keyword) => normalized.includes(keyword))
  ) {
    return 'qianniuhua';
  }

  return null;
}

async function cloneUploadFileToMemory(file: UploadFile) {
  const originFile = file.originFileObj as File | undefined;
  if (!originFile) {
    return file;
  }

  const buffer = await originFile.arrayBuffer();
  const clonedFile = new File([buffer], file.name || originFile.name, {
    lastModified: file.lastModified || originFile.lastModified,
    type: file.type || originFile.type,
  });

  return {
    ...file,
    lastModified: clonedFile.lastModified,
    originFileObj: clonedFile as any,
    size: clonedFile.size,
    type: clonedFile.type,
  } satisfies UploadFile;
}

function syncUploadStateFromFiles(fileList: UploadFile[]) {
  const nextState: Record<FinanceTaskFileKind, UploadFile[]> = {
    aoxiang: [],
    eleme_promo: [],
    meituan_promo: [],
    qianniuhua: [],
  };
  const duplicateLabels = new Set<string>();
  const unrecognizedFiles: string[] = [];

  for (const file of fileList) {
    const kind = classifyAttachmentByFileName(file.name);
    if (!kind) {
      unrecognizedFiles.push(file.name);
      continue;
    }

    if (nextState[kind].length > 0) {
      duplicateLabels.add(
        attachmentConfigs.find((config) => config.key === kind)?.label || file.name,
      );
    }
    nextState[kind] = [file];
  }

  for (const config of attachmentConfigs) {
    uploadState[config.key] = nextState[config.key];
  }
  combinedUploadFiles.value = attachmentConfigs.flatMap((config) => nextState[config.key]);

  if (duplicateLabels.size > 0) {
    message.warning(`检测到重复类型文件，已保留最后一个：${Array.from(duplicateLabels).join('、')}`);
  }
  if (unrecognizedFiles.length > 0) {
    message.warning(`以下文件名暂时无法识别，未纳入任务附件：${unrecognizedFiles.join('、')}`);
  }
}

async function updateUploadStateFromFiles(fileList: UploadFile[]) {
  try {
    const normalizedFiles = await Promise.all(
      fileList.map((file) => cloneUploadFileToMemory(file)),
    );
    syncUploadStateFromFiles(normalizedFiles);
  } catch (error: any) {
    message.error(error?.message || '读取上传文件失败，请重新选择文件');
  }
}

function getMissingAttachmentLabels() {
  return requiredAttachmentKinds
    .filter((kind) => uploadState[kind].length === 0)
    .map((kind) => attachmentConfigs.find((config) => config.key === kind)?.label || kind);
}

function buildActionButtons(row: FinanceWorkbenchRow) {
  const buttons = [
    h(
      Button,
      {
        size: 'small',
        onClick: () => openTaskDetail(resolveTaskByRow(row)),
      },
      () => '查看详情',
    ),
    h(
      Button,
      {
        size: 'small',
        type: 'primary',
        onClick: () => openNewTask(undefined, resolveTaskByRow(row)),
      },
      () => '编辑任务',
    ),
  ];

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
  return tasks.value
    .map((task) => {
      return {
        id: task.id,
        month: task.month,
        resultStatusLabel: formatResultStatus(task),
        reportRelativePath: task.reportRelativePath,
        statusLabel: formatTaskStatus(task),
        taskId: task.id,
        taskName: task.taskName,
        updatedAt: task.updatedAt,
      };
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
});

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
    title: '任务名称',
    width: 260,
  },
  { dataIndex: 'month', key: 'month', title: '月份', width: 110 },
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
    dataIndex: 'resultStatusLabel',
    key: 'resultStatusLabel',
    title: '结果状态',
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

const selectedTaskIds = computed(() => {
  const selectedIds = new Set(selectedRowKeys.value);
  return workbenchRows.value.filter((row) => selectedIds.has(row.id)).map((row) => row.taskId);
});

const rowSelection = computed(() => ({
  selectedRowKeys: selectedRowKeys.value,
  onChange: (keys: Array<number | string>) => {
    selectedRowKeys.value = keys.map((key) => `${key}`);
  },
}));

const headerOptions = computed(() => [
  {
    label: '新建任务',
    renderType: 'button',
    type: 'primary',
    click: () => openNewTask(),
  },
  {
    danger: true,
    disabled: selectedTaskIds.value.length === 0,
    label:
      selectedTaskIds.value.length > 0
        ? `批量删除 (${selectedTaskIds.value.length})`
        : '批量删除',
    renderType: 'button',
    type: 'default',
    click: () => confirmBatchDelete(),
  },
]);

const drawerTitle = computed(() => {
  if (currentDetailTask.value?.taskName) return currentDetailTask.value.taskName;
  if (reportDetail.value) return `${reportDetail.value.report.storeName} ${reportDetail.value.report.month}`;
  return '财务任务详情';
});

const currentDetailSummary = computed(() => {
  if (!reportDetail.value) return null;
  return buildReportSummary(reportDetail.value);
});

const currentDetailStoreName = computed(() => {
  return reportDetail.value?.report.storeName || currentDetailTask.value?.storeName || '';
});

const currentStoreConfig = computed(() => {
  return resolveStoreConfig(currentDetailStoreName.value);
});

const currentStoreStatus = computed<StoreStatus>(() => {
  return resolveStoreStatus(currentDetailStoreName.value);
});

const currentPreviewColumns = computed(() =>
  reportDetail.value?.tablePreview?.rows
    ? previewColumnsFor(reportDetail.value.tablePreview.rows)
    : [],
);

function resetTaskForm() {
  currentTaskId.value = '';
  taskForm.anjiMtOrders = undefined;
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
  combinedUploadFiles.value = [];
}

async function loadTaskAttachments(taskId: string) {
  const files = await listFinanceTaskFiles(taskId);
  for (const config of attachmentConfigs) {
    const file = files.find((item) => item.kind === config.key);
    uploadState[config.key] = file ? [buildUploadFile(file)] : [];
  }
  combinedUploadFiles.value = attachmentConfigs.flatMap((config) => uploadState[config.key]);
}

async function persistCurrentTask() {
  const task = await saveFinanceTask({
    anjiMtOrders: taskForm.anjiMtOrders,
    id: currentTaskId.value || undefined,
    month: taskForm.month,
    notes: taskForm.notes,
    reportFileName: taskForm.reportFileName,
    reportRelativePath: taskForm.reportRelativePath,
    source: taskForm.source,
    status: taskForm.status,
    storeName: taskForm.storeName,
    taskName: buildFinanceTaskName(taskForm.month),
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

async function fetchAll(selectedMonth = '', force = false) {
  if (
    !force &&
    financeDataReady.value &&
    loadedMonth.value === selectedMonth
  ) {
    return;
  }

  loading.value = true;
  try {
    const [taskRes, storeRes] = await Promise.all([
      listFinanceTasks(),
      getFinanceStores(),
    ]);

    tasks.value = taskRes;
    stores.value = storeRes.list || [];
    loadedMonth.value = selectedMonth;
    financeDataReady.value = true;
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

  await fetchAll(month);

  const buildFilteredRows = () =>
    workbenchRows.value.filter((item) => {
      const matchesMonth = !month || item.month === month;
      return matchesMonth;
    });

  const start = (page - 1) * pageSize;
  const filteredRows = buildFilteredRows();

  return {
    list: filteredRows.slice(start, start + pageSize),
    total: filteredRows.length,
    totalPages: filteredRows.length,
  };
}

async function openDetail(relativePath?: string) {
  currentDetailTask.value = null;
  detailDrawerOpen.value = true;
  activeDetailTab.value = 'compare';

  if (!relativePath) {
    reportDetail.value = null;
    return;
  }

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
  } catch (error: any) {
    reportDetail.value = null;
    message.error(error?.message || '读取财务报表详情失败');
  } finally {
    detailLoading.value = false;
  }
}

async function openTaskDetail(task?: FinanceTaskRecord) {
  if (!task) return;

  currentDetailTask.value = task;
  detailDrawerOpen.value = true;
  activeDetailTab.value = 'compare';

  if (!task.reportRelativePath) {
    reportDetail.value = null;
    return;
  }

  await openDetail(task.reportRelativePath);
  currentDetailTask.value = task;
}

async function openNewTask(report?: FinanceReportItem, existingTask?: FinanceTaskRecord) {
  resetTaskForm();

  if (existingTask) {
    currentTaskId.value = existingTask.id;
    taskForm.anjiMtOrders = existingTask.anjiMtOrders;
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
    taskForm.anjiMtOrders = undefined;
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

  const missingAttachmentLabels = getMissingAttachmentLabels();
  if (missingAttachmentLabels.length > 0) {
    message.warning(`缺少必要 Excel：${missingAttachmentLabels.join('、')}`);
    return;
  }

  modalLoading.value = true;
  try {
    if (window.ipcRenderer) {
      const files = await Promise.all(
        combinedUploadFiles.value.map(async (file) => {
          const originFile = file.originFileObj as File | undefined;
          if (!originFile) {
            throw new Error(`文件 ${file.name} 读取失败`);
          }
          return {
            buffer: await originFile.arrayBuffer(),
            name: file.name,
          };
        }),
      );

      const analysisResult = await window.ipcRenderer.invoke(
        'run-finance-analysis',
        {
          anjiMtOrders: taskForm.anjiMtOrders,
          files,
          month: taskForm.month,
        },
      );

      if (!analysisResult?.success) {
        throw new Error(analysisResult?.message || '财务分析执行失败');
      }

      taskForm.reportFileName = `${analysisResult.reportFileName || ''}`.trim();
      taskForm.reportRelativePath = `${analysisResult.reportRelativePath || ''}`.trim();
      taskForm.status = 'ready';
    } else {
      taskForm.status = 'ready';
    }

    await persistCurrentTask();
    await fetchAll(searchFormModel.value.month, true);
    taskModalOpen.value = false;
    message.success('财务任务已创建并完成分析');
  } catch (error: any) {
    message.error(error?.message || '保存财务任务失败');
  } finally {
    modalLoading.value = false;
  }
}

function clearSelectedRowsByTaskIds(taskIds: string[]) {
  const taskIdSet = new Set(taskIds);
  selectedRowKeys.value = selectedRowKeys.value.filter((key) => {
    const row = workbenchRows.value.find((item) => item.id === key);
    return row?.taskId ? !taskIdSet.has(row.taskId) : true;
  });
}

async function handleDeleteTask(taskId?: string) {
  if (!taskId) return;
  await removeFinanceTask(taskId);
  clearSelectedRowsByTaskIds([taskId]);
  await fetchAll(searchFormModel.value.month, true);
  message.success('任务已删除');
}

function confirmBatchDelete() {
  if (selectedTaskIds.value.length === 0) return;

  Modal.confirm({
    title: `确认删除选中的 ${selectedTaskIds.value.length} 个财务任务吗？`,
    content: '删除后会一并移除这些任务下保存的上传附件，报表结果本身不会被删除。',
    okButtonProps: { danger: true },
    okText: '删除',
    cancelText: '取消',
    onOk: async () => {
      await handleBatchDeleteTasks();
    },
  });
}

async function handleBatchDeleteTasks() {
  if (selectedTaskIds.value.length === 0) return;

  const taskIds = [...selectedTaskIds.value];
  await removeFinanceTasks(taskIds);
  clearSelectedRowsByTaskIds(taskIds);
  await fetchAll(searchFormModel.value.month, true);
  message.success(`已删除 ${taskIds.length} 个任务`);
}

function resolveTaskByRow(row: FinanceWorkbenchRow) {
  return tasks.value.find((item) => item.id === row.taskId);
}

</script>

<template>
  <Page title="财务管理">
    <div class="finance-workbench">
      <SimpleTemplate
        v-model="searchFormModel"
        row-key="id"
        :search-form-items="searchFormItems"
        :columns="tableColumns"
        :row-selection="rowSelection"
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
        <div v-if="currentDetailTask || reportDetail" class="detail-layout">
          <Card :bordered="false" class="detail-section">
            <Descriptions :column="2" size="small">
              <Descriptions.Item label="任务名称">
                {{ currentDetailTask?.taskName || '--' }}
              </Descriptions.Item>
              <Descriptions.Item label="任务状态">
                {{ currentDetailTask ? formatTaskStatus(currentDetailTask) : '--' }}
              </Descriptions.Item>
              <Descriptions.Item label="月份">
                {{ currentDetailTask?.month || reportDetail?.report.month || '--' }}
              </Descriptions.Item>
              <Descriptions.Item label="门店">
                {{ currentDetailTask?.storeName || reportDetail?.report.storeName || '--' }}
              </Descriptions.Item>
              <Descriptions.Item label="任务来源">
                {{
                  currentDetailTask
                    ? currentDetailTask.source === 'regenerate'
                      ? '结果重生成'
                      : '手工任务'
                    : '--'
                }}
              </Descriptions.Item>
              <Descriptions.Item label="最近更新时间">
                {{ formatDatetime(currentDetailTask?.updatedAt || reportDetail?.report.createdAt) }}
              </Descriptions.Item>
              <Descriptions.Item label="生成结果">
                {{ reportDetail?.report.fileName || '暂无生成结果' }}
              </Descriptions.Item>
              <Descriptions.Item label="安吉店美团订单量">
                {{ currentDetailTask?.anjiMtOrders ?? '--' }}
              </Descriptions.Item>
              <Descriptions.Item label="备注">
                {{ currentDetailTask?.notes || '--' }}
              </Descriptions.Item>
            </Descriptions>
          </Card>

          <div class="detail-topbar">
            <Space wrap>
              <Tag :color="storeTagColor(currentStoreStatus)">
                门店状态：{{ formatStoreStatus(currentStoreStatus) }}
              </Tag>
              <Tag v-if="reportDetail" :color="profitTagColor(currentDetailSummary?.profitStatus || 'unknown')">
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
                v-if="reportDetail?.previousReport"
                size="small"
                @click="openDetail(reportDetail.previousReport.relativePath)"
              >
                查看上月报表
              </Button>
              <Button
                v-if="currentDetailTask"
                size="small"
                type="primary"
                @click="openNewTask(undefined, currentDetailTask)"
              >
                编辑任务
              </Button>
              <Button
                v-else-if="reportDetail"
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

          <template v-if="reportDetail">
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
          </template>

          <Empty v-else description="该任务暂无生成结果" />
        </div>

        <Empty v-else description="暂无财务任务详情" />
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
          <Form.Item label="月份" required>
            <DatePicker
              picker="month"
              placeholder="选择月份"
              style="width: 100%"
              :value="taskForm.month ? dayjs(taskForm.month, 'YYYY-MM') : undefined"
              @update:value="(val) => (taskForm.month = val ? dayjs(val).format('YYYY-MM') : '')"
            />
          </Form.Item>
          <Form.Item label="安吉店美团订单量">
            <Input
              :value="taskForm.anjiMtOrders"
              placeholder="可选，不填默认按 0 处理"
              type="number"
              @update:value="
                (val) =>
                  (taskForm.anjiMtOrders =
                    val === '' || val == null ? undefined : Math.max(0, Number(val)))
              "
            />
          </Form.Item>
          <Form.Item label="Excel 文件" required>
            <div class="upload-title">支持批量上传，系统会按文件名自动识别类型。</div>
            <div class="upload-tip">
              需要包含：牵牛花 Excel、翱象 Excel、饿了么推广费 Excel、美团推广费 Excel。
            </div>
            <BaseUpload
              :file-list="combinedUploadFiles"
              accept=".xlsx,.xls"
              :auto-upload="false"
              :max-count="8"
              :multiple="true"
              :show-upload-button="true"
              button-text="选择 Excel"
              list-type="text"
              @update:file-list="updateUploadStateFromFiles"
            />
            <div class="upload-tip">
              文件名识别规则：
              牵牛花/经营分析归类到主数据，含“翱象/翱翔”归类到翱象，含“饿了么+推广”或“美团+推广”归类到推广费。
            </div>
          </Form.Item>
          <Form.Item label="备注">
            <Input.TextArea
              v-model:value="taskForm.notes"
              :rows="3"
              placeholder="记录这次重生成的说明、输入来源或注意事项"
            />
          </Form.Item>
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
