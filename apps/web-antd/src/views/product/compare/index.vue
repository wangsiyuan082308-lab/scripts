<script lang="ts" setup>
import type { TableColumnsType, UploadFile } from 'ant-design-vue';

import { computed, h, onMounted, reactive, ref } from 'vue';

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
  Modal,
  Radio,
  Space,
  Table,
  Tabs,
  Tag,
  Upload,
  message,
} from 'ant-design-vue';

import { readFileAsBuffer } from '#/utils/file';

type ProductCompareCheaperSide = 'equal' | 'reference' | 'target' | 'unknown';
type ProductCompareMatchType = 'ai_fuzzy' | 'unmatched' | 'upc_exact';
type ProductCompareResultType =
  | 'invalid'
  | 'new_product_candidate'
  | 'price_compare'
  | 'unmatched_pending';
type ProductCompareSourceMode = 'custom' | 'productMaster';

interface ProductCompareAiConfig {
  apiKey: string;
  baseUrl: string;
  matchPromptTemplate: string;
  model: string;
  newProductMonthlySalesThreshold: number;
}

interface ProductCompareRecordSide {
  monthlySales?: null | number;
  procurementCost?: null | number;
  productName: string;
  purchaseUnit?: string;
  rawData: Record<string, any>;
  sku: string;
  sourceLabel: string;
  specification: string;
  supplierCode?: string;
  supplierName?: string;
  supplierProductLink?: string;
  supplierProductName?: string;
  supplierProductSpec?: string;
  upc: string;
}

interface ProductCompareResult {
  cheaperSide: ProductCompareCheaperSide;
  comparisonName: string;
  conclusion: string;
  id: string;
  matchConfidence?: null | number;
  matchReason?: string;
  matchType: ProductCompareMatchType;
  priceDiff?: null | number;
  reference?: null | ProductCompareRecordSide;
  resultType: ProductCompareResultType;
  target: ProductCompareRecordSide;
}

interface ProductCompareRunStats {
  aiMatchedCount: number;
  aiNoMatchCount: number;
  aiSkippedCount: number;
  candidateCount: number;
  exactMatchedCount: number;
  invalidCount: number;
  newProductCandidateCount: number;
  priceCompareCount: number;
  targetCount: number;
  unmatchedPendingCount: number;
}

interface ProductCompareRunData {
  aiConfig: ProductCompareAiConfig;
  results: ProductCompareResult[];
  stats: ProductCompareRunStats;
  summary: string;
}

interface ProductMasterStatus {
  exists: boolean;
  fileMtimeMs: number;
  indexBuiltAt?: string;
  rawPath: string;
  rawSourcePath?: string;
  rawSize: number;
  recordCount: number;
  schemaVersion: number;
}

const sourceMode = ref<ProductCompareSourceMode>('productMaster');
const loading = ref(false);
const statusLoading = ref(false);
const configLoading = ref(false);
const sourceModeModalOpen = ref(false);
const drawerOpen = ref(false);
const activeTab = ref<ProductCompareResultType>('price_compare');
const currentRecord = ref<null | ProductCompareResult>(null);
const productMasterStatus = ref<null | ProductMasterStatus>(null);
const report = ref<null | ProductCompareRunData>(null);
const targetFileList = ref<UploadFile[]>([]);
const referenceFileList = ref<UploadFile[]>([]);

const aiConfig = reactive<ProductCompareAiConfig>({
  apiKey: '',
  baseUrl: '',
  matchPromptTemplate: '',
  model: '',
  newProductMonthlySalesThreshold: 10,
});

const resultTypeMeta: Record<ProductCompareResultType, { color: string; label: string }> = {
  invalid: { color: 'default', label: '异常数据' },
  new_product_candidate: { color: 'green', label: '新品引入候选' },
  price_compare: { color: 'blue', label: '采购价对比' },
  unmatched_pending: { color: 'orange', label: '未匹配待确认' },
};

