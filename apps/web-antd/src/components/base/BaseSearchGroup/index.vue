<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';

import { useLayoutStore } from '../../../stores/layout';
import { cloneDeep as clone, getDate } from '../utils';
import { vDomChange } from '../utils/domChange';

import BaseForm from '../BaseForm/BaseForm.vue';

// 定义组件名称
defineOptions({
  name: 'BaseSearchGroup',
});

// 定义 props
const props = withDefaults(
  defineProps<{
    /** 是否上传高度 */
    autoHeight?: boolean;
    /** 区分搜索模版的渠道 */
    channel?: string;
    /** 是否展开 */
    collapsed?: boolean;
    /** 列配置 */
    columns?: any[];
    /** 筛选模板键 */
    filterTemplateKeys?: any[];
    /** 是否校验show_type */
    isValidShowType?: boolean;
    /** 标签后缀 */
    labelSuffix?: string;
    /** 页码 */
    page: number;
    /** 搜索项目 */
    searchFormItems?: any[];
  }>(),
  {
    searchFormItems: () => [],
    page: 1,
    autoHeight: false,
    labelSuffix: '',
    collapsed: false,
    columns: () => [],
    filterTemplateKeys: () => [],
    isValidShowType: false,
    channel: 'toutiao',
  },
);

// 定义 emits
const emit = defineEmits<{
  export: [value: any];
  resetForm: [];
  search: [value?: Record<string, any>];
  'update:collapsed': [value: boolean];
}>();

// 使用 Pinia store
const layoutStore = useLayoutStore();

// 响应式数据
const defaultValue = ref<Record<string, any>>({});
// 表单数据
const model = defineModel<Record<string, any>>({
  default: () => ({}),
});
// 计算属性
const formItems = computed(() => {
  // 判断是否有时间快捷选项
  const formItems = clone(props.searchFormItems);
  const dateQuickIndex = formItems.findIndex(
    (item: any) => item.renderType === 'dateQuick',
  );
  if (dateQuickIndex !== -1) {
    formItems.splice(dateQuickIndex, 1, ...dateQuickItems.value);
  }
  formItems.forEach((item: any) => {
    // 如果是筛选模板下拉select
    if (item.child && item.child.renderType === 'selectSearchTemplate') {
      item.child = {
        ...item.child,
      };
    }
  });
  return formItems;
});

// 目前只兼容时间范围选项
const dateQuickItems = computed(() => {
  const formItems = clone(props.searchFormItems);
  const dateQuickItem = formItems.find(
    (item: any) => item.renderType === 'dateQuick',
  );

  if (!dateQuickItem) return [];

  // 默认前一日和后一日绑定的时间
  const { beginDateKey = 'begin_date', endDateKey = 'end_date' } =
    dateQuickItem;

  return [
    {
      label: '',
      _key: 'buttons',
      child: {
        renderType: 'buttons',
        options: [
          {
            label: '前一日',
            value: '前一日',
            type: 'primary',
            click: () => {
              model.value[beginDateKey] = getDate(
                -1,
                model.value[beginDateKey],
              );
              model.value[endDateKey] = getDate(-1, model.value[endDateKey]);
              onSearch(model.value);
            },
          },
          {
            label: '今日',
            value: '今日',
            type: 'primary',
            click: () => {
              model.value[beginDateKey] = getDate(0);
              model.value[endDateKey] = getDate(0);
              onSearch(model.value);
            },
          },
          {
            label: '后一日',
            value: '后一日',
            type: 'primary',
            click: () => {
              model.value[beginDateKey] = getDate(1, model.value[beginDateKey]);
              model.value[endDateKey] = getDate(1, model.value[endDateKey]);
              onSearch(model.value);
            },
          },
        ],
      },
    },
  ];
});
// 生命周期
onMounted(() => {
  if (model.value && Object.keys(model.value).length > 0) {
    // 收集重置数据 - 必须使用 clone 创建副本
    defaultValue.value = clone(model.value);
  }
});

// 方法定义
const onUpdateCollapsed = (collapsed: boolean) => {
  emit('update:collapsed', collapsed);
};

/**
 * @description 点击搜索
 */
const onSearch = (data?: Record<string, any>) => {
  // 移除强制重置页码的逻辑，保持当前页码
  emit('search', data);
};

/**
 * @description 重置搜索条件 判断model 类型 判断数组/字符串
 */
const onResult = () => {
  // 添加重置操作
  model.value.page = 1;
  emit('resetForm');
};

const onReset = () => {
  // search_template.value = '';

  // Vue 3 最简洁方案：使用 reactive 的特性
  const resetData = clone(defaultValue.value);

  // 一步到位：清空后重新赋值
  for (const key in model.value) {
    delete model.value[key];
  }
  Object.assign(model.value, resetData);

  onResult();
  nextTick(() => {
    onSearch();
  });
};

/**
 * @description 上报本组件高度
 */
const reportCompHeight = (size: { height: number }) => {
  if (props.autoHeight) {
    nextTick(() => {
      const { height } = size;
      if (height) {
        // 使用 Pinia store 存储搜索区域高度
        layoutStore.setSearchHeight(height);
      }
    });
  }
};
</script>

<template>
  <!-- 搜索区域 -->
  <BaseForm
    v-dom-change.height="autoHeight && reportCompHeight"
    :form-items="formItems"
    v-bind.prop="$attrs"
    v-model:model="model"
    :label-suffix="labelSuffix"
    :collapsed="collapsed"
    @update:collapsed="onUpdateCollapsed"
    @reset="onReset"
    @search="onSearch"
  />
</template>

<style lang="scss" scoped></style>
