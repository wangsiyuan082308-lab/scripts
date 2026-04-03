<script setup lang="tsx">
import { computed, ref } from 'vue';

import dayjs from 'dayjs';
import { Button, Descriptions, Drawer, Table, Tag, Tabs } from 'ant-design-vue';

import {
  getAoxiangReplenishmentSummary,
  getProcurementAlertDeliveries,
  getProcurementAlertEvents,
  type AoxiangReplenishmentItem,
  type ProcurementAlertDelivery,
  type ProcurementAlertEvent,
} from '#/api/procurement';
import { getStoreList, type Store } from '#/api/store';
import { getSupplierList, type Supplier } from '#/api/supplier';
import SimpleTemplate from '#/components/base/SimpleTemplate/index.vue';

type SearchModel = {
  fetchStatus: string;
  page: number;
  pageSize: number;
  sendStatus: string;
  storeId: string;
  supplierId: string;
};

type SupplierSoldOutSummary = {
  items: AoxiangReplenishmentItem[];
  soldItems: number;
  supplierSoldRate: number;
  supplierCode: string;
  supplierName: string;
  totalItems: number;
};

type StoreSoldOutLogRow = {
  createdAt: string;
  fetchStatus: 'failed' | 'success';
  latestSummary: string;
  productMasterTotalItems?: number;
  sendStatus: 'failed' | 'partial' | 'pending' | 'sent';
  soldItems: number;
  storeSoldRate: number;
  storeCode: string;
  storeName: string;
  supplierCount: number;
  supplierSummaries: SupplierSoldOutSummary[];
  totalItems: number;
};

const filters = ref<SearchModel>({
  fetchStatus: '',
  page: 1,
  pageSize: 10,
  sendStatus: '',
  storeId: '',
  supplierId: '',
});

const rawRows = ref<StoreSoldOutLogRow[]>([]);
const rawEvents = ref<ProcurementAlertEvent[]>([]);
const rawDeliveries = ref<ProcurementAlertDelivery[]>([]);
const storeOptions = ref<Array<{ label: string; value: string }>>([]);
const supplierOptions = ref<Array<{ label: string; value: string }>>([]);

const detailOpen = ref(false);
const currentDetailRow = ref<StoreSoldOutLogRow | null>(null);

const searchFormItems = computed(() => [
  {
    label: '门店',
    child: {
      options: storeOptions.value,
      placeholder: '请选择门店',
      renderType: 'select',
      valueKey: 'storeId',
    },
  },
  {
    label: '供应商',
    child: {
      options: supplierOptions.value,
      placeholder: '按供应商筛选门店',
      renderType: 'select',
      valueKey: 'supplierId',
    },
  },
  {
    label: '抓取状态',
    child: {
      options: [
        { label: '抓取成功', value: 'success' },
        { label: '抓取失败', value: 'failed' },
      ],
      placeholder: '请选择抓取状态',
      renderType: 'select',
      valueKey: 'fetchStatus',
    },
  },
  {
    label: '发送状态',
    child: {
      options: [
        { label: '发送成功', value: 'sent' },
        { label: '待发送', value: 'pending' },
        { label: '发送失败', value: 'failed' },
        { label: '部分成功', value: 'partial' },
      ],
      placeholder: '请选择发送状态',
      renderType: 'select',
      valueKey: 'sendStatus',
    },
  },
  {
    renderType: 'suffixButton',
    options: [
      { label: '搜索', renderType: 'search', type: 'primary' },
      { label: '重置', renderType: 'reset' },
    ],
  },
]);

function formatDatetime(value?: string) {
  return value ? dayjs(value).format('YYYY-MM-DD HH:mm:ss') : '-';
}

function formatPercent(value?: number) {
  const rounded = Number((value || 0).toFixed(2));
  return Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(2);
}

function renderFetchStatus(status: StoreSoldOutLogRow['fetchStatus']) {
  return status === 'success'
    ? <Tag color="success">抓取成功</Tag>
    : <Tag color="error">抓取失败</Tag>;
}

function renderSendStatus(status: StoreSoldOutLogRow['sendStatus']) {
  switch (status) {
    case 'sent':
      return <Tag color="success">发送成功</Tag>;
    case 'failed':
      return <Tag color="error">发送失败</Tag>;
    case 'partial':
      return <Tag color="warning">部分成功</Tag>;
    default:
      return <Tag color="processing">待发送</Tag>;
  }
}

function renderSupplierPreview(suppliers: SupplierSoldOutSummary[]) {
  if (suppliers.length === 0) return '-';
  const names = suppliers.map((item) => item.supplierName);
  return names.length <= 2
    ? names.join('、')
    : `${names.slice(0, 2).join('、')} 等${names.length}个`;
}