const matchTypeMeta: Record<ProductCompareMatchType, { color: string; label: string }> = {
  ai_fuzzy: { color: 'cyan', label: 'AI模糊匹配' },
  unmatched: { color: 'default', label: '未匹配' },
  upc_exact: { color: 'blue', label: 'UPC精确匹配' },
};

const cheaperSideMeta: Record<ProductCompareCheaperSide, { color: string; label: string }> = {
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
  (report.value?.results || []).filter((item) => item.resultType === activeTab.value),
);

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
  if (value == null || Number.isNaN(value)) return '-';
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
        { color: matchTypeMeta[text as ProductCompareMatchType]?.color || 'default' },
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
    customRender: ({ text }) => formatNumber(text as number | null | undefined),
  },
  {
    dataIndex: ['reference', 'procurementCost'],
    title: '比对采购价',
    width: 110,
    customRender: ({ record }) => formatNumber(record.reference?.procurementCost),
  },
  {
    dataIndex: 'priceDiff',
    title: '价差(目标-比对)',
    width: 130,
    customRender: ({ text }) => formatNumber(text as number | null | undefined),
  },
  {
    dataIndex: 'cheaperSide',
    title: '更低价来源',
    width: 120,
    customRender: ({ text }) =>
      h(
        Tag,
        { color: cheaperSideMeta[text as ProductCompareCheaperSide]?.color || 'default' },
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
    const result = await window.ipcRenderer.invoke('get-product-master-status');
    if (!result.success) {
      throw new Error(result.message || '获取商品总表状态失败');
    }
    productMasterStatus.value = result.data;
  } catch (error: any) {
    message.error(error.message || '获取商品总表状态失败');
  } finally {
    statusLoading.value = false;
  }
}

