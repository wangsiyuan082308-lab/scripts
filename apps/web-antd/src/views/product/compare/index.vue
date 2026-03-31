<script lang="ts" setup>
import type { TableColumnsType, UploadFile } from 'ant-design-vue';

import type { ProductCompareAiConfig } from '#/api/decision-center';
import type {
  ProductCompareCheaperSide,
  ProductCompareMatchType,
  ProductCompareResult,
  ProductCompareResultType,
  ProductCompareRunResult,
  ProductCompareSourceMode,
} from '#/api/product-compare';
import type { ProductMasterStatus } from '#/api/product-master';

import { computed, h, onMounted, reactive, ref } from 'vue';
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
  message,
  Modal,
  Radio,
  Space,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Upload,
} from 'ant-design-vue';

import { getProductCompareAiConfig } from '#/api/decision-center';
import { runProductCompare } from '#/api/product-compare';
import { getProductMasterStatus } from '#/api/product-master';

const sourceMode = ref<ProductCompareSourceMode>('productMaster');
const router = useRouter();
const loading = ref(false);
const statusLoading = ref(false);
const configLoading = ref(false);
const setupModalOpen = ref(false);
const drawerOpen = ref(false);
const activeTab = ref<ProductCompareResultType>('price_compare');
const currentRecord = ref<null | ProductCompareResult>(null);
const productMasterStatus = ref<null | ProductMasterStatus>(null);
const report = ref<null | ProductCompareRunResult>(null);
const targetFileList = ref<UploadFile[]>([]);
const referenceFileList = ref<UploadFile[]>([]);

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
  reference: { color: 'green', label: '比对侧更低' },
  target: { color: 'gold', label: '目标货盘更低' },
  unknown: { color: 'default', label: '无法判断' },
};

const hasResults = computed(() => (report.value?.results || []).length > 0);
const sourceModeLabel = computed(() =>
  sourceMode.value === 'productMaster' ? '跟商品总表比对' : '自定义双货盘比对',
);
const sourceModeDescription = computed(() =>
  sourceMode.value === 'productMaster'
    ? '只上传目标货盘，系统会直接引用本地商品总表作为比对基准。'
    : '同时上传目标货盘和比对货盘，系统会用两份 Excel 做逐项比对。',
);
const sourceModeFeatureTip = computed(() =>
  sourceMode.value === 'productMaster'
    ? '适合日常拿目标货盘快速对比本地商品总表，不需要再准备第二份比对文件。'
    : '适合临时做两份货盘对照，系统会先按 UPC 精确匹配，再补充 AI 模糊匹配。',
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
        '先按 UPC 完全匹配，再对未匹配商品使用大模型做名称/规格模糊比对。',
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
  (report.value?.summary || '')
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
  for (const item of report.value?.results || []) {
    counts[item.resultType]++;
  }
  return counts;
});

const currentRows = computed(() =>
  (report.value?.results || []).filter(
    (item) => item.resultType === activeTab.value,
  ),
);

const targetOriginFile = computed(() => getOriginFile(targetFileList.value[0]));
const referenceOriginFile = computed(() =>
  getOriginFile(referenceFileList.value[0]),
);
const requiresReferenceFile = computed(() => sourceMode.value === 'custom');
const hasAiModel = computed(() => Boolean(aiConfig.model || aiConfig.baseUrl));
const compareDisabledReason = computed(() => {
  if (!targetOriginFile.value) {
    return '请先上传目标货盘 Excel';
  }
  if (
    sourceMode.value === 'productMaster' &&
    !productMasterStatus.value?.exists
  ) {
    return '商品总表模式下，需要先导入商品总表';
  }
  if (requiresReferenceFile.value && !referenceOriginFile.value) {
    return '双货盘模式下，需要上传比对货盘 Excel';
  }
  return '';
});
const canRunCompare = computed(() => !compareDisabledReason.value);

function getReferenceReadinessValue() {
  if (sourceMode.value === 'productMaster') {
    return productMasterStatus.value?.exists
      ? `商品总表 ${productMasterStatus.value.recordCount} 条`
      : '未导入商品总表';
  }
  return referenceOriginFile.value?.name || '未上传';
}

const executionChecks = computed(() => [
  {
    key: 'target',
    label: '目标货盘',
    status: Boolean(targetOriginFile.value),
    value: targetOriginFile.value?.name || '未上传',
  },
  {
    key: 'reference',
    label: sourceMode.value === 'productMaster' ? '比对来源' : '比对货盘',
    status:
      sourceMode.value === 'productMaster'
        ? Boolean(productMasterStatus.value?.exists)
        : Boolean(referenceOriginFile.value),
    value: getReferenceReadinessValue(),
  },
  {
    key: 'ai',
    label: '模型',
    status: hasAiModel.value,
    value: hasAiModel.value ? aiConfig.model || '已配置' : '未配置',
  },
]);