function resolveSendStatus(deliveries: ProcurementAlertDelivery[]): StoreSoldOutLogRow['sendStatus'] {
  if (deliveries.length === 0) return 'pending';
  const statuses = deliveries.map((item) => item.status);
  if (statuses.every((status) => status === 'sent')) return 'sent';
  if (statuses.every((status) => status === 'failed')) return 'failed';
  if (statuses.every((status) => status === 'pending')) return 'pending';
  return 'partial';
}

function getRelatedEvents(row: StoreSoldOutLogRow) {
  return rawEvents.value.filter((event) => {
    if (event.sourceType !== 'replenishment') return false;
    if (event.storeIds.length > 0 && !event.storeIds.includes(row.storeCode)) return false;
    if (
      row.supplierSummaries.length > 0 &&
      event.supplierIds.length > 0 &&
      !row.supplierSummaries.some((item) => event.supplierIds.includes(item.supplierCode))
    ) {
      return false;
    }
    return true;
  });
}

function getRelatedDeliveries(row: StoreSoldOutLogRow) {
  const eventIds = new Set(getRelatedEvents(row).map((event) => event.id));
  return rawDeliveries.value.filter((delivery) => eventIds.has(delivery.eventId));
}

const columns = [
  {
    dataIndex: 'createdAt',
    title: '时间',
    width: 180,
    render: (_h: any, ctx: { text?: string }) => formatDatetime(ctx?.text),
  },
  {
    dataIndex: 'storeName',
    title: '门店',
    minWidth: 180,
  },
  {
    dataIndex: 'supplierSummaries',
    title: '涉及供应商',
    minWidth: 240,
    render: (_h: any, ctx: { row?: StoreSoldOutLogRow; record?: StoreSoldOutLogRow }) => {
      const row = ctx?.row || ctx?.record;
      return renderSupplierPreview(row?.supplierSummaries || []);
    },
  },
  { dataIndex: 'supplierCount', title: '供应商数', width: 100 },
  {
    dataIndex: 'soldItems',
    title: '售罄商品数',
    width: 100,
    render: (_h: any, ctx: { text?: number }) => (
      <Tag color={(ctx?.text || 0) > 0 ? 'error' : 'default'}>{ctx?.text || 0}</Tag>
    ),
  },
  {
    dataIndex: 'storeSoldRate',
    title: '门店售罄率',
    width: 120,
    render: (_h: any, ctx: { text?: number }) => `${formatPercent(ctx?.text)}%`,
  },
  { dataIndex: 'totalItems', title: '门店商品数', width: 110 },
  {
    dataIndex: 'fetchStatus',
    title: '抓取状态',
    width: 120,
    render: (_h: any, ctx: { text?: StoreSoldOutLogRow['fetchStatus'] }) =>
      renderFetchStatus((ctx?.text || 'failed') as StoreSoldOutLogRow['fetchStatus']),
  },
  {
    dataIndex: 'sendStatus',
    title: '发送状态',
    width: 120,
    render: (_h: any, ctx: { text?: StoreSoldOutLogRow['sendStatus'] }) =>
      renderSendStatus((ctx?.text || 'pending') as StoreSoldOutLogRow['sendStatus']),
  },
  { dataIndex: 'latestSummary', title: '摘要', minWidth: 320 },
  {
    title: '操作',
    width: 120,
    render: (_h: any, ctx: { row?: StoreSoldOutLogRow; record?: StoreSoldOutLogRow }) => {
      const row = ctx?.row || ctx?.record;
      if (!row) return null;
      return (
        <Button type="link" onClick={() => openDetail(row)}>
          查看详情
        </Button>
      );
    },
  },
];

const detailSupplierColumns = [
  { dataIndex: 'supplierName', title: '供应商', minWidth: 180 },
  {
    dataIndex: 'soldItems',
    title: '售罄商品数',
    width: 100,
    render: (_h: any, ctx: { text?: number }) => (
      <Tag color={(ctx?.text || 0) > 0 ? 'error' : 'default'}>{ctx?.text || 0}</Tag>
    ),
  },
  {
    dataIndex: 'supplierSoldRate',
    title: '供应商售罄率',
    width: 120,
    render: (_h: any, ctx: { text?: number }) => `${formatPercent(ctx?.text)}%`,
  },
  { dataIndex: 'totalItems', title: '供应商商品数', width: 120 },
];