async function loadAiConfig() {
  configLoading.value = true;
  try {
    const result = await window.ipcRenderer.invoke('get-product-compare-ai-config');
    if (!result.success) {
      throw new Error(result.message || '获取 AI 阈值配置失败');
    }
    Object.assign(aiConfig, result.data);
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
    const targetBuffer = await readFileAsBuffer(targetFile);
    const referenceBuffer = referenceFile
      ? await readFileAsBuffer(referenceFile)
      : undefined;

    const result = await window.ipcRenderer.invoke('run-product-compare', {
      referenceBuffer,
      sourceMode: sourceMode.value,
      targetBuffer,
    });

    if (!result.success) {
      throw new Error(result.message || '商品比对失败');
    }

    report.value = result.data;
    Object.assign(aiConfig, result.data.aiConfig || {});
    pickFirstVisibleTab();
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
            <div class="panel-title">比对设置</div>
            <div class="panel-subtitle">
              先按 UPC 完全匹配，再对未匹配商品使用大模型做名称/规格模糊比对。
            </div>
          </div>
          <Space>
            <Button @click="resetFiles">清空文件</Button>
            <Button type="primary" :loading="loading" @click="runCompare">
              开始比对
            </Button>
          </Space>
        </div>

        <Form layout="vertical">
          <FormItem label="比对来源模式">
            <div class="mode-selector">
              <div class="mode-copy">
                <div class="mode-value">{{ sourceModeLabel }}</div>
                <div class="mode-desc">{{ sourceModeDescription }}</div>
              </div>
              <Button @click="sourceModeModalOpen = true">选择模式</Button>
            </div>
          </FormItem>

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

          <div class="upload-grid" :class="{ single: sourceMode === 'productMaster' }">
            <FormItem label="目标货盘 Excel" required>
              <Upload.Dragger
                accept=".xlsx,.xls"
                :before-upload="() => false"
                :file-list="targetFileList"
                :max-count="1"
                @change="handleTargetChange"
              >
                <p>点击或拖拽上传目标货盘</p>
                <p class="upload-tip">会读取 UPC、商品名称、规格、采购价、月销等字段。</p>
              </Upload.Dragger>
            </FormItem>

            <FormItem v-if="sourceMode === 'custom'" label="比对货盘 Excel" required>
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
        </Form>
      </Card>

      <Card :bordered="false" class="panel-card">
        <div class="stats-strip">
          <div class="stat-chip">
            <span class="stat-label">新品月销阈值</span>
            <strong>{{ aiConfig.newProductMonthlySalesThreshold }}</strong>
          </div>
          <div class="stat-chip">
            <span class="stat-label">当前模型</span>
            <strong>{{ aiConfig.model || '-' }}</strong>
          </div>
          <div class="stat-chip">
            <span class="stat-label">商品总表记录</span>
            <strong>{{ productMasterStatus?.recordCount ?? 0 }}</strong>
          </div>
        </div>

        <div v-if="summaryLines.length > 0" class="summary-box">
          <div v-for="line in summaryLines" :key="line">{{ line }}</div>
        </div>

        <template v-if="hasResults">
          <Tabs v-model:activeKey="activeTab" :items="tabItems" />
          <Table
            :columns="columns"
            :custom-row="(record) => ({ onClick: () => openRecord(record as ProductCompareResult) })"
            :data-source="currentRows"
            :pagination="{ pageSize: 10 }"
            row-key="id"
            size="middle"
            :scroll="{ x: 1400 }"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.dataIndex === 'conclusion'">
                <Button type="link" @click="openRecord(record as ProductCompareResult)">
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
            <DescriptionsItem label="UPC">{{ currentRecord.target.upc || '-' }}</DescriptionsItem>
            <DescriptionsItem label="SKU">{{ currentRecord.target.sku || '-' }}</DescriptionsItem>
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
          <pre class="raw-box">{{ JSON.stringify(currentRecord.target.rawData, null, 2) }}</pre>
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
            <pre class="raw-box">{{ JSON.stringify(currentRecord.reference.rawData, null, 2) }}</pre>
          </template>
          <Empty v-else description="当前记录没有比对侧明细" />
        </Card>
      </template>
    </Drawer>

    <Modal
      v-model:open="sourceModeModalOpen"
      title="选择比对来源模式"
      ok-text="确认"
      cancel-text="取消"
    >
      <Form layout="vertical">
        <FormItem label="比对来源模式">
          <Radio.Group v-model:value="sourceMode" class="mode-radio-group">
            <Radio.Button value="productMaster">跟商品总表比对</Radio.Button>
            <Radio.Button value="custom">自定义双货盘比对</Radio.Button>
          </Radio.Group>
        </FormItem>
      </Form>

      <div class="mode-option-list">
        <div class="mode-option-card" :class="{ active: sourceMode === 'productMaster' }">
          <div class="mode-option-title">跟商品总表比对</div>
          <div class="mode-option-text">
            只上传目标货盘，自动引用本地商品总表作为比对侧。
          </div>
        </div>
        <div class="mode-option-card" :class="{ active: sourceMode === 'custom' }">
          <div class="mode-option-title">自定义双货盘比对</div>
          <div class="mode-option-text">
            同时上传目标货盘和比对货盘，适合临时做两份货盘对照。
          </div>
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

.panel-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
  margin-bottom: 20px;
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

.mode-radio-group {
  width: 100%;
}

.mode-option-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.mode-option-card {
  padding: 14px 16px;
  border: 1px solid #dbe4ee;
  border-radius: 16px;
  background: #f8fafc;
}

.mode-option-card.active {
  border-color: #0f766e;
  background: linear-gradient(135deg, rgba(15, 118, 110, 0.08), rgba(14, 165, 233, 0.12));
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

.stats-strip {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}

.stat-chip {
  padding: 14px 16px;
  border-radius: 16px;
  background:
    linear-gradient(135deg, rgba(15, 118, 110, 0.08), rgba(14, 165, 233, 0.12)),
    #f8fafc;
  border: 1px solid rgba(15, 118, 110, 0.12);
}

.stat-label {
  display: block;
  margin-bottom: 6px;
  color: #6b7280;
  font-size: 12px;
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

  .upload-grid,
  .upload-grid.single,
  .stats-strip,
  .mode-option-list {
    grid-template-columns: minmax(0, 1fr);
  }

  .mode-selector {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