const tabItems = computed(() => [
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

function pickFirstVisibleTab() {
  const order: ProductCompareResultType[] = [
    'price_compare',
    'new_product_candidate',
    'unmatched_pending',
    'invalid',
  ];
  activeTab.value =
    order.find((key) => groupedCounts.value[key] > 0) || 'price_compare';
}

function navigateToProductMaster() {
  router.push('/product/master').catch(() => {});
}

async function refreshCompareContext() {
  await Promise.all([loadProductMasterStatus(), loadAiConfig()]);
  message.success('比对上下文已刷新');
}

const columns: TableColumnsType<ProductCompareResult> = [
  { dataIndex: ['target', 'upc'], title: '目标UPC', width: 160 },
  {
    dataIndex: ['target', 'productName'],
    title: '目标商品',
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
    title: '目标采购价',
    width: 110,
    customRender: ({ text }) => formatNumber(text as null | number | undefined),
  },
  {
    dataIndex: ['reference', 'procurementCost'],
    title: '比对采购价',
    width: 110,
    customRender: ({ record }) =>
      formatNumber(record.reference?.procurementCost),
  },
  {
    dataIndex: 'priceDiff',
    title: '价差(目标-比对)',
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

function handleTargetChange(info: { fileList: UploadFile[] }) {
  targetFileList.value = info.fileList.slice(-1);
}

function handleReferenceChange(info: { fileList: UploadFile[] }) {
  referenceFileList.value = info.fileList.slice(-1);
}

function getOriginFile(file?: null | UploadFile) {
  return (file?.originFileObj as File | undefined) || null;
}

function validateBeforeRun() {
  const targetFile = getOriginFile(targetFileList.value[0]);
  const referenceFile = getOriginFile(referenceFileList.value[0]);

  if (!targetFile) {
    throw new Error('请上传目标货盘 Excel');
  }

  if (sourceMode.value === 'productMaster') {
    if (!productMasterStatus.value?.exists) {
      throw new Error('商品总表模式需要先导入商品总表');
    }
    return { referenceFile: null, targetFile };
  }

  if (!referenceFile) {
    throw new Error('双货盘模式必须上传比对货盘 Excel');
  }

  return { referenceFile, targetFile };
}

async function runCompare() {
  try {
    const { referenceFile, targetFile } = validateBeforeRun();
    loading.value = true;
    const result = await runProductCompare({
      referenceFile,
      sourceMode: sourceMode.value,
      targetFile,
    });

    report.value = result;
    Object.assign(aiConfig, result.aiConfig || {});
    pickFirstVisibleTab();
    setupModalOpen.value = false;
    message.success('商品比对完成');
  } catch (error: any) {
    message.error(error.message || '商品比对失败');
  } finally {
    loading.value = false;
  }
}

function openRecord(record: ProductCompareResult) {
  currentRecord.value = record;
  drawerOpen.value = true;
}

function resetFiles() {
  targetFileList.value = [];
  referenceFileList.value = [];
}

function openSetupModal() {
  setupModalOpen.value = true;
}

onMounted(async () => {
  await Promise.all([loadProductMasterStatus(), loadAiConfig()]);
});
</script>

<template>
  <Page title="商品比对">
    <div class="product-compare-page">
      <Card :bordered="false" class="panel-card">
        <div class="panel-head">
          <div>
            <div class="panel-title">比对概览</div>
            <div class="panel-subtitle">
              上传与模式选择已收进弹框。这里先看当前配置状态，再进入弹框完成本次比对。
            </div>
          </div>
          <div class="panel-actions">
            <Space>
              <Button @click="refreshCompareContext">刷新状态</Button>
              <Button @click="resetFiles">清空文件</Button>
              <Button type="primary" @click="openSetupModal">配置比对</Button>
            </Space>
          </div>
        </div>

        <div class="overview-shell">
          <div class="mode-selector">
            <div class="mode-copy">
              <div class="mode-value">{{ sourceModeLabel }}</div>
              <div class="mode-desc">{{ sourceModeDescription }}</div>
            </div>
            <div class="mode-badge">
              {{
                sourceMode === 'productMaster' ? '商品总表模式' : '双货盘模式'
              }}
            </div>
          </div>

          <div class="overview-meta">
            <div
              v-for="item in executionChecks"
              :key="item.key"
              class="overview-chip"
            >
              <span class="overview-chip-label">{{ item.label }}</span>
              <span class="overview-chip-value">{{ item.value }}</span>
            </div>
          </div>

          <div class="overview-hint" :class="{ ready: canRunCompare }">
            {{
              canRunCompare
                ? '当前配置已齐，进入弹框即可开始比对。'
                : compareDisabledReason
            }}
          </div>
        </div>
      </Card>

      <Card :bordered="false" class="panel-card">
        <div v-if="summaryLines.length > 0" class="summary-box">
          <div v-for="line in summaryLines" :key="line">{{ line }}</div>
        </div>

        <template v-if="hasResults">
          <Tabs v-model:active-key="activeTab" :items="tabItems" />
          <Table
            :columns="columns"
            :custom-row="
              (record) => ({
                onClick: () => openRecord(record as ProductCompareResult),
              })
            "
            :data-source="currentRows"
            :pagination="{ pageSize: 10 }"
            row-key="id"
            size="middle"
            :scroll="{ x: 1400 }"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.dataIndex === 'conclusion'">
                <Button
                  type="link"
                  @click="openRecord(record as ProductCompareResult)"
                >
                  {{ (record as ProductCompareResult).conclusion }}
                </Button>
              </template>
            </template>
            <template #emptyText>
              <Empty description="当前分组下暂无结果" />
            </template>
          </Table>
        </template>
        <Empty
          v-else
          description="上传文件并开始比对后，这里会展示采购价对比、新品引入候选和异常数据。"
        />
      </Card>
    </div>

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
          <DescriptionsItem label="价差(目标-比对)">
            {{ formatNumber(currentRecord.priceDiff) }}
          </DescriptionsItem>
        </Descriptions>

        <Card title="目标货盘" size="small" class="detail-card">
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

        <Card title="比对侧" size="small" class="detail-card">
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
          <Empty v-else description="当前记录没有比对侧明细" />
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
          message="先按 UPC 完全匹配，再对未匹配商品使用大模型做名称/规格模糊比对。"
        />

        <Form layout="vertical">
          <FormItem>
            <div class="mode-section">
              <div class="mode-section-head">
                <span class="mode-section-label">比对来源模式</span>
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

        <div
          class="upload-grid"
          :class="{ single: sourceMode === 'productMaster' }"
        >
          <FormItem label="目标货盘 Excel" required>
            <Upload.Dragger
              accept=".xlsx,.xls"
              :before-upload="() => false"
              :file-list="targetFileList"
              :max-count="1"
              @change="handleTargetChange"
            >
              <p>点击或拖拽上传目标货盘</p>
              <p class="upload-tip">
                会读取 UPC、商品名称、规格、采购价、月销等字段。
              </p>
            </Upload.Dragger>
          </FormItem>

          <FormItem
            v-if="sourceMode === 'custom'"
            label="比对货盘 Excel"
            required
          >
            <Upload.Dragger
              accept=".xlsx,.xls"
              :before-upload="() => false"
              :file-list="referenceFileList"
              :max-count="1"
              @change="handleReferenceChange"
            >
              <p>点击或拖拽上传比对货盘</p>
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

.overview-shell {
  display: flex;
  flex-direction: column;
  gap: 16px;
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
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.upload-grid.single {
  grid-template-columns: minmax(0, 1fr);
}

.upload-tip {
  margin-top: 8px;
  color: #6b7280;
}

.context-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}

.mode-selector {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  border: 1px solid #dbe4ee;
  border-radius: 16px;
  background: #f8fafc;
}

.mode-copy {
  min-width: 0;
}

.mode-value {
  color: #0f172a;
  font-size: 15px;
  font-weight: 600;
}

.mode-desc {
  margin-top: 6px;
  color: #64748b;
  line-height: 1.6;
}

.mode-badge {
  flex-shrink: 0;
  padding: 6px 10px;
  border-radius: 999px;
  background: #eef2f7;
  color: #475569;
  font-size: 12px;
}

.overview-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.overview-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 999px;
  background: #f8fafc;
  color: #475569;
  font-size: 12px;
}

.overview-chip-label {
  color: #94a3b8;
}

.overview-chip-value {
  color: #0f172a;
  font-weight: 600;
}

.overview-hint {
  color: #94a3b8;
  font-size: 13px;
  line-height: 1.6;
}

.overview-hint.ready {
  color: #0f766e;
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

.readiness-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-top: 16px;
}

.readiness-grid.compact {
  margin-top: 0;
}

.readiness-item {
  padding: 14px 16px;
  border: 1px solid #dbe4ee;
  border-radius: 16px;
  background: #f8fafc;
}

.readiness-item.ready {
  border-color: rgba(15, 118, 110, 0.2);
  background:
    linear-gradient(135deg, rgba(15, 118, 110, 0.08), rgba(14, 165, 233, 0.08)),
    #f8fafc;
}

.readiness-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.readiness-label {
  color: #0f172a;
  font-weight: 600;
}

.readiness-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: #cbd5e1;
  flex-shrink: 0;
}

.readiness-dot.ready {
  background: #0f766e;
}

.readiness-value {
  margin-top: 8px;
  color: #64748b;
  line-height: 1.6;
  word-break: break-all;
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

  .upload-grid,
  .upload-grid.single,
  .readiness-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .mode-selector {
    align-items: flex-start;
    flex-direction: column;
  }

  .mode-section-head {
    align-items: flex-start;
  }
}
</style>
