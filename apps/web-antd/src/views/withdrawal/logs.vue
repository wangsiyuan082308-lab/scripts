<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Button,
  Card,
  Empty,
  message,
  Select,
  Spin,
  Switch,
  Table,
  Tag,
} from 'ant-design-vue';

import { requestClient } from '#/api/request';

interface LogEntry {
  data?: any;
  level: string;
  message: string;
  store?: string;
  timestamp: string;
}

const loading = ref(false);
const logs = ref<LogEntry[]>([]);
const logFiles = ref<string[]>([]);
const storeOptions = ref<string[]>([]);
const selectedFile = ref('');
const levelFilter = ref('');
const storeFilter = ref('');
const autoRefresh = ref(false);
let timer: ReturnType<typeof setInterval> | null = null;

const levelColors: Record<string, string> = {
  info: 'blue',
  warn: 'orange',
  error: 'red',
  debug: 'default',
};

const columns = [
  { title: '时间', dataIndex: 'timestamp', key: 'timestamp', width: 200 },
  { title: '级别', dataIndex: 'level', key: 'level', width: 80 },
  { title: '消息', dataIndex: 'message', key: 'message', ellipsis: true },
  { title: '详情', dataIndex: 'data', key: 'data', width: 300, ellipsis: true },
];

async function fetchLogs() {
  loading.value = true;
  try {
    const params: Record<string, string> = {};
    if (selectedFile.value) params.file = selectedFile.value;
    if (levelFilter.value) params.level = levelFilter.value;

    const res = await requestClient.get<any>('/withdrawal/logs', { params });
    let list = res.list || [];
    if (storeFilter.value) {
      list = list.filter((e: any) => e.store?.includes(storeFilter.value));
    }
    logs.value = list;
    logFiles.value = res.files || [];
    storeOptions.value = res.stores || [];

    if (!selectedFile.value && res.file) {
      selectedFile.value = res.file;
    }
  } catch (e) {
    console.error('获取日志失败', e);
    message.error('获取日志失败');
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

function formatTimestamp(ts: string) {
  if (!ts) return '-';
  try {
    return new Date(ts).toLocaleString('zh-CN', { hour12: false });
  } catch {
    return ts;
  }
}

function formatData(data: any) {
  if (!data) return '';
  if (typeof data === 'string') return data;
  try {
    return JSON.stringify(data, null, 0).substring(0, 200);
  } catch {
    return String(data);
  }
}

onMounted(fetchLogs);
onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <Page title="自动提现运行日志">
    <div class="p-4">
      <!-- 过滤栏 -->
      <Card class="mb-4">
        <div class="flex flex-wrap items-center gap-4">
          <div class="flex items-center gap-2">
            <span class="text-gray-600 dark:text-gray-400">日志文件：</span>
            <Select
              v-model:value="selectedFile"
              style="width: 260px"
              placeholder="选择日志文件"
              allow-clear
              :options="logFiles.map((f: string) => ({ value: f, label: f }))"
              @change="fetchLogs"
            />
          </div>
          <div class="flex items-center gap-2">
            <span class="text-gray-600 dark:text-gray-400">级别：</span>
            <Select
              v-model:value="levelFilter"
              style="width: 120px"
              placeholder="全部"
              allow-clear
              :options="[
                { value: 'info', label: 'Info' },
                { value: 'warn', label: 'Warn' },
                { value: 'error', label: 'Error' },
                { value: 'debug', label: 'Debug' },
              ]"
              @change="fetchLogs"
            />
          </div>
          <div class="flex items-center gap-2">
            <span class="text-gray-600 dark:text-gray-400">门店：</span>
            <Select
              v-model:value="storeFilter"
              style="width: 200px"
              placeholder="全部门店"
              allow-clear
              :options="storeOptions.map((s: string) => ({ value: s, label: s }))"
              @change="fetchLogs"
            />
          </div>
          <div class="flex-1" />
          <span class="text-sm text-gray-400 dark:text-gray-500">共 {{ logs.length }} 条</span>
          <div class="flex items-center gap-1">
            <span class="text-sm text-gray-500 dark:text-gray-400">自动刷新</span>
            <Switch v-model:checked="autoRefresh" size="small" @change="toggleAutoRefresh" />
          </div>
          <Button size="small" :loading="loading" @click="fetchLogs">刷新</Button>
        </div>
      </Card>

      <!-- 日志表格 -->
      <Card>
        <Spin :spinning="loading">
          <Table
            :columns="columns"
            :data-source="logs"
            :pagination="{
              pageSize: 50,
              showSizeChanger: true,
              showTotal: (t: number) => `显示 ${t} 条`,
            }"
            :row-key="
              (_record: LogEntry, index?: number) =>
                _record.timestamp + String(index)
            "
            :scroll="{ x: 800 }"
            size="small"
            :row-class-name="
              (record: LogEntry) =>
                record.level === 'error'
                  ? 'log-error-row'
                  : record.level === 'warn'
                    ? 'log-warn-row'
                    : ''
            "
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'timestamp'">
                <span class="font-mono text-xs">
                  {{ formatTimestamp(record.timestamp) }}
                </span>
              </template>

              <template v-else-if="column.key === 'level'">
                <Tag
                  :color="levelColors[record.level] || 'default'"
                  class="uppercase"
                >
                  {{ record.level }}
                </Tag>
              </template>

              <template v-else-if="column.key === 'message'">
                <span>{{ record.message }}</span>
              </template>

              <template v-else-if="column.key === 'data'">
                <span class="font-mono text-xs text-gray-500 dark:text-gray-400">
                  {{ formatData(record.data) }}
                </span>
              </template>
            </template>

            <template #emptyText>
              <Empty description="暂无日志记录" />
            </template>
          </Table>
        </Spin>
      </Card>
    </div>
  </Page>
</template>

<style scoped>
:deep(.log-error-row) {
  background-color: #fff2f0 !important;
}
:deep(.log-warn-row) {
  background-color: #fffbe6 !important;
}

.dark :deep(.log-error-row) {
  background-color: rgba(255, 77, 79, 0.1) !important;
}
.dark :deep(.log-warn-row) {
  background-color: rgba(250, 173, 20, 0.1) !important;
}
</style>
