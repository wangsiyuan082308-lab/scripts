<script lang="ts" setup>
import type { TableColumnsType, UploadFile } from 'ant-design-vue';

import type { ProductCompareAiConfig } from '#/api/decision-center';
import type {
  ProductCompareCheaperSide,
  ProductCompareMatchType,
  ProductCompareResult,
  ProductCompareResultType,
  ProductCompareSourceMode,
  ProductCompareTaskDetail,
  ProductCompareTaskStatus,
  ProductCompareTaskSummary,
} from '#/api/product-compare';
import type { ProductMasterStatus } from '#/api/product-master';

import { computed, h, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import { Page } from '@vben/common-ui';

import {
  Alert,
  Button,
  Card,
  Descriptions,
  DescriptionsItem,
  Drawer,
  Empty,
  Form,
  FormItem,
  Input,
  message,
  Modal,
  Radio,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Upload,
} from 'ant-design-vue';

import { getProductCompareAiConfig } from '#/api/decision-center';
import {
  cancelProductCompareTask,
  createProductCompareTask,
  deleteProductCompareTask,
  downloadProductCompareTargetFile,
  getProductCompareTask,
  getProductCompareTaskResultDetail,
  getProductCompareTaskResults,
  listProductCompareTasks,
  retryProductCompareTask,
  updateProductCompareTask,
} from '#/api/product-compare';
import { getProductMasterStatus } from '#/api/product-master';

const sourceMode = ref<ProductCompareSourceMode>('productMaster');
const router = useRouter();
const loading = ref(false);
const statusLoading = ref(false);
const configLoading = ref(false);
const taskListLoading = ref(false);
const taskActionLoading = ref(false);
const taskResultsLoading = ref(false);
const taskDeleteLoading = ref(false);
const taskEditLoading = ref(false);
const taskRetryLoading = ref(false);
const setupModalOpen = ref(false);
const taskEditOpen = ref(false);
const taskRetryOpen = ref(false);
const taskDetailOpen = ref(false);
const drawerOpen = ref(false);
type ProductCompareResultTabKey = 'all' | ProductCompareResultType;
const activeTab = ref<ProductCompareResultTabKey>('all');
const detailKeyword = ref('');
const detailMatchType = ref<'' | ProductCompareMatchType>('');
const detailCheaperSide = ref<'' | ProductCompareCheaperSide>('');
const appliedDetailKeyword = ref('');
const appliedDetailMatchType = ref<'' | ProductCompareMatchType>('');
const appliedDetailCheaperSide = ref<'' | ProductCompareCheaperSide>('');
const resultPage = ref(1);
const resultPageSize = ref(10);
const currentRecord = ref<null | ProductCompareResult>(null);
const productMasterStatus = ref<null | ProductMasterStatus>(null);
const currentTask = ref<null | ProductCompareTaskDetail>(null);
const editingTask = ref<null | ProductCompareTaskSummary>(null);
const retryingTask = ref<null | ProductCompareTaskSummary>(null);
const currentTaskId = ref('');
const taskList = ref<ProductCompareTaskSummary[]>([]);
const taskResults = ref<ProductCompareResult[]>([]);
const taskResultsTotal = ref(0);
const targetFileList = ref<UploadFile[]>([]);
const referenceFileList = ref<UploadFile[]>([]);
const editSourceMode = ref<ProductCompareSourceMode>('productMaster');
const editTargetFileName = ref('');
const editTargetFileList = ref<UploadFile[]>([]);
const editReferenceFileList = ref<UploadFile[]>([]);
const retryTargetFileName = ref('');
const retryTargetFileList = ref<UploadFile[]>([]);
const lastTaskToastKey = ref('');

let taskPollingTimer: null | number = null;

const aiConfig = reactive<ProductCompareAiConfig>({
  apiKey: '',
  baseUrl: '',
  matchPromptTemplate: '',
  model: '',
  newProductMonthlySalesThreshold: 10,
});

const resultTypeMeta: Record<
  ProductCompareResultType,
  { color: string; label: string }
> = {
  invalid: { color: 'default', label: '异常数据' },
  new_product_candidate: { color: 'green', label: '新品引入候选' },
  price_compare: { color: 'blue', label: '采购价对比' },
  unmatched_pending: { color: 'orange', label: '未匹配待确认' },
};

const matchTypeMeta: Record<
  ProductCompareMatchType,
  { color: string; label: string }
> = {
  ai_fuzzy: { color: 'cyan', label: 'AI模糊匹配' },
  unmatched: { color: 'default', label: '未匹配' },
  upc_exact: { color: 'blue', label: 'UPC精确匹配' },
};

const cheaperSideMeta: Record<
  ProductCompareCheaperSide,
  { color: string; label: string }
> = {
  equal: { color: 'default', label: '价格一致' },
  reference: { color: 'green', label: '对照货盘更低' },
  target: { color: 'gold', label: '主货盘更低' },
  unknown: { color: 'default', label: '无法判断' },
};
const taskStatusMeta: Record<
  ProductCompareTaskStatus,
  {
    alertType: 'error' | 'info' | 'success' | 'warning';
    color: string;
    description: string;
    label: string;
  }
> = {
  cancelled: {
    alertType: 'warning',
    color: 'warning',
    description: '任务已取消，可以重新调整文件后再发起。',
    label: '已取消',
  },
  failed: {
    alertType: 'error',
    color: 'error',
    description: '任务执行失败，请根据错误信息检查文件或 AI 配置。',
    label: '执行失败',
  },
  pending: {
    alertType: 'info',
    color: 'default',
    description: '任务已创建，等待后台调度开始执行。',
    label: '待执行',
  },
  running: {
    alertType: 'info',
    color: 'processing',
    description: '后台正在执行 UPC 匹配与 AI 模糊比对，可以稍后查看详情。',
    label: '执行中',
  },
  succeeded: {
    alertType: 'success',
    color: 'success',
    description: '任务已完成，可以查看本次比对结果和明细。',
    label: '已完成',
  },
};
const matchTypeFilterOptions: Array<{
  label: string;
  value: '' | ProductCompareMatchType;
}> = [
  { label: '全部匹配方式', value: '' },
  { label: 'UPC精准匹配', value: 'upc_exact' },
  { label: 'AI模糊匹配', value: 'ai_fuzzy' },
  { label: '未匹配', value: 'unmatched' },
];
const cheaperSideFilterOptions: Array<{
  label: string;
  value: '' | ProductCompareCheaperSide;
}> = [
  { label: '全部更低价来源', value: '' },
  { label: '价格一致', value: 'equal' },
  { label: '对照货盘更低', value: 'reference' },
  { label: '主货盘更低', value: 'target' },
  { label: '无法判断', value: 'unknown' },
];

const hasTaskResults = computed(() => {
  if (!currentTask.value) {
    return false;
  }
  return Number(currentTask.value.resultCount ?? currentTask.value.stats?.targetCount ?? 0) > 0;
});
const selectedTaskStatusMeta = computed(() =>
  currentTask.value ? taskStatusMeta[currentTask.value.status] : null,
);
const sourceModeFeatureTip = computed(() =>
  sourceMode.value === 'productMaster'
    ? '适合日常拿主货盘快速对比本地商品总表，不需要再准备第二份对照货盘。'
    : '适合临时做主货盘和对照货盘对照，系统会先按 UPC 精确匹配，再补充 AI 模糊匹配。',
);
const sourceModeTooltipInnerStyle = {
  border: '1px solid #dbe4ee',
  borderRadius: '12px',
  boxShadow: '0 12px 32px rgba(15, 23, 42, 0.12)',
  color: '#0f172a',
  padding: '10px 12px',
};
const sourceModeTooltipTitle = computed(() =>
  h(
    'div',
    {
      style: {
        maxWidth: '320px',
        lineHeight: '1.6',
      },
    },
    [
      h(
        'div',
        {
          style: {
            color: '#0f172a',
            fontWeight: '600',
            marginBottom: '6px',
          },
        },
        '先按 UPC 完全匹配，再对主货盘中的未匹配商品与对照货盘做名称/规格模糊比对。',
      ),
      h(
        'div',
        {
          style: {
            color: '#64748b',
          },
        },
        sourceModeFeatureTip.value,
      ),
    ],
  ),
);
const summaryLines = computed(() =>
  (currentTask.value?.summary || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean),
);

const groupedCounts = computed(() => {
  const counts: Record<ProductCompareResultType, number> = {
    invalid: 0,
    new_product_candidate: 0,
    price_compare: 0,
    unmatched_pending: 0,
  };
  const source = currentTask.value?.resultTypeCounts || {};
  const stats = currentTask.value?.stats;
  counts.invalid = Number(source.invalid ?? stats?.invalidCount ?? 0);
  counts.new_product_candidate = Number(
    source.new_product_candidate ?? stats?.newProductCandidateCount ?? 0,
  );
  counts.price_compare = Number(
    source.price_compare ?? stats?.priceCompareCount ?? 0,
  );
  counts.unmatched_pending = Number(
    source.unmatched_pending ?? stats?.unmatchedPendingCount ?? 0,
  );
  return counts;
});
const allResultCount = computed(() =>
  Number(currentTask.value?.resultCount ?? currentTask.value?.stats?.targetCount ?? 0),
);

const resultPagination = computed(() => ({
  current: resultPage.value,
  pageSize: resultPageSize.value,
  showQuickJumper: true,
  showSizeChanger: true,
  pageSizeOptions: ['10', '20', '50', '100'],
  showTotal: (total: number) => `共 ${total} 条`,
  total: taskResultsTotal.value,
}));

const targetOriginFile = computed(() => getOriginFile(targetFileList.value[0]));
const referenceOriginFile = computed(() =>
  getOriginFile(referenceFileList.value[0]),
);
const requiresReferenceFile = computed(() => sourceMode.value === 'custom');
const compareDisabledReason = computed(() => {
  if (!targetOriginFile.value) {
    return '请先上传主货盘 Excel';
  }
  if (
    sourceMode.value === 'productMaster' &&
    !productMasterStatus.value?.exists
  ) {
    return '商品总表模式下，需要先导入商品总表';
  }
  if (requiresReferenceFile.value && !referenceOriginFile.value) {
    return '双货盘模式下，需要上传对照货盘 Excel';
  }
  return '';
});
const canRunCompare = computed(() => !compareDisabledReason.value);
const currentTaskSummaryLines = computed(() =>
  (currentTask.value?.summary || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean),
);

const tabItems = computed(() => [
  {
    key: 'all',
    label: `全部结果 (${allResultCount.value})`,
  },
  {
    key: 'price_compare',
    label: `采购价对比 (${groupedCounts.value.price_compare})`,
  },
  {
    key: 'new_product_candidate',
    label: `新品引入候选 (${groupedCounts.value.new_product_candidate})`,
  },
  {
    key: 'unmatched_pending',
    label: `未匹配待确认 (${groupedCounts.value.unmatched_pending})`,
  },
  {
    key: 'invalid',
    label: `异常数据 (${groupedCounts.value.invalid})`,
  },
]);

function formatNumber(value?: null | number) {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return value;
}

function formatDate(value?: number | string) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
}

