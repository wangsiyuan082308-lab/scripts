<script setup>
import { computed } from 'vue';
import { Table, Empty } from 'ant-design-vue';
import { RenderDom } from '../utils';

const props = defineProps({
  rowKey: {
    type: [String, Function],
    default: 'id',
  },
  rowSelection: {
    type: Object,
    default: null,
  },
  columns: {
    type: Array,
    default: () => [],
  },
  data: {
    type: Array,
    default: () => [],
  },
  // 汇总数据
  summaryData: {
    type: Object,
    default: () => ({}),
  },
  height: {
    type: [String, Number],
    default: '',
  },
  loading: {
    type: Boolean,
    default: false,
  },
  pagination: {
    type: [Object, Boolean],
    default: false,
  },
});

const emit = defineEmits(['change', 'sort-change']);

const tableColumns = computed(() => {
  return props.columns.map((column) => {
    return {
      ...column,
      title: column.label || column.title,
      dataIndex: column.key || column.dataIndex || column.prop,
      key: column.key || column.dataIndex || column.prop,
      ellipsis: true,
      sorter: column.sortable ? true : false,
    };
  });
});

const dataSource = computed(() => {
  return props.data;
});

const onChange = (pagination, filters, sorter, extra) => {
  emit('change', pagination, filters, sorter, extra);
  if (extra.action === 'sort') {
    emit('sort-change', sorter);
  }
};
</script>

<template>
  <Table
    :columns="tableColumns"
    :pagination="pagination"
    bordered
    :scroll="{ y: height }"
    :loading="loading"
    :dataSource="dataSource"
    :row-key="rowKey"
    :row-selection="rowSelection || undefined"
    size="small"
    @change="onChange"
  >
    <template #emptyText>
      <Empty :image="Empty.PRESENTED_IMAGE_SIMPLE" />
    </template>
    <template #bodyCell="{ column, record, index, text }">
      <template v-if="column.render">
        <RenderDom
          :render="column.render"
          :props="{ row: record, index, column, text }"
        />
      </template>
      <template v-else>
        {{ text }}
      </template>
    </template>
  </Table>
</template>
