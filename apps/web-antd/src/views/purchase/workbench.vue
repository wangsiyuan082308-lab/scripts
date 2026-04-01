<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Alert,
  Card,
  Col,
  Empty,
  Row,
  Select,
  Space,
  Table,
  Tag,
} from 'ant-design-vue';

import {
  getProcurementWorkbench,
  type ProcurementReport,
  type ProcurementRun,
  type ProcurementWorkbenchResponse,
} from '#/api/procurement';

const loading = ref(false);
const data = ref<ProcurementWorkbenchResponse | null>(null);
const filters = ref({
  storeId: '',
  supplierId: '',
  tagId: '',
});

const filteredRuns = computed(() => {
  const runs = data.value?.latestRuns || [];
  return runs.filter((run) => {
    const snapshot = run.inputSnapshot || {};
    const storeIds = Array.isArray(snapshot.storeIds) ? snapshot.storeIds : [];
    const supplierIds = Array.isArray(snapshot.supplierIds)
      ? snapshot.supplierIds
      : [];
    const tagIds = Array.isArray(snapshot.tagIds) ? snapshot.tagIds : [];

    return (
      (!filters.value.storeId || storeIds.includes(filters.value.storeId)) &&
      (!filters.value.supplierId ||
        supplierIds.includes(filters.value.supplierId)) &&
      (!filters.value.tagId || tagIds.includes(filters.value.tagId))
    );
  });
});

const filteredReports = computed(() => {
  const reports = data.value?.latestReports || [];
  return reports.filter((report) => {
    if (!filters.value.supplierId) return true;
    const supplierId = filters.value.supplierId;
    return (
      report.report?.supplierIds?.includes?.(supplierId) ||
      report.report?.supplierId === supplierId
    );
  });
});

const runColumns = [
  { title: '运行ID', dataIndex: 'id', key: 'id', width: 180 },
  { title: '平台', dataIndex: 'platform', key: 'platform', width: 100 },
  { title: '阶段', dataIndex: 'currentStage', key: 'currentStage', width: 140 },
  { title: '状态', dataIndex: 'status', key: 'status', width: 120 },
  { title: '触发来源', dataIndex: 'triggerSource', key: 'triggerSource', width: 100 },
];

const reportColumns = [
  { title: '供应商', dataIndex: 'supplierName', key: 'supplierName', width: 180 },
  { title: '平台', dataIndex: 'platform', key: 'platform', width: 100 },
  { title: '商品数', dataIndex: 'itemCount', key: 'itemCount', width: 100 },
  { title: '失败数', dataIndex: 'failedCount', key: 'failedCount', width: 100 },
  { title: '金额', dataIndex: 'totalAmount', key: 'totalAmount', width: 120 },
];

function statusColor(status: string) {
  switch (status) {
    case 'succeeded':
      return 'success';
    case 'running':
      return 'processing';
    case 'failed':
      return 'error';
    case 'waiting_retry':
      return 'warning';
    case 'partial_success':
      return 'gold';
    default:
      return 'default';
  }
}

async function fetchWorkbench() {
  loading.value = true;
  try {
    data.value = await getProcurementWorkbench();
  } finally {
    loading.value = false;
  }
}

onMounted(fetchWorkbench);
</script>

<template>
  <Page title="采购作业台">
    <div class="p-4">
      <Alert
        class="mb-4"
        type="warning"
        show-icon
        message="第一期作业台已接入采购域后端数据，执行主线聚焦翱象。共享补货单保护、供应商过滤和重试状态会在任务详情中继续细化。"
      />

      <Row :gutter="[16, 16]" class="mb-4">
        <Col
          v-for="stage in data?.stages || []"
          :key="stage.key"
          :xs="12"
          :sm="12"
          :xl="6"
        >
          <Card>
            <div class="text-sm text-gray-500">{{ stage.label }}</div>
            <div class="mt-2 text-3xl font-semibold">{{ stage.count }}</div>
          </Card>
        </Col>
      </Row>

      <Card class="mb-4" title="筛选器" :loading="loading">
        <Space wrap>
          <Select
            v-model:value="filters.supplierId"
            allow-clear
            placeholder="供应商"
            style="width: 220px"
            :options="data?.suppliers || []"
          />
          <Select
            v-model:value="filters.storeId"
            allow-clear
            placeholder="门店"
            style="width: 220px"
            :options="data?.stores || []"
          />
          <Select
            v-model:value="filters.tagId"
            allow-clear
            placeholder="商品标签"
            style="width: 220px"
            :options="data?.tags || []"
          >
            <template #option="{ label, color }">
              <Tag :color="color">{{ label }}</Tag>
            </template>
          </Select>
        </Space>
      </Card>

      <Row :gutter="[16, 16]">
        <Col :xs="24" :xl="12">
          <Card title="最近执行链路" :loading="loading">
            <Table
              :columns="runColumns"
              :data-source="filteredRuns"
              :pagination="false"
              :row-key="(record: ProcurementRun) => record.id"
              :scroll="{ x: 760 }"
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
            <Empty
              v-if="!loading && filteredRuns.length === 0"
              class="mt-4"
              description="暂无命中的执行链路"
            />
          </Card>
        </Col>

        <Col :xs="24" :xl="12">
          <Card title="最近执行报告" :loading="loading">
            <Table
              :columns="reportColumns"
              :data-source="filteredReports"
              :pagination="false"
              :row-key="(record: ProcurementReport) => record.id"
              :scroll="{ x: 720 }"
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
            <Empty
              v-if="!loading && filteredReports.length === 0"
              class="mt-4"
              description="暂无命中的执行报告"
            />
          </Card>
        </Col>
      </Row>
    </div>
  </Page>
</template>