function formatTaskLabel(status: ProductCompareTaskStatus) {
  return taskStatusMeta[status].label;
}

function getTaskModeLabel(mode: ProductCompareSourceMode) {
  return mode === 'productMaster' ? '商品总表模式' : '双货盘模式';
}

function getTaskReferenceLabel(task: ProductCompareTaskSummary | ProductCompareTaskDetail) {
  return (
    task.referenceFileName ||
    (task.sourceMode === 'productMaster' ? '商品总表' : '对照货盘')
  );
}

function getTaskRowSummary(task: ProductCompareTaskSummary | ProductCompareTaskDetail) {
  if (task.status === 'failed' || task.status === 'cancelled') {
    return task.errorMessage || taskStatusMeta[task.status].description;
  }
  return task.summary || taskStatusMeta[task.status].description;
}

function getTaskHint(task: ProductCompareTaskDetail) {
  return task.errorMessage || taskStatusMeta[task.status].description;
}

function pickFirstVisibleTab() {
  activeTab.value = 'all';
  detailKeyword.value = '';
  detailMatchType.value = '';
  detailCheaperSide.value = '';
  appliedDetailKeyword.value = '';
  appliedDetailMatchType.value = '';
  appliedDetailCheaperSide.value = '';
  resultPage.value = 1;
  resultPageSize.value = 10;
}

function applyDetailFilters() {
  appliedDetailKeyword.value = detailKeyword.value.trim();
  appliedDetailMatchType.value = detailMatchType.value;
  appliedDetailCheaperSide.value = detailCheaperSide.value;
  resultPage.value = 1;
  if (taskDetailOpen.value && currentTask.value?.status === 'succeeded') {
    void loadTaskResults();
  }
}

function resetDetailFilters() {
  detailKeyword.value = '';
  detailMatchType.value = '';
  detailCheaperSide.value = '';
  appliedDetailKeyword.value = '';
  appliedDetailMatchType.value = '';
  appliedDetailCheaperSide.value = '';
  resultPage.value = 1;
  if (taskDetailOpen.value && currentTask.value?.status === 'succeeded') {
    void loadTaskResults();
  }
}

