<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { Page } from '@vben/common-ui';

import {
  Button,
  Card,
  Col,
  Descriptions,
  DescriptionsItem,
  Empty,
  message,
  Row,
  Spin,
  Statistic,
  Table,
  Tag,
} from 'ant-design-vue';

import { requestClient } from '#/api/request';

const route = useRoute();
const router = useRouter();
const loading = ref(false);

interface ActivityDetail {
  daysToDeadline: number;
  endTime: string;
  fullText: string;
  id: string;
  level: 'p0' | 'p1' | 'p2' | 'p3';
  merchantCost: number;
  merchantRatio: number;
  name: string;
  platformSubsidy: number;
  roi: number;
  signupStores: StoreSignup[];
  startTime: string;
  status: 'available' | 'expired' | 'signed_up';
  totalDiscount: number;
}

interface StoreSignup {
  city: string;
  signupTime: string;
  status: 'failed' | 'pending' | 'success';
  storeId: string;
  storeName: string;
}

const detail = ref<ActivityDetail | null>(null);

const levelConfig: Record<string, { label: string; tagColor: string }> = {
  p0: { label: '🔴 今日必报', tagColor: 'red' },
  p1: { label: '🟡 值得报名', tagColor: 'orange' },
  p2: { label: '🟢 可选活动', tagColor: 'green' },
  p3: { label: '⚪ 不推荐', tagColor: 'default' },
};

const statusConfig: Record<string, { color: string; label: string }> = {
  available: { label: '可报名', color: 'blue' },
  signed_up: { label: '已报名', color: 'green' },
  expired: { label: '已过期', color: 'default' },
};

const storeColumns = [
  { title: '门店名称', dataIndex: 'storeName', key: 'storeName' },
  { title: '城市', dataIndex: 'city', key: 'city', width: 100 },
  { title: '报名时间', dataIndex: 'signupTime', key: 'signupTime', width: 180 },
  { title: '状态', dataIndex: 'status', key: 'status', width: 100 },
];

const storeStatusConfig: Record<string, { color: string; label: string }> = {
  success: { label: '报名成功', color: 'green' },
  failed: { label: '报名失败', color: 'red' },
  pending: { label: '待确认', color: 'orange' },
};

const signedCount = computed(() =>
  detail.value?.signupStores?.filter((s) => s.status === 'success').length ?? 0,
);

async function fetchDetail() {
  loading.value = true;
  try {
    const id = route.params.id as string;
    const res = await requestClient.get<any>(`/eleme/activities/${id}`);
    detail.value = res;
  } catch (e) {
    console.error('获取活动详情失败', e);
    message.error('获取活动详情失败');
  } finally {
    loading.value = false;
  }
}

function goBack() {
  router.push('/activity/list');
}

onMounted(fetchDetail);
</script>

<template>
  <Page title="活动详情">
    <template #extra>
      <div class="flex gap-2">
        <Button @click="fetchDetail">刷新</Button>
        <Button @click="goBack">返回列表</Button>
      </div>
    </template>

    <Spin :spinning="loading">
      <Empty v-if="!detail && !loading" description="活动不存在" />

      <template v-if="detail">
        <Row :gutter="[16, 16]" class="mb-4">
          <Col :xs="12" :sm="6">
            <Card>
              <Statistic title="平台补贴" prefix="¥" :value="detail.platformSubsidy" :value-style="{ color: '#f5222d' }" />
            </Card>
          </Col>
          <Col :xs="12" :sm="6">
            <Card>
              <Statistic title="商家出资" prefix="¥" :value="detail.merchantCost" />
            </Card>
          </Col>
          <Col :xs="12" :sm="6">
            <Card>
              <Statistic title="商家出资比例" suffix="%" :value="(detail.merchantRatio * 100).toFixed(1)" :value-style="{ color: detail.merchantRatio > 0.3 ? '#f5222d' : '#52c41a' }" />
            </Card>
          </Col>
          <Col :xs="12" :sm="6">
            <Card>
              <Statistic title="ROI" :value="detail.roi >= 999 ? '∞' : detail.roi.toFixed(1)" :value-style="{ color: detail.roi >= 1.5 ? '#52c41a' : '#faad14' }" />
            </Card>
          </Col>
        </Row>

        <!-- 基本信息 -->
        <Card title="活动信息" class="mb-4">
          <Descriptions :column="{ xs: 1, sm: 2, md: 3 }" bordered>
            <DescriptionsItem label="活动名称">{{ detail.name }}</DescriptionsItem>
            <DescriptionsItem label="推荐等级">
              <Tag :color="levelConfig[detail.level]?.tagColor">
                {{ levelConfig[detail.level]?.label }}
              </Tag>
            </DescriptionsItem>
            <DescriptionsItem label="状态">
              <Tag :color="statusConfig[detail.status]?.color">
                {{ statusConfig[detail.status]?.label }}
              </Tag>
            </DescriptionsItem>
            <DescriptionsItem label="活动时间">
              {{ detail.startTime }} ~ {{ detail.endTime }}
            </DescriptionsItem>
            <DescriptionsItem label="截止天数">
              <span :class="detail.daysToDeadline <= 3 ? 'font-bold text-red-500' : 'text-gray-700 dark:text-gray-300'">
                {{ detail.daysToDeadline }}天
              </span>
            </DescriptionsItem>
            <DescriptionsItem label="总优惠">¥{{ detail.totalDiscount }}</DescriptionsItem>
          </Descriptions>
        </Card>

        <!-- 报名门店 -->
        <Card :title="`报名门店（${signedCount}/${detail.signupStores?.length ?? 0}）`">
          <Table
            :columns="storeColumns"
            :data-source="detail.signupStores || []"
            :pagination="false"
            row-key="storeId"
            size="middle"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'status'">
                <Tag :color="storeStatusConfig[record.status]?.color">
                  {{ storeStatusConfig[record.status]?.label }}
                </Tag>
              </template>
            </template>

            <template #emptyText>
              <Empty description="暂无门店报名记录" />
            </template>
          </Table>
        </Card>
      </template>
    </Spin>
  </Page>
</template>
