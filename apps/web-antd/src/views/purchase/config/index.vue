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
  createProcurementTag,
  getProcurementConfig,
  getProcurementTags,
  saveProcurementConfig,
  type ProcurementConfigResponse,
  type ProcurementTag,
} from '#/api/procurement';
import { getStoreList } from '#/api/store';
import { getSupplierList } from '#/api/supplier';

const loading = ref(false);
const config = ref<ProcurementConfigResponse | null>(null);
const tags = ref<ProcurementTag[]>([]);
const suppliers = ref<any[]>([]);
const stores = ref<any[]>([]);
const tagModalOpen = ref(false);
const configForm = reactive({
  executionHost: 'electron',
  feishuWebhook: '',
  platforms: ['Aoxiang'] as string[],
  reminderChannels: ['feishu', 'webhook'] as string[],
  webhookUrl: '',
  defaultStatuses: ['pending', 'running', 'waiting_retry'] as string[],
});
const tagForm = reactive({
  color: 'blue',
  description: '',
  tagCode: '',
  tagName: '',
});

const tagColumns = [
  { title: '标签名称', dataIndex: 'tagName', key: 'tagName', width: 140 },
  { title: '编码', dataIndex: 'tagCode', key: 'tagCode', width: 180 },
  { title: '颜色', dataIndex: 'color', key: 'color', width: 100 },
  { title: '说明', dataIndex: 'description', key: 'description' },
  { title: '状态', dataIndex: 'status', key: 'status', width: 100 },
];

const supplierColumns = [
  { title: '供应商', dataIndex: 'supplierName', key: 'supplierName', width: 180 },
  { title: 'ID', dataIndex: 'supplierId', key: 'supplierId', width: 120 },
  { title: '类型', dataIndex: 'type', key: 'type', width: 120 },
  { title: '状态', dataIndex: 'status', key: 'status', width: 100 },
];

const storeColumns = [
  { title: '门店', dataIndex: 'storeName', key: 'storeName', width: 180 },
  { title: 'ID', dataIndex: 'storeId', key: 'storeId', width: 120 },
  { title: '平台', dataIndex: 'platform', key: 'platform', width: 100 },
  { title: '区域', dataIndex: 'region', key: 'region', width: 100 },
];

async function fetchData() {
  loading.value = true;
  try {
    const [configRes, tagRes, supplierRes, storeRes] = await Promise.all([
      getProcurementConfig(),
      getProcurementTags(),
      getSupplierList({}),
      getStoreList({}),
    ]);
    config.value = configRes;
    tags.value = tagRes || [];
    suppliers.value = supplierRes || [];
    stores.value = storeRes || [];
    configForm.executionHost = configRes.executionHost || 'electron';
    configForm.platforms = configRes.platforms || ['Aoxiang'];
    configForm.reminderChannels =
      configRes.reminderDefaults?.channels || ['feishu', 'webhook'];
    configForm.feishuWebhook =
      configRes.reminderDefaults?.channelTargets?.feishu || '';
    configForm.webhookUrl =
      configRes.reminderDefaults?.channelTargets?.webhook || '';
    configForm.defaultStatuses =
      configRes.workbench?.defaultStatuses || ['pending', 'running', 'waiting_retry'];
  } finally {
    loading.value = false;
  }
}

async function handleSaveConfig() {
  await saveProcurementConfig({
    executionHost: configForm.executionHost,
    platforms: configForm.platforms,
        reminderDefaults: {
          channelTargets: {
            feishu: configForm.feishuWebhook,
            webhook: configForm.webhookUrl,
          },
          channels: configForm.reminderChannels,
          enabled: true,
        },
    workbench: {
      defaultStatuses: configForm.defaultStatuses,
    },
  });
  message.success('采购配置已保存');
  await fetchData();
}

async function handleCreateTag() {
  await createProcurementTag({ ...tagForm });
  message.success('商品标签已创建');
  tagForm.color = 'blue';
  tagForm.description = '';
  tagForm.tagCode = '';
  tagForm.tagName = '';
  tagModalOpen.value = false;
  await fetchData();
}

onMounted(fetchData);
</script>