function handleResultTableChange(page: number, pageSize: number) {
  resultPage.value = page;
  resultPageSize.value = pageSize;
  if (taskDetailOpen.value && currentTask.value?.status === 'succeeded') {
    void loadTaskResults(true);
  }
}

function navigateToProductMaster() {
  router.push('/product/master').catch(() => {});
}

const columns: TableColumnsType<ProductCompareResult> = [
  { dataIndex: ['target', 'upc'], title: '主货盘UPC', width: 160 },
  {
    dataIndex: ['target', 'productName'],
    title: '主货盘商品',
    width: 220,
    ellipsis: true,
  },
  {
    dataIndex: ['target', 'specification'],
    title: '规格',
    width: 160,
    ellipsis: true,
    customRender: ({ text }) => text || '-',
  },
  {
    dataIndex: 'matchType',
    title: '匹配方式',
    width: 130,
    customRender: ({ text }) =>
      h(
        Tag,
        {
          color:
            matchTypeMeta[text as ProductCompareMatchType]?.color || 'default',
        },
        () => matchTypeMeta[text as ProductCompareMatchType]?.label || text,
      ),
  },
  {
    dataIndex: 'comparisonName',
    title: '比对对象',
    width: 220,
    ellipsis: true,
    customRender: ({ text }) => text || '-',
  },
  {
    dataIndex: ['target', 'procurementCost'],
    title: '主货盘采购价',
    width: 110,
    customRender: ({ text }) => formatNumber(text as null | number | undefined),
  },
  {
    dataIndex: ['reference', 'procurementCost'],
    title: '对照货盘采购价',
    width: 110,
    customRender: ({ record }) =>
      formatNumber(record.reference?.procurementCost),
  },
  {
    dataIndex: 'priceDiff',
    title: '价差(主货盘-对照货盘)',
    width: 130,
    customRender: ({ text }) => formatNumber(text as null | number | undefined),
  },
  {
    dataIndex: 'cheaperSide',
    title: '更低价来源',
    width: 120,
    customRender: ({ text }) =>
      h(
        Tag,
        {
          color:
            cheaperSideMeta[text as ProductCompareCheaperSide]?.color ||
            'default',
        },
        () => cheaperSideMeta[text as ProductCompareCheaperSide]?.label || text,
      ),
  },
  {
    dataIndex: 'conclusion',
    title: '处理结论',
    width: 180,
  },
  {
    key: 'actions',
    title: '操作',
    width: 110,
    fixed: 'right',
    customRender: ({ record }) =>
      h(
        Space,
        { size: 4 },
        () => [
          h(
            Button,
            {
              size: 'small',
              type: 'link',
              onClick: (event: MouseEvent) => {
                event.stopPropagation();
                openRecord(record as ProductCompareResult);
              },
            },
            () => '查看详情',
          ),
        ],
      ),
  },
];
const taskColumns: TableColumnsType<ProductCompareTaskSummary> = [
  {
    dataIndex: 'status',
    title: '状态',
    width: 110,
    customRender: ({ text }) =>
      h(
        Tag,
        {
          color:
            taskStatusMeta[text as ProductCompareTaskStatus]?.color || 'default',
        },
        () => formatTaskLabel(text as ProductCompareTaskStatus),
      ),
  },
  {
    dataIndex: 'sourceMode',
    title: '模式',
    width: 130,
    customRender: ({ text }) => getTaskModeLabel(text as ProductCompareSourceMode),
  },
  {
    dataIndex: 'targetFileName',
    title: '主货盘',
    ellipsis: true,
    minWidth: 240,
  },
  {
    key: 'referenceFileName',
    title: '对照来源',
    width: 160,
    customRender: ({ record }) =>
      getTaskReferenceLabel(record as ProductCompareTaskSummary),
  },
  {
    dataIndex: 'createdAt',
    title: '创建时间',
    width: 170,
    customRender: ({ text }) => formatDate(text as string),
  },
  {
    dataIndex: 'finishedAt',
    title: '完成时间',
    width: 170,
    customRender: ({ text }) => formatDate(text as string),
  },
  {
    key: 'summary',
    title: '任务摘要',
    ellipsis: true,
    minWidth: 280,
    customRender: ({ record }) => getTaskRowSummary(record as ProductCompareTaskSummary),
  },
  {
    key: 'action',
    title: '操作',
    width: 280,
    fixed: 'right',
    customRender: ({ record }) => {
      const task = record as ProductCompareTaskSummary;
      const canCancel = ['pending', 'running'].includes(task.status);
      const canViewDetail = task.status === 'succeeded';
      const canManage = !canCancel;

      return h(
        Space,
        { size: 4 },
        () => [
          canViewDetail
            ? h(
                Button,
                {
                  size: 'small',
                  type: task.taskId === currentTaskId.value ? 'primary' : 'link',
                  onClick: (event: MouseEvent) => {
                    event.stopPropagation();
                    void viewTaskDetail(task.taskId);
                  },
                },
                () => '查看详情',
              )
            : null,
          canManage
            ? h(
                Button,
                {
                  size: 'small',
                  type: 'link',
                  onClick: (event: MouseEvent) => {
                    event.stopPropagation();
                    openEditTask(task);
                  },
                },
                () => '编辑',
              )
            : null,
          canManage
            ? h(
                Button,
                {
                  size: 'small',
                  type: 'link',
                  onClick: (event: MouseEvent) => {
                    event.stopPropagation();
                    openRetryTask(task);
                  },
                },
                () => '重新发起',
              )
            : null,
          canCancel
            ? h(
                Button,
                {
                  danger: true,
                  loading:
                    taskActionLoading.value &&
                    currentTask.value?.taskId === task.taskId,
                  size: 'small',
                  type: 'link',
                  onClick: (event: MouseEvent) => {
                    event.stopPropagation();
                    if (currentTask.value?.taskId !== task.taskId) {
                      void loadTaskDetail(task.taskId, true).then(() => {
                        void cancelTask();
                      });
                      return;
                    }
                    void cancelTask();
                  },
                },
                () => '取消',
              )
            : null,
          canManage
            ? h(
                Button,
                {
                  danger: true,
                  loading: taskDeleteLoading.value,
                  size: 'small',
                  type: 'link',
                  onClick: (event: MouseEvent) => {
                    event.stopPropagation();
                    confirmDeleteTask(task);
                  },
                },
                () => '删除',
              )
            : null,
        ],
      );
    },
  },
];

async function loadProductMasterStatus() {
  statusLoading.value = true;
  try {
    productMasterStatus.value = await getProductMasterStatus();
  } catch (error: any) {
    message.error(error.message || '获取商品总表状态失败');
  } finally {
    statusLoading.value = false;
  }
}

