<script lang="ts" setup>
import type {
  WithdrawalExecutionResult,
  WithdrawalLogEntry,
  WithdrawalTask,
  WithdrawalTaskResult,
} from '#/api/withdrawal-task';

import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';

import { Page } from '@vben/common-ui';
import { usePreferences } from '@vben/preferences';

import {
  Alert,
  Button,
  Card,
  Empty,
  message,
  Modal,
  Progress,
  Select,
  Space,
  Table,
  Tag,
} from 'ant-design-vue';

import { getStoreList } from '#/api/store';
import { executeWithdrawalTask, onWithdrawalLog } from '#/api/withdrawal-task';

interface StoreOption {
  label: string;
  storeId: string;
  value: string;
}

interface RunHistoryItem {
  finishedAt: string;
  runId: string;
  startedAt: string;
  status: WithdrawalExecutionResult['status'];
  storeNames: string[];
  summary: string;
}

const { isDark } = usePreferences();

const isElectron = computed(
  () => typeof window !== 'undefined' && window.ipcRenderer !== undefined,
);

const storeOptions = ref<StoreOption[]>([]);
const selectedStores = ref<string[]>([]);
const loadingStores = ref(false);
const running = ref(false);
const logModalOpen = ref(false);
const activeRunId = ref('');
const logEntries = ref<WithdrawalLogEntry[]>([]);
const latestResult = ref<null | WithdrawalExecutionResult>(null);
const runHistory = ref<RunHistoryItem[]>([]);
const terminalRef = ref<HTMLElement>();

let unsubscribeLog: (() => void) | null = null;

const resultColumns = [
  { dataIndex: 'storeName', key: 'storeName', title: '门店' },
  { dataIndex: 'status', key: 'status', title: '状态', width: 110 },
  { dataIndex: 'message', key: 'message', title: '执行信息' },
  { dataIndex: 'executedAt', key: 'executedAt', title: '执行时间', width: 180 },
];

const historyColumns = [
  { dataIndex: 'startedAt', key: 'startedAt', title: '开始时间', width: 180 },
  { dataIndex: 'finishedAt', key: 'finishedAt', title: '结束时间', width: 180 },
  { dataIndex: 'storeNames', key: 'storeNames', title: '门店', width: 260 },
  { dataIndex: 'status', key: 'status', title: '状态', width: 110 },
  { dataIndex: 'summary', key: 'summary', title: '摘要' },
];

const selectedStoreLabel = computed(() =>
  selectedStores.value.length > 0
    ? selectedStores.value
        .map((storeId) => {
          const option = storeOptions.value.find((item) => item.value === storeId);
          return option?.label || storeId;
        })
        .join('、')
    : '未选择门店',
);
const pageThemeClass = computed(() =>
  isDark.value ? 'theme-dark' : 'theme-light',
);
const themeModeLabel = computed(() => (isDark.value ? '夜间模式' : '白天模式'));

const statusText = computed(() => {
  if (running.value) return '执行中';
  if (latestResult.value) return formatStatusText(latestResult.value.status);
  return '待命中';
});

const statusColor = computed(() => {
  if (running.value) return 'processing';
  if (latestResult.value) return getStatusColor(latestResult.value.status);
  return 'default';
});

const successRate = computed(() => {
  const result = latestResult.value;
  if (!result) return 0;
  const total = result.successCount + result.failedCount;
  if (total === 0) return 100;
  return Math.round((result.successCount / total) * 100);
});

const summaryCards = computed(() => {
  const result = latestResult.value;
  let statusAccent: 'danger' | 'plain' | 'warn' = 'plain';
  if (result?.status === 'failed') {
    statusAccent = 'danger';
  } else if (result?.status === 'partial_success') {
    statusAccent = 'warn';
  }
  return [
    {
      accent: statusAccent,
      label: '任务状态',
      value: result ? formatStatusText(result.status) : '未执行',
    },
    {
      accent: 'success',
      label: '成功门店',
      value: String(result?.successCount ?? 0),
    },
    {
      accent: 'danger',
      label: '失败门店',
      value: String(result?.failedCount ?? 0),
    },
    {
      accent: 'warn',
      label: '当前目标',
      value: `${selectedStores.value.length || 0} 家`,
    },
  ];
});

