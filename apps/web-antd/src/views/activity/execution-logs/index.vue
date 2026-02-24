<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';

import { Page } from '@vben/common-ui';

import { Button, Card, Empty, message, Select, Spin, Switch, Table } from 'ant-design-vue';

import { requestClient } from '#/api/request';

interface LogItem {
  action?: string;
  detail?: string;
  id?: string;
  result?: string;
  time?: string;
}

const loading = ref(false);
const logs = ref<LogItem[]>([]);
const total = ref(0);
const files = ref<string[]>([]);
const selectedFile = ref<string | undefined>(undefined);
const autoRefresh = ref(false);
let timer: ReturnType<typeof setInterval> | null = null;

const columns = [
  {
    title: '时间',
    dataIndex: 'time',
    key: 'time',
    width: 180,
    sorter: (a: LogItem, b: LogItem) =>
      (a.time || '').localeCompare(b.time || ''),
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
    const params: Record<string, any> = {};
    if (selectedFile.value) params.date = selectedFile.value;
    const res = await requestClient.get<any>('/eleme/logs', { params });
    logs.value = res.list || [];
    total.value = res.total ?? logs.value.length;
    if (res.files && !files.value.length) {
      files.value = res.files;
    }
  } catch {
    logs.value = [];
    total.value = 0;
    message.error('获取执行日志失败');
  } finally {
    loading.value = false;
  }
}

function toggleAutoRefresh(checked: boolean) {
  if (checked) {
    timer = setInterval(fetchLogs, 30_000);
  } else if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

onMounted(fetchLogs);
onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <Page title="执行日志">
    <div class="p-4">
      <div class="mb-4 flex items-center gap-2">
        <Select
          v-model:value="selectedFile"
          placeholder="选择日志文件"
          style="width: 200px"
          allow-clear
          @change="fetchLogs"
        >
          <Select.Option v-for="f in files" :key="f" :value="f">
            {{ f }}
          </Select.Option>
        </Select>
        <div class="flex-1" />
        <div class="flex items-center gap-1">
          <span class="text-sm text-gray-500 dark:text-gray-400">自动刷新</span>
          <Switch v-model:checked="autoRefresh" size="small" @change="toggleAutoRefresh" />
        </div>
        <Button @click="fetchLogs">刷新</Button>
      </div>

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
            :row-key="(record: LogItem, index: number) => record.id ?? `log-${index}`"
            :scroll="{ x: 700 }"
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
