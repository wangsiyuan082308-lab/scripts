<script setup lang="ts">
import { ref, onMounted } from 'vue';

import { Page } from '@vben/common-ui';

import { Button, Card, Empty, Spin, Table } from 'ant-design-vue';

import { requestClient } from '#/api/request';

interface StoreConfig {
  name: string;
  shortName: string;
  meituanId?: string;
  elemeName?: string;
  salary?: number;
  rent?: number;
  depreciation?: number;
  promotion?: number;
  meituanPromo?: number;
  elemePromo?: number;
  office?: number;
  franchise?: number;
  totalFixedCost?: number;
}

const loading = ref(false);
const stores = ref<StoreConfig[]>([]);

const columns = [
  {
    title: '门店',
    dataIndex: 'shortName',
    key: 'name',
    width: 100,
    fixed: 'left' as const,
  },
  {
    title: '美团ID',
    dataIndex: 'meituanId',
    key: 'meituanId',
    width: 110,
  },
  {
    title: '饿了么名称',
    dataIndex: 'elemeName',
    key: 'elemeName',
    width: 160,
  },
  {
    title: '人工',
    dataIndex: 'salary',
    key: 'salary',
    width: 90,
  },
  {
    title: '房租',
    dataIndex: 'rent',
    key: 'rent',
    width: 90,
  },
  {
    title: '折旧',
    dataIndex: 'depreciation',
    key: 'depreciation',
    width: 90,
  },
  {
    title: '推广',
    dataIndex: 'promotion',
    key: 'promotion',
    width: 90,
  },
  {
    title: '美团推广',
    dataIndex: 'meituanPromo',
    key: 'meituanPromo',
    width: 100,
  },
  {
    title: '饿了么推广',
    dataIndex: 'elemePromo',
    key: 'elemePromo',
    width: 110,
  },
  {
    title: '办公',
    dataIndex: 'office',
    key: 'office',
    width: 90,
  },
  {
    title: '加盟费',
    dataIndex: 'franchise',
    key: 'franchise',
    width: 100,
  },
  {
    title: '固定成本合计',
    dataIndex: 'totalFixedCost',
    key: 'totalFixedCost',
    width: 130,
    fixed: 'right' as const,
  },
];

function formatMoney(val: number | undefined) {
  if (val === undefined || val === null) return '-';
  return `¥${val.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

async function fetchStores() {
  loading.value = true;
  try {
    const res = await requestClient.get<any>('/finance/stores');
    const list = Array.isArray(res) ? res : res.list || res.stores || [];
    stores.value = list;
  } catch (e) {
    console.error('获取门店配置失败', e);
  } finally {
    loading.value = false;
  }
}

onMounted(fetchStores);
</script>

<template>
  <Page title="门店配置">
    <div class="p-4">
      <!-- 刷新 -->
      <div class="mb-4 flex items-center justify-between">
        <span class="text-sm text-gray-400">
          共 {{ stores.length }} 个门店
        </span>
        <Button :loading="loading" @click="fetchStores">🔄 刷新数据</Button>
      </div>

      <!-- 门店配置表格 -->
      <Card>
        <Spin :spinning="loading">
          <Table
            :columns="columns"
            :data-source="stores"
            :pagination="false"
            :row-key="
              (record: StoreConfig, index?: number) =>
                record.name || String(index)
            "
            :scroll="{ x: 1200 }"
            size="middle"
          >
            <template #bodyCell="{ column, record }">
              <template v-if="column.key === 'name'">
                <span>🏪 {{ record.shortName }}</span>
              </template>

              <template v-else-if="column.key === 'meituanId'">
                <span class="font-mono text-sm">
                  {{ record.meituanId || '-' }}
                </span>
              </template>

              <template v-else-if="column.key === 'elemeName'">
                <span>{{ record.elemeName || '-' }}</span>
              </template>

              <template
                v-else-if="['salary', 'rent', 'depreciation', 'promotion', 'meituanPromo', 'elemePromo', 'office', 'franchise'].includes(column.key as string)"
              >
                <span class="text-sm">
                  {{ formatMoney((record as any)[(column.dataIndex || column.key) as string] as number | undefined) }}
                </span>
              </template>

              <template v-else-if="column.key === 'totalFixedCost'">
                <span style="color: #f5222d; font-weight: bold">
                  {{ formatMoney(record.totalFixedCost) }}
                </span>
              </template>
            </template>

            <template #emptyText>
              <Empty description="暂无门店配置数据" />
            </template>
          </Table>
        </Spin>
      </Card>
    </div>
  </Page>
</template>
