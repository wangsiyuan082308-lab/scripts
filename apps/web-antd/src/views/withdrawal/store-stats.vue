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
  Progress,
  Row,
  Spin,
  Statistic,
  Table,
  Tag,
} from 'ant-design-vue';

import { requestClient } from '#/api/request';
import { exportToExcel } from '#/utils/export-excel';

interface StoreInfo {
  failCount: number;
  lastRun: string | null;
  lastStatus: string | null;
  name: string;
  successCount: number;
  successRate: number;
  totalAmount: number;
  totalRuns: number;
}

const loading = ref(false);
const stores = ref<StoreInfo[]>([]);
const chartRef = ref<InstanceType<typeof EchartsUI>>();
const { renderEcharts } = useEcharts(chartRef);

const avgRate = computed(() => {
  if (!stores.value.length) return 0;
  return Math.round(stores.value.reduce((s, r) => s + r.successRate, 0) / stores.value.length * 10) / 10;
});

const totalAmount = computed(() =>
  stores.value.reduce((s, r) => s + (r.totalAmount || 0), 0),
);

const totalRuns = computed(() =>
  stores.value.reduce((s, r) => s + r.totalRuns, 0),
);

const columns = [
  { title: '门店', key: 'name', width: 180, fixed: 'left' as const },
  { title: '成功率', dataIndex: 'successRate', key: 'successRate', width: 180, sorter: (a: StoreInfo, b: StoreInfo) => a.successRate - b.successRate },
  { title: '执行', key: 'result', width: 140 },
  { title: '累计提现', dataIndex: 'totalAmount', key: 'totalAmount', width: 130, sorter: (a: StoreInfo, b: StoreInfo) => a.totalAmount - b.totalAmount },
  { title: '最后执行', dataIndex: 'lastRun', key: 'lastRun', width: 120 },
  { title: '状态', dataIndex: 'lastStatus', key: 'lastStatus', width: 80 },
];

function rateStatus(rate: number): 'exception' | 'normal' | 'success' {
  if (rate >= 90) return 'success';
  if (rate >= 60) return 'normal';
  return 'exception';
}

