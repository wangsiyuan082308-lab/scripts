<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  message,
  Modal,
  Select,
  Space,
  Table,
  Tabs,
  Tag,
} from 'ant-design-vue';

import {
  createProcurementAlertRule,
  deleteProcurementAlertRule,
  getProcurementAlertDeliveries,
  getProcurementAlertEvents,
  getProcurementAlertRules,
  type ProcurementAlertDelivery,
  type ProcurementAlertEvent,
  type ProcurementAlertRule,
} from '#/api/procurement';
import { useProcurementBaseOptions } from '#/composables/useProcurementBaseOptions';

const loading = ref(false);
const rules = ref<ProcurementAlertRule[]>([]);
const events = ref<ProcurementAlertEvent[]>([]);
const deliveries = ref<ProcurementAlertDelivery[]>([]);
const {
  loadBaseOptions,
  suppliers: supplierOptions,
  stores: storeOptions,
  tags: tagOptions,
} = useProcurementBaseOptions();
const modalOpen = ref(false);

const form = reactive({
  alertType: 'execution_exception',
  channels: ['feishu'],
  name: '',
  platform: 'Aoxiang',
  sourceType: 'execution',
  status: 'active',
  storeIds: [] as string[],
  supplierIds: [] as string[],
  tagIds: [] as string[],
  triggerCondition: '{"statuses":["failed","waiting_retry"]}',
});

const ruleColumns = [
  { title: '规则名称', dataIndex: 'name', key: 'name', width: 180 },
  { title: '提醒类型', dataIndex: 'alertType', key: 'alertType', width: 140 },
  { title: '来源', dataIndex: 'sourceType', key: 'sourceType', width: 120 },
  { title: '平台', dataIndex: 'platform', key: 'platform', width: 100 },
  { title: '渠道', dataIndex: 'channels', key: 'channels' },
  { title: '状态', dataIndex: 'status', key: 'status', width: 100 },
];

const eventColumns = [
  { title: '提醒类型', dataIndex: 'alertType', key: 'alertType', width: 140 },
  { title: '来源', dataIndex: 'sourceType', key: 'sourceType', width: 120 },
  { title: '摘要', dataIndex: 'payloadSummary', key: 'payloadSummary' },
  { title: '状态', dataIndex: 'status', key: 'status', width: 100 },
  { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 180 },
];

const deliveryColumns = [
  { title: '渠道', dataIndex: 'channel', key: 'channel', width: 100 },
  { title: '状态', dataIndex: 'status', key: 'status', width: 100 },
  { title: '摘要', dataIndex: 'payloadSummary', key: 'payloadSummary' },
  { title: '失败原因', dataIndex: 'failureReason', key: 'failureReason' },
  { title: '创建时间', dataIndex: 'createdAt', key: 'createdAt', width: 180 },
];

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

async function fetchData() {
  loading.value = true;
  try {
    const [ruleRes, eventRes, deliveryRes] = await Promise.allSettled([
      getProcurementAlertRules(),
      getProcurementAlertEvents(),
      getProcurementAlertDeliveries(),
      loadBaseOptions(),
    ]);
    rules.value =
      ruleRes.status === 'fulfilled' ? ruleRes.value.items || [] : [];
    events.value =
      eventRes.status === 'fulfilled' ? eventRes.value.items || [] : [];
    deliveries.value =
      deliveryRes.status === 'fulfilled' ? deliveryRes.value.items || [] : [];
    if (
      supplierOptions.value.length === 0 &&
      storeOptions.value.length === 0 &&
      tagOptions.value.length === 0
    ) {
      message.warning(
        '\u63d0\u9192\u89c4\u5219\u7684\u95e8\u5e97\u3001\u4f9b\u5e94\u5546\u3001\u6807\u7b7e\u9009\u9879\u6682\u672a\u52a0\u8f7d\u5230\uff0c\u8bf7\u7a0d\u540e\u91cd\u8bd5',
      );
    }
  } finally {
    loading.value = false;
  }
}

async function handleCreateRule() {
  try {
    await createProcurementAlertRule({
      ...form,
      triggerCondition: JSON.parse(form.triggerCondition || '{}'),
    });
    message.success('提醒规则已创建');
    modalOpen.value = false;
    form.name = '';
    await fetchData();
  } catch (error: any) {
    message.error(error?.message || '创建提醒规则失败');
  }
}

async function handleDeleteRule(id: string) {
  await deleteProcurementAlertRule(id);
  message.success('提醒规则已删除');
  await fetchData();
}

onMounted(fetchData);
</script>

