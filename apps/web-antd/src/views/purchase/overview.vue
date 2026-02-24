<script setup lang="ts">
import type { EChartsOption } from 'echarts';

import { computed, onMounted, ref } from 'vue';

import { Page } from '@vben/common-ui';
import { EchartsUI, useEcharts } from '@vben/plugins/echarts';

import {
  Button,
  Card,
  Col,
  Empty,
  message,
  Radio,
  Row,
  Spin,
  Statistic,
  Table,
  Tag,
} from 'ant-design-vue';

import { requestClient } from '#/api/request';
import { exportToExcel } from '#/utils/export-excel';

interface NoStockSku {
  name?: string;
  reason?: string;
  sku: string;
}

interface PurchaseReport {
  date: string;
  duration: string;
  generatedAt: string;
  itemCount: number;
  noStockSkus: NoStockSku[];
  orderNo: string;
  platform: '翱象' | '牵牛花';
  success: boolean;
  suppliers: string[];
  totalAmount: number;
}

interface Summary {
  latestDate: string;
  successCount: number;
  successRate: number;
  totalCount: number;
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
const chartRef = ref<InstanceType<typeof EchartsUI>>();
const { renderEcharts } = useEcharts(chartRef);

const platformOptions = [
  { label: '全部', value: '' },
  { label: '翱象', value: '翱象' },
  { label: '牵牛花', value: '牵牛花' },
];

const columns = [
  { title: '日期', dataIndex: 'date', key: 'date', width: 120, sorter: (a: PurchaseReport, b: PurchaseReport) => (a.date || '').localeCompare(b.date || '') },
  { title: '平台', dataIndex: 'platform', key: 'platform', width: 90 },
  { title: '供应商', dataIndex: 'suppliers', key: 'suppliers', ellipsis: true },
  { title: '状态', dataIndex: 'success', key: 'success', width: 80 },
  { title: '商品数', dataIndex: 'itemCount', key: 'itemCount', width: 80 },
  { title: '金额(元)', dataIndex: 'totalAmount', key: 'totalAmount', width: 110, sorter: (a: PurchaseReport, b: PurchaseReport) => a.totalAmount - b.totalAmount },
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

function renderChart(data: PurchaseReport[]) {
  if (!data.length) return;
  // 按日期聚合金额
  const dateMap = new Map<string, number>();
  for (const r of data) {
    if (!r.date) continue;
    dateMap.set(r.date, (dateMap.get(r.date) || 0) + r.totalAmount);
  }
  const sorted = [...dateMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));

  const option: EChartsOption = {
    tooltip: { trigger: 'axis' },
    grid: { left: 60, right: 20, top: 10, bottom: 30 },
    xAxis: { type: 'category', data: sorted.map((d) => d[0]) },
    yAxis: { type: 'value', name: '金额(¥)' },
    series: [
      {
        type: 'line',
        data: sorted.map((d) => Math.round(d[1] * 100) / 100),
        smooth: true,
        areaStyle: { opacity: 0.15 },
        itemStyle: { color: '#1677ff' },
      },
    ],
  };
  renderEcharts(option);
}

async function fetchData() {
  loading.value = true;
  try {
    const res = await requestClient.get<any>('/purchase/reports');
    summary.value = res.summary || summary.value;
    reports.value = res.reports || [];
    renderChart(reports.value);
  } catch {
    reports.value = [];
    message.error('获取采购数据失败');
  } finally {
    loading.value = false;
  }
}

function handleExport() {
  const exportColumns = [
    { title: '日期', dataIndex: 'date', width: 14 },
    { title: '平台', dataIndex: 'platform', width: 10 },
    { title: '状态', dataIndex: 'success', width: 8 },
    { title: '商品数', dataIndex: 'itemCount', width: 10 },
    { title: '金额', dataIndex: 'totalAmount', width: 12 },
    { title: '耗时', dataIndex: 'duration', width: 10 },
    { title: '订单号', dataIndex: 'orderNo', width: 28 },
  ];
  const data = filteredReports.value.map((r) => ({
    ...r,
    success: r.success ? '成功' : '失败',
  }));
  exportToExcel(exportColumns, data, '采购记录');
}

onMounted(fetchData);
</script>

<template>
  <Page title="采购管理">
    <div class="p-4">
      <!-- 统计卡片 -->
      <Row :gutter="[16, 16]" class="mb-4">
        <Col :xs="12" :sm="6">
          <Card class="stat-card" size="small">
            <Statistic
              title="总采购次数"
              :value="summary.totalCount"
              :value-style="{ color: '#1677ff' }"
            />
          </Card>
        </Col>
        <Col :xs="12" :sm="6">
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
        <Col :xs="12" :sm="6">
          <Card class="stat-card" size="small">
            <Statistic title="最近采购" :value="summary.latestDate" />
          </Card>
        </Col>
        <Col :xs="12" :sm="6">
          <Card class="stat-card" size="small">
            <Statistic
              title="总金额"
              :value="reports.reduce((s, r) => s + r.totalAmount, 0)"
              :precision="2"
              prefix="¥"
              :value-style="{ color: '#f5222d' }"
            />
          </Card>
        </Col>
      </Row>

      <!-- 采购趋势图 -->
      <Card class="mb-4" v-if="reports.length">
        <EchartsUI ref="chartRef" style="height: 250px" />
      </Card>

      <!-- 工具栏 -->
      <div class="mb-4 flex items-center gap-4">
        <Radio.Group
          v-model:value="platformFilter"
          :options="platformOptions"
          option-type="button"
          button-style="solid"
          size="small"
        />
        <div class="flex-1" />
        <Button size="small" @click="handleExport">导出</Button>
        <Button size="small" :loading="loading" @click="fetchData">刷新</Button>
      </div>

      <!-- 采购记录表格 -->
      <Spin :spinning="loading">
        <Table
          :columns="columns"
          :data-source="filteredReports"
          :pagination="{
            pageSize: 20,
            showSizeChanger: true,
            showTotal: (t: number) => `共 ${t} 条`,
          }"
          :row-key="(record: PurchaseReport) => record.date + record.platform + record.orderNo"
          :scroll="{ x: 900 }"
          size="middle"
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
              <div class="mb-2 text-sm text-gray-500 dark:text-gray-400">
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
            <div v-else class="pl-4 text-sm text-gray-400 dark:text-gray-500">暂无无库存SKU</div>
          </template>
          <template #expandColumnTitle>
            <span title="展开查看无库存SKU">详情</span>
          </template>

          <template #emptyText>
            <Empty description="暂无采购数据" />
          </template>
        </Table>
      </Spin>
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
.dark .stat-card:hover {
  box-shadow: 0 2px 12px rgba(255, 255, 255, 0.06);
}
</style>
