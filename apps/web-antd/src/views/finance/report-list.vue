<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Button,
  Card,
  Col,
  Empty,
  Row,
  Select,
  Spin,
  Table,
  Tag,
} from 'ant-design-vue';

import { requestClient } from '#/api/request';

interface Report {
  id: string;
  storeName: string;
  month: string;
  fileName: string;
  createdAt: string;
  revenue?: number;
  cost?: number;
  profit?: number;
}

const loading = ref(false);
const reports = ref<Report[]>([]);
const storeFilter = ref<string | undefined>(undefined);
const monthFilter = ref<string | undefined>(undefined);

const storeOptions = computed(() => {
  const names = [...new Set(reports.value.map((r) => r.storeName))].sort();
  return [
    { value: undefined, label: '全部门店' },
    ...names.map((n) => ({ value: n, label: n })),
  ];
});

const monthOptions = computed(() => {
  const months = [...new Set(reports.value.map((r) => r.month))].sort().reverse();
  return [
    { value: undefined, label: '全部月份' },
    ...months.map((m) => ({ value: m, label: m })),
  ];
});

const filteredReports = computed(() => {
  return reports.value.filter((r) => {
    if (storeFilter.value && r.storeName !== storeFilter.value) return false;
    if (monthFilter.value && r.month !== monthFilter.value) return false;
    return true;
  });
});

const columns = [
  {
    title: '门店',
    dataIndex: 'storeName',
    key: 'storeName',
    width: 140,
  },
  {
    title: '月份',
    dataIndex: 'month',
    key: 'month',
    width: 100,
    sorter: (a: Report, b: Report) => a.month.localeCompare(b.month),
  },
  {
    title: '营收',
    dataIndex: 'revenue',
    key: 'revenue',
    width: 120,
    sorter: (a: Report, b: Report) => (a.revenue ?? 0) - (b.revenue ?? 0),
  },
  {
    title: '成本',
    dataIndex: 'cost',
    key: 'cost',
    width: 120,
    sorter: (a: Report, b: Report) => (a.cost ?? 0) - (b.cost ?? 0),
  },
  {
    title: '利润',
    dataIndex: 'profit',
    key: 'profit',
    width: 120,
    sorter: (a: Report, b: Report) => (a.profit ?? 0) - (b.profit ?? 0),
  },
  {
    title: '生成时间',
    dataIndex: 'createdAt',
    key: 'createdAt',
    width: 170,
  },
  {
    title: '操作',
    key: 'action',
    width: 100,
  },
];

function formatMoney(val: number | undefined) {
  if (val === undefined || val === null) return '-';
  return `¥${val.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function profitColor(val: number | undefined) {
  if (val === undefined || val === null) return '#999';
  if (val > 0) return '#52c41a';
  if (val < 0) return '#f5222d';
  return '#999';
}

function formatTime(iso: string | null | undefined) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return iso;
  }
}

function handleDownload(record: Report) {
  const url = `/api/finance/reports/download?file=${encodeURIComponent(record.fileName)}`;
  window.open(url, '_blank');
}

async function fetchReports() {
  loading.value = true;
  try {
    const params: Record<string, string> = {};
    if (storeFilter.value) params.store = storeFilter.value;
    if (monthFilter.value) params.month = monthFilter.value;
    const res = await requestClient.get<any>('/finance/reports', { params });
    const list = Array.isArray(res) ? res : res.list || res.reports || [];
    reports.value = list;
  } catch (e) {
    console.error('获取报表列表失败', e);
  } finally {
    loading.value = false;
  }
}

onMounted(fetchReports);
</script>

<template>
  <Page title="财务报表列表">
    <div class="p-4">
      <!-- 筛选栏 -->
      <Card class="mb-4">
        <Row :gutter="[16, 16]" align="middle">
          <Col :xs="24" :sm="8" :md="6">
            <span class="mr-2">门店：</span>
            <Select
              v-model:value="storeFilter"
              style="width: 160px"
              :options="storeOptions"
              placeholder="全部门店"
              allow-clear
            />
          </Col>
          <Col :xs="24" :sm="8" :md="6">
            <span class="mr-2">月份：</span>
            <Select
              v-model:value="monthFilter"
              style="width: 160px"
              :options="monthOptions"
              placeholder="全部月份"
              allow-clear
            />
          </Col>
          <Col :xs="24" :sm="8" :md="6">
            <Button type="primary" :loading="loading" @click="fetchReports">
              刷新数据
            </Button>
          </Col>
        </Row>
      </Card>

      <!-- 报表表格 -->
      <Card>
        <Spin :spinning="loading">
          <Table
            :columns="columns"
            :data-source="filteredReports"
            :pagination="{
              pageSize: 20,
              showSizeChanger: true,
              showTotal: (t: number) => `共 ${t} 份报表`,
            }"
            :row-key="
              (record: Report, index?: number) =>
                record.id || record.fileName || String(index)
            "
            size="middle"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'storeName'">
                <span>🏪 {{ record.storeName }}</span>
              </template>

              <template v-else-if="column.key === 'month'">
                <Tag color="blue">{{ record.month }}</Tag>
              </template>

              <template v-else-if="column.key === 'revenue'">
                <span style="color: #1677ff; font-weight: bold">
                  {{ formatMoney(record.revenue) }}
                </span>
              </template>

              <template v-else-if="column.key === 'cost'">
                <span style="color: #fa8c16">
                  {{ formatMoney(record.cost) }}
                </span>
              </template>

              <template v-else-if="column.key === 'profit'">
                <span
                  :style="{
                    color: profitColor(record.profit),
                    fontWeight: 'bold',
                  }"
                >
                  {{ formatMoney(record.profit) }}
                </span>
              </template>

              <template v-else-if="column.key === 'createdAt'">
                <span class="text-sm text-gray-500">
                  {{ formatTime(record.createdAt) }}
                </span>
              </template>

              <template v-else-if="column.key === 'action'">
                <Button
                  type="link"
                  size="small"
                  @click="handleDownload(record as Report)"
                >
                  📥 下载
                </Button>
              </template>
            </template>

            <template #emptyText>
              <Empty description="暂无报表数据" />
            </template>
          </Table>
        </Spin>
      </Card>
    </div>
  </Page>
</template>