async function loadAiConfig() {
  configLoading.value = true;
  try {
    Object.assign(aiConfig, await getProductCompareAiConfig());
  } catch (error: any) {
    message.error(error.message || '获取 AI 阈值配置失败');
  } finally {
    configLoading.value = false;
  }
}

async function loadTaskResults(silent = false) {
  if (!currentTask.value) {
    taskResults.value = [];
    taskResultsTotal.value = 0;
    return;
  }

  if (currentTask.value.status !== 'succeeded') {
    taskResults.value = [];
    taskResultsTotal.value = 0;
    return;
  }

  if (!silent) {
    taskResultsLoading.value = true;
  }

  try {
    const response = await getProductCompareTaskResults({
      cheaperSide: appliedDetailCheaperSide.value,
      keyword: appliedDetailKeyword.value,
      matchType: appliedDetailMatchType.value,
      page: resultPage.value,
      pageSize: resultPageSize.value,
      resultType: activeTab.value === 'all' ? '' : activeTab.value,
      taskId: currentTask.value.taskId,
    });
    taskResults.value = response.items;
    taskResultsTotal.value = response.total;
    if (currentTask.value && !currentTask.value.resultCount) {
      currentTask.value = {
        ...currentTask.value,
        resultCount:
          currentTask.value.stats?.targetCount ?? response.total,
      };
    }
  } catch (error: any) {
    if (!silent) {
      message.error(error.message || '获取商品比对结果失败');
    }
  } finally {
    if (!silent) {
      taskResultsLoading.value = false;
    }
  }
}

function stopTaskPolling() {
  if (taskPollingTimer !== null) {
    window.clearTimeout(taskPollingTimer);
    taskPollingTimer = null;
  }
}

function scheduleTaskPolling(taskId: string) {
  stopTaskPolling();
  taskPollingTimer = window.setTimeout(() => {
    void pollTask(taskId);
  }, 2000);
}

function notifyTaskIfNeeded(task: ProductCompareTaskDetail, previousStatus?: string) {
  if (task.status === previousStatus) {
    return;
  }
  if (!['cancelled', 'failed'].includes(task.status)) {
    return;
  }

  const toastKey = `${task.taskId}:${task.status}`;
  if (lastTaskToastKey.value === toastKey) {
    return;
  }
  lastTaskToastKey.value = toastKey;

  if (task.status === 'cancelled') {
    message.warning(task.errorMessage || '商品比对任务已取消');
  } else {
    message.error(task.errorMessage || '商品比对任务执行失败');
  }
}

async function loadTaskList(silent = false) {
  if (!silent) {
    taskListLoading.value = true;
  }
  try {
    taskList.value = await listProductCompareTasks(8);
  } catch (error: any) {
    if (!silent) {
      message.error(error.message || '获取商品比对任务列表失败');
    }
  } finally {
    if (!silent) {
      taskListLoading.value = false;
    }
  }
}

async function applyTaskDetail(task: ProductCompareTaskDetail) {
  const previousStatus =
    currentTask.value?.taskId === task.taskId ? currentTask.value.status : undefined;
  currentTaskId.value = task.taskId;
  currentTask.value = task;
  notifyTaskIfNeeded(task, previousStatus);

  if (['pending', 'running'].includes(task.status)) {
    scheduleTaskPolling(task.taskId);
  } else {
    stopTaskPolling();
  }

  if (task.status !== 'succeeded') {
    taskResults.value = [];
    taskResultsTotal.value = 0;
  } else if (taskDetailOpen.value) {
    pickFirstVisibleTab();
    void loadTaskResults(true);
  }
}

async function loadTaskDetail(taskId: string, silent = false) {
  try {
    const task = await getProductCompareTask(taskId);
    await applyTaskDetail(task);
  } catch (error: any) {
    stopTaskPolling();
    if (!silent) {
      message.error(error.message || '获取商品比对任务详情失败');
    }
  }
}

async function pollTask(taskId: string) {
  await Promise.all([loadTaskDetail(taskId, true), loadTaskList(true)]);
}

function handleTargetChange(info: { fileList: UploadFile[] }) {
  targetFileList.value = info.fileList.slice(-1);
}

function handleReferenceChange(info: { fileList: UploadFile[] }) {
  referenceFileList.value = info.fileList.slice(-1);
}

function handleEditTargetChange(info: { fileList: UploadFile[] }) {
  editTargetFileList.value = info.fileList.slice(-1);
}

function handleEditReferenceChange(info: { fileList: UploadFile[] }) {
  editReferenceFileList.value = info.fileList.slice(-1);
}

function handleRetryTargetChange(info: { fileList: UploadFile[] }) {
  retryTargetFileList.value = info.fileList.slice(-1);
}

function getOriginFile(file?: null | UploadFile) {
  return (file?.originFileObj as File | undefined) || null;
}

function resetEditState() {
  editingTask.value = null;
  editSourceMode.value = 'productMaster';
  editTargetFileName.value = '';
  editTargetFileList.value = [];
  editReferenceFileList.value = [];
}

function resetRetryState() {
  retryingTask.value = null;
  retryTargetFileName.value = '';
  retryTargetFileList.value = [];
}

function validateBeforeRun() {
  const targetFile = getOriginFile(targetFileList.value[0]);
  const referenceFile = getOriginFile(referenceFileList.value[0]);

  if (!targetFile) {
    throw new Error('请上传主货盘 Excel');
  }

  if (sourceMode.value === 'productMaster') {
    if (!productMasterStatus.value?.exists) {
      throw new Error('商品总表模式需要先导入商品总表');
    }
    return { referenceFile: null, targetFile };
  }

  if (!referenceFile) {
    throw new Error('双货盘模式必须上传对照货盘 Excel');
  }

  return { referenceFile, targetFile };
}

async function runCompare() {
  try {
    const { referenceFile, targetFile } = validateBeforeRun();
    loading.value = true;
    const task = await createProductCompareTask({
      referenceFile,
      sourceMode: sourceMode.value,
      targetFile,
    });
    setupModalOpen.value = false;
    taskResults.value = [];
    taskResultsTotal.value = 0;
    await Promise.all([loadTaskList(true), loadTaskDetail(task.taskId, true)]);
    taskDetailOpen.value = true;
    pickFirstVisibleTab();
    await loadTaskResults(true);
    message.success('已创建商品比对任务，后台开始执行');
  } catch (error: any) {
    message.error(error.message || '创建商品比对任务失败');
  } finally {
    loading.value = false;
  }
}

async function viewTaskDetail(taskId?: string) {
  if (taskId) {
    await loadTaskDetail(taskId);
  }
  if (!currentTask.value) return;
  taskDetailOpen.value = true;
  pickFirstVisibleTab();
  await loadTaskResults();
}

