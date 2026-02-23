<script setup lang="ts">
import { ref, computed, onMounted } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Button,
  Card,
  Col,
  Descriptions,
  DescriptionsItem,
  Drawer,
  Empty,
  Input,
  Row,
  Select,
  Spin,
  Statistic,
  Table,
  Tag,
  Tooltip,
} from 'ant-design-vue';

import { requestClient } from '#/api/request';

interface Activity {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  signupDeadline: string;
  daysToDeadline: number;
  platformSubsidy: number;
  merchantCost: number;
  suitableStores: string[];
  status: 'available' | 'signed_up' | 'expired';
  level: 'p0' | 'p1' | 'p2' | 'p3';
  platform: 'eleme' | 'meituan' | 'unknown';
  fullText: string;
  url: string;
}

interface Summary {
  total: number;
  available: number;
  signedUp: number;
  expired: number;
  p0: number;
  p1: number;
  p2: number;
  p3: number;
}

const loading = ref(false);
const activities = ref<Activity[]>([]);
const summary = ref<Summary>({
  total: 0, available: 0, signedUp: 0, expired: 0,
  p0: 0, p1: 0, p2: 0, p3: 0,
});
const statusFilter = ref('all');
const searchText = ref('');
const drawerVisible = ref(false);
const currentActivity = ref<Activity | null>(null);

const levelConfig: Record<string, { label: string; tagColor: string }> = {
  p0: { label: '🔴 今日必报', tagColor: 'red' },
  p1: { label: '🟡 值得报名', tagColor: 'orange' },
  p2: { label: '🟢 可选活动', tagColor: 'green' },
  p3: { label: '⚪ 不推荐', tagColor: 'default' },
};

const statusConfig: Record<string, { label: string; color: string }> = {
  available: { label: '可报名', color: 'blue' },
  signed_up: { label: '已报名', color: 'green' },
  expired: { label: '已过期', color: 'default' },
};

const platformConfig: Record<string, { label: string; color: string }> = {
  eleme: { label: '饿了么', color: 'blue' },
  meituan: { label: '美团', color: 'orange' },
  unknown: { label: '未知', color: 'default' },
};

const columns = [
  {
    title: '推荐',
    dataIndex: 'level',
    key: 'level',
    width: 110,
  },
  {
    title: '平台',
    dataIndex: 'platform',
    key: 'platform',
    width: 80,
  },
  {
    title: '活动名称',
    dataIndex: 'name',
    key: 'name',
    ellipsis: true,
  },
  {
    title: '活动时间',
    key: 'time',
    width: 160,
  },
  {
    title: '报名截止',
    dataIndex: 'signupDeadline',
    key: 'deadline',
    width: 100,
    sorter: (a: Activity, b: Activity) => (a.daysToDeadline || 9999) - (b.daysToDeadline || 9999),
  },
  {
    title: '平台补贴',
    dataIndex: 'platformSubsidy',
    key: 'subsidy',
    width: 100,
    sorter: (a: Activity, b: Activity) => (a.platformSubsidy || 0) - (b.platformSubsidy || 0),
  },
  {
    title: '商家出资',
    dataIndex: 'merchantCost',
    key: 'cost',
    width: 100,
  },
  {
    title: '适用门店',
    dataIndex: 'suitableStores',
    key: 'stores',
    width: 200,
  },
  {
    title: '状态',
    dataIndex: 'status',
    key: 'status',
    width: 90,
  },
  {
    title: '操作',
    key: 'action',
    width: 80,
    fixed: 'right' as const,
  },
];

const filteredActivities = computed(() => {
  let list = activities.value;
  if (statusFilter.value !== 'all') {
    list = list.filter((a) => a.status === statusFilter.value);
  }
  if (searchText.value.trim()) {
    const kw = searchText.value.trim().toLowerCase();
    list = list.filter((a) => a.name?.toLowerCase().includes(kw));
  }
  return list;
});

function showDetail(record: Activity) {
  currentActivity.value = record;
  drawerVisible.value = true;
}

function openUrl(url: string) {
  window.open(url, '_blank');
}

