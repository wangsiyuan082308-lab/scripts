<script lang="tsx" setup>
import type { TableColumnsType } from 'ant-design-vue';

import { computed, h, onMounted, reactive, ref, toRaw } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Button,
  Card,
  Descriptions,
  Empty,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Upload,
  message,
} from 'ant-design-vue';

import { getStoreList } from '#/api/store';
import { readFileAsBuffer } from '#/utils/file';

interface ProductMasterListItem {
  baseUnitProcurementCost?: number | null;
  cartonProcurementCost?: number | null;
  cartonSize?: string;
  currentRetailPrice?: number | null;
  hasStorePriceVariance?: boolean;
  primaryStoreNames: string[];
  primarySupplierNames: string[];
  procurementCost?: number | null;
  productName: string;
  priceVarianceReason?: string;
  sku: string;
  specification: string;
  storeCount: number;
  supplierCount: number;
  upc: string;
}

interface FilterOption {
  label: string;
  value: string;
}

interface ProductMasterStatus {
  exists: boolean;
  fileMtimeMs: number;
  indexBuiltAt?: string;
  rawPath: string;
  rawSize: number;
  rawSourcePath?: string;
  recordCount: number;
  schemaVersion: number;
}

const loading = ref(false);
const statusLoading = ref(false);
const statusModalOpen = ref(false);
const rows = ref<ProductMasterListItem[]>([]);
const storeOptions = ref<FilterOption[]>([]);
const supplierOptions = ref<FilterOption[]>([]);
const status = ref<ProductMasterStatus | null>(null);

const filters = reactive({
  hasStorePriceVariance: undefined as string | undefined,
  productName: '',
  storeNames: [] as string[],
  supplierNames: [] as string[],
  upc: '',
});

const statusTagColor = computed(() => (status.value?.exists ? 'success' : 'default'));
const statusText = computed(() => (status.value?.exists ? '已上传' : '未上传'));

function compareNumber(left?: number | null, right?: number | null) {
  return (left ?? Number.NEGATIVE_INFINITY) - (right ?? Number.NEGATIVE_INFINITY);
}

const columns: TableColumnsType = [
  { dataIndex: 'upc', title: '商品条码', width: 160 },
  { dataIndex: 'sku', title: '商品编码', width: 180 },
  {
    dataIndex: 'productName',
    title: '商品名称',
    width: 280,
    ellipsis: true,
    customRender: ({ record, text }) => {
      const row = record as ProductMasterListItem;
      if (!row.hasStorePriceVariance) {
        return text || '-';
      }
      return h(
        Space,
        { size: 6 },
        {
          default: () => [
            h(
              Tooltip,
              { title: `多门店采购价不一致：${row.priceVarianceReason}` },
              {
                default: () =>
                  h(
                    Tag,
                    { color: 'warning' },
                    () => '差异',
                  ),
              },
            ),
            h('span', text || '-'),
          ],
        },
      );
    },
  },
  { dataIndex: 'specification', title: '规格', width: 160, ellipsis: true },
  {
    dataIndex: 'cartonSize',
    title: '箱规',
    width: 120,
    customRender: ({ text }) => text || '-',
  },
  {
    dataIndex: 'cartonProcurementCost',
    title: '箱规采购价',
    width: 100,
    customRender: ({ text }) => (text == null ? '-' : text),
    sorter: (left: ProductMasterListItem, right: ProductMasterListItem) =>
      compareNumber(left.cartonProcurementCost, right.cartonProcurementCost),
  },
  {
    dataIndex: 'baseUnitProcurementCost',
    title: '最小单位采购价',
    width: 120,
    customRender: ({ text }) => (text == null ? '-' : text),
    sorter: (left: ProductMasterListItem, right: ProductMasterListItem) =>
      compareNumber(left.baseUnitProcurementCost, right.baseUnitProcurementCost),
  },
  {
    dataIndex: 'currentRetailPrice',
    title: '零售价',
    width: 100,
    customRender: ({ text }) => (text == null ? '-' : text),
    sorter: (left: ProductMasterListItem, right: ProductMasterListItem) =>
      compareNumber(left.currentRetailPrice, right.currentRetailPrice),
  },
  {
    dataIndex: 'storeCount',
    title: '门店数',
    width: 90,
    sorter: (left: ProductMasterListItem, right: ProductMasterListItem) =>
      compareNumber(left.storeCount, right.storeCount),
  },
  {
    dataIndex: 'primaryStoreNames',
    title: '门店',
    width: 260,
    customRender: ({ text }) => {
      const value = Array.isArray(text) ? text : [];
      return value.length ? value.join('、') : '无';
    },
  },
  { dataIndex: 'supplierCount', title: '供应商数', width: 100 },
  {
    dataIndex: 'primarySupplierNames',
    title: '供应商',
    width: 220,
    customRender: ({ text }) => {
      const value = Array.isArray(text) ? text : [];
      return value.length ? value.join('、') : '无';
    },
  },
];

