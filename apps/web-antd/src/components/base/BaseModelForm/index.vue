<script>
import { Button, message, Modal } from 'ant-design-vue';

import BaseForm from '../BaseForm/BaseForm.vue';

export default {
  name: 'BaseModelForm',
  components: {
    BaseForm,
    Modal,
    Button,
  },
  props: {
    show: {
      type: Boolean,
      default: false,
      required: true,
    },
    formItems: {
      type: Array,
      default: () => [],
      required: true,
    },
    layout: {
      type: String,
      default: 'horizontal',
    },
    title: {
      type: String,
      default: '',
    },
    closable: {
      type: Boolean,
      default: true,
    },
    model: {
      type: Object,
      default: () => ({}),
      required: true,
    },
    rules: {
      type: Object,
      default: null,
    },
    labelWidth: {
      type: String,
      default: '',
    },
    labelPosition: {
      type: String,
      default: 'right',
    },
    submit: {
      type: Function,
      default: () => ({}),
    },
    labelCol: {
      type: Object,
      default: () => ({}),
    },
    labelAlign: {
      type: String,
      default: 'left',
    },
    // model 宽度
    width: {
      type: [String, Number],
      default: '500px',
    },
    modelStyles: {
      type: Object,
      default: () => ({}),
    },
    modelClassName: {
      type: String,
      default: '',
    },
    inline: {
      type: Boolean,
      default: false,
    },
    contentStyles: {
      type: [Object, String],
      default: () => ({}),
    },
    disabled: {
      type: Boolean,
      default: false,
    },
    submitDisabled: {
      type: Boolean,
      default: false,
    },
    maskClosable: {
      type: Boolean,
      default: false,
    },
    // 调用Api 回显的loading
    fetchLoading: {
      type: Boolean,
      default: false,
    },
    okText: {
      type: String,
      default: '确定',
    },
    cancelText: {
      type: String,
      default: '取消',
    },
    cancel: {
      type: Function,
      default: () => ({}),
    },
    showMessage: {
      type: Boolean,
      default: true,
    },
    isSubmitValidate: {
      type: Boolean,
      default: true,
    },
  },
  data() {
    return {
      modelShow: false,
      loading: false,
      currentModel: this.model,
    };
  },
  computed: {
    styles() {
      return {
        height: this.contentHeight,
      };
    },
  },
  watch: {
    show: {
      handler() {
        this.$refs.baseform && this.$refs.baseform.resetModel();
        this.modelShow = this.show;
        if (this.show) {
          this.loading = false;
        }
      },
      deep: true,
      immediate: true,
    },
    modelShow: {
      handler() {
        this.$emit('update:show', this.modelShow);
        if (this.modelShow === false) {
          this.onCancel();
        }
      },
      deep: true,
    },
    model: {
      handler() {
        this.currentModel = this.model;
      },
      deep: true,
      immediate: true,
    },
    currentModel: {
      handler() {
        this.$emit('update:model', this.currentModel);
      },
      deep: true,
    },
  },
  methods: {
    onCancel() {
      this.modelShow = false;
      this.loading = false;
      this.cancel && this.cancel();
      this.$refs.baseform && this.$refs.baseform.resetModel();
    },
    async onSubmit() {
      if (this.isSubmitValidate) {
        const valid = await this.validate();
        if (valid === false) {
          message.warning('请检查必填项');
          return false;
        }
      }
      const submit = this.submit(this.model);
      if (submit && submit.then) {
        this.loading = true;
        submit
          .then((validResult) => {
            if (validResult) this.onCancel();
          })
          .catch((error) => {
            console.log(error, '提交报错');
          })
          .finally(() => {
            this.loading = false;
          });
      } else {
        console.error('请使用then 函数');
        this.onCancel();
      }
    },
    async validate() {
      return (await this.$refs.baseform) && this.$refs.baseform.validate();
    },
    resetModel() {
      this.$refs.baseform && this.$refs.baseform.resetModel();
    },
  },
};
</script>
<template>
  <Modal
    v-model:open="modelShow"
    :title="title"
    :width="width"
    :styles="modelStyles"
    :mask-closable="false"
    :closable="closable"
    :class-name="modelClassName"
  >
    <!-- 弹框 header slot -->
    <template #header>
      <slot name="header"></slot>
    </template>
    <!-- 弹框 主体表单 -->
    <BaseForm
      ref="baseform"
      :layout="layout"
      :labelAlign="labelAlign"
      :labelCol="labelCol"
      :show-message="showMessage"
      :loading="fetchLoading"
      :form-items="formItems"
      v-model:model="currentModel"
      :inline="inline"
      :label-position="labelPosition"
      :rules="rules"
      :disabled="disabled"
      :style="contentStyles"
    />
    <template #footer>
      <slot name="footer">
        <div>
          <Button type="text" @click="onCancel">
            {{ cancelText }}
          </Button>
          <Button
            type="primary"
            :loading="loading"
            :disabled="submitDisabled"
            @click="onSubmit"
          >
            {{ okText }}
          </Button>
        </div>
      </slot>
    </template>
  </Modal>
</template>
