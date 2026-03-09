<script>
/**
 * @description 主要应用在template 中 内容头部右边区域得操作项区域
 */
import { Button } from 'ant-design-vue';

import { RenderDom } from '../utils';
// 第41行：修复空箭头函数
export default {
  components: {
    RenderDom,
    Button,
  },
  props: {
    // 将空箭头函数改为返回空对象的函数
    someProperty: {
      type: Object,
      default: () => ({}), // 而不是 default: () => {}
    },
    options: {
      type: Array,
      default: () => [],
    },
  },
};
</script>
<template>
  <div class="table-header-options mb-2">
    <template v-for="(option, index) in options">
      <!-- 自定义render -->
      <RenderDom
        v-if="option.renderType === 'render'"
        :key="index"
        :render="option.render"
      />
      <!-- 没有render 判断其他条件 -->
      <Button
        v-if="option.renderType === 'button'"
        :key="option.name"
        :ghost="option.ghost || false"
        :type="option.type || 'primary'"
        :disabled="option.disabled"
        :class="option.class"
        style="margin-right: 10px"
        @click="option.click(option)"
      >
        <i class="iconfont" style="font-size: 12px" v-html="option.icon"></i>
        {{ option.name || option.label }}
      </Button>
      <div
        v-if="option.renderType === 'text'"
        :key="index"
        v-bind.prop="option"
      >
        {{ option.name || option.label }}
      </div>
    </template>
  </div>
</template>

<style lang="scss" scoped>
.table-header-options {
  display: flex;
  align-content: center;
  align-items: center;

  .Button {
    margin: 0 5px;
  }
}
</style>