function formatTime(activity: Activity) {
  if (activity.startTime && activity.endTime) {
    return `${activity.startTime} ~ ${activity.endTime}`;
  }
  // 匹配 YYYY/MM/DD ~ YYYY/MM/DD 或 MM/DD ~ MM/DD
  const match = activity.fullText?.match(/活动时间[：:]\s*(\d{2,4}\/\d{2}(?:\/\d{2})?)\s*~\s*(\d{2,4}\/\d{2}(?:\/\d{2})?)/);
  if (match) return `${match[1]} ~ ${match[2]}`;
  return '-';
}

async function fetchActivities() {
  loading.value = true;
  try {
    const res = await requestClient.get<any>('/eleme/activities');
    activities.value = res.list || [];
    summary.value = res.summary || summary.value;
  } catch (e) {
    console.error('获取活动列表失败', e);
  } finally {
    loading.value = false;
  }
}

onMounted(fetchActivities);
</script>

<template>
  <Page title="活动中心">
    <div class="p-4">
      <!-- 统计卡片 -->
      <Row :gutter="[16, 16]" class="mb-4">
        <Col :xs="12" :sm="6">
          <Card class="stat-card" size="small">
            <Statistic title="活动总数" :value="summary.total" />
          </Card>
        </Col>
        <Col :xs="12" :sm="6">
          <Card class="stat-card" size="small">
            <Statistic title="可报名" :value="summary.available" :value-style="{ color: '#1890ff' }" />
          </Card>
        </Col>
        <Col :xs="12" :sm="6">
          <Card class="stat-card" size="small">
            <Statistic title="已报名" :value="summary.signedUp" :value-style="{ color: '#52c41a' }" />
          </Card>
        </Col>
        <Col :xs="12" :sm="6">
          <Card class="stat-card" size="small">
            <Statistic title="今日必报" :value="summary.p0" :value-style="{ color: '#f5222d' }" />
          </Card>
        </Col>
      </Row>

      <!-- 活动列表 -->
      <Card>
        <template #title>
          <div style="display: flex; align-items: center; gap: 12px; flex-wrap: wrap">
            <span>活动列表</span>
            <Input.Search
              v-model:value="searchText"
              placeholder="搜索活动名称"
              style="width: 220px"
              size="small"
              allow-clear
            />
            <Select v-model:value="statusFilter" style="width: 120px" size="small">
              <Select.Option value="all">全部状态</Select.Option>
              <Select.Option value="available">可报名</Select.Option>
              <Select.Option value="signed_up">已报名</Select.Option>
              <Select.Option value="expired">已过期</Select.Option>
            </Select>
          </div>
        </template>
        <template #extra>
          <Button :loading="loading" @click="fetchActivities">🔄 刷新</Button>
        </template>

        <Spin :spinning="loading">
          <Table
            :columns="columns"
            :data-source="filteredActivities"
            :pagination="{ pageSize: 20, showSizeChanger: true, showTotal: (t: number) => `共 ${t} 条` }"
            :scroll="{ x: 1200, y: 700 }"
            row-key="id"
            size="middle"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'level'">
                <Tag :color="levelConfig[record.level]?.tagColor">
                  {{ levelConfig[record.level]?.label }}
                </Tag>
              </template>

              <template v-else-if="column.key === 'platform'">
                <Tag :color="platformConfig[record.platform]?.color">
                  {{ platformConfig[record.platform]?.label }}
                </Tag>
              </template>

              <template v-else-if="column.key === 'name'">
                <Tooltip :title="record.name">
                  <a style="cursor: pointer" @click="showDetail(record as Activity)">{{ record.name }}</a>
                </Tooltip>
              </template>

              <template v-else-if="column.key === 'time'">
                <span>{{ formatTime(record as Activity) }}</span>
              </template>

              <template v-else-if="column.key === 'deadline'">
                <span v-if="record.signupDeadline" :style="{ color: record.daysToDeadline <= 3 ? '#f5222d' : record.daysToDeadline <= 7 ? '#faad14' : '' }">
                  {{ record.signupDeadline }}
                </span>
                <span v-else style="color: #999">长期</span>
              </template>

              <template v-else-if="column.key === 'subsidy'">
                <span v-if="record.platformSubsidy > 0" style="color: #f5222d; font-weight: bold">
                  ¥{{ record.platformSubsidy }}
                </span>
                <span v-else style="color: #999">-</span>
              </template>

              <template v-else-if="column.key === 'cost'">
                <span v-if="record.merchantCost > 0">¥{{ record.merchantCost }}</span>
                <span v-else style="color: #999">-</span>
              </template>

              <template v-else-if="column.key === 'stores'">
                <template v-if="record.suitableStores?.length > 3">
                  <Tooltip :title="record.suitableStores.join('、')">
                    <span>{{ record.suitableStores.slice(0, 3).join('、') }}…共{{ record.suitableStores.length }}店</span>
                  </Tooltip>
                </template>
                <span v-else-if="record.suitableStores?.length">{{ record.suitableStores.join('、') }}</span>
                <span v-else style="color: #999">-</span>
              </template>

              <template v-else-if="column.key === 'status'">
                <Tag :color="statusConfig[record.status]?.color">
                  {{ statusConfig[record.status]?.label }}
                </Tag>
              </template>

              <template v-else-if="column.key === 'action'">
                <Button type="link" size="small" @click="showDetail(record as Activity)">
                  详情
                </Button>
              </template>
            </template>

            <template #emptyText>
              <Empty description="暂无活动数据" />
            </template>
          </Table>
        </Spin>
      </Card>

      <!-- 活动详情 Drawer -->
      <Drawer
        v-model:open="drawerVisible"
        title="活动详情"
        :width="520"
        placement="right"
      >
        <template v-if="currentActivity">
          <Descriptions :column="1" bordered size="small">
            <DescriptionsItem label="活动名称">
              {{ currentActivity.name }}
            </DescriptionsItem>
            <DescriptionsItem label="平台">
              <Tag :color="platformConfig[currentActivity.platform]?.color">
                {{ platformConfig[currentActivity.platform]?.label }}
              </Tag>
            </DescriptionsItem>
            <DescriptionsItem label="推荐等级">
              <Tag :color="levelConfig[currentActivity.level]?.tagColor">
                {{ levelConfig[currentActivity.level]?.label }}
              </Tag>
            </DescriptionsItem>
            <DescriptionsItem label="活动时间">
              {{ formatTime(currentActivity) }}
            </DescriptionsItem>
            <DescriptionsItem label="报名截止">
              <span v-if="currentActivity.signupDeadline" :style="{ color: currentActivity.daysToDeadline <= 3 ? '#f5222d' : '' }">
                {{ currentActivity.signupDeadline }}
              </span>
              <span v-else style="color: #999">长期有效</span>
            </DescriptionsItem>
            <DescriptionsItem label="平台补贴">
              <span v-if="currentActivity.platformSubsidy > 0" style="color: #f5222d; font-weight: bold">
                ¥{{ currentActivity.platformSubsidy }}
              </span>
              <span v-else>无</span>
            </DescriptionsItem>
            <DescriptionsItem label="商家出资">
              <span v-if="currentActivity.merchantCost > 0">¥{{ currentActivity.merchantCost }}</span>
              <span v-else>无</span>
            </DescriptionsItem>
            <DescriptionsItem label="适用门店">
              {{ currentActivity.suitableStores?.join('、') || '-' }}
            </DescriptionsItem>
            <DescriptionsItem label="当前状态">
              <Tag :color="statusConfig[currentActivity.status]?.color">
                {{ statusConfig[currentActivity.status]?.label }}
              </Tag>
            </DescriptionsItem>
          </Descriptions>

          <Card title="活动原文" size="small" class="mt-4">
            <div style="white-space: pre-wrap; font-size: 13px; color: #666; line-height: 1.8">
              {{ currentActivity.fullText || '暂无详情' }}
            </div>
          </Card>

          <div class="mt-4" style="text-align: right">
            <Button
              v-if="currentActivity.url"
              type="primary"
              @click="openUrl(currentActivity.url)"
            >
              打开活动页面
            </Button>
          </div>
        </template>
      </Drawer>
    </div>
  </Page>
</template>

<style scoped>
:deep(.stat-card) {
  transition: all 0.2s;
}
:deep(.stat-card):hover {
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}
</style>