function openEditTask(task: ProductCompareTaskSummary) {
  editingTask.value = task;
  editSourceMode.value = task.sourceMode;
  editTargetFileName.value = task.targetFileName;
  editTargetFileList.value = [];
  editReferenceFileList.value = [];
  taskEditOpen.value = true;
}

function openRetryTask(task: ProductCompareTaskSummary) {
  retryingTask.value = task;
  retryTargetFileName.value = task.targetFileName;
  retryTargetFileList.value = [];
  taskRetryOpen.value = true;
}

async function downloadTaskTarget(task: ProductCompareTaskSummary | ProductCompareTaskDetail) {
  try {
    const blob = await downloadProductCompareTargetFile(task.taskId);
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = task.targetFileName || 'target.xlsx';
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.URL.revokeObjectURL(url);
  } catch (error: any) {
    message.error(error.message || '下载主货盘失败');
  }
}

async function submitEditTask() {
  if (!editingTask.value) return;
  const targetFileName = editTargetFileName.value.trim();
  if (!targetFileName) {
    message.error('主货盘名称不能为空');
    return;
  }

  taskEditLoading.value = true;
  try {
    const nextTargetFile = getOriginFile(editTargetFileList.value[0]);
    const nextReferenceFile = getOriginFile(editReferenceFileList.value[0]);
    const sourceChanged = editSourceMode.value !== editingTask.value.sourceMode;
    const targetChanged = Boolean(nextTargetFile);
    const referenceChanged = Boolean(nextReferenceFile);
    const updated = await updateProductCompareTask(editingTask.value.taskId, {
      referenceFile: nextReferenceFile,
      sourceMode: editSourceMode.value,
      targetFile: nextTargetFile,
      targetFileName,
    });
    await loadTaskList(true);
    if (currentTaskId.value === updated.taskId) {
      await loadTaskDetail(updated.taskId, true);
    }
    taskEditOpen.value = false;
    resetEditState();
    message.success('任务已更新');

    if (sourceChanged || targetChanged || referenceChanged) {
      Modal.confirm({
        title: '重新发起比对任务',
        content: '比对模式或主货盘/对照货盘文件已变更，是否立即重新发起商品比对任务？',
        okText: '立即发起',
        cancelText: '稍后再说',
        onOk: async () => {
          const nextTask = await retryProductCompareTask(updated.taskId, {
            targetFile: nextTargetFile,
            targetFileName,
          });
          await loadTaskList(true);
          message.success('已根据更新后的配置重新发起商品比对任务');
          await viewTaskDetail(nextTask.taskId);
        },
      });
    }
  } catch (error: any) {
    message.error(error.message || '更新任务失败');
  } finally {
    taskEditLoading.value = false;
  }
}

async function submitRetryTask() {
  if (!retryingTask.value) return;
  const nextTargetFile = getOriginFile(retryTargetFileList.value[0]);
  if (!nextTargetFile) {
    message.warning('比对模式和数据源未变化，无需重新发起；如只需改名称请使用编辑');
    return;
  }

  taskRetryLoading.value = true;
  try {
    const nextTask = await retryProductCompareTask(retryingTask.value.taskId, {
      targetFile: nextTargetFile,
      targetFileName:
        retryTargetFileName.value.trim() || retryingTask.value.targetFileName,
    });
    await loadTaskList(true);
    taskRetryOpen.value = false;
    resetRetryState();
    message.success('已重新发起商品比对任务');
    await viewTaskDetail(nextTask.taskId);
  } catch (error: any) {
    message.error(error.message || '重新发起任务失败');
  } finally {
    taskRetryLoading.value = false;
  }
}

function confirmDeleteTask(task: ProductCompareTaskSummary) {
  Modal.confirm({
    title: '删除任务',
    content: `确认删除任务「${task.targetFileName}」吗？删除后任务记录和上传文件会一并移除。`,
    okButtonProps: {
      danger: true,
    },
    onOk: async () => {
      taskDeleteLoading.value = true;
      try {
        await deleteProductCompareTask(task.taskId);
        if (currentTaskId.value === task.taskId) {
          currentTaskId.value = '';
          currentTask.value = null;
          taskResults.value = [];
          taskResultsTotal.value = 0;
          taskDetailOpen.value = false;
        }
        await loadTaskList(true);
        message.success('任务已删除');
      } catch (error: any) {
        message.error(error.message || '删除任务失败');
      } finally {
        taskDeleteLoading.value = false;
      }
    },
  });
}

async function cancelTask() {
  if (!currentTask.value) return;

  taskActionLoading.value = true;
  try {
    await cancelProductCompareTask(currentTask.value.taskId);
    message.success('已发送取消请求');
    await Promise.all([
      loadTaskDetail(currentTask.value.taskId, true),
      loadTaskList(true),
    ]);
  } catch (error: any) {
    message.error(error.message || '取消商品比对任务失败');
  } finally {
    taskActionLoading.value = false;
  }
}

async function openRecord(record: ProductCompareResult) {
  if (!currentTask.value) return;

  try {
    const detail = await getProductCompareTaskResultDetail(
      currentTask.value.taskId,
      record.id,
    );
    currentRecord.value = detail;
    drawerOpen.value = true;
  } catch (error: any) {
    message.error(error.message || '获取商品比对明细失败');
  }
}

function openSetupModal() {
  setupModalOpen.value = true;
}

onMounted(async () => {
  await Promise.all([loadProductMasterStatus(), loadAiConfig(), loadTaskList(true)]);
  if (taskList.value[0]?.taskId) {
    await loadTaskDetail(taskList.value[0].taskId, true);
  }
});

onBeforeUnmount(() => {
  stopTaskPolling();
});

watch(activeTab, () => {
  resultPage.value = 1;
  if (taskDetailOpen.value && currentTask.value?.status === 'succeeded') {
    void loadTaskResults(true);
  }
});

watch(
  () => [taskDetailOpen.value, currentTask.value?.taskId, currentTask.value?.status],
  ([open, taskId, status]) => {
    if (!open || !taskId || status !== 'succeeded') {
      return;
    }
    void loadTaskResults(true);
  },
);

</script>