<template>
  <Page title="基础配置">
    <div class="p-4">
      <Alert
        class="mb-4"
        type="success"
        show-icon
        message="采购基础配置已把供应商、门店、商品标签和采购后端配置收拢到同一入口，方便任务创建、作业台筛选和提醒规则复用。"
      />

      <Card class="mb-4" :loading="loading" title="采购域运行配置">
        <Form layout="vertical">
          <Form.Item label="执行宿主">
            <Select
              v-model:value="configForm.executionHost"
              :options="[
                { label: 'Electron 桌面端', value: 'electron' },
                { label: '后端 Worker', value: 'backend-worker' },
              ]"
            />
          </Form.Item>
          <Form.Item label="启用平台">
            <Select
              v-model:value="configForm.platforms"
              mode="multiple"
              :options="[
                { label: '翱象', value: 'Aoxiang' },
                { label: '牵牛花', value: 'Qianniuhua' },
              ]"
            />
          </Form.Item>
          <Form.Item label="默认提醒渠道">
            <Select
              v-model:value="configForm.reminderChannels"
              mode="multiple"
              :options="[
                { label: '飞书', value: 'feishu' },
                { label: 'Webhook', value: 'webhook' },
              ]"
            />
          </Form.Item>
          <Form.Item label="飞书 Webhook">
            <Input
              v-model:value="configForm.feishuWebhook"
              placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
            />
          </Form.Item>
          <Form.Item label="通用 Webhook">
            <Input
              v-model:value="configForm.webhookUrl"
              placeholder="https://example.com/webhook"
            />
          </Form.Item>
          <Form.Item label="作业台默认状态">
            <Select
              v-model:value="configForm.defaultStatuses"
              mode="multiple"
              :options="[
                { label: '待采购', value: 'pending' },
                { label: '采购中', value: 'running' },
                { label: '待重试', value: 'waiting_retry' },
                { label: '已结束', value: 'succeeded' },
                { label: '失败', value: 'failed' },
              ]"
            />
          </Form.Item>
          <Button type="primary" @click="handleSaveConfig">保存配置</Button>
        </Form>
      </Card>

      <Card :loading="loading">
        <template #title>采购对象配置</template>
        <template #extra>
          <Space>
            <Button @click="tagModalOpen = true">新增商品标签</Button>
          </Space>
        </template>

        <Tabs>
          <Tabs.TabPane key="tags" tab="商品标签">
            <Table
              :columns="tagColumns"
              :data-source="tags"
              :pagination="false"
              :row-key="(record: ProcurementTag) => record.id"
              :scroll="{ x: 780 }"
              size="small"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'tagName'">
                  <Tag :color="record.color">{{ record.tagName }}</Tag>
                </template>
                <template v-else-if="column.key === 'status'">
                  <Tag :color="record.status === 'active' ? 'success' : 'default'">
                    {{ record.status }}
                  </Tag>
                </template>
              </template>
            </Table>
          </Tabs.TabPane>

          <Tabs.TabPane key="suppliers" tab="供应商">
            <Table
              :columns="supplierColumns"
              :data-source="suppliers"
              :pagination="false"
              :row-key="(record: any) => record.supplierId"
              :scroll="{ x: 700 }"
              size="small"
            />
          </Tabs.TabPane>

          <Tabs.TabPane key="stores" tab="门店">
            <Table
              :columns="storeColumns"
              :data-source="stores"
              :pagination="false"
              :row-key="(record: any) => record.storeId"
              :scroll="{ x: 700 }"
              size="small"
            />
          </Tabs.TabPane>

          <Tabs.TabPane key="rulesets" tab="采购规则">
            <Space direction="vertical" style="width: 100%">
              <Alert
                type="warning"
                show-icon
                message="默认规则已由采购后端维护，第一期会重点约束供应商过滤、共享补货单保护、分页 100、失败 SKU 重试和提醒联动。"
              />
              <div
                v-for="rule in config?.ruleSets || []"
                :key="rule.id"
                class="rounded border border-gray-200 p-4"
              >
                <div class="mb-2 flex items-center gap-2">
                  <Tag color="blue">{{ rule.platform }}</Tag>
                  <span class="font-medium">{{ rule.name }}</span>
                </div>
                <pre class="mb-0 overflow-auto rounded bg-gray-50 p-3 text-xs">{{
                  JSON.stringify(rule.rulePayload, null, 2)
                }}</pre>
              </div>
            </Space>
          </Tabs.TabPane>
        </Tabs>
      </Card>

      <Modal
        v-model:open="tagModalOpen"
        title="新增商品标签"
        ok-text="保存"
        @ok="handleCreateTag"
      >
        <Form layout="vertical">
          <Form.Item label="标签名称">
            <Input v-model:value="tagForm.tagName" />
          </Form.Item>
          <Form.Item label="标签编码">
            <Input v-model:value="tagForm.tagCode" />
          </Form.Item>
          <Form.Item label="颜色">
            <Select
              v-model:value="tagForm.color"
              :options="[
                { label: '蓝色', value: 'blue' },
                { label: '绿色', value: 'green' },
                { label: '橙色', value: 'orange' },
                { label: '紫色', value: 'purple' },
              ]"
            />
          </Form.Item>
          <Form.Item label="说明">
            <Input.TextArea v-model:value="tagForm.description" :rows="3" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  </Page>
</template>