<template>
  <Page title="提醒中心">
    <div class="p-4">
      <Alert
        class="mb-4"
        show-icon
        type="info"
        message="第一期提醒中心统一了补货提醒、执行异常提醒和发送记录。当前发送状态以队列/占位回写为主，便于后续接入真实通知通道。"
      />

      <Card :loading="loading">
        <template #title>采购提醒</template>
        <template #extra>
          <Button type="primary" @click="modalOpen = true">新建提醒规则</Button>
        </template>

        <Tabs>
          <Tabs.TabPane key="rules" tab="提醒规则">
            <Table
              :columns="ruleColumns"
              :data-source="rules"
              :pagination="false"
              :row-key="(record: ProcurementAlertRule) => record.id"
              :scroll="{ x: 880 }"
              size="small"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'alertType'">
                  {{ alertTypeLabel(record.alertType) }}
                </template>
                <template v-else-if="column.key === 'channels'">
                  <Space wrap>
                    <Tag v-for="channel in record.channels" :key="channel">
                      {{ channel }}
                    </Tag>
                  </Space>
                </template>
                <template v-else-if="column.key === 'status'">
                  <Tag
                    :color="record.status === 'active' ? 'success' : 'default'"
                  >
                    {{ record.status }}
                  </Tag>
                </template>
                <template v-else-if="column.key === 'name'">
                  <div class="flex items-center justify-between">
                    <span>{{ record.name }}</span>
                    <Button
                      danger
                      size="small"
                      type="link"
                      @click="handleDeleteRule(record.id)"
                    >
                      删除
                    </Button>
                  </div>
                </template>
              </template>
            </Table>
          </Tabs.TabPane>

          <Tabs.TabPane key="events" tab="当前提醒">
            <Table
              :columns="eventColumns"
              :data-source="events"
              :pagination="false"
              :row-key="(record: ProcurementAlertEvent) => record.id"
              :scroll="{ x: 860 }"
              size="small"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'alertType'">
                  {{ alertTypeLabel(record.alertType) }}
                </template>
                <template v-else-if="column.key === 'status'">
                  <Tag
                    :color="record.status === 'pending' ? 'warning' : 'success'"
                  >
                    {{ record.status }}
                  </Tag>
                </template>
              </template>
            </Table>
          </Tabs.TabPane>

          <Tabs.TabPane key="deliveries" tab="发送记录">
            <Table
              :columns="deliveryColumns"
              :data-source="deliveries"
              :pagination="false"
              :row-key="(record: ProcurementAlertDelivery) => record.id"
              :scroll="{ x: 860 }"
              size="small"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'status'">
                  <Tag
                    :color="
                      record.status === 'sent'
                        ? 'success'
                        : record.status === 'failed'
                          ? 'error'
                          : 'processing'
                    "
                  >
                    {{ record.status }}
                  </Tag>
                </template>
              </template>
            </Table>
          </Tabs.TabPane>
        </Tabs>
      </Card>

      <Modal
        v-model:open="modalOpen"
        title="新建提醒规则"
        ok-text="保存"
        @ok="handleCreateRule"
      >
        <Form layout="vertical">
          <Form.Item label="规则名称">
            <Input v-model:value="form.name" placeholder="请输入规则名称" />
          </Form.Item>
          <Form.Item label="提醒类型">
            <Select
              v-model:value="form.alertType"
              :options="[
                { label: '补货提醒', value: 'replenishment' },
                { label: '执行异常', value: 'execution_exception' },
                { label: '任务开始', value: 'task_started' },
                { label: '任务结束', value: 'task_finished' },
              ]"
            />
          </Form.Item>
          <Form.Item label="来源类型">
            <Select
              v-model:value="form.sourceType"
              :options="[
                { label: '补货', value: 'replenishment' },
                { label: '执行', value: 'execution' },
                { label: '任务', value: 'task' },
              ]"
            />
          </Form.Item>
          <Form.Item label="供应商范围">
            <Select
              v-model:value="form.supplierIds"
              mode="multiple"
              :options="supplierOptions"
            />
          </Form.Item>
          <Form.Item label="门店范围">
            <Select
              v-model:value="form.storeIds"
              mode="multiple"
              :options="storeOptions"
            />
          </Form.Item>
          <Form.Item label="标签范围">
            <Select
              v-model:value="form.tagIds"
              mode="multiple"
              :options="
                tagOptions.map((item) => ({
                  label: item.tagName,
                  value: item.id,
                }))
              "
            />
          </Form.Item>
          <Form.Item label="触发条件 JSON">
            <Input.TextArea
              v-model:value="form.triggerCondition"
              :rows="4"
              placeholder='例如 {"statuses":["failed","waiting_retry"]}'
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  </Page>
</template>
