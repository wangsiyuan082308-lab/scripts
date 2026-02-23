<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';

import { Page } from '@vben/common-ui';

import { Button, Card, Col, Row, Statistic } from 'ant-design-vue';

import { requestClient } from '#/api/request';

interface StatusInfo {
  apiOnline: boolean;
  storeCount: number;
  reportCount: number;
  monthCount: number;
}

const router = useRouter();
const loading = ref(false);
const status = ref<StatusInfo>({
  apiOnline: false,
  storeCount: 0,
  reportCount: 0,
  monthCount: 0,
});

const navCards = [
  {
    title: '报表列表',
    icon: '📊',
    desc: '查看所有已生成的财务报表，按门店和月份筛选',
    route: '/finance/reports',
    gradient: 'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
  },
  {
    title: '门店配置',
    icon: '🏪',
    desc: '各门店固定成本配置，平台ID和费用明细',
    route: '/finance/store-config',
    gradient: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
  },
];

async function fetchStatus() {
  loading.value = true;
  try {
    const res = await requestClient.get<any>('/finance/status');
    status.value = {
      apiOnline: true,
      storeCount: res.storeCount ?? 0,
      reportCount: res.reportCount ?? 0,
      monthCount: res.monthCount ?? 0,
    };
  } catch {
    status.value.apiOnline = false;
  } finally {
    loading.value = false;
  }
}

function navigateTo(route: string) {
  router.push(route);
}

onMounted(fetchStatus);
</script>

<template>
  <Page title="财务报表">
    <div class="p-4">
      <!-- 状态概览 -->
      <Row :gutter="[16, 16]" class="mb-4">
        <Col :xs="12" :sm="6">
          <Card class="stat-card" size="small">
            <Statistic title="门店数量" :value="status.storeCount" :value-style="{ color: '#1677ff' }" />
          </Card>
        </Col>
        <Col :xs="12" :sm="6">
          <Card class="stat-card" size="small">
            <Statistic title="报表总数" :value="status.reportCount" :value-style="{ color: '#52c41a' }" />
          </Card>
        </Col>
        <Col :xs="12" :sm="6">
          <Card class="stat-card" size="small">
            <Statistic title="覆盖月份" :value="status.monthCount" />
          </Card>
        </Col>
        <Col :xs="12" :sm="6">
          <Card class="stat-card" size="small">
            <Statistic :value="status.apiOnline ? '在线' : '离线'" title="API 状态" :value-style="{ color: status.apiOnline ? '#52c41a' : '#ff4d4f' }" />
          </Card>
        </Col>
      </Row>

      <!-- 刷新 -->
      <div class="mb-4 flex items-center justify-end">
        <Button :loading="loading" @click="fetchStatus">🔄 刷新状态</Button>
      </div>

      <!-- 功能导航 -->
      <Row :gutter="[16, 16]">
        <Col v-for="nav in navCards" :key="nav.route" :xs="24" :sm="12">
          <Card
            hoverable
            class="nav-card"
            :body-style="{ padding: '24px' }"
            @click="navigateTo(nav.route)"
          >
            <div class="nav-card-icon" :style="{ background: nav.gradient }">
              {{ nav.icon }}
            </div>
            <div class="nav-card-title">{{ nav.title }}</div>
            <div class="nav-card-desc">{{ nav.desc }}</div>
          </Card>
        </Col>
      </Row>
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

.nav-card {
  cursor: pointer;
  transition: all 0.3s;
  text-align: center;
}
.nav-card:hover {
  transform: translateY(-4px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}

.nav-card-icon {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  margin: 0 auto 12px;
}

.nav-card-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 8px;
  color: #1f1f1f;
}

.nav-card-desc {
  font-size: 13px;
  color: #999;
  line-height: 1.5;
}

.dark .nav-card-title {
  color: #e0e0e0;
}
.dark .nav-card-desc {
  color: #666;
}
</style>
