<script>
import { getPropByPath, isDef, RenderDom } from '../utils';

import {
  Button,
  Cascader,
  Checkbox,
  CheckboxGroup,
  DatePicker,
  Image,
  Input,
  InputNumber,
  InputPassword,
  Radio,
  RadioGroup,
  Select,
  Switch,
  Textarea,
  TimePicker,
} from 'ant-design-vue';

import BaseDatePickerRange from '../BaseDatePickerRange/index.vue';
import BaseSelectGroup from '../BaseSelectGroup/index.vue';
import BaseUpload from '../BaseUpload/index.vue';

export default {
  name: 'BaseFormRender',
  components: {
    RenderDom,
    BaseUpload,
    BaseSelectGroup,
    Select,
    BaseDatePickerRange,
    InputPassword,
    InputNumber,
    Button,
    DatePicker,
    Input,
    Textarea,
    Radio,
    RadioGroup,
    Checkbox,
    CheckboxGroup,
    Image,
    TimePicker,
    Switch,
    Cascader,
  },
  inject: ['baseForm'],
  props: {
    renderData: {
      type: Object,
      default: () => ({}),
    },
    styles: {
      type: [Object, String],
      default: () => ({}),
    },
    contentStyles: {
      type: [Object, String],
      default: () => ({}),
    },
    label: {
      type: String,
      default: '',
    },
    renderType: {
      type: String,
      default: '',
    },
  },
  computed: {
    // 日期选择器属性 - 根据是否有valueKey决定绑定方式
    datePickerAttrs() {
      const attrs = { ...this.$attrs };

      if (this.$attrs.valueKey) {
        // 有valueKey时，使用v-model绑定
        return {
          ...attrs,
          value: this.baseForm.model[this.$attrs.valueKey],
          'onUpdate:value': (value) => {
            this.baseForm.updateModel(this.$attrs.valueKey, value);
          },
        };
      } else {
        // 没有valueKey时，使用单独的事件监听
        return {
          ...attrs,
          onUpdateBeginTime: this.$attrs['update:beginTime'],
          onUpdateEndTime: this.$attrs['update:endTime'],
        };
      }
    },

    currentModelValue() {
      return this.baseForm.model[this.$attrs.valueKey];
    },
    // 经过转换后的options
    currentOptions() {
      const { optionLabel = 'label', optionValue = 'value' } = this.$attrs;
      try {
        const options = this.$attrs.options.map((option) => {
          return {
            ...option,
            optionValue:
              option[optionValue] === undefined ? '' : option[optionValue], // 字符串的情况下
            optionLabel: Array.isArray(optionLabel)
              ? this.$attrs.optionLabel.map((item) => option[item]).join('-')
              : option[optionLabel], // 如果是数组的情况下
          };
        });
        return options;
      } catch {
        return [];
      }
    },

    // 经过转换后的value
    currentValue() {
      // 兼职value
      if (this.$attrs.value !== undefined) return this.$attrs.value;
      // 判断是否有嵌套场景 TODO
      // 剔除空值
      if (!this.$attrs.valueKey) return '';
      // 如果是多个子级
      const prop = getPropByPath(
        this.baseForm.model,
        this.$attrs.valueKey,
        true,
      );
      return prop.o[prop.k];
    },
    // 选项clearable属性的传值修改
    currentClearable() {
      if (this.$attrs.clearable !== undefined) return this.$attrs.clearable;
      return true;
    },
    // 自动生成的placeholder
    currentPlaceholder() {
      if (this.$attrs.placeholder || this.$attrs.render)
        return this.$attrs.placeholder;

      const inputPlaceholder = [
        'input',
        'textarea',
        'autocomplete',
        'cascader',
      ];
      const selectPlaceholder = ['select', 'selectV2', 'selectGroup'];
      if (inputPlaceholder.includes(this.renderType)) {
        return `请输入${this.renderData.label}`;
      } else if (selectPlaceholder.includes(this.renderType)) {
        return `请选择${this.renderData.label}`;
      } else {
        return '';
      }
    },
  },
  methods: {
    onUpdateInputModelValue(attrs, value) {
      const valueKey = attrs.valueKey;
      if (!valueKey) return;
      this.baseForm.updateModel(valueKey, value);
    },
    /**
     * @description v-model 的语法糖
     */
    onInput(value) {
      // 首先判断有key
      const valueKey = this.$attrs.valueKey;
      if (!valueKey) return;
      this.baseForm.updateModel(valueKey, value);
    },
    isDef,
  },
};
</script>
<template>
  <div class="baseFormRender">
    <!-- 是否有render -->
    <RenderDom v-if="$attrs.render" :props="$attrs" :render="$attrs.render" />
    <!-- text -->
    <div v-else-if="renderType === 'text'" :style="styles">
      {{ currentValue }}
    </div>
    <Button
      v-else-if="renderType === 'button'"
      :style="styles"
      v-bind.prop="$attrs"
      v-on="$attrs"
    >
      {{ label }}
    </Button>
    <!-- 多个按钮 -->
    <template v-else-if="renderType === 'buttons'">
      <Button
        v-for="item in currentOptions"
        :key="item.value"
        v-bind="item"
        :style="styles"
        @click="item.click"
      >
        {{ item.label }}
      </Button>
    </template>

    <!-- 没有render -->
    <!-- inputNumber 类型 -->
    <InputNumber
      v-else-if="renderType === 'inputNumber'"
      :style="styles"
      v-bind.prop="$attrs"
      :value="baseForm.model[$attrs.valueKey]"
      @update:value="(val) => baseForm.updateModel($attrs.valueKey, val)"
    />
    <!-- input 类型 -->
    <!-- @input="(value)=>onInput(value.trim())" -->

    <Input
      v-bind.prop="$attrs"
      v-on="$attrs"
      v-else-if="renderType === 'input'"
      :placeholder="currentPlaceholder"
      :style="styles"
      :clearable="currentClearable"
      :value="baseForm.model[$attrs.valueKey]"
      @update:value="(val) => baseForm.updateModel($attrs.valueKey, val)"
    />
    <InputPassword
      v-else-if="renderType === 'password'"
      :placeholder="currentPlaceholder"
      :style="styles"
      v-bind.prop="$attrs"
      :clearable="currentClearable"
      :value="baseForm.model[$attrs.valueKey]"
      @update:value="(val) => baseForm.updateModel($attrs.valueKey, val)"
    />

    <!-- input-textarea 类型 -->
    <Textarea
      v-else-if="renderType === 'textarea'"
      :placeholder="currentPlaceholder"
      :style="styles"
      v-bind.prop="$attrs"
      :clearable="currentClearable"
      :value="baseForm.model[$attrs.valueKey]"
      @update:value="(val) => baseForm.updateModel($attrs.valueKey, val)"
    />
    <!-- select 类型  -->
    <Select
      v-else-if="renderType === 'select'"
      :placeholder="currentPlaceholder"
      :style="styles"
      :clearable="currentClearable"
      v-bind="$attrs"
      v-on="$attrs"
      :value="baseForm.model[$attrs.valueKey]"
      @update:value="(val) => baseForm.updateModel($attrs.valueKey, val)"
    />
    <!-- radio 类型 -->
    <RadioGroup
      v-else-if="renderType === 'radioGroup'"
      :size="$attrs.size || 'medium'"
      v-bind.prop="$attrs"
      :value="baseForm.model[$attrs.valueKey]"
      @update:value="(val) => baseForm.updateModel($attrs.valueKey, val)"
    >
      <Radio
        v-for="(option, index) in currentOptions"
        v-bind.prop="option"
        :key="isDef(option.optionValue) ? option.optionValue : index"
        :border="$attrs.isBorder || false"
        :label="option.optionValue"
      >
        <RenderDom
          v-if="option.renderLabel"
          :render="option.renderLabel"
          :props="option"
        />
        <span v-else>{{ option.optionLabel }}</span>
      </Radio>
    </RadioGroup>
    <!-- checkbox group -->
    <CheckboxGroup
      v-else-if="renderType === 'checkboxGroup'"
      :size="$attrs.size || 'medium'"
      v-bind.prop="$attrs"
      :value="baseForm.model[$attrs.valueKey]"
      @update:value="(val) => baseForm.updateModel($attrs.valueKey, val)"
    >
      <Checkbox
        v-for="(option, index) in currentOptions"
        :key="index"
        v-bind.prop="option"
        :label="option.optionValue"
      >
        {{ option.optionLabel }}
      </Checkbox>
    </CheckboxGroup>
    <Checkbox
      v-else-if="renderType === 'checkbox'"
      v-bind.prop="$attrs"
      :checked="baseForm.model[$attrs.valueKey]"
      @update:checked="(val) => baseForm.updateModel($attrs.valueKey, val)"
    >
      {{ $attrs.content }}
    </Checkbox>
    <!-- cascader -->
    <Cascader
      v-else-if="renderType === 'cascader'"
      :placeholder="currentPlaceholder"
      v-bind.prop="$attrs"
      :style="styles"
      :value="baseForm.model[$attrs.valueKey]"
      @update:value="(val) => baseForm.updateModel($attrs.valueKey, val)"
    />
    <!-- switch -->
    <Switch
      v-else-if="renderType === 'switch'"
      v-bind.prop="$attrs"
      :checked="baseForm.model[$attrs.valueKey]"
      @update:checked="(val) => baseForm.updateModel($attrs.valueKey, val)"
    />
    <!-- 时分秒 -->
    <TimePicker
      v-else-if="renderType === 'timePicker'"
      v-bind.prop="$attrs"
      :value="baseForm.model[$attrs.valueKey]"
      @update:value="(val) => baseForm.updateModel($attrs.valueKey, val)"
    />
    <!-- image -->
    <Image v-else-if="renderType === 'image'" v-bind.prop="$attrs" />
    <!-- select group -->
    <BaseSelectGroup
      v-else-if="renderType === 'selectGroup'"
      :placeholder="currentPlaceholder"
      v-bind="$attrs"
      v-on="$attrs"
      :style="styles"
      :value="baseForm.model[$attrs.valueKey]"
      @update:value="(val) => baseForm.updateModel($attrs.valueKey, val)"
    />

    <!-- Upload 上传组件 -->
    <BaseUpload
      v-else-if="renderType === 'upload'"
      v-bind="$attrs"
      v-on="$attrs"
      :style="styles"
      :file-list="baseForm.model[$attrs.valueKey] || []"
      :required="$attrs.required !== undefined ? $attrs.required : false"
      :auto-show-message="
        $attrs.autoShowMessage !== undefined ? $attrs.autoShowMessage : true
      "
    />

    <!-- 时间范围 -->
    <BaseDatePickerRange
      v-else-if="renderType === 'datePickerRange'"
      :style="styles"
      v-bind="$attrs"
      v-on="$attrs"
      :model-value="baseForm.model[$attrs.valueKey]"
      @update:modelValue="(val) => baseForm.updateModel($attrs.valueKey, val)"
    />
    <!-- 时间搜索 单个 -->
    <DatePicker
      v-else-if="renderType === 'datePicker'"
      v-bind.prop="$attrs"
      type="date"
      :style="styles"
      :value="baseForm.model[$attrs.valueKey]"
      @update:value="(val) => baseForm.updateModel($attrs.valueKey, val)"
    />
    <!-- 周选择器 -->
    <DatePicker
      v-else-if="renderType === 'weekPicker'"
      v-bind.prop="$attrs"
      type="week"
      :style="styles"
      :value="baseForm.model[$attrs.valueKey]"
      @update:value="(val) => baseForm.updateModel($attrs.valueKey, val)"
    />
    <!-- 月维度选择 -->
    <DatePicker
      v-else-if="renderType === 'monthPicker'"
      v-bind.prop="$attrs"
      type="month"
      :style="styles"
      :value="baseForm.model[$attrs.valueKey]"
      @update:value="(val) => baseForm.updateModel($attrs.valueKey, val)"
    />
  </div>
</template>

<style lang="scss" scoped>
.baseFormRender {
  .el-select__tags-text {
    max-width: 70px !important;
  }

  .el-form-item--mini.el-form-item,
  .el-form-item--small.el-form-item {
    margin-bottom: 0;
  }
}
</style>