const detailItemColumns = [
  { dataIndex: 'supplierName', title: '供应商', width: 180 },
  { dataIndex: 'stageDesc', title: '阶段', width: 140 },
  { dataIndex: 'skuName', title: '商品', minWidth: 260 },
  { dataIndex: 'barcode', title: '条码', width: 160 },
  { dataIndex: 'suggestedQty', title: '建议补货', width: 110 },
  { dataIndex: 'actualQty', title: '实际补货', width: 110 },
];

const detailDeliveryColumns = [
  {
    dataIndex: 'channel',
    title: '渠道',
    width: 120,
    render: (_h: any, ctx: { text?: string }) => (
      <Tag color={ctx?.text === 'feishu' ? 'blue' : 'purple'}>{ctx?.text || '-'}</Tag>
    ),
  },
  {
    dataIndex: 'status',
    title: '状态',
    width: 120,
    render: (_h: any, ctx: { text?: string }) =>
      renderSendStatus((ctx?.text || 'pending') as StoreSoldOutLogRow['sendStatus']),
  },
  { dataIndex: 'payloadSummary', title: '摘要', minWidth: 320 },
  { dataIndex: 'failureReason', title: '失败原因', width: 240 },
  {
    dataIndex: 'createdAt',
    title: '时间',
    width: 180,
    render: (_h: any, ctx: { text?: string }) => formatDatetime(ctx?.text),
  },
];

const detailDeliveries = computed(() => {
  if (!currentDetailRow.value) return [];
  return getRelatedDeliveries(currentDetailRow.value).sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
});

async function ensureBaseOptionsLoaded() {
  if (storeOptions.value.length > 0 && supplierOptions.value.length > 0) return;

  const [stores, suppliers] = await Promise.all([
    getStoreList({}),
    getSupplierList({}),
  ]);

  storeOptions.value = stores.map((item: Store) => ({
    label: item.storeName,
    value: item.storeId,
  }));
  supplierOptions.value = suppliers.map((item: Supplier) => ({
    label: item.supplierName,
    value: item.supplierId,
  }));
}

function buildStoreRows(summary: Awaited<ReturnType<typeof getAoxiangReplenishmentSummary>>) {
  const storeMap = new Map<string, StoreSoldOutLogRow>();

  for (const report of summary.reports || []) {
    for (const store of report.triggeredStores || report.storeSummaries || []) {
      const rowItems = (report.items || []).filter((item) => item.storeCode === store.storeCode);
      const existing = storeMap.get(store.storeCode) || {
        createdAt: summary.generatedAt,
        fetchStatus: 'success',
        latestSummary: '',
        productMasterTotalItems: store.productMasterTotalItems,
        sendStatus: 'pending',
        soldItems: 0,
        storeSoldRate: 0,
        storeCode: store.storeCode,
        storeName: store.storeName,
        supplierCount: 0,
        supplierSummaries: [],
        totalItems: 0,
      };

      existing.supplierSummaries.push({
        items: rowItems,
        soldItems: store.soldItems,
        supplierSoldRate: store.soldRate,
        supplierCode: report.supplierCode,
        supplierName: report.matchedSupplierName,
        totalItems: store.totalItems,
      });
      existing.soldItems += store.soldItems;
      if (store.productMasterTotalItems) {
        existing.productMasterTotalItems = store.productMasterTotalItems;
        existing.totalItems = store.productMasterTotalItems;
      } else {
        existing.totalItems += store.totalItems;
      }
      existing.supplierCount = existing.supplierSummaries.length;
      const storeTotalItems = existing.productMasterTotalItems || existing.totalItems;
      existing.storeSoldRate =
        storeTotalItems > 0
          ? Number(((existing.soldItems / storeTotalItems) * 100).toFixed(2))
          : 0;
      existing.latestSummary = `${store.storeName}-共${existing.supplierCount}个供应商，门店商品${storeTotalItems}个，售罄${existing.soldItems}个，门店售罄率 ${formatPercent(existing.storeSoldRate)}%，请及时补货`;
      existing.totalItems = storeTotalItems;

      storeMap.set(store.storeCode, existing);
    }
  }

  const rows = [...storeMap.values()];
  for (const row of rows) {
    row.sendStatus = resolveSendStatus(getRelatedDeliveries(row));
  }
  return rows;
}

