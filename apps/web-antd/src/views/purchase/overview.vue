<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Card,
  Col,
  Radio,
  Row,
  Statistic,
  Table,
  Tag,
} from 'ant-design-vue';

import { requestClient } from '#/api/request';

interface NoStockSku {
  sku: string;
  name?: string;
  reason?: string;
}

interface PurchaseReport {
  date: string;
  platform: '翱象' | '牵牛花';
  suppliers: string[];
  success: boolean;
  itemCount: number;
  duration: string;
  orderNo: string;
  totalAmount: number;
  noStockSkus: NoStockSku[];
  generatedAt: string;
}

interface Summary {
  totalCount: number;
  successCount: number;
  successRate: number;
  latestDate: string;
}

const loading = ref(false);
const platformFilter = ref('');
const summary = ref<Summary>({
  totalCount: 0,
  successCount: 0,
  successRate: 0,
  latestDate: '-',
});
const reports = ref<PurchaseReport[]>([]);

const platformOptions = [
  { label: '全部', value: '' },
  { label: '翱象', value: '翱象' },
  { label: '牵牛花', value: '牵牛花' },
];

const columns = [
  { title: '日期', dataIndex: 'date', key: 'date', width: 120 },
  { title: '平台', dataIndex: 'platform', key: 'platform', width: 90 },
  {
    title: '供应商',
    dataIndex: 'suppliers',
    key: 'suppliers',
    ellipsis: true,
  },
  { title: '状态', dataIndex: 'success', key: 'success', width: 80 },
  { title: '商品数', dataIndex: 'itemCount', key: 'itemCount', width: 80 },
  {
    title: '金额(元)',
    dataIndex: 'totalAmount',
    key: 'totalAmount',
    width: 110,
  },
  { title: '耗时', dataIndex: 'duration', key: 'duration', width: 80 },
  { title: '1688订单号', dataIndex: 'orderNo', key: 'orderNo', width: 220 },
];

const noStockColumns = [
  { title: 'SKU编码', dataIndex: 'sku', key: 'sku', width: 200 },
  { title: '商品名称', dataIndex: 'name', key: 'name', ellipsis: true },
  { title: '原因', dataIndex: 'reason', key: 'reason', width: 200 },
];

const filteredReports = computed(() => {
  if (!platformFilter.value) return reports.value;
  return reports.value.filter((r) => r.platform === platformFilter.value);
});

async function fetchData() {
  loading.value = true;
  try {
    const res = await requestClient.get<any>('/purchase/reports');
    summary.value = res.summary || summary.value;
    reports.value = res.reports || [];
  } catch {
    reports.value = [];
  } finally {
    loading.value = false;
  }
}

onMounted(fetchData);
</script>

<template>
  <Page title="采购管理">
    <div class="p-4">
      <!-- 统计卡片 -->
      <Row :gutter="[16, 16]" class="mb-4">
        <Col :xs="24" :sm="8">
          <Card class="stat-card" size="small">
            <Statistic
              title="总采购次数"
              :value="summary.totalCount"
              :value-style="{ color: '#1677ff' }"
            />
          </Card>
        </Col>
        <Col :xs="24" :sm="8">
          <Card class="stat-card" size="small">
            <Statistic
              title="成功率"
              :value="summary.successRate"
              suffix="%"
              :value-style="{
                color: summary.successRate >= 80 ? '#52c41a' : '#faad14',
              }"
            />
          </Card>
        </Col>
        <Col :xs="24" :sm="8">
          <Card class="stat-card" size="small">
            <Statistic title="最近采购" :value="summary.latestDate" />
          </Card>
        </Col>
      </Row>

      <!-- 筛选 -->
      <div class="mb-4 flex items-center justify-between">
        <Radio.Group
          v-model:value="platformFilter"
          button-style="solid"
          size="small"
        >
          <Radio.Button
            v-for="opt in platformOptions"
            :key="opt.value"
            :value="opt.value"
          >
            {{ opt.label }}
          </Radio.Button>
        </Radio.Group>
        <a-button :loading="loading" size="small" @click="fetchData">
          刷新
        </a-button>
      </div>

      <!-- 采购记录表格 -->
      <Table
        :columns="columns"
        :data-source="filteredReports"
        :loading="loading"
        :pagination="{ pageSize: 20, showSizeChanger: true }"
        :row-key="(r: any) => r.date + r.platform + r.orderNo"
        size="small"
        :scroll="{ x: 900 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'platform'">
            <Tag :color="record.platform === '翱象' ? 'blue' : 'green'">
              {{ record.platform }}
            </Tag>
          </template>
          <template v-else-if="column.key === 'suppliers'">
            {{ record.suppliers?.join('、') || '-' }}
          </template>
          <template v-else-if="column.key === 'success'">
            <Tag :color="record.success ? 'success' : 'error'">
              {{ record.success ? '成功' : '失败' }}
            </Tag>
          </template>
          <template v-else-if="column.key === 'totalAmount'">
            {{ record.totalAmount > 0 ? `¥${record.totalAmount.toFixed(2)}` : '-' }}
          </template>
        </template>

        <!-- 可展开行：无库存SKU -->
        <template #expandedRowRender="{ record }">
          <div v-if="record.noStockSkus?.length" class="pl-4">
            <div class="mb-2 text-sm text-gray-500">
              无库存SKU（{{ record.noStockSkus.length }}个）
            </div>
            <Table
              :columns="noStockColumns"
              :data-source="record.noStockSkus"
              :pagination="false"
              :row-key="(r: any) => r.sku"
              size="small"
            />
          </div>
          <div v-else class="pl-4 text-sm text-gray-400">暂无无库存SKU</div>
        </template>
        <template #expandColumnTitle>
          <span title="展开查看无库存SKU">详情</span>
        </template>
      </Table>
    </div>
  </Page>
</template>

<style scoped>
.stat-card {
  transition: all 0.2s;
}
.stat-card:hover {
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}
</style>