<template>
  <Page title="商品比对">
    <div class="product-compare-page">
      <Card :bordered="false" class="panel-card">
        <div class="panel-head">
          <div>
            <div class="panel-title">任务中心</div>
            <div class="panel-subtitle">
              每次商品比对都会生成后台任务。点击新建任务后，在弹框里选择比对模式并上传文件。
            </div>
          </div>
          <div class="panel-actions">
            <Space>
              <Button type="primary" @click="openSetupModal">新建比对任务</Button>
              <Button :loading="taskListLoading" @click="loadTaskList()">刷新任务</Button>
            </Space>
          </div>
        </div>
        <Table
          class="task-table"
          :columns="taskColumns"
          :data-source="taskList"
          :loading="taskListLoading"
          :pagination="false"
          row-key="taskId"
          size="middle"
          :scroll="{ x: 1280 }"
          :custom-row="
            (record) => ({
              onClick: () =>
                loadTaskDetail(
                  (record as ProductCompareTaskSummary).taskId,
                ),
            })
          "
          :row-class-name="
            (record) =>
              (record as ProductCompareTaskSummary).taskId === currentTaskId
                ? 'task-table-row-active'
                : ''
          "
        >
          <template #emptyText>
            <Empty description="还没有商品比对任务记录，先新建一个任务试试。" />
          </template>
        </Table>
      </Card>
    </div>

    <Modal
      v-model:open="taskEditOpen"
      title="编辑任务"
      :confirm-loading="taskEditLoading"
      ok-text="保存"
      cancel-text="取消"
      @ok="submitEditTask"
      @cancel="resetEditState"
    >
      <template v-if="editingTask">
        <Form layout="vertical">
          <FormItem label="比对模式" required>
            <Radio.Group v-model:value="editSourceMode" class="mode-radio-group">
              <Radio.Button value="productMaster">商品总表模式</Radio.Button>
              <Radio.Button value="custom">自定义双货盘模式</Radio.Button>
            </Radio.Group>
            <div class="field-tip">
              修改比对模式后不会自动重算，保存后可按提示决定是否重新发起。
            </div>
          </FormItem>

          <FormItem label="主货盘名称" required>
            <Input
              v-model:value="editTargetFileName"
              placeholder="请输入主货盘名称"
            />
            <div class="field-tip">
              仅更新任务里的展示名称，不会重新执行商品比对。
            </div>
          </FormItem>

          <FormItem label="主货盘文件操作">
            <Button size="small" @click="downloadTaskTarget(editingTask)">
              下载上一次主货盘
            </Button>
          </FormItem>

          <FormItem label="替换主货盘文件">
            <Upload.Dragger
              accept=".xlsx,.xls"
              :before-upload="() => false"
              :file-list="editTargetFileList"
              :max-count="1"
              @change="handleEditTargetChange"
            >
              <p>点击或拖拽上传新的主货盘 Excel</p>
              <p class="upload-tip">
                不上传则保留当前文件；上传后会替换任务保存的主货盘文件。
              </p>
            </Upload.Dragger>
          </FormItem>

          <FormItem
            v-if="editSourceMode === 'custom'"
            label="对照货盘文件"
            required
          >
            <Upload.Dragger
              accept=".xlsx,.xls"
              :before-upload="() => false"
              :file-list="editReferenceFileList"
              :max-count="1"
              @change="handleEditReferenceChange"
            >
              <p>点击或拖拽上传对照货盘 Excel</p>
              <p class="upload-tip">
                切换到自定义双货盘模式时，需要提供一份对照货盘文件。
              </p>
            </Upload.Dragger>
          </FormItem>
        </Form>
      </template>
    </Modal>

    <Modal
      v-model:open="taskRetryOpen"
      title="重新发起任务"
      :confirm-loading="taskRetryLoading"
      ok-text="重新发起"
      cancel-text="取消"
      @ok="submitRetryTask"
      @cancel="resetRetryState"
    >
      <template v-if="retryingTask">
        <Alert
          show-icon
          type="info"
          class="mb-4"
          message="默认复用当前任务的原始文件重新发起，也可以先下载上一次货盘后替换上传。"
        />

        <Form layout="vertical">
          <FormItem label="主货盘名称" required>
            <Input
              v-model:value="retryTargetFileName"
              placeholder="请输入新的主货盘名称"
            />
            <div class="field-tip">
              会作为新任务的主货盘名称，不影响当前任务记录。
            </div>
          </FormItem>

          <FormItem label="主货盘文件操作">
            <Button size="small" @click="downloadTaskTarget(retryingTask)">
              下载上一次主货盘
            </Button>
          </FormItem>

          <FormItem label="替换主货盘">
            <Upload.Dragger
              accept=".xlsx,.xls"
              :before-upload="() => false"
              :file-list="retryTargetFileList"
              :max-count="1"
              @change="handleRetryTargetChange"
            >
              <p>点击或拖拽上传新的主货盘 Excel</p>
              <p class="upload-tip">
                不上传则复用当前任务的主货盘文件重新发起。
              </p>
            </Upload.Dragger>
          </FormItem>
        </Form>
      </template>
    </Modal>

    <Drawer
      v-model:open="taskDetailOpen"
      title="任务详情"
      :width="1120"
      placement="right"
    >
      <template v-if="currentTask">
        <div class="task-detail-head">
          <div>
            <div class="task-current-title">任务编号</div>
            <div class="task-current-id">{{ currentTask.taskId }}</div>
          </div>
          <div class="task-current-badges">
            <Tag :color="selectedTaskStatusMeta?.color">
              {{ selectedTaskStatusMeta?.label }}
            </Tag>
            <Tag color="default">
              {{ getTaskModeLabel(currentTask.sourceMode) }}
            </Tag>
          </div>
        </div>

        <div class="task-meta-grid compact">
          <div class="task-meta-item">
            <span class="task-meta-label">主货盘</span>
            <span class="task-meta-value">{{ currentTask.targetFileName }}</span>
          </div>
          <div class="task-meta-item">
            <span class="task-meta-label">对照来源</span>
            <span class="task-meta-value">{{ getTaskReferenceLabel(currentTask) }}</span>
          </div>
          <div class="task-meta-item">
            <span class="task-meta-label">创建时间</span>
            <span class="task-meta-value">{{ formatDate(currentTask.createdAt) }}</span>
          </div>
          <div class="task-meta-item">
            <span class="task-meta-label">开始时间</span>
            <span class="task-meta-value">{{ formatDate(currentTask.startedAt) }}</span>
          </div>
          <div class="task-meta-item">
            <span class="task-meta-label">完成时间</span>
            <span class="task-meta-value">{{ formatDate(currentTask.finishedAt) }}</span>
          </div>
          <div class="task-meta-item">
            <span class="task-meta-label">任务摘要</span>
            <span class="task-meta-value">{{ getTaskRowSummary(currentTask) }}</span>
          </div>
        </div>

        <div
          v-if="currentTask.status !== 'succeeded' && currentTaskSummaryLines.length > 0"
          class="summary-box"
        >
          <div v-for="line in currentTaskSummaryLines" :key="line">{{ line }}</div>
        </div>

        <Alert
          v-if="currentTask.status !== 'succeeded'"
          show-icon
          class="mb-4"
          :type="selectedTaskStatusMeta?.alertType"
          :message="getTaskHint(currentTask)"
        />

        <template v-else-if="hasTaskResults">
          <div v-if="summaryLines.length > 0" class="summary-box">
            <div v-for="line in summaryLines" :key="line">{{ line }}</div>
          </div>

          <div class="result-toolbar">
            <Input
              v-model:value="detailKeyword"
              class="result-toolbar-search"
              placeholder="搜索 UPC、商品名称、处理结论"
              @press-enter="applyDetailFilters"
            />
            <Select
              v-model:value="detailMatchType"
              allow-clear
              class="result-toolbar-select"
              placeholder="筛选匹配方式"
            >
              <Select.Option
                v-for="option in matchTypeFilterOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </Select.Option>
            </Select>
            <Select
              v-model:value="detailCheaperSide"
              allow-clear
              class="result-toolbar-select"
              placeholder="筛选更低价来源"
            >
              <Select.Option
                v-for="option in cheaperSideFilterOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </Select.Option>
            </Select>
            <Button type="primary" @click="applyDetailFilters">搜索</Button>
            <Button @click="resetDetailFilters">重置</Button>
          </div>

          <Tabs v-model:active-key="activeTab" :items="tabItems" />
          <Table
            :columns="columns"
            :loading="taskResultsLoading"
            :data-source="taskResults"
            :pagination="resultPagination"
            row-key="id"
            size="middle"
            :scroll="{ x: 1400 }"
            @change="
              (pagination) =>
                handleResultTableChange(
                  pagination.current || 1,
                  pagination.pageSize || 10,
                )
            "
          >
            <template #emptyText>
              <Empty description="当前筛选条件下暂无结果，请调整筛选条件后重试。" />
            </template>
          </Table>
        </template>
        <Empty
          v-else
          description="当前任务还没有可展示的比对结果。"
        />
      </template>
    </Drawer>

    <Drawer
      v-model:open="drawerOpen"
      title="商品比对详情"
      :width="640"
      placement="right"
    >
      <template v-if="currentRecord">
        <Descriptions :column="1" bordered size="small">
          <DescriptionsItem label="处理结论">
            <Tag :color="resultTypeMeta[currentRecord.resultType].color">
              {{ resultTypeMeta[currentRecord.resultType].label }}
            </Tag>
            <span class="ml-2">{{ currentRecord.conclusion }}</span>
          </DescriptionsItem>
          <DescriptionsItem label="匹配方式">
            <Tag :color="matchTypeMeta[currentRecord.matchType].color">
              {{ matchTypeMeta[currentRecord.matchType].label }}
            </Tag>
          </DescriptionsItem>
          <DescriptionsItem label="匹配说明">
            {{ currentRecord.matchReason || '-' }}
          </DescriptionsItem>
          <DescriptionsItem label="匹配置信度">
            {{ currentRecord.matchConfidence ?? '-' }}
          </DescriptionsItem>
          <DescriptionsItem label="更低价来源">
            <Tag :color="cheaperSideMeta[currentRecord.cheaperSide].color">
              {{ cheaperSideMeta[currentRecord.cheaperSide].label }}
            </Tag>
          </DescriptionsItem>
          <DescriptionsItem label="价差(主货盘-对照货盘)">
            {{ formatNumber(currentRecord.priceDiff) }}
          </DescriptionsItem>
        </Descriptions>

        <Card title="主货盘" size="small" class="detail-card">
          <Descriptions :column="1" bordered size="small">
            <DescriptionsItem label="UPC">
              {{ currentRecord.target.upc || '-' }}
            </DescriptionsItem>
            <DescriptionsItem label="SKU">
              {{ currentRecord.target.sku || '-' }}
            </DescriptionsItem>
            <DescriptionsItem label="商品名称">
              {{ currentRecord.target.productName || '-' }}
            </DescriptionsItem>
            <DescriptionsItem label="规格">
              {{ currentRecord.target.specification || '-' }}
            </DescriptionsItem>
            <DescriptionsItem label="采购价">
              {{ formatNumber(currentRecord.target.procurementCost) }}
            </DescriptionsItem>
            <DescriptionsItem label="月销">
              {{ formatNumber(currentRecord.target.monthlySales) }}
            </DescriptionsItem>
            <DescriptionsItem label="供应商">
              {{ currentRecord.target.supplierName || '-' }}
            </DescriptionsItem>
            <DescriptionsItem label="供应商编码">
              {{ currentRecord.target.supplierCode || '-' }}
            </DescriptionsItem>
            <DescriptionsItem label="采购单位">
              {{ currentRecord.target.purchaseUnit || '-' }}
            </DescriptionsItem>
          </Descriptions>
          <pre class="raw-box">{{
            JSON.stringify(currentRecord.target.rawData, null, 2)
          }}</pre>
        </Card>

        <Card title="对照货盘" size="small" class="detail-card">
          <template v-if="currentRecord.reference">
            <Descriptions :column="1" bordered size="small">
              <DescriptionsItem label="来源">
                {{ currentRecord.reference.sourceLabel }}
              </DescriptionsItem>
              <DescriptionsItem label="UPC">
                {{ currentRecord.reference.upc || '-' }}
              </DescriptionsItem>
              <DescriptionsItem label="SKU">
                {{ currentRecord.reference.sku || '-' }}
              </DescriptionsItem>
              <DescriptionsItem label="商品名称">
                {{ currentRecord.reference.productName || '-' }}
              </DescriptionsItem>
              <DescriptionsItem label="规格">
                {{ currentRecord.reference.specification || '-' }}
              </DescriptionsItem>
              <DescriptionsItem label="采购价">
                {{ formatNumber(currentRecord.reference.procurementCost) }}
              </DescriptionsItem>
              <DescriptionsItem label="供应商">
                {{ currentRecord.reference.supplierName || '-' }}
              </DescriptionsItem>
              <DescriptionsItem label="供应商编码">
                {{ currentRecord.reference.supplierCode || '-' }}
              </DescriptionsItem>
              <DescriptionsItem label="供应商商品名称">
                {{ currentRecord.reference.supplierProductName || '-' }}
              </DescriptionsItem>
              <DescriptionsItem label="供应商商品规格">
                {{ currentRecord.reference.supplierProductSpec || '-' }}
              </DescriptionsItem>
              <DescriptionsItem label="采购单位">
                {{ currentRecord.reference.purchaseUnit || '-' }}
              </DescriptionsItem>
              <DescriptionsItem label="商品链接">
                <a
                  v-if="currentRecord.reference.supplierProductLink"
                  :href="currentRecord.reference.supplierProductLink"
                  target="_blank"
                  rel="noreferrer"
                >
                  打开链接
                </a>
                <span v-else>-</span>
              </DescriptionsItem>
            </Descriptions>
            <pre class="raw-box">{{
              JSON.stringify(currentRecord.reference.rawData, null, 2)
            }}</pre>
          </template>
          <Empty v-else description="当前记录没有对照货盘明细" />
        </Card>
      </template>
    </Drawer>

    <Modal
      v-model:open="setupModalOpen"
      title="配置商品比对"
      :width="880"
      ok-text="开始比对"
      cancel-text="取消"
      :ok-button-props="{ disabled: !canRunCompare, loading }"
      @ok="runCompare"
    >
      <div class="setup-modal-body">
        <Alert
          v-if="sourceMode === 'productMaster'"
          :type="productMasterStatus?.exists ? 'success' : 'warning'"
          show-icon
          class="mb-4"
          :message="
            productMasterStatus?.exists
              ? `商品总表已就绪，共 ${productMasterStatus.recordCount} 条商品，最近索引时间 ${formatDate(productMasterStatus.indexBuiltAt)}`
              : '当前未检测到商品总表，请先到商品总表页面导入后再执行比对。'
          "
        />

        <Alert
          show-icon
          type="info"
          class="mb-4"
          message="先按 UPC 完全匹配，再对主货盘中的未匹配商品与对照货盘做名称/规格模糊匹配。"
        />

        <Form layout="vertical">
          <FormItem>
            <div class="mode-section">
              <div class="mode-section-head">
                <span class="mode-section-label">货盘对照模式</span>
                <Tooltip
                  :title="sourceModeTooltipTitle"
                  color="#ffffff"
                  :overlay-inner-style="sourceModeTooltipInnerStyle"
                  placement="top"
                >
                  <span class="mode-tip-icon">i</span>
                </Tooltip>
              </div>
              <Radio.Group v-model:value="sourceMode" class="mode-radio-group">
                <Radio.Button value="productMaster">
                  跟商品总表比对
                </Radio.Button>
                <Radio.Button value="custom">自定义双货盘比对</Radio.Button>
              </Radio.Group>
            </div>
          </FormItem>
        </Form>

        <div class="context-actions">
          <Button
            v-if="
              sourceMode === 'productMaster' && !productMasterStatus?.exists
            "
            size="small"
            @click="navigateToProductMaster"
          >
            去导入商品总表
          </Button>
        </div>

        <div class="upload-grid">
          <FormItem label="主货盘 Excel" required>
            <Upload.Dragger
              accept=".xlsx,.xls"
              :before-upload="() => false"
              :file-list="targetFileList"
              :max-count="1"
              @change="handleTargetChange"
            >
              <p>点击或拖拽上传主货盘</p>
              <p class="upload-tip">
                会读取 UPC、商品名称、规格、采购价、月销等字段。
              </p>
            </Upload.Dragger>
          </FormItem>

          <FormItem
            v-if="sourceMode === 'custom'"
            label="对照货盘 Excel"
            required
          >
            <Upload.Dragger
              accept=".xlsx,.xls"
              :before-upload="() => false"
              :file-list="referenceFileList"
              :max-count="1"
              @change="handleReferenceChange"
            >
              <p>点击或拖拽上传对照货盘</p>
              <p class="upload-tip">会用于 UPC 精确匹配和 AI 模糊候选匹配。</p>
            </Upload.Dragger>
          </FormItem>
        </div>
      </div>
    </Modal>
  </Page>