const signalItems = computed(() => [
  {
    label: '运行环境',
    value: isElectron.value ? 'Electron 桌面端' : 'Web 预览模式',
  },
  { label: '已加载门店', value: `${storeOptions.value.length} 家` },
  {
    label: '当前目标',
    value:
      selectedStores.value.length > 0 ? selectedStoreLabel.value : '未选择',
  },
  {
    label: '最近运行',
    value: latestResult.value
      ? formatTimestamp(latestResult.value.finishedAt)
      : '暂无记录',
  },
]);

const formattedLogLines = computed(() =>
  logEntries.value.map((entry) =>
    [
      formatTimestamp(entry.timestamp),
      `[${entry.level}]`,
      `[${entry.module}${entry.store ? `/${entry.store}` : ''}]`,
      entry.message,
    ]
      .filter(Boolean)
      .join(' '),
  ),
);

function formatTimestamp(value?: string) {
  if (!value) return '--';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatStatusText(
  status: string | WithdrawalExecutionResult['status'],
) {
  if (status === 'success') return '成功';
  if (status === 'partial_success') return '部分成功';
  if (status === 'failed') return '失败';
  return status || '--';
}

function getStatusColor(status: string) {
  if (status === 'success') return 'success';
  if (status === 'partial_success') return 'warning';
  if (status === 'failed') return 'error';
  return 'default';
}

function getSummaryClass(accent: string) {
  return `summary-card-${accent}`;
}

function getTerminalClass(index: number) {
  return `terminal-${logEntries.value[index]?.level?.toLowerCase?.() || 'info'}`;
}

async function loadStores() {
  if (loadingStores.value) return;
  loadingStores.value = true;
  try {
    const stores = await getStoreList({ page: 1, pageSize: 500 });
    storeOptions.value = (stores || []).map((item: any) => ({
      label: item.storeName,
      storeId: item.storeId || item.id || item.storeName,
      value: item.storeId || item.id || item.storeName,
    }));

  } catch (error) {
    console.error(error);
    message.error('加载门店列表失败');
  } finally {
    loadingStores.value = false;
  }
}

async function handleStoreDropdownVisibleChange(open: boolean) {
  if (!open) return;
  await loadStores();
}

function appendLog(entry: WithdrawalLogEntry) {
  logEntries.value.push(entry);
  nextTick(() => {
    if (terminalRef.value) {
      terminalRef.value.scrollTop = terminalRef.value.scrollHeight;
    }
  });
}

function buildTaskPayload(): WithdrawalTask {
  const now = new Date().toISOString();
  const clientRequestId = `withdrawal_manual_${Date.now()}`;
  const stores = selectedStores.value.map((selectedStoreId) => {
    const option = storeOptions.value.find((item) => item.value === selectedStoreId);
    return {
      storeId: option?.storeId || selectedStoreId,
      storeName: option?.label || selectedStoreId,
    };
  });

  return {
    clientRequestId,
    createdAt: now,
    id: clientRequestId,
    storeCount: stores.length,
    storeIds: stores.map((item) => item.storeId),
    storeNames: stores.map((item) => item.storeName),
    taskId: clientRequestId,
    taskType: 'WithdrawalManual',
    triggerMode: 'Manual',
    updatedAt: now,
  };
}

async function handleManualRun() {
  if (!isElectron.value) {
    message.error('当前环境不支持 Electron 提现任务');
    return;
  }
  if (selectedStores.value.length === 0) {
    message.warning('请先选择至少一个门店');
    return;
  }

  const payload = buildTaskPayload();
  activeRunId.value = payload.clientRequestId || payload.id;
  latestResult.value = null;
  logEntries.value = [];
  logModalOpen.value = true;
  running.value = true;

  appendLog({
    level: 'INFO',
    message: `手动运行已启动，目标门店：${payload.storeNames.join('、')}`,
    module: 'withdrawal-page',
    timestamp: new Date().toISOString(),
  });

  try {
    const result = await executeWithdrawalTask(payload);
    latestResult.value = result;
    runHistory.value.unshift({
      finishedAt: result.finishedAt,
      runId: result.runId || activeRunId.value,
      startedAt: result.startedAt,
      status: result.status,
      storeNames: [...payload.storeNames],
      summary: result.summary,
    });
    runHistory.value = runHistory.value.slice(0, 8);

    if (result.status === 'success') {
      message.success('提现任务执行成功');
    } else if (result.status === 'partial_success') {
      message.warning('提现任务部分成功，请查看日志');
    } else {
      message.error('提现任务执行失败，请查看日志');
    }
  } catch (error: any) {
    console.error(error);
    appendLog({
      level: 'ERROR',
      message: error?.message || '提现任务执行失败',
      module: 'withdrawal-page',
      timestamp: new Date().toISOString(),
    });
    message.error(error?.message || '提现任务执行失败');
  } finally {
    running.value = false;
  }
}

async function copyLogs() {
  try {
    await navigator.clipboard.writeText(formattedLogLines.value.join('\n'));
    message.success('日志已复制');
  } catch (error) {
    console.error(error);
    message.error('复制日志失败');
  }
}

onMounted(async () => {
  unsubscribeLog = onWithdrawalLog((payload) => {
    if (payload.runId !== activeRunId.value) return;
    appendLog(payload.entry);
  });
  await loadStores();
});

onBeforeUnmount(() => {
  unsubscribeLog?.();
});
</script>

<template>
  <Page title="提现任务控制台">
    <div class="withdrawal-page" :class="pageThemeClass">
      <Alert
        v-if="!isElectron"
        class="environment-alert"
        type="warning"
        show-icon
        message="当前是 Web 环境"
        description="提现任务依赖 Electron 和本地 Playwright，会话执行请在桌面端中运行。"
      />

      <section class="hero-panel">
        <div class="hero-copy">
          <div class="hero-kicker">Withdrawal Console</div>
          <h1 class="hero-title">门店提现控制台</h1>
          <p class="hero-description">
            手动触发、实时看日志、执行前后校验门店上下文，把提现操作集中在一个更清晰的操作台里。
          </p>
          <Space wrap>
            <Tag :color="isElectron ? 'success' : 'warning'">
              {{ isElectron ? 'Electron 桌面端' : 'Web 预览' }}
            </Tag>
            <Tag :color="statusColor">{{ statusText }}</Tag>
            <Tag color="processing">
              已选 {{ selectedStores.length }} 家门店
            </Tag>
            <Tag :color="isDark ? 'blue' : 'gold'">{{ themeModeLabel }}</Tag>
          </Space>
        </div>
        <div class="hero-side">
          <div class="hero-side-title">运行护栏</div>
          <div class="hero-side-list">
            <div class="hero-side-item">
              切店前、切店后、提现前都会校验当前门店。
            </div>
            <div class="hero-side-item">
              只走精确门店候选，不回退到连锁别名。
            </div>
            <div class="hero-side-item">
              正余额账户必须全部成功，整店才算成功。
            </div>
          </div>
        </div>
      </section>

      <section class="top-grid">
        <Card class="surface-card" :bordered="false">
          <template #title>
            <div class="card-heading">
              <div>
                <div class="card-kicker">手动执行</div>
                <div class="card-title">选择门店并启动提现</div>
              </div>
            </div>
          </template>

          <div class="control-stack">
            <div class="field-label">门店选择</div>
            <Select
              v-model:value="selectedStores"
              mode="multiple"
              size="large"
              show-search
              allow-clear
              :field-names="{ label: 'label', value: 'value' }"
              :options="storeOptions"
              :loading="loadingStores"
              @dropdownVisibleChange="handleStoreDropdownVisibleChange"
              option-filter-prop="label"
              placeholder="选择或输入要执行提现的门店"
              :not-found-content="loadingStores ? '加载中...' : '暂无门店数据'"
              style="width: 100%"
            />

            <div class="target-panel">
              <div class="field-label">当前任务目标</div>
              <div class="target-title">{{ selectedStoreLabel }}</div>
            </div>

            <Space wrap>
              <Button
                type="primary"
                size="large"
                :disabled="!isElectron"
                :loading="running"
                @click="handleManualRun"
              >
                {{ running ? '执行中...' : '手动运行' }}
              </Button>
              <Button
                size="large"
                :disabled="logEntries.length === 0"
                @click="logModalOpen = true"
              >
                查看日志终端
              </Button>
              <Button
                size="large"
                :disabled="formattedLogLines.length === 0"
                @click="copyLogs"
              >
                复制日志
              </Button>
            </Space>
          </div>
        </Card>

        <Card class="surface-card status-card" :bordered="false">
          <template #title>
            <div class="card-heading">
              <div>
                <div class="card-kicker">运行态势</div>
                <div class="card-title">最近执行健康度</div>
              </div>
            </div>
          </template>

          <div class="status-orb">
            <div class="status-orb-value">{{ successRate }}%</div>
            <div class="status-orb-label">成功率</div>
          </div>
          <Progress
            :percent="successRate"
            :show-info="false"
            stroke-color="#f59e0b"
          />

          <div class="signal-list">
            <div
              v-for="item in signalItems"
              :key="item.label"
              class="signal-item"
            >
              <span>{{ item.label }}</span>
              <strong>{{ item.value }}</strong>
            </div>
          </div>
        </Card>
      </section>

      <section class="summary-grid">
        <article
          v-for="item in summaryCards"
          :key="item.label"
          class="summary-card"
          :class="getSummaryClass(item.accent)"
        >
          <div class="summary-label">{{ item.label }}</div>
          <div class="summary-value">{{ item.value }}</div>
        </article>
      </section>

      <Card class="surface-card" :bordered="false">
        <template #title>
          <div class="card-heading">
            <div>
              <div class="card-kicker">最新执行结果</div>
              <div class="card-title">逐门店返回结果</div>
            </div>
          </div>
        </template>

        <Table
          v-if="latestResult?.results?.length"
          :columns="resultColumns"
          :data-source="latestResult.results"
          :pagination="false"
          row-key="storeName"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'status'">
              <Tag :color="getStatusColor(record.status)">
                {{ record.status === 'success' ? '成功' : '失败' }}
              </Tag>
            </template>
            <template v-else-if="column.key === 'executedAt'">
              {{ formatTimestamp((record as WithdrawalTaskResult).executedAt) }}
            </template>
          </template>
        </Table>
        <div v-else class="empty-shell">
          <Empty description="还没有执行结果" />
        </div>
      </Card>

      <Card class="surface-card" :bordered="false">
        <template #title>
          <div class="card-heading">
            <div>
              <div class="card-kicker">本页运行历史</div>
              <div class="card-title">最近 8 次手动执行</div>
            </div>
          </div>
        </template>

        <Table
          v-if="runHistory.length > 0"
          :columns="historyColumns"
          :data-source="runHistory"
          :pagination="false"
          row-key="runId"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'status'">
              <Tag :color="getStatusColor(record.status)">
                {{ formatStatusText(record.status) }}
              </Tag>
            </template>
            <template v-else-if="column.key === 'storeNames'">
              {{ record.storeNames.join('、') }}
            </template>
            <template
              v-else-if="
                column.key === 'startedAt' || column.key === 'finishedAt'
              "
            >
              {{ formatTimestamp(record[column.key]) }}
            </template>
          </template>
        </Table>
        <div v-else class="empty-shell">
          <Empty description="本页还没有运行记录" />
        </div>
      </Card>

      <Modal
        v-model:open="logModalOpen"
        :destroy-on-close="false"
        :footer="null"
        :title="running ? '提现运行日志（执行中）' : '提现运行日志'"
        width="1040px"
      >
        <div class="log-shell" :class="pageThemeClass">
          <div class="log-toolbar">
            <Tag :color="statusColor">{{ statusText }}</Tag>
            <span class="log-run-id">{{
              activeRunId || '尚未生成任务 ID'
            }}</span>
            <Button
              size="small"
              :disabled="formattedLogLines.length === 0"
              @click="copyLogs"
            >
              复制日志
            </Button>
          </div>

          <div class="terminal-frame">
            <div class="terminal-header">
              <span class="dot dot-red"></span>
              <span class="dot dot-amber"></span>
              <span class="dot dot-green"></span>
              <span class="terminal-title">withdrawal-terminal</span>
            </div>
            <div ref="terminalRef" class="terminal-panel">
              <div
                v-for="(line, index) in formattedLogLines"
                :key="`${activeRunId}_${index}`"
                class="terminal-line"
                :class="getTerminalClass(index)"
              >
                {{ line }}
              </div>
              <div v-if="formattedLogLines.length === 0" class="terminal-empty">
                运行日志会实时显示在这里。
              </div>
            </div>
          </div>

          <Alert
            v-if="latestResult"
            class="log-summary"
            show-icon
            :type="
              latestResult.status === 'success'
                ? 'success'
                : latestResult.status === 'partial_success'
                  ? 'warning'
                  : 'error'
            "
            :message="latestResult.summary"
            :description="`成功 ${latestResult.successCount} 家，失败 ${latestResult.failedCount} 家`"
          />
        </div>
      </Modal>
    </div>
  </Page>
</template>

<style scoped>
.withdrawal-page,
.log-shell {
  --accent-strong: rgb(194 65 12);
  --accent-text: rgb(124 45 18);
  --body-text: rgb(71 85 105);
  --muted-text: rgb(100 116 139);
  --panel-border: rgb(253 186 116 / 45%);
  --panel-shadow: 0 16px 42px rgb(249 115 22 / 10%);
  --surface-bg: linear-gradient(180deg, rgb(255 255 255), rgb(250 250 249));
  --surface-border: rgb(255 255 255 / 68%);
  --surface-shadow: 0 10px 32px rgb(15 23 42 / 6%);
  --hero-bg:
    radial-gradient(
      circle at top right,
      rgb(251 191 36 / 25%),
      transparent 36%
    ),
    linear-gradient(
      145deg,
      rgb(255 251 235),
      rgb(255 255 255) 58%,
      rgb(255 247 237)
    );
  --hero-side-bg: linear-gradient(
    180deg,
    rgb(255 255 255 / 96%),
    rgb(255 247 237 / 96%)
  );
  --status-card-bg: linear-gradient(180deg, rgb(17 24 39), rgb(31 41 55));
  --status-card-text: rgb(255 255 255);
  --status-card-muted: rgb(203 213 225);
  --target-bg: linear-gradient(145deg, rgb(255 255 255), rgb(248 250 252));
  --target-border: rgb(226 232 240);
  --summary-border: rgb(229 231 235);
  --summary-shadow: 0 10px 28px rgb(15 23 42 / 5%);
  --summary-plain: linear-gradient(160deg, rgb(248 250 252), rgb(255 255 255));
  --summary-success: linear-gradient(
    160deg,
    rgb(240 253 250),
    rgb(255 255 255)
  );
  --summary-danger: linear-gradient(160deg, rgb(255 241 242), rgb(255 255 255));
  --summary-warn: linear-gradient(160deg, rgb(255 251 235), rgb(255 255 255));
  --table-head-bg: rgb(248 250 252);
  --table-head-text: rgb(71 85 105);
  --terminal-shell-shadow: 0 18px 44px rgb(15 23 42 / 16%);
  --terminal-header-bg: rgb(30 41 59);
  --terminal-header-text: rgb(203 213 225);
  --terminal-bg: linear-gradient(180deg, rgb(9 12 17), rgb(18 24 31));
  --terminal-info: rgb(226 232 240);
  --terminal-empty: rgb(148 163 184);
}

.withdrawal-page.theme-dark,
.log-shell.theme-dark {
  --accent-strong: rgb(251 191 36);
  --accent-text: rgb(255 237 213);
  --body-text: rgb(203 213 225);
  --muted-text: rgb(148 163 184);
  --panel-border: rgb(251 191 36 / 18%);
  --panel-shadow: 0 24px 56px rgb(2 6 23 / 46%);
  --surface-bg: linear-gradient(
    180deg,
    rgb(15 23 42 / 94%),
    rgb(15 23 42 / 82%)
  );
  --surface-border: rgb(148 163 184 / 14%);
  --surface-shadow: 0 16px 36px rgb(2 6 23 / 36%);
  --hero-bg:
    radial-gradient(
      circle at top right,
      rgb(251 191 36 / 16%),
      transparent 36%
    ),
    linear-gradient(
      140deg,
      rgb(15 23 42 / 98%),
      rgb(30 41 59 / 94%) 56%,
      rgb(51 65 85 / 92%)
    );
  --hero-side-bg: linear-gradient(
    180deg,
    rgb(15 23 42 / 78%),
    rgb(15 23 42 / 62%)
  );
  --status-card-bg: linear-gradient(180deg, rgb(8 15 32), rgb(19 30 54));
  --status-card-text: rgb(248 250 252);
  --status-card-muted: rgb(191 219 254);
  --target-bg: linear-gradient(
    145deg,
    rgb(15 23 42 / 86%),
    rgb(30 41 59 / 72%)
  );
  --target-border: rgb(96 165 250 / 18%);
  --summary-border: rgb(148 163 184 / 12%);
  --summary-shadow: 0 16px 34px rgb(2 6 23 / 28%);
  --summary-plain: linear-gradient(
    160deg,
    rgb(15 23 42 / 92%),
    rgb(30 41 59 / 88%)
  );
  --summary-success: linear-gradient(
    160deg,
    rgb(6 78 59 / 52%),
    rgb(15 23 42 / 92%)
  );
  --summary-danger: linear-gradient(
    160deg,
    rgb(127 29 29 / 52%),
    rgb(15 23 42 / 92%)
  );
  --summary-warn: linear-gradient(
    160deg,
    rgb(120 53 15 / 62%),
    rgb(15 23 42 / 92%)
  );
  --table-head-bg: rgb(30 41 59 / 82%);
  --table-head-text: rgb(203 213 225);
  --terminal-shell-shadow: 0 22px 52px rgb(2 6 23 / 42%);
  --terminal-header-bg: rgb(15 23 42);
  --terminal-header-text: rgb(226 232 240);
  --terminal-bg: linear-gradient(180deg, rgb(2 6 23), rgb(15 23 42));
  --terminal-info: rgb(226 232 240);
  --terminal-empty: rgb(148 163 184);
}

.withdrawal-page {
  display: flex;
  flex-direction: column;
  gap: 18px;
  color: var(--body-text);
}
.environment-alert {
  border-radius: 22px;
}
.hero-panel,
.top-grid,
.summary-grid {
  display: grid;
  gap: 18px;
}
.hero-panel {
  grid-template-columns: minmax(0, 1.3fr) minmax(300px, 0.7fr);
  padding: 28px;
  border: 1px solid var(--panel-border);
  border-radius: 28px;
  background: var(--hero-bg);
  box-shadow: var(--panel-shadow);
}
.hero-kicker,
.card-kicker {
  color: var(--accent-strong);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}
.hero-title {
  margin: 10px 0 0;
  color: var(--accent-text);
  font-size: 34px;
  font-weight: 800;
  line-height: 1.1;
}
.hero-description {
  margin: 14px 0 18px;
  color: var(--body-text);
  font-size: 15px;
  line-height: 1.8;
}
.hero-side {
  padding: 18px;
  border: 1px solid var(--panel-border);
  border-radius: 22px;
  background: var(--hero-side-bg);
}
.hero-side-title {
  color: var(--accent-strong);
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}
.hero-side-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 16px;
}
.hero-side-item {
  position: relative;
  padding-left: 16px;
  color: var(--body-text);
  font-size: 14px;
  line-height: 1.7;
}
.hero-side-item::before {
  content: '';
  position: absolute;
  top: 10px;
  left: 0;
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: linear-gradient(135deg, rgb(249 115 22), rgb(217 119 6));
}
.top-grid {
  grid-template-columns: minmax(0, 1.25fr) minmax(320px, 0.75fr);
}
.summary-grid {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}
.surface-card {
  border: 1px solid var(--surface-border);
  border-radius: 26px;
  background: var(--surface-bg);
  box-shadow: var(--surface-shadow);
}
.status-card {
  background: var(--status-card-bg);
}
:deep(.surface-card .ant-card-head) {
  min-height: auto;
  padding: 20px 22px 0;
  border-bottom: none;
}
:deep(.surface-card .ant-card-body) {
  padding: 22px;
}
.card-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.card-title {
  margin-top: 6px;
  color: var(--accent-text);
  font-size: 20px;
  font-weight: 700;
}
.status-card .card-title,
.status-card .card-kicker {
  color: var(--status-card-text);
}
.control-stack {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.field-label {
  color: var(--muted-text);
  font-size: 13px;
  font-weight: 700;
}
.target-panel {
  padding: 18px;
  border: 1px solid var(--target-border);
  border-radius: 20px;
  background: var(--target-bg);
}
.target-title {
  margin-top: 8px;
  color: var(--accent-text);
  font-size: 18px;
  font-weight: 700;
  line-height: 1.6;
}
.status-orb {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  width: 120px;
  height: 120px;
  margin: 0 auto 18px;
  border-radius: 999px;
  background: radial-gradient(
    circle at top,
    rgb(253 186 116),
    rgb(249 115 22) 68%,
    rgb(154 52 18)
  );
  color: white;
}
.status-orb-value {
  font-size: 28px;
  font-weight: 800;
  line-height: 1;
}
.status-orb-label {
  margin-top: 8px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.signal-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 18px;
}
.signal-item {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  padding-bottom: 10px;
  border-bottom: 1px solid rgb(255 255 255 / 10%);
  color: var(--status-card-muted);
  font-size: 13px;
}
.signal-item:last-child {
  padding-bottom: 0;
  border-bottom: none;
}
.signal-item strong {
  max-width: 55%;
  color: var(--status-card-text);
  text-align: right;
  word-break: break-word;
}
.summary-card {
  min-height: 142px;
  padding: 18px;
  border: 1px solid var(--summary-border);
  border-radius: 22px;
  box-shadow: var(--summary-shadow);
}
.summary-card-plain {
  background: var(--summary-plain);
}
.summary-card-success {
  background: var(--summary-success);
}
.summary-card-danger {
  background: var(--summary-danger);
}
.summary-card-warn {
  background: var(--summary-warn);
}
.summary-label {
  color: var(--muted-text);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.summary-value {
  margin-top: 18px;
  color: var(--accent-text);
  font-size: 24px;
  font-weight: 800;
  line-height: 1.45;
  word-break: break-word;
}
.empty-shell {
  padding: 24px 0 8px;
}
:deep(.ant-table-wrapper .ant-table) {
  border-radius: 18px;
  overflow: hidden;
}
.withdrawal-page :deep(.ant-table-wrapper .ant-table),
.log-shell :deep(.ant-table-wrapper .ant-table) {
  background: transparent;
}
.withdrawal-page :deep(.ant-table-wrapper .ant-table-thead > tr > th),
.log-shell :deep(.ant-table-wrapper .ant-table-thead > tr > th) {
  background: var(--table-head-bg);
  color: var(--table-head-text);
  font-weight: 700;
}
.withdrawal-page.theme-dark
  :deep(.ant-table-wrapper .ant-table-tbody > tr > td) {
  background: rgb(15 23 42 / 36%);
  color: rgb(226 232 240);
  border-bottom-color: rgb(148 163 184 / 14%);
}
.withdrawal-page.theme-dark :deep(.ant-table-wrapper .ant-empty-description) {
  color: var(--muted-text);
}
.log-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.log-run-id {
  color: var(--muted-text);
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 12px;
}
.terminal-frame {
  overflow: hidden;
  border-radius: 20px;
  box-shadow: var(--terminal-shell-shadow);
}
.terminal-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: var(--terminal-header-bg);
}
.dot {
  width: 10px;
  height: 10px;
  border-radius: 999px;
}
.dot-red {
  background: rgb(248 113 113);
}
.dot-amber {
  background: rgb(251 191 36);
}
.dot-green {
  background: rgb(52 211 153);
}
.terminal-title {
  margin-left: 6px;
  color: var(--terminal-header-text);
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 12px;
}
.terminal-panel {
  height: 460px;
  overflow: auto;
  padding: 18px;
  background: var(--terminal-bg);
}
.terminal-line,
.terminal-empty {
  font-family: Consolas, Monaco, 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.8;
  white-space: pre-wrap;
  word-break: break-word;
}
.terminal-line {
  color: var(--terminal-info);
}
.terminal-info {
  color: var(--terminal-info);
}
.terminal-warn {
  color: rgb(253 224 71);
}
.terminal-error {
  color: rgb(248 113 113);
}
.terminal-debug {
  color: rgb(96 165 250);
}
.terminal-empty {
  color: var(--terminal-empty);
}
.log-summary {
  margin-top: 14px;
}
@media (max-width: 1200px) {
  .hero-panel,
  .top-grid,
  .summary-grid {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 768px) {
  .hero-panel {
    padding: 18px;
  }
  .hero-title {
    font-size: 28px;
  }
  .log-toolbar {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