function formatDate(value?: number | string) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
}

function formatSize(value?: number) {
  if (!value) return '-';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(2)} MB`;
}

async function loadStatus() {
  statusLoading.value = true;
  try {
    const result = await window.ipcRenderer.invoke('get-product-master-status');
    if (!result.success) {
      throw new Error(result.message || '获取商品总表状态失败');
    }
    status.value = result.data;
  } catch (error: any) {
    message.error(error.message || '获取商品总表状态失败');
  } finally {
    statusLoading.value = false;
  }
}

async function loadFilterOptions() {
  try {
    const stores = await getStoreList({ page: 1, pageSize: 500 });
    const result = await window.ipcRenderer.invoke(
      'get-product-master-filter-options',
    );
    if (!result.success) {
      throw new Error(result.message || '获取商品总表筛选项失败');
    }
    storeOptions.value = (stores || []).map((item: any) => ({
      label: item.storeName,
      value: item.storeName,
    }));
    supplierOptions.value = result.data?.supplierOptions || [];
  } catch (error: any) {
    message.error(error.message || '获取商品总表筛选项失败');
  }
}

async function loadRows() {
  loading.value = true;
  try {
    const payload = {
      hasStorePriceVariance: filters.hasStorePriceVariance,
      productName: filters.productName,
      storeNames: [...toRaw(filters.storeNames)],
      supplierNames: [...toRaw(filters.supplierNames)],
      upc: filters.upc,
    };

    const result = await window.ipcRenderer.invoke('list-product-master-records', {
      ...payload,
    });

    if (!result.success) {
      throw new Error(result.message || '获取商品总表失败');
    }

    rows.value = result.data || [];
  } catch (error: any) {
    rows.value = [];
    message.error(error.message || '获取商品总表失败');
  } finally {
    loading.value = false;
  }
}

async function refreshProductMaster() {
  statusLoading.value = true;
  try {
    const result = await window.ipcRenderer.invoke('refresh-product-master');
    if (!result.success) {
      throw new Error(result.message || '刷新商品总表失败');
    }
    await Promise.all([loadStatus(), loadFilterOptions(), loadRows()]);
    message.success(`刷新完成，共 ${result.data.recordCount} 条商品记录`);
  } catch (error: any) {
    message.error(error.message || '刷新商品总表失败');
  } finally {
    statusLoading.value = false;
  }
}

async function handleUpload(file: File) {
  try {
    loading.value = true;
    const fileBuffer = await readFileAsBuffer(file);
    const result = await window.ipcRenderer.invoke('import-product-master', {
      fileBuffer,
      originalName: file.name,
    });

    if (!result.success) {
      throw new Error(result.message || '导入商品总表失败');
    }

    message.success(`导入成功，共 ${result.data.recordCount} 条商品记录`);
    await Promise.all([loadStatus(), loadFilterOptions(), loadRows()]);
  } catch (error: any) {
    message.error(error.message || '导入商品总表失败');
  } finally {
    loading.value = false;
  }

  return false;
}

function resetFilters() {
  filters.hasStorePriceVariance = undefined;
  filters.productName = '';
  filters.upc = '';
  filters.storeNames = [];
  filters.supplierNames = [];
  void loadRows();
}

onMounted(() => {
  void Promise.all([loadStatus(), loadFilterOptions(), loadRows()]);
});
</script>

<template>
  <Page title="商品总表">
    <div class="space-y-4 p-4">
      <Card>
        <div class="flex flex-wrap items-center gap-3">
          <span class="text-sm text-gray-500">
            最后更新: {{ formatDate(status?.fileMtimeMs) }}
          </span>
          <Button size="small" :loading="statusLoading" @click="statusModalOpen = true">
            查看状态详情
          </Button>
          <Button size="small" :loading="statusLoading" @click="refreshProductMaster">
            刷新总表
          </Button>
        </div>
      </Card>

      <Card>
        <Space wrap>
          <Input
            v-model:value="filters.productName"
            allow-clear
            placeholder="请输入商品名称"
            style="width: 220px"
          />
          <Input
            v-model:value="filters.upc"
            allow-clear
            placeholder="请输入商品条码"
            style="width: 180px"
          />
          <Select
            v-model:value="filters.storeNames"
            allow-clear
            mode="multiple"
            :options="storeOptions"
            placeholder="请选择门店"
            show-search
            option-filter-prop="label"
            style="width: 260px"
          />
          <Select
            v-model:value="filters.supplierNames"
            allow-clear
            mode="multiple"
            :options="supplierOptions"
            placeholder="请选择供应商"
            show-search
            option-filter-prop="label"
            style="width: 260px"
          />
          <Select
            v-model:value="filters.hasStorePriceVariance"
            allow-clear
            :options="[
              { label: '是', value: '是' },
              { label: '否', value: '否' },
            ]"
            placeholder="补货差异"
            style="width: 140px"
          />
          <Button type="primary" :loading="loading" @click="loadRows">搜索</Button>
          <Button :disabled="loading" @click="resetFilters">重置</Button>
          <Upload
            :before-upload="handleUpload"
            :show-upload-list="false"
            accept=".json,.xlsx,.xls,application/json"
          >
            <Button type="primary" :loading="loading">导入商品总表</Button>
          </Upload>
        </Space>
      </Card>

      <Card>
        <Table
          row-key="upc"
          :columns="columns"
          :data-source="rows"
          :loading="loading"
          :row-class-name="(record: ProductMasterListItem) => record.hasStorePriceVariance ? 'product-master-row-variance' : ''"
          size="small"
          bordered
          :pagination="{
            pageSize: 20,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total: number) => `共${total}条数据`,
          }"
          :scroll="{ x: 2000 }"
        >
          <template #emptyText>
            <Empty description="暂无数据" />
          </template>
        </Table>
      </Card>

      <Modal
        v-model:open="statusModalOpen"
        title="商品总表状态详情"
        :footer="null"
        width="760px"
      >
        <Descriptions :column="1" bordered size="small">
          <Descriptions.Item label="当前状态">
            <Tag :color="statusTagColor">{{ statusText }}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="最后更新时间">
            {{ formatDate(status?.fileMtimeMs) }}
          </Descriptions.Item>
          <Descriptions.Item label="索引构建时间">
            {{ formatDate(status?.indexBuiltAt) }}
          </Descriptions.Item>
          <Descriptions.Item label="商品记录数">
            {{ status?.recordCount ?? 0 }}
          </Descriptions.Item>
          <Descriptions.Item label="文件大小">
            {{ formatSize(status?.rawSize) }}
          </Descriptions.Item>
          <Descriptions.Item label="Schema 版本">
            {{ status?.schemaVersion ?? '-' }}
          </Descriptions.Item>
          <Descriptions.Item label="运行时文件路径">
            <span class="break-all">{{ status?.rawPath || '-' }}</span>
          </Descriptions.Item>
          <Descriptions.Item label="来源">
            <span class="break-all">{{ status?.rawSourcePath || '-' }}</span>
          </Descriptions.Item>
        </Descriptions>
      </Modal>
    </div>
  </Page>
</template>

<style scoped>
:deep(.product-master-row-variance td) {
  background-color: #fff7d6 !important;
}
</style>
