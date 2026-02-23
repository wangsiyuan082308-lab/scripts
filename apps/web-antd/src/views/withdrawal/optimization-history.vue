<script setup lang="ts">
import { ref, onMounted } from 'vue';

import { Page } from '@vben/common-ui';

import { Card, Col, Empty, Row, Spin, Statistic, Table, Tag } from 'ant-design-vue';

import { requestClient } from '#/api/request';

interface Optimization {
  timestamp: string;
  strategy: {
    optimizations: Array<{
      type?: string;
      action?: string;
      expected_improvement?: string;
    }>;
  };
}

const loading = ref(false);
const optimizations = ref<Optimization[]>([]);

const columns = [
  {
    title: '时间',
    dataIndex: 'timestamp',
    key: 'timestamp',
    width: 200,
  },
  {
    title: '优化数量',
    key: 'count',
    width: 100,
  },
  {
    title: '优化详情',
    key: 'details',
  },
];

function formatTime(iso: string) {
  if (!iso) return '-';
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return iso;
  }
}

async function fetchOptimizations() {
  loading.value = true;
  try {
    const res = await requestClient.get<any>('/withdrawal/optimizations');
    const list = Array.isArray(res) ? res : res.list || res.optimizations || [];
    optimizations.value = list;
  } catch (e) {
    console.error('获取优化策略失败', e);
  } finally {
    loading.value = false;
  }
}

onMounted(fetchOptimizations);
</script>

<template>
  <Page title="优化策略历史">
    <div class="p-4">
      <!-- 统计 -->
      <Row :gutter="[16, 16]" class="mb-4">
        <Col :xs="12" :sm="6">
          <Card class="stat-card" size="small">
            <Statistic title="优化次数" :value="optimizations.length" />
          </Card>
        </Col>
        <Col :xs="12" :sm="6">
          <Card class="stat-card" size="small">
            <Statistic
              title="最近优化"
              :value="optimizations.length ? formatTime(optimizations[0]?.timestamp || '') : '暂无'"
              :value-style="{ fontSize: '16px' }"
            />
          </Card>
        </Col>
      </Row>

      <!-- 优化历史表格 -->
      <Card>
        <Spin :spinning="loading">
          <Table
            :columns="columns"
            :data-source="optimizations"
            :pagination="{
              pageSize: 20,
              showSizeChanger: true,
              showTotal: (t: number) => `共 ${t} 条`,
            }"
            :row-key="(record: Optimization, index?: number) => record.timestamp || String(index)"
            size="middle"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'timestamp'">
                <span class="font-mono text-sm">
                  {{ formatTime(record.timestamp) }}
                </span>
              </template>

              <template v-else-if="column.key === 'count'">
                <Tag color="blue">
                  {{ record.strategy?.optimizations?.length || 0 }} 项
                </Tag>
              </template>

              <template v-else-if="column.key === 'details'">
                <div
                  v-if="record.strategy?.optimizations?.length"
                  class="space-y-1"
                >
                  <div
                    v-for="(opt, idx) in record.strategy.optimizations"
                    :key="idx"
                    class="text-sm"
                  >
                    <Tag
                      v-if="opt.type"
                      :color="
                        opt.type === 'coordinate_cleanup'
                          ? 'purple'
                          : opt.type === 'selector_priority'
                            ? 'orange'
                            : opt.type === 'parallel_processing'
                              ? 'cyan'
                              : 'blue'
                      "
                      size="small"
                    >
                      {{ opt.type }}
                    </Tag>
                    <span class="text-gray-600">
                      {{ opt.action || '' }}
                    </span>
                    <span
                      v-if="opt.expected_improvement"
                      class="ml-2 text-xs text-gray-400"
                    >
                      预期：{{ opt.expected_improvement }}
                    </span>
                  </div>
                </div>
                <span v-else class="text-gray-400">无详情</span>
              </template>
            </template>

            <template #emptyText>
              <Empty description="暂无优化记录" />
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
</style>
