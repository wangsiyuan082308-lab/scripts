<script setup lang="ts">
import { ref } from 'vue';
import { RangePicker } from 'ant-design-vue';

// 定义props
const props = withDefaults(
  defineProps<{
    beginTime?: string;
    clearable?: boolean;
    /**
     * 禁用日期函数
     * @param {Date} time - 日期对象
     * @returns {boolean} - 是否禁用
     */
    disabledDate?: (time: Date) => boolean;
    endTime?: string;
    loading?: boolean;
    // 快捷选项默认
    shortcutsLayout?: Array<string>;
  }>(),
  {
    loading: false,
    disabledDate: (time: Date) => time.getTime() > Date.now(),
    clearable: false,
    beginTime: '',
    endTime: '',
    shortcutsLayout: () => [
      'today',
      'lastDay',
      '7day',
      '30day',
      'week',
      'lastWeek',
      'month',
      'lastMonth',
    ],
  },
);

// 定义事件
const emit = defineEmits(['update:beginTime', 'update:endTime', 'change']);

const datePickerRef = ref(null);

// 使用defineModel定义双向绑定
const timeDate = defineModel<Array<string>>({
  default: () => [],
});
</script>

<template>
  <!-- 外面的快捷选项 只有3个 昨天 今天  明天 -->
  <!-- v-bind.prop="$attrs"
  v-model="timeDate" -->
  <RangePicker
    ref="datePickerRef"
    align="right"
    v-model:value="timeDate"
    start-placeholder="开始日期"
    end-placeholder="结束日期"
    range-separator="-"
    :clearable="clearable"
    format="YYYY-MM-DD"
    value-format="YYYY-MM-DD"
  />
</template>