function formatAmount(val: number) {
  if (!val) return '-';
  return `¥${val.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function renderChart(data: StoreInfo[]) {
  if (!data.length) return;
  const sorted = [...data].sort((a, b) => b.totalAmount - a.totalAmount);
  const option: EChartsOption = {
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: { data: ['累计提现', '成功率'], bottom: 0 },
    grid: { left: 80, right: 40, top: 10, bottom: 40 },
    xAxis: [
      { type: 'value', name: '金额(¥)', position: 'bottom' },
      { type: 'value', name: '成功率(%)', position: 'top', max: 100 },
    ],
    yAxis: {
      type: 'category',
      data: sorted.map((s) => s.name),
      axisLabel: { width: 70, overflow: 'truncate' },
    },
    series: [
      {
        name: '累计提现',
        type: 'bar',
        xAxisIndex: 0,
        data: sorted.map((s) => Math.round(s.totalAmount * 100) / 100),
        itemStyle: { color: '#1677ff' },
      },
      {
        name: '成功率',
        type: 'bar',
        xAxisIndex: 1,
        data: sorted.map((s) => s.successRate),
        itemStyle: { color: '#52c41a' },
      },
    ],
  };
  renderEcharts(option);
}

async function fetchStores() {
  loading.value = true;
  try {
    const res = await requestClient.get<any>('/withdrawal/stores');
    stores.value = res.list || res.stores || [];
    renderChart(stores.value);
  } catch (e) {
    console.error('获取门店统计失败', e);
    message.error('获取门店统计失败');
  } finally {
    loading.value = false;
  }
}

function handleExport() {
  const exportColumns = [
    { title: '门店', dataIndex: 'name', width: 15 },
    { title: '成功率(%)', dataIndex: 'successRate', width: 12 },
    { title: '成功次数', dataIndex: 'successCount', width: 10 },
    { title: '失败次数', dataIndex: 'failCount', width: 10 },
    { title: '总执行', dataIndex: 'totalRuns', width: 10 },
    { title: '累计提现', dataIndex: 'totalAmount', width: 14 },
    { title: '最后执行', dataIndex: 'lastRun', width: 14 },
    { title: '最后状态', dataIndex: 'lastStatus', width: 10 },
  ];
  exportToExcel(exportColumns, stores.value, '门店提现统计');
}

onMounted(fetchStores);
</script>

<template>
  <Page title="门店提现统计">
    <div class="p-4">
      <Row :gutter="[16, 16]" class="mb-4">
        <Col :xs="12" :sm="6">
          <Card class="stat-card" size="small">
            <Statistic title="门店总数" :value="stores.length">
              <template #prefix><span class="stat-icon">🏪</span></template>
            </Statistic>
          </Card>
        </Col>
        <Col :xs="12" :sm="6">
          <Card class="stat-card" size="small">
            <Statistic title="平均成功率" :value="avgRate" suffix="%" :value-style="{ color: avgRate >= 90 ? '#52c41a' : avgRate >= 60 ? '#faad14' : '#f5222d' }">
              <template #prefix><span class="stat-icon">📊</span></template>
            </Statistic>
          </Card>
        </Col>
        <Col :xs="12" :sm="6">
          <Card class="stat-card" size="small">
            <Statistic title="累计提现" :value="totalAmount" :precision="2" prefix="¥" :value-style="{ color: '#1677ff' }">
              <template #prefix><span class="stat-icon">💰</span></template>
            </Statistic>
          </Card>
        </Col>
        <Col :xs="12" :sm="6">
          <Card class="stat-card" size="small">
            <Statistic title="总执行次数" :value="totalRuns">
              <template #prefix><span class="stat-icon">⚡</span></template>
            </Statistic>
          </Card>
        </Col>
      </Row>

      <!-- 门店对比图 -->
      <Card class="mb-4" v-if="stores.length">
        <EchartsUI ref="chartRef" :style="{ height: `${Math.max(200, stores.length * 50)}px` }" />
      </Card>

      <Card>
        <template #title>
          <div class="flex items-center justify-between">
            <span>各门店统计</span>
            <div class="flex gap-2">
              <Button size="small" @click="handleExport">导出</Button>
              <Button size="small" :loading="loading" @click="fetchStores">刷新</Button>
            </div>
          </div>
        </template>
        <Spin :spinning="loading">
          <Table
            :columns="columns"
            :data-source="stores"
            :pagination="{ pageSize: 10, showSizeChanger: true, showTotal: (t: number) => `共 ${t} 条` }"
            :row-key="(record: StoreInfo) => record.name"
            :scroll="{ x: 820 }"
            size="middle"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'name'">
                <span class="font-medium">🏪 {{ record.name || '未知门店' }}</span>
              </template>

              <template v-else-if="column.key === 'successRate'">
                <Progress
                  :percent="record.successRate"
                  :size="[120, 8]"
                  :status="rateStatus(record.successRate)"
                  :format="(p?: number) => `${p ?? 0}%`"
                />
              </template>

              <template v-else-if="column.key === 'result'">
                <span class="text-green-500">{{ record.successCount }}</span>
                <span class="mx-1 text-gray-300 dark:text-gray-600">/</span>
                <span :class="record.failCount > 0 ? 'text-red-500' : 'text-gray-300 dark:text-gray-600'">{{ record.failCount }}</span>
                <span class="ml-1 text-xs text-gray-400 dark:text-gray-500">共{{ record.totalRuns }}次</span>
              </template>

              <template v-else-if="column.key === 'totalAmount'">
                <span :class="record.totalAmount > 0 ? 'font-semibold text-blue-500' : 'text-gray-400 dark:text-gray-500'">
                  {{ formatAmount(record.totalAmount) }}
                </span>
              </template>

              <template v-else-if="column.key === 'lastRun'">
                <span class="text-sm text-gray-500 dark:text-gray-400">{{ record.lastRun || '-' }}</span>
              </template>

              <template v-else-if="column.key === 'lastStatus'">
                <Tag v-if="record.lastStatus === 'success'" color="success">成功</Tag>
                <Tag v-else-if="record.lastStatus === 'failed'" color="error">失败</Tag>
                <Tag v-else>{{ record.lastStatus || '-' }}</Tag>
              </template>
            </template>

            <template #emptyText>
              <Empty description="暂无门店数据" />
            </template>
          </Table>
        </Spin>
      </Card>
    </div>
  </Page>
</template>

<style scoped>
.stat-card {
  transition: all 0.2s;
}
.stat-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.09);
  transform: translateY(-1px);
}
.dark .stat-card:hover {
  box-shadow: 0 2px 8px rgba(255, 255, 255, 0.06);
}
.stat-icon {
  font-size: 16px;
  margin-right: 2px;
}
</style>
