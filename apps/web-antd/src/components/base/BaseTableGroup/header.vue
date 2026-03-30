<script>
import BaseTableGroupOptions from './options.vue';

export default {
  name: 'BaseTableGroupHeader',
  components: {
    BaseTableGroupOptions,
  },
  inject: ['baseTableGroupVm'],
  // 禁止根元素继承 attribute，以解决 column 和 data 不必要地挂载到根元素上，但不影响 style 和 class 的绑定
  inheritAttrs: false,
  props: {
    fullscreen: {
      type: Boolean,
      default: false,
    },
    size: {
      type: String,
      default: '',
    },
    showOption: {
      type: Boolean,
      default: false,
    },
    headerOptions: {
      type: Array,
      default: () => [],
    },
    // 添加device属性，如果父组件没有传递则默认为desktop
    device: {
      type: String,
      default: 'desktop',
    },
  },
  data() {
    return {
      fullscreenRef: null,
      header: {
        Authorization: window.localStorage.getItem('storagetoken'),
      },
    };
  },
  computed: {
    /**
     * 过滤显示的header选项
     * @returns {Array} 过滤后的选项数组
     */
    headerOptionsShow() {
      return this.headerOptions.filter((item) => item.show !== false);
    },
    /**
     * 左边的header选项
     * @returns {Array} 左边位置的选项数组
     */
    leftHeaderOptions() {
      return this.headerOptionsShow.filter((item) => item.position === 'left');
    },
    /**
     * 右边的header选项
     * @returns {Array} 右边位置的选项数组
     */
    rightHeaderOptions() {
      return this.headerOptionsShow.filter((item) => item.position !== 'left');
    },
  },
  methods: {
    /**
     * 全屏功能
     */
    onFullScreen() {
      // this.fullscreenRef = this.$utils.transferDom.transferDom(this.baseTableGroupVm.$refs.baseTableGroup, true, '#fullscreenTable')
      this.$emit('update:fullscreen', true);
    },
    /**
     * 取消全屏功能
     */
    onCancelFullScreen() {
      // this.fullscreenRef.parentNode.appendChild(this.baseTableGroupVm.$refs.baseTableGroup)
      // 关闭全屏 吧所有弹框斗关闭 因为有些table全屏了以后还要在谈弹框
      this.$emit('update:fullscreen', false);
    },
    /**
     * 刷新功能
     */
    onReset() {
      this.baseTableGroupVm.onRefresh();
    },
    /**
     * 下拉菜单选择处理
     * @param {string} value - 选择的值
     */
    onDropdown(value) {
      // 默认是mini 间距6px 中等是3px 紧凑是0px
      this.$emit('update:size', value);
      window.localStorage.setItem('tableSize', value);
    },
  },
};
</script>

<template>
  <div class="table-header">
    <!-- 左边 -->
    <BaseTableGroupOptions
      :options="leftHeaderOptions"
      class="table-header-item"
    />
    <!-- 右边 -->
    <div class="table-header-item">
      <template v-if="showOption"> </template>
      <BaseTableGroupOptions :options="rightHeaderOptions" />
    </div>
  </div>
</template>

<style lang="scss" scoped>
.table-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;

  .table-header-item {
    display: flex;
    flex-direction: row-reverse;
    align-items: center;
  }

  i {
    margin-left: 8px;
    font-size: 1.2rem;
    color: #606266;
  }
}
</style>
