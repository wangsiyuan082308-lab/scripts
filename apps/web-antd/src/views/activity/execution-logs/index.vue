<script setup lang="ts">
import type { ExecutionLogItem } from '#/api/execution-logs';

import { computed, onMounted, onUnmounted, ref } from 'vue';

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

import { getExecutionLogs } from '#/api/execution-logs';

const loading = ref(false);
const logs = ref<ExecutionLogItem[]>([]);
const total = ref(0);
const files = ref<string[]>([]);
const selectedFile = ref<string | undefined>(undefined);
const autoRefresh = ref(false);
let timer: null | ReturnType<typeof setInterval> = null;

const fileOptions = computed(() =>
  files.value.map((item) => ({
    label: formatDateLabel(item),
    value: item,
  })),
);

const columns = [
  {
    title: '时间',
    dataIndex: 'time',
    key: 'time',
    width: 180,
    sorter: (a: ExecutionLogItem, b: ExecutionLogItem) =>
      (a.time || '').localeCompare(b.time || ''),
  },
  {
    title: '来源',
    dataIndex: 'source',
    key: 'source',
    width: 100,
  },
  {
    title: '操作',
    dataIndex: 'action',
    key: 'action',
    width: 180,
  },
  {
    title: '级别',
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

function formatDateLabel(value: string) {
  const matched = value.match(/^(\d{4})(\d{2})(\d{2})$/u);
  if (!matched) return value;
  return `${matched[1]}-${matched[2]}-${matched[3]}`;
}

function getResultColor(result: string) {
  const normalized = (result || '').toUpperCase();
  if (normalized === 'ERROR' || normalized === 'FAILED') return 'error';
  if (normalized === 'WARN' || normalized === 'WARNING') return 'warning';
  if (normalized === 'SUCCESS') return 'success';
  return 'processing';
}

function getSourceColor(source: string) {
  return source === '提现' ? 'gold' : 'blue';
}

async function fetchLogs() {
  loading.value = true;
  try {
    const response = await getExecutionLogs({
      date: selectedFile.value,
    });
    logs.value = response.list || [];
    total.value = response.total ?? logs.value.length;
    files.value = response.files || [];

    if (!selectedFile.value && response.selectedDate) {
      selectedFile.value = response.selectedDate;
    }
  } catch (error) {
    console.error(error);
    logs.value = [];
    total.value = 0;
    message.error('获取执行日志失败');
  } finally {
    loading.value = false;
  }
}

function clearTimer() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function toggleAutoRefresh(checked: boolean | number | string) {
  clearTimer();
  if (checked) {
    timer = setInterval(fetchLogs, 30_000);
  }
}

onMounted(fetchLogs);
onUnmounted(clearTimer);
</script>

<template>
  <Page title="执行日志">
    <div class="p-4">
      <div class="mb-4 flex items-center gap-2">
        <Select
          v-model:value="selectedFile"
          :options="fileOptions"
          placeholder="选择日期"
          style="width: 220px"
          allow-clear
          @change="fetchLogs"
        />
        <div class="flex-1"></div>
        <div class="flex items-center gap-1">
          <span class="text-sm text-gray-500 dark:text-gray-400">自动刷新</span>
          <Switch
            v-model:checked="autoRefresh"
            size="small"
            @change="toggleAutoRefresh"
          />
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
              showTotal: (value: number) => `共 ${value} 条`,
            }"
            :row-key="(record: ExecutionLogItem) => record.id"
            :scroll="{ x: 900 }"
            size="middle"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'source'">
                <Tag :color="getSourceColor(record.source)">
                  {{ record.source }}
                </Tag>
              </template>
              <template v-else-if="column.key === 'result'">
                <Tag :color="getResultColor(record.result)">
                  {{ record.result }}
                </Tag>
              </template>
            </template>

            <template #emptyText>
              <Empty description="暂无执行日志" />
            </template>
          </Table>
        </Spin>
      </Card>
    </div>
  </Page>
</template>
