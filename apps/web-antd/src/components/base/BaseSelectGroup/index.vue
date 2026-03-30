<script>
import { message, Select, SelectOption } from 'ant-design-vue';

import { isEqual } from '../utils';

/**
 * @description selectGroup 选择工具组件，具有说明请看组件文档
 */

export default {
  name: 'BaseSelctGroup',
  components: {
    Select,
    SelectOption,
  },
  props: {
    /** 请求方法 */
    serveMethods: {
      type: Function,
      default: (data) => data,
      require: true,
    },
    /** 请求前函数 */
    beforeRequest: {
      type: Function,
      default(data = {}) {
        return {
          ...data.query,
          ...this.query,
        };
      },
    },
    mode: {
      type: String,
      default: '',
    },

    /** 请求后函数 */
    afterRequest: {
      type: Function,
      default: (data) => data,
    },
    remote: {
      type: Boolean,
      default: false,
    },
    clearable: {
      type: Boolean,
      default: true,
    },
    query: {
      type: Object,
      default: () => ({}),
    },
    // 是否显示编辑按钮
    showEditor: {
      type: Boolean,
      default: false,
    },
    // 是否显示删除按钮
    showDelete: {
      type: Boolean,
      default: false,
    },
    // 点击编辑
    clickEdit: {
      type: Function,
      default: () => ({}),
    },
    // 点击删除
    clickDeleted: {
      type: Function,
      default: () => ({}),
    },
    isFetch: {
      type: Boolean,
      default: false,
    },
  },
  data() {
    return {
      options: [],
      response: null,
    };
  },
  computed: {
    showOptionButton() {
      if (this.showEditor || this.showDelete) return true;
      return false;
    },
    // 经过转换后的options
    currentOptions() {
      const { optionLabel = 'label', optionValue = 'value' } = this.$attrs;
      try {
        const options = this.options.map((option) => {
          return {
            ...option,
            value: option[optionValue] === undefined ? '' : option[optionValue], // 字符串的情况下
            label: Array.isArray(optionLabel)
              ? this.$attrs.optionLabel.map((item) => option[item]).join('-')
              : option[optionLabel], // 如果是数组的情况下
          };
        });
        return options;
      } catch {
        return [];
      }
    },
  },
  watch: {
    value: {
      handler() {
        this.data = this.value;
      },
      deep: true,
      immediate: true,
    },
    /** query 变动的时候获取数据 */
    query: {
      handler(value, oldValue) {
        // 如果新旧value 不一样 在发送请求
        if (isEqual(value, oldValue) === false) {
          this.getList();
        }
      },
      deep: true,
    },
    isFetch: {
      handler(value, oldValue) {
        this.getList();
      },
      deep: true,
    },
  },

  created() {
    this.getList();
  },

  methods: {
    filterOption(input, option) {
      return option.label.toLowerCase().indexOf(input.toLowerCase()) >= 0;
    },
    // 编辑
    async onClickEdit() {
      const result = await this.clickEdit(...arguments);
      result === true && this.getList();
    },
    // 删除option
    async onClickDeleted() {
      // 删除二次确认
      message({
        text: '请确认是否删除',
        title: '提示',
        type: 'warning',
        allowFun: async () => {
          const result = await this.clickDeleted(...arguments);
          result === true && this.getList();
        },
      });
    },
    /** 如果是远程搜索 需要将methods 指向组件内部搜索方法 */
    remoteMethods() {
      if (this.remote) {
        this.getList(...arguments);
      }
    },
    /**
     * @description 获取select下拉列表闭环
     */
    async getList(query) {
      // PS：如果是远程搜索 必须传入this.beforeRequest 处理处理数据
      const queryData = this.beforeRequest(query, { vm: this });
      // 如果请求前返回的数据是false 那么不显示
      if (queryData === false) return false;
      const response = await this.serveMethods(queryData);
      const dataList = await this.afterRequest(response);
      this.options = dataList;
      this.$emit('update:options', this.options);
      this.response = response;
    },
    onChange(values) {
      // 判断是否有最大选择数量
      const { optionValue = 'value', multiple } = this.$attrs;
      const selectVal =
        multiple === true
          ? values[values.length - 1 < 0 ? '' : values.length - 1]
          : values;
      //
      if (multiple) {
        const selectData =
          this.options.filter((item) => values.includes(item[optionValue])) ||
          [];
        const target =
          this.options.find((item) => item[optionValue] === selectVal) || {};
        // 请注意多选的时候 selectData 是数组
        this.$emit('selectChange', values, target, selectData);
      } else {
        const target =
          this.options.find((item) => item[optionValue] === selectVal) || {};
        this.$emit('selectChange', values, target);
      }
    },
  },
};
</script>
<template>
  <Select
    v-bind="$attrs"
    :remote="remote"
    style="min-width: 200px"
    :remote-method="remoteMethods"
    :clearable="clearable"
    :options="currentOptions"
    :mode="mode"
    @change="onChange"
    show-search
    :filter-option="filterOption"
  >
  </Select>
</template>
