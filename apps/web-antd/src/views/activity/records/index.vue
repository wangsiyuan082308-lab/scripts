<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Button,
  Card,
  Col,
  Empty,
  Input,
  message,
  Row,
  Spin,
  Statistic,
  Table,
  Tag,
} from 'ant-design-vue';

import { requestClient } from '#/api/request';
import { exportToExcel } from '#/utils/export-excel';

interface ActivityRecord {
  endTime?: string;
  id?: string;
  merchantCost?: number;
  name: string;
  platformSubsidy?: number;
  signupDate?: string;
  source?: string;
  startTime?: string;
  status?: string;
  suitableStores?: string[];
}

const loading = ref(false);
const records = ref<ActivityRecord[]>([]);
const total = ref(0);
const searchText = ref('');

const filteredRecords = computed(() => {
  if (!searchText.value) return records.value;
  const keyword = searchText.value.toLowerCase();
  return records.value.filter((r) =>
    r.name?.toLowerCase().includes(keyword),
  );
});

const columns = [
  {
    title: '活动名称',
    dataIndex: 'name',
    key: 'name',
    ellipsis: true,
  },
  {
    title: '活动时间',
    key: 'time',
    width: 150,
  },
  {
    title: '平台补贴',
    dataIndex: 'platformSubsidy',
    key: 'subsidy',
    width: 100,
  },
  {
    title: '商家成本',
    dataIndex: 'merchantCost',
    key: 'cost',
    width: 100,
  },
  {
    title: '适用门店',
    dataIndex: 'suitableStores',
    key: 'stores',
    width: 160,
  },
  {
    title: '报名日期',
    dataIndex: 'signupDate',
    key: 'signupDate',
    width: 120,
    sorter: (a: ActivityRecord, b: ActivityRecord) =>
      (a.signupDate || '').localeCompare(b.signupDate || ''),
  },
  {
    title: '状态',
    dataIndex: 'status',
    key: 'status',
    width: 90,
  },
];

async function fetchRecords() {
  loading.value = true;
  try {
    const res = await requestClient.get<any>('/eleme/records');
    records.value = res.list || [];
    total.value = res.total || 0;
  } catch (e) {
    console.error('获取报名记录失败', e);
    message.error('获取报名记录失败');
  } finally {
    loading.value = false;
  }
}

function handleExport() {
  const exportColumns = [
    { title: '活动名称', dataIndex: 'name', width: 30 },
    { title: '开始时间', dataIndex: 'startTime', width: 18 },
    { title: '结束时间', dataIndex: 'endTime', width: 18 },
    { title: '平台补贴', dataIndex: 'platformSubsidy', width: 12 },
    { title: '商家成本', dataIndex: 'merchantCost', width: 12 },
    { title: '报名日期', dataIndex: 'signupDate', width: 14 },
    { title: '状态', dataIndex: 'status', width: 10 },
  ];
  exportToExcel(exportColumns, filteredRecords.value, '活动报名记录');
}

onMounted(fetchRecords);
</script>

<template>
  <Page title="饿了么报名记录">
    <div class="p-4">
      <!-- 统计 -->
      <Row :gutter="[16, 16]" class="mb-4">
        <Col :xs="12" :sm="6">
          <Card class="stat-card" size="small">
            <Statistic title="总报名数" :value="total" />
          </Card>
        </Col>
        <Col :xs="12" :sm="6">
          <Card class="stat-card" size="small">
            <Statistic
              title="已报名"
              :value="records.filter((r) => r.status === 'signed_up').length"
              :value-style="{ color: '#52c41a' }"
            />
          </Card>
        </Col>
        <Col :xs="12" :sm="6">
          <Card class="stat-card" size="small">
            <Statistic
              title="待确认"
              :value="records.filter((r) => r.status !== 'signed_up' && r.status !== 'expired').length"
              :value-style="{ color: '#faad14' }"
            />
          </Card>
        </Col>
        <Col :xs="12" :sm="6">
          <Card class="stat-card" size="small">
            <Statistic
              title="数据来源"
              :value="[...new Set(records.map((r) => r.source).filter(Boolean))].length || 1"
              suffix="个文件"
            />
          </Card>
        </Col>
      </Row>

      <!-- 工具栏 -->
      <div class="mb-4 flex items-center gap-2">
        <Input.Search
          v-model:value="searchText"
          placeholder="搜索活动名称"
          style="width: 240px"
          allow-clear
        />
        <div class="flex-1" />
        <Button @click="fetchRecords">刷新</Button>
        <Button @click="handleExport">导出 Excel</Button>
      </div>

      <!-- 记录表格 -->
      <Card>
        <Spin :spinning="loading">
          <Table
            :columns="columns"
            :data-source="filteredRecords"
            :pagination="{ pageSize: 20, showSizeChanger: true, showTotal: (t: number) => `共 ${t} 条` }"
            :row-key="(_record: ActivityRecord) => _record.id || _record.name"
            :scroll="{ x: 900 }"
            size="middle"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'name'">
                <span>{{ record.name || '-' }}</span>
              </template>

              <template v-else-if="column.key === 'time'">
                <span v-if="record.startTime">
                  {{ record.startTime }} ~ {{ record.endTime }}
                </span>
                <span v-else class="text-gray-400 dark:text-gray-500">-</span>
              </template>

              <template v-else-if="column.key === 'subsidy'">
                <span v-if="record.platformSubsidy" class="text-red-500">
                  ¥{{ record.platformSubsidy }}
                </span>
                <span v-else class="text-gray-400 dark:text-gray-500">-</span>
              </template>

              <template v-else-if="column.key === 'cost'">
                <span v-if="record.merchantCost">¥{{ record.merchantCost }}</span>
                <span v-else class="text-gray-400 dark:text-gray-500">-</span>
              </template>

              <template v-else-if="column.key === 'stores'">
                <span>{{ record.suitableStores?.join('、') || '-' }}</span>
              </template>

              <template v-else-if="column.key === 'signupDate'">
                <span>{{ record.signupDate || '-' }}</span>
              </template>

              <template v-else-if="column.key === 'status'">
                <Tag v-if="record.status === 'signed_up'" color="green">已报名</Tag>
                <Tag v-else-if="record.status === 'expired'" color="default">已过期</Tag>
                <Tag v-else color="blue">{{ record.status || '未知' }}</Tag>
              </template>
            </template>

            <template #emptyText>
              <Empty description="暂无报名记录" />
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
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}
:root.dark .stat-card:hover {
  box-shadow: 0 2px 12px rgba(255, 255, 255, 0.06);
}
</style>
