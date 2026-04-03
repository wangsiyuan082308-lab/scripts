<script setup lang="ts">
import {
  computed,
  nextTick,
  onActivated,
  onMounted,
  onUnmounted,
  reactive,
  ref,
  useAttrs,
} from 'vue';

import { useDebounceFn } from '@vueuse/core';

import { useLayoutStore } from '../../../stores/layout';
import BaseSearchGroup from '../BaseSearchGroup/index.vue';
// @ts-expect-error no .vue type declaration
import BaseTableGroup from '../BaseTableGroup/index.vue';

const CSS_VARIABLE_LAYOUT_CONTENT_HEIGHT = '--vben-content-height';

/**
 * 组件属性定义
 */
interface Props {
  /** 是否显示搜索框 */
  showSearch?: boolean;
  /** 服务方法 */
  serveMethods: (params: any) => Promise<any>;
  /** 获取请求的公共方法 */
  totalServeMethods?: (params: any) => Promise<any>;
  /** 搜索表单配置项 */
  searchFormItems?: any[];
  /** 是否内联显示 */
  inline?: boolean;
  /** 表格列配置 */
  columns?: any[];
  /** 表格头部操作配置 */
  headerOptions?: any[];
  /** 搜索前处理函数 */
  beforeSearch?: (data: any) => any | Promise<any>;
  /** 自动高度 */
  autoHeight?: boolean;
  /** 是否显示分页 */
  showPage?: boolean;
  /** 最大高度 */
  maxHeight?: number | string;
  /** 响应后处理函数 */
  afterResponse?: (data: any) => any;
  /** 是否折叠 */
  collapsed?: boolean;
  /** 行类名 */
  rowClassName?: ((params: any) => string) | string;
  /** 是否显示操作列 */
  showOption?: boolean;
  rowKey?: string;
  rowSelection?: any;
}

/**
 * 组件事件定义
 */
interface Emits {
  'update:collapsed': [value: boolean];
  sortChange: [value: any];
}

// 定义属性和事件
const props = withDefaults(defineProps<Props>(), {
  showSearch: true,
  searchFormItems: () => [],
  inline: true,
  columns: () => [],
  headerOptions: () => [],
  beforeSearch: (data: any) => data,
  autoHeight: true,
  showPage: true,
  afterResponse: (data: any) => data,
  collapsed: false,
  showOption: false,
  maxHeight: 800,
  rowKey: 'id',
  rowSelection: null,
});

const emit = defineEmits<Emits>();

// 获取 attrs
const attrs = useAttrs();

// 使用 Pinia store
const layoutStore = useLayoutStore();

// 获取 LayoutContent 的高度（通过 CSS 变量）
// 由于 useCssVar 无法正确读取通过 style.setProperty 设置的变量
// 我们直接从 DOM 读取并使用 ref 来存储
const layoutContentHeight = ref<string>('');

// 定义一个函数来读取 CSS 变量
const updateLayoutContentHeight = () => {
  const height = getComputedStyle(document.documentElement).getPropertyValue(
    CSS_VARIABLE_LAYOUT_CONTENT_HEIGHT,
  );
  layoutContentHeight.value = height.trim();
};

/**
 * 响应式数据
 */
// 表格数据状态
const tableData = reactive({
  list: [] as any[],
  total: 0,
  spanMethodColumns: [] as any[],
  census: null as any,
});
// form绑定到的数据 - 添加类型和默认值
const searchFormModel = defineModel({
  type: Object,
  default: () => ({}),
});
// 是否展开
const collapsedModel = defineModel('collapsed', {
  type: Boolean,
  default: false,
});

// 为 limit 创建独立的计算属性
const limitModel = computed({
  get: () => {
    return (searchFormModel.value as any)?.pageSize || 20;
  },
  set: (value: number) => {
    if (searchFormModel.value) {
      (searchFormModel.value as any).pageSize = value;
    }
  },
});

/**
 * 动态计算表格高度
 * 从 LayoutContent 获取容器高度，减去搜索区域高度和间距
 * 返回实际像素值
 */
const dynamicTableHeight = computed(() => {
  if (!props.autoHeight) {
    return props.maxHeight;
  }

  // 从 CSS 变量获取 LayoutContent 的实际高度
  const containerHeight = Number.parseInt(layoutContentHeight.value || '0') || 0;
  const searchHeight = layoutStore.searchHeight || 0;
  const padding = 40; // SimpleTemplate 的上下 padding (20px * 2)
  const gap = 60; // 搜索区域与表格区域之间的间距
  // 如果容器高度还未计算，返回默认值
  if (!containerHeight) {
    return props.maxHeight;
  }

  // 计算实际可用高度
  let availableHeight = containerHeight - searchHeight - padding;

  // 如果有搜索区域，需要减去搜索区域高度和间距
  if (props.showSearch && searchHeight > 0) {
    availableHeight = availableHeight - searchHeight - gap;
  }

  // 确保高度不小于最小值
  return Math.max(availableHeight, 200);
});

// 表格状态
const tableState = reactive({
  loading: false,
});

/**
 * 计算属性
 */

