<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Button,
  Card,
  Col,
  Empty,
  Progress,
  Row,
  Spin,
  Statistic,
  Table,
  Tag,
} from 'ant-design-vue';

import { requestClient } from '#/api/request';

interface StoreInfo {
  name: string;
  totalRuns: number;
  successCount: number;
  failCount: number;
  totalAmount: number;
  lastRun: string | null;
  lastStatus: string | null;
  successRate: number;
}

const loading = ref(false);
const stores = ref<StoreInfo[]>([]);

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

function rateStatus(rate: number): 'success' | 'normal' | 'exception' {
  if (rate >= 90) return 'success';
  if (rate >= 60) return 'normal';
  return 'exception';
}

function formatAmount(val: number) {
  if (!val) return '-';
  return `¥${val.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

async function fetchStores() {
  loading.value = true;
  try {
    const res = await requestClient.get<any>('/withdrawal/stores');
    stores.value = res.list || res.stores || [];
  } catch (e) {
    console.error('获取门店统计失败', e);
  } finally {
    loading.value = false;
  }
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

      <Card>
        <template #title>
          <div style="display: flex; align-items: center; justify-content: space-between">
            <span>各门店统计</span>
            <Button size="small" :loading="loading" @click="fetchStores">🔄 刷新</Button>
          </div>
        </template>
        <Spin :spinning="loading">
          <Table
            :columns="columns"
            :data-source="stores"
            :pagination="false"
            :row-key="(record: StoreInfo) => record.name"
            :scroll="{ x: 820 }"
            size="middle"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'name'">
                <span style="font-weight: 500">🏪 {{ record.name || '未知门店' }}</span>
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
                <span style="color: #52c41a">{{ record.successCount }}</span>
                <span style="color: #d9d9d9; margin: 0 4px">/</span>
                <span :style="{ color: record.failCount > 0 ? '#f5222d' : '#d9d9d9' }">{{ record.failCount }}</span>
                <span style="color: #999; font-size: 12px; margin-left: 4px">共{{ record.totalRuns }}次</span>
              </template>

              <template v-else-if="column.key === 'totalAmount'">
                <span :style="{ color: record.totalAmount > 0 ? '#1677ff' : '#999', fontWeight: record.totalAmount > 0 ? '600' : 'normal' }">
                  {{ formatAmount(record.totalAmount) }}
                </span>
              </template>

              <template v-else-if="column.key === 'lastRun'">
                <span style="color: #666; font-size: 13px">{{ record.lastRun || '-' }}</span>
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
.stat-icon {
  font-size: 16px;
  margin-right: 2px;
}
</style>
