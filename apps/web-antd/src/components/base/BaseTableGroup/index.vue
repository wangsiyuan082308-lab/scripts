<script>
import { useLayoutStore } from '../../../stores/layout';
import BaseTable from '../BaseTable/index.vue';
import Header from './header.vue';

export default {
  name: 'BaseTableGroup',
  components: {
    BaseTable,
    Header,
  },
  provide() {
    return {
      baseTableGroupVm: this,
    };
  },
  inheritAttrs: false,
  props: {
    /**
     * @description 分页总数
     */
    total: {
      type: Number,
      default: 0,
    },
    pageSize: {
      type: Number,
      default: 100,
    },
    rowKey: {
      type: String,
      default: 'id',
    },
    page: {
      type: Number,
      default: 1,
    },
    formatDate: {
      type: String,
      default: 'YYYY-MM-DD HH:mm:ss',
    },
    showPage: {
      type: Boolean,
      default: true,
    },
    height: {
      type: [String, Number],
      default: '',
      required: true,
    },
    loading: {
      type: Boolean,
      default: false,
    },
    // 完全自定义高度
    // 是否计算高度赋值到 Table，如果是非常规搜索表格页，比如弹框里的表格不需要计算高度
    autoHeight: {
      type: Boolean,
      default: false,
    },
    showOption: {
      type: Boolean,
      default: false,
    },
    // 表格请求数据函数
    request: {
      type: Function,
      default: null,
    },
    headerOptions: {
      type: Array,
      default: () => [],
    },
    data: {
      type: Array,
      default: () => [],
    },
    columns: {
      type: Array,
      default: () => [],
    },
    fixedData: {
      type: Array,
      default: () => [],
    },
    // 数据总结
    summaryData: {
      type: Object,
      default: () => ({}),
    },
  },
  data() {
    return {
      fullscreen: false,
      size: 'default',
    };
  },
  computed: {
    pagination() {
      const pagination = {
        total: this.total,
        current: this.page,
        pageSize: this.pageSize,
        defaultPageSize: this.pageSize,
        hideOnSinglePage: false,
        showSizeChanger: true,
        showTotal: (total) => {
          return `共${total}条数据`;
        },
        pageSizeOptions: ['10', '20', '30', '40', '50', '100'],
        showQuickJumper: true,
      };
      return pagination;
    },
    classs() {
      return {
        fullscreen: this.fullscreen,
      };
    },
    // 根元素高度
    wrapperHeight() {
      // 使用 Pinia store
      const layoutStore = useLayoutStore();
      // 10px  是margin的高度
      return this.autoHeight
        ? `calc(100% - ${layoutStore.searchHeight + 10}px )`
        : 'unset';
    },
    styles() {
      return {
        height: this.wrapperHeight,
      };
    },
  },
  methods: {
    /** basetable change事件，包含pagination, filters, sorter, { action: 'paginate' | 'sort' | 'filter' }) */
    onChange(pagination, filters, sorter, extra) {
      this.$emit('update:page', pagination.current);
      this.$emit('update:pageSize', pagination.pageSize);
      // 当分页变化时，触发重新搜索
      if (extra.action === 'paginate') {
        this.onRefresh();
      }
    },
    onSortChange(sort) {
      this.$emit('sort-change', sort);
    },
    onRefresh() {
      this.request && this.request();
    },
    /** * @description table 一页展示几条数据 change 事件 */
    handlePageSizeChange(pageSize) {
      this.$emit('on-page-size-change', pageSize);
    },
    /**
     * @description page change事件
     */
    // onPageChange(page, pageSize) {
    //   // 暂时刷新事件和emit事件都调用
    //   this.$emit('update:page', page);
    //   this.$emit('update:limit', page);
    //   this.$emit('update:pageSize', pageSize);
    //   this.$emit('pageChange', page);
    //   // 重新获取
    //   this.onRefresh();
    // },
    tableDoLayout() {
      if (this.fullscreen) {
        this.$refs.fullTable && this.$refs.fullTable.tableDoLayout();
      } else {
        this.$refs.table && this.$refs.table.tableDoLayout();
      }
    },
    clearSort() {
      this.$refs.table.clearSort();
    },
    // 调用 ref.table 的内置方法
    callBuiltInMethod(fn) {
      if (this.fullscreen) {
        this.$refs.fullTable && this.$refs.fullTable.callBuiltInMethod(fn);
      } else {
        this.$refs.table.callBuiltInMethod(fn);
      }
    },
  },
};
</script>
<template>
  <div :style="styles">
    <!-- 表格顶部 -->
    <Header v-if="headerOptions.length > 0" :header-options="headerOptions" />
    <BaseTable
      :data="data"
      :row-key="rowKey"
      :height="height"
      :columns="columns"
      :loading="loading"
      :fixed-data="fixedData"
      :summary-data="summaryData"
      @sort-change="onSortChange"
      :pagination="pagination"
      @change="onChange"
    />
  </div>
</template>