// 表格属性
const tableProps = computed(() => ({
  border: true,
  request: handleSearch,
  headerOptions: props.headerOptions,
  columns: props.columns.filter((v) => v.show !== false), // 过滤不展示的column
  height: dynamicTableHeight.value, // 使用计算后的实际像素高度
  autoHeight: props.autoHeight,
  showOption: props.showOption,
  rowClassName: props.rowClassName,
  showPage: props.showPage,
  showSummary: attrs['show-summary'],
  summaryMethod: attrs['summary-method'],
  rowKey: props.rowKey,
  rowSelection: props.rowSelection,
  emptyText: '暂无数据', // 直接使用中文
}));

/**
 * 排序变化处理
 * @param sortInfo - 排序信息
 */
const handleSortChange = (sortInfo: any) => {
  // 如果没有定义排序字段，直接触发事件
  if (sortInfo) {
    searchFormModel.value.order = sortInfo.key;
    searchFormModel.value.sort = sortInfo.order;
  } else {
    searchFormModel.value.order = '';
    searchFormModel.value.sort = '';
  }

  // 使用 nextTick 确保数据更新后再搜索
  nextTick(() => {
    handleSearch();
  });
};

/**
 * 筛选条件变化处理
 * @param filterData - 筛选数据
 */
const handleFilterChange = (filterData: Record<string, any>) => {
  const newSearchForm = { ...searchFormModel.value };

  newSearchForm.search_condition = newSearchForm.search_condition
    ? { ...newSearchForm.search_condition }
    : {};

  Object.assign(newSearchForm.search_condition, filterData);

  // 使用 nextTick 确保数据更新后再搜索
  nextTick(() => {
    handleSearch();
  });
};

/**
 * 执行搜索请求
 * @param searchParams - 搜索参数
 * @returns 搜索结果
 */
const executeSearch = async (searchParams: any) => {
  try {
    const response = await props.serveMethods(searchParams);
    return response;
  } catch (error) {
    console.error('搜索请求失败:', error);
    throw error;
  }
};

/**
 * 搜索处理方法（防抖）
 */
const handleSearch = useDebounceFn(
  async () => {
    try {
      // 搜索前处理
      const requestData = await props.beforeSearch({
        data: searchFormModel.value,
      });
      if (requestData === false) return;

      tableState.loading = true;

      // 执行搜索
      const response = await executeSearch(requestData);
      // 响应后的数据
      const processedData = props.afterResponse(response);
      const { list, totalPages, total } = processedData || {};
      // 更新表格数据
      tableData.list = list || [];
      tableData.total = totalPages || total || 0;
    } catch (error) {
      console.error('搜索失败:', error);
      // 重置数据
      tableData.list = [];
      tableData.total = 0;
    } finally {
      tableState.loading = false;
    }
  },
  500,
);

// MutationObserver 实例
let styleObserver: MutationObserver | null = null;

/**
 * 生命周期钩子
 */
onMounted(() => {
  // 立即读取一次
  updateLayoutContentHeight();

  // 使用 MutationObserver 监听 document.documentElement 的 style 属性变化
  styleObserver = new MutationObserver(() => {
    updateLayoutContentHeight();
  });

  styleObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style'],
  });

  // 延迟检查，给 LayoutContent 一些时间来设置 CSS 变量
  setTimeout(() => {
    updateLayoutContentHeight();
  }, 100);

  handleSearch();
});

onActivated(() => {
  handleSearch();
});

onUnmounted(() => {
  // 组件卸载时断开观察器
  if (styleObserver) {
    styleObserver.disconnect();
    styleObserver = null;
  }
});

/**
 * 暴露给父组件的方法
 */
defineExpose({
  search: handleSearch,
  onSearch: handleSearch,
  getData: () => tableData.list,
  setData: (data: any) => {
    // 使用数组展开确保触发响应式更新
    tableData.list = [...data];
  },
  dataSource: () => tableData.list,
});
</script>
<template>
  <div class="simple-template p-5">
    <!-- 搜索区域 -->
    <BaseSearchGroup
      v-if="showSearch"
      class="bg-card text-card-foreground border-border w-full rounded-xl p-5"
      v-bind.prop="attrs"
      :auto-height="autoHeight"
      v-model="searchFormModel"
      v-model:page="searchFormModel.page"
      v-model:collapsed="collapsedModel"
      :search-form-items="searchFormItems"
      :inline="inline"
      @search="handleSearch"
    >
      <template #footer>
        <slot name="searchFooter" style="margin: 8px 0"></slot>
      </template>
    </BaseSearchGroup>

    <div
      class="bg-card text-card-foreground border-border mt-5 w-full rounded-xl p-5"
    >
      <!-- 表格区域 -->
      <BaseTableGroup
        v-bind.prop="tableProps"
        v-model:page="searchFormModel.page"
        v-model:page-size="limitModel"
        :data="tableData.list"
        :total="tableData.total"
        :loading="tableState.loading"
        @filter-change="handleFilterChange"
        @sort-change="handleSortChange"
      />
    </div>
  </div>
</template>

<style scoped>
.simple-template {
  /* 使用 LayoutContent 提供的高度 CSS 变量 */
  height: var(--vben-content-height);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
</style>