async function loadData(query: SearchModel) {
  const [summary, eventsRes, deliveriesRes] = await Promise.all([
    getAoxiangReplenishmentSummary({
      allowInteractiveLogin: false,
      groupByStore: true,
      minSoldCount: 1,
    }),
    getProcurementAlertEvents(),
    getProcurementAlertDeliveries(),
  ]);

  rawEvents.value = eventsRes.items || [];
  rawDeliveries.value = deliveriesRes.items || [];

  return buildStoreRows(summary)
    .filter((row) => {
      if (query.storeId && row.storeCode !== query.storeId) return false;
      if (
        query.supplierId &&
        !row.supplierSummaries.some((item) => item.supplierCode === query.supplierId)
      ) {
        return false;
      }
      if (query.fetchStatus && row.fetchStatus !== query.fetchStatus) return false;
      if (query.sendStatus && row.sendStatus !== query.sendStatus) return false;
      return true;
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function openDetail(row: StoreSoldOutLogRow) {
  currentDetailRow.value = row;
  detailOpen.value = true;
}

async function serveMethods(params: { data?: Partial<SearchModel> } | Partial<SearchModel>) {
  const query = {
    ...filters.value,
    ...((params as any)?.data || params || {}),
  } as SearchModel;

  await ensureBaseOptionsLoaded();
  const rows = await loadData(query);
  rawRows.value = rows;

  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.max(1, Number(query.pageSize) || 10);
  const start = (page - 1) * pageSize;

  return {
    list: rows.slice(start, start + pageSize),
    total: rows.length,
  };
}
</script>

<template>
  <SimpleTemplate
    layout="inline"
    row-key="storeCode"
    v-model="filters"
    :search-form-items="searchFormItems"
    :columns="columns"
    :serve-methods="serveMethods"
  />

  <Drawer
    v-model:open="detailOpen"
    :title="currentDetailRow ? `${currentDetailRow.storeName} 门店售罄详情` : '门店售罄详情'"
    width="78%"
  >
    <template v-if="currentDetailRow">
      <Descriptions bordered :column="3" size="small" class="mb-4">
        <Descriptions.Item label="时间">
          {{ formatDatetime(currentDetailRow.createdAt) }}
        </Descriptions.Item>
        <Descriptions.Item label="门店">
          {{ currentDetailRow.storeName }}
        </Descriptions.Item>
        <Descriptions.Item label="涉及供应商">
          {{ currentDetailRow.supplierCount }}
        </Descriptions.Item>
        <Descriptions.Item label="售罄数">
          <Tag color="error">{{ currentDetailRow.soldItems }}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label="门店售罄率">
          {{ formatPercent(currentDetailRow.storeSoldRate) }}%
        </Descriptions.Item>
        <Descriptions.Item label="门店商品数">
          {{ currentDetailRow.totalItems }}
        </Descriptions.Item>
        <Descriptions.Item label="抓取状态">
          <Tag :color="currentDetailRow.fetchStatus === 'success' ? 'success' : 'error'">
            {{ currentDetailRow.fetchStatus === 'success' ? '抓取成功' : '抓取失败' }}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label="发送状态">
          <Tag
            :color="
              currentDetailRow.sendStatus === 'sent'
                ? 'success'
                : currentDetailRow.sendStatus === 'failed'
                  ? 'error'
                  : currentDetailRow.sendStatus === 'partial'
                    ? 'warning'
                    : 'processing'
            "
          >
            {{
              currentDetailRow.sendStatus === 'sent'
                ? '发送成功'
                : currentDetailRow.sendStatus === 'failed'
                  ? '发送失败'
                  : currentDetailRow.sendStatus === 'partial'
                    ? '部分成功'
                    : '待发送'
            }}
          </Tag>
        </Descriptions.Item>
        <Descriptions.Item label="摘要" :span="3">
          {{ currentDetailRow.latestSummary }}
        </Descriptions.Item>
      </Descriptions>

      <Tabs>
        <Tabs.TabPane key="suppliers" :tab="`供应商汇总 (${currentDetailRow.supplierSummaries.length})`">
          <Table
            row-key="supplierCode"
            size="small"
            :columns="detailSupplierColumns"
            :data-source="currentDetailRow.supplierSummaries"
            :pagination="false"
            :scroll="{ x: 760 }"
          />
        </Tabs.TabPane>
        <Tabs.TabPane key="items" :tab="`售罄商品 (${currentDetailRow.supplierSummaries.flatMap((item) => item.items).length})`">
          <Table
            row-key="skuCode"
            size="small"
            :columns="detailItemColumns"
            :data-source="currentDetailRow.supplierSummaries.flatMap((item) => item.items)"
            :pagination="{ pageSize: 10 }"
            :scroll="{ x: 1180 }"
          />
        </Tabs.TabPane>
        <Tabs.TabPane key="deliveries" :tab="`发送记录 (${detailDeliveries.length})`">
          <Table
            row-key="id"
            size="small"
            :columns="detailDeliveryColumns"
            :data-source="detailDeliveries"
            :pagination="false"
            :scroll="{ x: 980 }"
          />
        </Tabs.TabPane>
      </Tabs>
    </template>
  </Drawer>
</template>
