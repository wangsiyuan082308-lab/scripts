<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { Page } from '@vben/common-ui';

import { Button, Card, Col, message, Row, Statistic, Tag } from 'ant-design-vue';

import { requestClient } from '#/api/request';

interface StatusInfo {
  apiOnline: boolean;
  lastAnalyzed: string | null;
  optimizationCount: number;
  storeCount: number;
  successRate: number;
  totalExecutions: number;
  totalWithdrawn: number;
}

const router = useRouter();
const loading = ref(false);
const status = ref<StatusInfo>({
  apiOnline: false,
  storeCount: 0,
  totalExecutions: 0,
  lastAnalyzed: null,
  optimizationCount: 0,
  totalWithdrawn: 0,
  successRate: 0,
});

const navCards = [
  {
    title: '门店统计',
    icon: '🏪',
    desc: '各门店提现成功率、累计金额、执行趋势',
    route: '/withdrawal/store-stats',
    gradient: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
  },
  {
    title: '优化策略',
    icon: '🧠',
    desc: '自动优化策略历史记录与效果分析',
    route: '/withdrawal/optimization',
    gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
  },
  {
    title: '运行日志',
    icon: '📄',
    desc: '完整的运行日志、错误追踪与排查',
    route: '/withdrawal/logs',
    gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
  },
];

async function fetchStatus() {
  loading.value = true;
  try {
    const res = await requestClient.get<any>('/withdrawal/status');
    status.value = {
      apiOnline: true,
      storeCount: res.storeCount ?? 0,
      totalExecutions: res.totalExecutions ?? 0,
      lastAnalyzed: res.lastAnalyzed ?? null,
      optimizationCount: res.optimizationCount ?? 0,
      totalWithdrawn: res.totalWithdrawn ?? 0,
      successRate: res.successRate ?? 0,
    };
  } catch {
    status.value.apiOnline = false;
    message.error('获取提现状态失败');
  } finally {
    loading.value = false;
  }
}

function formatTime(iso: string | null) {
  if (!iso) return '暂无';
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return iso;
  }
}

function navigateTo(route: string) {
  router.push(route);
}

onMounted(fetchStatus);
</script>

<template>
  <Page title="饿了么自动提现">
    <div class="p-4">
      <!-- 状态概览 -->
      <Row :gutter="[16, 16]" class="mb-4">
        <Col :xs="12" :sm="6">
          <Card class="stat-card" size="small">
            <Statistic
              title="累计提现"
              :value="status.totalWithdrawn"
              :precision="2"
              prefix="¥"
              :value-style="{ color: '#f5222d', fontWeight: 700 }"
            />
          </Card>
        </Col>
        <Col :xs="12" :sm="6">
          <Card class="stat-card" size="small">
            <Statistic
              title="成功率"
              :value="status.successRate"
              suffix="%"
              :value-style="{ color: status.successRate >= 90 ? '#52c41a' : '#faad14' }"
            />
          </Card>
        </Col>
        <Col :xs="12" :sm="6">
          <Card class="stat-card" size="small">
            <Statistic title="门店数量" :value="status.storeCount" :value-style="{ color: '#1677ff' }" />
          </Card>
        </Col>
        <Col :xs="12" :sm="6">
          <Card class="stat-card" size="small">
            <Statistic title="执行次数" :value="status.totalExecutions" />
          </Card>
        </Col>
      </Row>

      <!-- 最后分析时间 + 刷新 -->
      <div class="mb-4 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <Tag :color="status.apiOnline ? 'success' : 'error'">
            {{ status.apiOnline ? '🟢 在线' : '🔴 离线' }}
          </Tag>
          <span class="text-sm text-gray-400 dark:text-gray-500">
            最后执行：{{ formatTime(status.lastAnalyzed) }}
          </span>
        </div>
        <Button :loading="loading" @click="fetchStatus">刷新</Button>
      </div>

      <!-- 功能导航 -->
      <Row :gutter="[16, 16]">
        <Col v-for="nav in navCards" :key="nav.route" :xs="24" :sm="8">
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
.dark .stat-card:hover {
  box-shadow: 0 2px 12px rgba(255, 255, 255, 0.06);
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
.dark .nav-card:hover {
  box-shadow: 0 8px 24px rgba(255, 255, 255, 0.06);
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
  color: #888;
}
</style>
