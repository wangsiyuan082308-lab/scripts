<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
} from 'ant-design-vue';

import {
  getProcurementOverview,
  type ProcurementAlertEvent,
  type ProcurementOverviewResponse,
  type ProcurementReport,
  type ProcurementRun,
} from '#/api/procurement';

const loading = ref(false);
const overview = ref<ProcurementOverviewResponse | null>(null);

const runColumns = [
  { title: '运行ID', dataIndex: 'id', key: 'id', width: 180 },
  { title: '平台', dataIndex: 'platform', key: 'platform', width: 100 },
  { title: '阶段', dataIndex: 'currentStage', key: 'currentStage', width: 140 },
  { title: '状态', dataIndex: 'status', key: 'status', width: 140 },
  { title: '触发来源', dataIndex: 'triggerSource', key: 'triggerSource', width: 120 },
  { title: '开始时间', dataIndex: 'startedAt', key: 'startedAt', width: 180 },
];

const reportColumns = [
  { title: '时间', dataIndex: 'createdAt', key: 'createdAt', width: 180 },
  { title: '供应商', dataIndex: 'supplierName', key: 'supplierName', width: 180 },
  { title: '平台', dataIndex: 'platform', key: 'platform', width: 100 },
  { title: '商品数', dataIndex: 'itemCount', key: 'itemCount', width: 100 },
  { title: '失败数', dataIndex: 'failedCount', key: 'failedCount', width: 100 },
  { title: '金额', dataIndex: 'totalAmount', key: 'totalAmount', width: 120 },
];

const alertColumns = [
  { title: '提醒类型', dataIndex: 'alertType', key: 'alertType', width: 160 },
  { title: '来源', dataIndex: 'sourceType', key: 'sourceType', width: 120 },
  { title: '摘要', dataIndex: 'payloadSummary', key: 'payloadSummary' },
  { title: '状态', dataIndex: 'status', key: 'status', width: 120 },
  { title: '时间', dataIndex: 'createdAt', key: 'createdAt', width: 180 },
];

const stats = computed(() => {
  const summary = overview.value?.summary;
  return {
    completedTasks: summary?.completedTasks ?? 0,
    failedTasks: summary?.failedTasks ?? 0,
    pendingTasks: summary?.pendingTasks ?? 0,
    runningTasks: summary?.runningTasks ?? 0,
    totalReports: summary?.totalReports ?? 0,
    totalTasks: summary?.totalTasks ?? 0,
    waitingRetryTasks: summary?.waitingRetryTasks ?? 0,
  };
});

function statusColor(status: string) {
  switch (status) {
    case 'succeeded':
      return 'success';
    case 'failed':
      return 'error';
    case 'waiting_retry':
      return 'warning';
    case 'running':
      return 'processing';
    case 'partial_success':
      return 'gold';
    default:
      return 'default';
  }
}

function alertTypeLabel(alertType: string) {
  switch (alertType) {
    case 'replenishment':
      return '补货提醒';
    case 'execution_exception':
      return '执行异常';
    case 'task_started':
      return '任务开始';
    case 'task_finished':
      return '任务结束';
    case 'task_waiting_retry':
      return '待重试';
    default:
      return alertType;
  }
}

async function fetchOverview() {
  loading.value = true;
  try {
    overview.value = await getProcurementOverview();
  } finally {
    loading.value = false;
  }
}

onMounted(fetchOverview);
</script>

<template>
  <Page title="采购总览">
    <div class="p-4">
      <Row :gutter="[16, 16]" class="mb-4">
        <Col :xs="12" :sm="8" :xl="4">
          <Card>
            <Statistic title="今日待采购" :value="stats.pendingTasks" />
          </Card>
        </Col>
        <Col :xs="12" :sm="8" :xl="4">
          <Card>
            <Statistic title="采购中任务" :value="stats.runningTasks" />
          </Card>
        </Col>
        <Col :xs="12" :sm="8" :xl="4">
          <Card>
            <Statistic title="待重试" :value="stats.waitingRetryTasks" />
          </Card>
        </Col>
        <Col :xs="12" :sm="8" :xl="4">
          <Card>
            <Statistic title="已结束任务" :value="stats.completedTasks" />
          </Card>
        </Col>
        <Col :xs="12" :sm="8" :xl="4">
          <Card>
            <Statistic title="失败任务" :value="stats.failedTasks" />
          </Card>
        </Col>
        <Col :xs="12" :sm="8" :xl="4">
          <Card>
            <Statistic title="采购报告数" :value="stats.totalReports" />
          </Card>
        </Col>
      </Row>

      <Alert
        class="mb-4"
        type="info"
        show-icon
        message="当前采购总览已切换为采购后端数据源，聚合了任务、运行、报告和提醒摘要。"
      />

      <Row :gutter="[16, 16]">
        <Col :span="24">
          <Card :loading="loading" title="失败与提醒摘要">
            <div v-if="overview">
              <Space wrap>
                <Tag color="warning">待处理提醒 {{ overview.alertSummary.pending }}</Tag>
                <Tag color="success">已发送提醒 {{ overview.alertSummary.sent }}</Tag>
                <Tag>累计提醒 {{ overview.alertSummary.total }}</Tag>
                <Tag color="processing">采购任务 {{ stats.totalTasks }}</Tag>
              </Space>
            </div>
            <Empty v-else description="暂无总览数据" />
          </Card>
        </Col>

        <Col :xs="24" :xl="14">
          <Card title="最近执行" :loading="loading">
            <div class="mb-3 flex justify-end">
              <Button size="small" @click="fetchOverview">刷新</Button>
            </div>
            <Table
              :columns="runColumns"
              :data-source="overview?.latestRuns || []"
              :pagination="false"
              :row-key="(record: ProcurementRun) => record.id"
              :scroll="{ x: 900 }"
              size="small"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'status'">
                  <Tag :color="statusColor(record.status)">
                    {{ record.status }}
                  </Tag>
                </template>
              </template>
            </Table>
          </Card>
        </Col>

        <Col :xs="24" :xl="10">
          <Card title="最近提醒" :loading="loading">
            <Table
              :columns="alertColumns"
              :data-source="overview?.latestAlerts || []"
              :pagination="false"
              :row-key="(record: ProcurementAlertEvent) => record.id"
              :scroll="{ x: 780 }"
              size="small"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'alertType'">
                  {{ alertTypeLabel(record.alertType) }}
                </template>
                <template v-else-if="column.key === 'status'">
                  <Tag :color="record.status === 'pending' ? 'warning' : 'success'">
                    {{ record.status }}
                  </Tag>
                </template>
              </template>
            </Table>
          </Card>
        </Col>

        <Col :span="24">
          <Card title="最近执行报告" :loading="loading">
            <Table
              :columns="reportColumns"
              :data-source="overview?.latestReports || []"
              :pagination="false"
              :row-key="(record: ProcurementReport) => record.id"
              :scroll="{ x: 900 }"
              size="small"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'platform'">
                  <Tag :color="record.platform === 'Aoxiang' ? 'blue' : 'cyan'">
                    {{ record.platform === 'Aoxiang' ? '翱象' : '牵牛花' }}
                  </Tag>
                </template>
                <template v-else-if="column.key === 'totalAmount'">
                  ¥{{ Number(record.totalAmount || 0).toFixed(2) }}
                </template>
              </template>
            </Table>
          </Card>
        </Col>
      </Row>
    </div>
  </Page>
</template>