</template>

<style scoped>
.product-compare-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.panel-card {
  border-radius: 20px;
}

.task-detail-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 16px;
}

.task-current-title {
  color: #0f172a;
  font-size: 15px;
  font-weight: 600;
}

.task-current-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.task-current-id {
  margin-top: 6px;
  color: #64748b;
  font-size: 12px;
  line-height: 1.6;
  word-break: break-all;
}

.task-meta-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin-top: 16px;
}

.task-meta-item {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border-radius: 14px;
  background: #fff;
}

.task-meta-label {
  color: #94a3b8;
  font-size: 12px;
}

.task-meta-value {
  color: #0f172a;
  font-weight: 600;
  line-height: 1.5;
  word-break: break-word;
}

.task-table {
  margin-top: 16px;
}

:deep(.task-table .ant-table-tbody > tr.task-table-row-active > td) {
  background: #eef6ff;
}

:deep(.task-table .ant-table-tbody > tr) {
  cursor: pointer;
}

.panel-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 20px;
}

.panel-actions {
  display: flex;
  align-items: center;
}

.panel-title {
  font-size: 18px;
  font-weight: 600;
  color: #1f2937;
}

.panel-subtitle {
  margin-top: 6px;
  color: #6b7280;
  line-height: 1.6;
}

.upload-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
}

