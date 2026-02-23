<script setup lang="ts">
import { ref, onMounted } from 'vue';

import { Page } from '@vben/common-ui';

import { Card, Empty, Spin, Table } from 'ant-design-vue';

import { requestClient } from '#/api/request';

interface LogItem {
  id?: string;
  time?: string;
  action?: string;
  result?: string;
  detail?: string;
}

const loading = ref(false);
const logs = ref<LogItem[]>([]);
const total = ref(0);

const columns = [
  {
    title: '时间',
    dataIndex: 'time',
    key: 'time',
    width: 180,
  },
  {
    title: '操作',
    dataIndex: 'action',
    key: 'action',
    width: 120,
  },
  {
    title: '结果',
    dataIndex: 'result',
    key: 'result',
    width: 100,
  },
  {
    title: '详情',
    dataIndex: 'detail',
    key: 'detail',
    ellipsis: true,
  },
];

async function fetchLogs() {
  loading.value = true;
  try {
    const res = await requestClient.get<{ list?: LogItem[]; total?: number }>('/eleme/logs');
    logs.value = res.list || [];
    total.value = res.total ?? logs.value.length;
  } catch {
    logs.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

onMounted(fetchLogs);
</script>

<template>
  <Page title="执行日志">
    <div class="p-4">
      <Card>
        <Spin :spinning="loading">
          <Table
            :columns="columns"
            :data-source="logs"
            :pagination="{
              pageSize: 20,
              showSizeChanger: true,
              showTotal: (t: number) => `共 ${t} 条`,
            }"
            row-key="(record: LogItem, index: number) => record.id ?? `log-${index}`"
            size="middle"
          >
            <template #emptyText>
              <Empty description="暂无执行日志" />
            </template>
          </Table>
        </Spin>
      </Card>
    </div>
  </Page>
</template>

<style scoped>
.card {
  transition: all 0.2s;
}
.card:hover {
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}
</style>
