<script>
import { cloneDeep as clone, RenderDom } from '../utils';

import { Button, Form, FormItem } from 'ant-design-vue';

/**
 * @desc 基础组件  form表单组件
 */
import BaseFormRender from './BaseFormRender.vue';

export default {
  name: 'BaseForm',
  components: {
    BaseFormRender,
    RenderDom,
    Button,
    Form,
    FormItem,
  },
  provide() {
    return {
      baseForm: this,
    };
  },
  inheritAttrs: false,
  props: {
    layout: {
      type: String,
      default: 'inline',
    },
    model: {
      type: Object,
      default: () => ({}),
    },
    // v-model 双向数据绑定的
    modelValue: {
      type: Object,
      default: () => ({}),
    },
    formItems: {
      type: Array,
      required: true,
      default: () => [],
      validate: (value) => {
        return Array.isArray(value);
      },
    },
    labelSuffix: {
      type: String,
      default: '：',
    },
    loading: {
      type: Boolean,
      default: false,
    },
    // 是否展开
    collapsed: {
      type: Boolean,
      default: false,
    },
  },
  emits: [
    'update:model',
    'update:modelValue',
    'search',
    'reset',
    'addSearchTemplate',
    'update:collapsed',
    'export',
  ],
  setup() {
    // const { exportData: any } = UseExport();
    return {
      // exportData: any,
    };
  },
  data() {
    return {
      defaultModel: null,
    };
  },
  computed: {
    // 🔥 创建响应式的 model 计算属性
    computedModel: {
      get() {
        return this.model;
      },
      set(value) {
        this.$emit('update:model', value);
      },
    },
  },
  created() {
    if (this.model) {
      this.$nextTick(() => {
        // 收集重置数据
        this.defaultModel = clone(this.model);
      });
    }
  },
  methods: {
    /** 导出报表 */
    async onExport(item) {
      this.$emit('export', item);
    },
    /** 添加筛选模板 */
    onAddSearchTemplate() {
      this.$emit('addSearchTemplate');
    },
    /** 展开和收起 */
    onCollaps() {
      this.$emit('update:collapsed', !this.collapsed);
    },
    /** 得道el-form-prop */
    getProp(item) {
      return this.$attrs.rules || item.rules
        ? item.prop || item.child.valueKey
        : undefined;
    },
    getKey(item, index) {
      return item._key || item._id || item.label || index;
    },
    // form 搜索button
    onSearch() {
      this.$emit('search', this.model);
    },
    // form 搜索button
    onReset() {
      this.$emit('reset');
    },
    /**
     * @description 校验form表单字段
     */
    async validate() {
      return await this.$refs.baseForm.validate();
    },
    // 重置model
    resetModel() {
      this.$emit('update:model', clone(this.defaultModel));
      const baseForm = this.$refs.baseForm;
      this.$nextTick(() => {
        baseForm.resetFields && baseForm.resetFields();
        baseForm.clearValidate && baseForm.clearValidate();
      });
    },
    // 更新model
    updateModel(key, value) {
      const newModel = { ...this.model };
      // 处理嵌套路径
      if (key.includes('.')) {
        const keys = key.split('.');
        let current = newModel;
        for (let i = 0; i < keys.length - 1; i++) {
          if (!current[keys[i]]) current[keys[i]] = {};
          current = current[keys[i]];
        }
        current[keys[keys.length - 1]] = value;
      } else {
        newModel[key] = value;
      }
      this.$emit('update:model', newModel);
    },
  },
};
</script>
<template>
  <Form
    ref="baseForm"
    v-loading="loading"
    v-bind.prop="$attrs"
    :layout="layout"
    :model="model"
    :label-suffix="labelSuffix"
  >
    <!-- 如果传递 是否需要自定义标签 -->
    <template
      v-for="(item, index) in formItems.filter((item) => item.show !== false)"
      :key="getKey(item, index)"
    >
      <!-- 分割线title -->
      <div
        v-if="item.renderType === 'lineTitle'"
        style="
          margin-bottom: 20px;
          font-size: 20px;
          font-weight: bold;
          color: #000;
        "
        v-bind.prop="$attrs"
      >
        {{ item.label }}
      </div>

      <!-- 后缀按钮 -->
      <FormItem v-else-if="['suffixButton'].includes(item.renderType)">
        <!-- -->

        <template v-for="child in item.options">
          <Button
            v-if="child.renderType === 'search'"
            :key="`${child.label}search`"
            v-bind="child"
            class="mr-2"
            @click.stop="onSearch"
          >
            {{ child.label || '搜索' }}
          </Button>
          <Button
            v-if="child.renderType === 'reset'"
            :key="`${child.label}reset`"
            v-bind="child"
            class="mr-2"
            @click.stop="onReset"
          >
            {{ child.label || '重置' }}
          </Button>
          <Button
            v-if="
              child.renderType === 'export' || child.renderType === 'exportAll'
            "
            :key="`${child.label}export`"
            v-bind="child"
            class="mr-2"
            @click.stop="onExport(child)"
          >
            {{ child.label || '导出报表' }}
          </Button>
          <Button
            v-if="child.renderType === 'collapse'"
            :key="`${child.label}collapse`"
            v-bind="child"
            class="mr-2"
            @click.stop="onCollaps"
          >
            {{ child.label || (collapsed ? '展开' : '收起') }}
          </Button>
          <Button
            v-if="child.renderType === 'button'"
            :key="`${child.label}button`"
            v-bind="child"
            v-on="child"
            class="mr-2"
          >
            {{ child.label }}
          </Button>
        </template>
      </FormItem>

      <FormItem
        v-else
        v-bind.prop="item"
        :label="!item.tooltip && !item.renderLabel ? item.label : undefined"
        :name="getProp(item)"
      >
        <!-- 不支持requre 自动生成校验 -->
        <!-- child 为数组的时候 也就是多个的时候 -->
        <template v-if="Array.isArray(item.child)">
          <BaseFormRender
            v-for="(child, childIndex) in item.child.filter(
              (obj) => obj.show !== false,
            )"
            v-bind="child"
            :key="childIndex"
            style="display: inline-block; margin-right: 8px"
            :render-data="item"
            :render-type="child.renderType"
            :label="child.label"
          />
        </template>
        <template v-else>
          <BaseFormRender
            v-bind="item"
            :render-data="item"
            :render-type="item.renderType"
            :label="item.label"
          />
        </template>
        <div v-html="item.member"></div>
      </FormItem>
    </template>
  </Form>
</template>