.upload-tip {
  margin-top: 8px;
  color: #6b7280;
}

.field-tip {
  margin-top: 8px;
  color: #94a3b8;
  font-size: 12px;
  line-height: 1.6;
}

.file-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid #dbe4ee;
  border-radius: 12px;
  background: #f8fafc;
}

.file-card-name {
  color: #0f172a;
  line-height: 1.6;
  word-break: break-all;
}

.context-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.mode-radio-group {
  width: 100%;
}

.mode-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.mode-section-head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.mode-section-label {
  color: #1f2937;
  font-size: 14px;
  font-weight: 500;
}

.mode-option-title {
  color: #0f172a;
  font-weight: 600;
}

.mode-option-text {
  margin-top: 8px;
  color: #64748b;
  line-height: 1.6;
}

.mode-tip-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 999px;
  border: 1px solid #cbd5e1;
  background: #fff;
  flex-shrink: 0;
  color: #64748b;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  cursor: help;
  transition: all 0.2s ease;
}

.mode-tip-icon:hover {
  border-color: #94a3b8;
  color: #0f172a;
}

.summary-box {
  padding: 14px 16px;
  margin-bottom: 16px;
  border-radius: 16px;
  background: #f8fafc;
  border: 1px dashed #cbd5e1;
  line-height: 1.8;
  color: #334155;
}

.detail-card {
  margin-top: 16px;
}

.setup-modal-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.result-toolbar {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}

.result-toolbar-search {
  flex: 1;
}

.result-toolbar-select {
  width: 220px;
}

.raw-box {
  margin-top: 12px;
  padding: 12px;
  border-radius: 12px;
  background: #0f172a;
  color: #e2e8f0;
  overflow: auto;
  font-size: 12px;
  line-height: 1.6;
}

@media (max-width: 960px) {
  .panel-head {
    flex-direction: column;
  }

  .panel-actions {
    width: 100%;
    justify-content: flex-start;
  }

  .upload-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .mode-section-head {
    align-items: flex-start;
  }
}

@media (max-width: 960px) {
  .task-meta-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .task-detail-head {
    flex-direction: column;
  }

  .result-toolbar {
    flex-direction: column;
  }

  .result-toolbar-select {
    width: 100%;
  }
}
</style>
