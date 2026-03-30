<script setup lang="ts">
import type { UploadFile, UploadProps } from 'ant-design-vue';

import { computed, ref, watch } from 'vue';

import { Button, message, Upload } from 'ant-design-vue';

/**
 * BaseUpload 上传组件
 * 支持文件上传、预览、删除等功能
 */

export interface BaseUploadProps {
  // 上传地址
  action?: string;
  // 接受的文件类型
  accept?: string;
  // 是否支持多选
  multiple?: boolean;
  // 最大上传数量
  maxCount?: number;
  // 最大文件大小（MB）
  maxSize?: number;
  // 文件列表样式：text | picture | picture-card
  listType?: 'picture' | 'picture-card' | 'text';
  // 是否显示上传按钮
  showUploadButton?: boolean;
  // 按钮文字
  buttonText?: string;
  // 是否禁用
  disabled?: boolean;
  // 提示文字
  tip?: string;
  // 自定义上传方法
  customRequest?: ((options: any) => void) | undefined;
  // 上传前的钩子
  beforeUpload?: ((file: File) => boolean | Promise<boolean>) | undefined;
  // 上传状态改变的回调
  onChange?: ((info: any) => void) | undefined;
  // 自定义文件类型校验错误提示
  acceptErrorMessage?: string;
  // 自定义文件大小校验错误提示
  sizeErrorMessage?: string;
  // 自定义请求头
  headers?: Record<string, string>;
  // 上传时附带的额外参数
  data?: Record<string, any>;
  // 是否必填（自动验证）
  required?: boolean;
  // 是否自动显示验证提示
  autoShowMessage?: boolean;
  // 是否自动上传
  // true: 选择文件后立即上传
  // false: 只选择文件不上传，文件流保存在 fileList 中
  //        - 可以调用 startUpload() 手动上传（使用组件的上传方法）
  //        - 或在表单提交时获取文件流统一上传（由业务代码处理）
  autoUpload?: boolean;
}

const props = withDefaults(defineProps<BaseUploadProps>(), {
  action: '/api/opm/upload',
  accept: '*',
  multiple: false,
  maxCount: 1,
  maxSize: 10,
  listType: 'text',
  showUploadButton: true,
  buttonText: '点击上传',
  disabled: false,
  tip: '',
  customRequest: undefined,
  beforeUpload: undefined,
  onChange: undefined,
  acceptErrorMessage: '文件类型不符合要求',
  sizeErrorMessage: '文件大小超出限制',
  headers: () => ({}),
  data: () => ({}),
  required: false,
  autoShowMessage: false,
  autoUpload: true,
});

const emit = defineEmits<{
  (e: 'update:fileList', value: UploadFile[]): void;
  (e: 'change', value: any): void;
  (e: 'success', value: any): void;
  (e: 'error', value: any): void;
  (e: 'validate', result: { message: string; valid: boolean }): void;
}>();

// 文件列表
const fileList = ref<UploadFile[]>([]);

// 监听外部传入的文件列表
const modelValue = defineModel<UploadFile[]>('fileList', { default: [] });

watch(
  modelValue,
  (newVal) => {
    if (newVal) {
      fileList.value = newVal;
    }
  },
  { immediate: true, deep: true },
);

watch(
  fileList,
  (newVal) => {
    modelValue.value = newVal;
    emit('update:fileList', newVal);
  },
  { deep: true },
);

// 上传按钮是否显示
const showButton = computed(() => {
  if (!props.showUploadButton) return false;
  return fileList.value.length < props.maxCount;
});

// 文件类型校验
const validateFileType = (file: any): boolean => {
  if (props.accept === '*') return true;

  const acceptTypes = props.accept.split(',').map((type) => type.trim());
  const fileExtension = `.${file.name.split('.').pop()?.toLowerCase()}`;
  const fileType = file.type;

  return acceptTypes.some((type) => {
    if (type.startsWith('.')) {
      return fileExtension === type.toLowerCase();
    }
    return fileType.includes(type.replace('*', ''));
  });
};

// 文件大小校验
const validateFileSize = (file: any): boolean => {
  const size = file.size / 1024 / 1024;
  return size <= props.maxSize;
};

// 上传前的校验
const handleBeforeUpload: UploadProps['beforeUpload'] = async (file) => {
  // 文件类型校验
  if (!validateFileType(file)) {
    message.error(props.acceptErrorMessage);
    return false;
  }

  // 文件大小校验
  if (!validateFileSize(file)) {
    message.error(`${props.sizeErrorMessage}（最大 ${props.maxSize}MB）`);
    return false;
  }

  // 自定义上传前钩子
  if (props.beforeUpload) {
    const result = await props.beforeUpload(file);
    if (!result) return false;
  }

  // ✅ 如果不是自动上传，阻止上传行为（文件流会保存在 fileList 中）
  if (!props.autoUpload) {
    return false;
  }

  return true;
};

// 上传状态改变
const handleChange: UploadProps['onChange'] = (info: any) => {
  const { status, response } = info.file;

  if (status === 'uploading') {
    // 上传中
  }

  if (status === 'done') {
    if (response.code !== 200) {
      props.autoShowMessage && message.error(`${info.file.name} 文件上传失败`);
      emit('error', info.file);
      return;
    }
    props.autoShowMessage && message.success(`${info.file.name} 文件上传成功`);
    emit('success', response);
  }

  if (status === 'error') {
    props.autoShowMessage && message.error(`${info.file.name} 文件上传失败`);
    emit('error', info.file);
  }

  // 触发 onChange 事件
  if (props.onChange) {
    props.onChange(info);
  }

  emit('change', info);
};

// 删除文件
const handleRemove: UploadProps['onRemove'] = (file: any) => {
  const index = fileList.value.indexOf(file);
  if (index !== -1) {
    fileList.value.splice(index, 1);
  }
};

// 预览文件
const handlePreview: UploadProps['onPreview'] = async (file: any) => {
  // 如果是图片，打开新窗口预览
  if (file.url || file.preview) {
    window.open(file.url || file.preview);
  } else {
    message.info('暂不支持预览该文件类型');
  }
};

// 自定义上传请求
const handleCustomRequest: UploadProps['customRequest'] = async (
  options: any,
) => {
  if (props.customRequest) {
    // 使用外部传入的自定义上传方法
    props.customRequest(options);
  } else {
    // 默认上传逻辑：使用 FormData 和 fetch
    const { onSuccess, onError, onProgress, file } = options;
    try {
      // 创建 FormData
      const formData = new FormData();
      formData.append('file', file);

      // 添加额外的参数
      if (props.data) {
        Object.keys(props.data).forEach((key) => {
          formData.append(key, props.data![key]);
        });
      }

      // 使用 XMLHttpRequest 上传文件（支持进度）
      const xhr = new XMLHttpRequest();

      // 监听上传进度
      xhr.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) {
          const percent = Math.round((event.loaded / event.total) * 100);
          onProgress?.({ percent });
        }
      });

      // 监听上传完成
      xhr.addEventListener('load', () => {
        const response = JSON.parse(xhr.responseText);

        if (xhr.status >= 200 && xhr.status < 300 && response.code !== 200) {
          try {
            onSuccess?.(response);
          } catch {
            // 如果响应不是 JSON，返回简单的成功对象
            onSuccess?.({ url: props.action, status: 'success' });
          }
        } else {
          const error = new Error(`上传失败: ${xhr.status} ${xhr.statusText}`);
          onError?.(error);
        }
      });

      // 监听上传错误
      xhr.addEventListener('error', () => {
        const error = new Error('网络错误，请检查网络连接');
        onError?.(error);
      });

      // 监听上传超时
      xhr.addEventListener('timeout', () => {
        const error = new Error('上传超时');
        onError?.(error);
      });

      // 发送请求
      xhr.open('POST', props.action);

      // 设置超时时间（30秒）
      xhr.timeout = 30_000;

      // 设置自定义请求头
      if (props.headers && Object.keys(props.headers).length > 0) {
        Object.keys(props.headers).forEach((key) => {
          const value = props.headers?.[key];
          if (value) {
            xhr.setRequestHeader(key, value);
          }
        });
      }

      // 发送请求
      xhr.send(formData);
    } catch (error) {
      onError?.(error as Error);
    }
  }
};

// 手动上传所有待上传的文件（仅在 autoUpload: false 时使用）
const startUpload = async () => {
  if (props.autoUpload) {
    message.warning('当前为自动上传模式，无需手动上传');
    return { success: false, message: '当前为自动上传模式' };
  }

  // 过滤出待上传的文件（status 为 ready 的文件）
  const pendingFiles = fileList.value.filter(
    (file) => !file.status,
  );

  if (pendingFiles.length === 0) {
    message.warning('没有需要上传的文件');
    return { success: false, message: '没有需要上传的文件' };
  }

  // 手动触发每个文件的上传（使用组件的上传方法）
  const results = await Promise.allSettled(
    pendingFiles.map(async (file) => {
      return new Promise((resolve, reject) => {
        // 更新文件状态为上传中
        file.status = 'uploading';

        const options = {
          file: file.originFileObj,
          onSuccess: (response: any) => {
            file.status = 'done';
            file.response = response;
            if (props.autoShowMessage) {
              message.success(`${file.name} 上传成功`);
            }
            resolve(response);
          },
          onError: (error: Error) => {
            file.status = 'error';
            file.error = error;
            message.error(`${file.name} 上传失败`);
            reject(error);
          },
          onProgress: (event: { percent: number }) => {
            file.percent = event.percent;
          },
        };

        handleCustomRequest(options as any);
      });
    }),
  );

  const successCount = results.filter((r) => r.status === 'fulfilled').length;
  const failCount = results.filter((r) => r.status === 'rejected').length;
  return failCount === 0
    ? { success: true, message: `${successCount} 个文件上传成功` }
    : {
        success: false,
        message: `${successCount} 个成功，${failCount} 个失败`,
      };
};

// 验证文件列表状态
const validateFileList = () => {
  // 如果不是必填，且没有文件，则验证通过
  if (!props.required && (!fileList.value || fileList.value.length === 0)) {
    return { valid: true, message: '验证通过', files: [] };
  }

  // 如果是必填，检查是否有文件
  if (props.required && (!fileList.value || fileList.value.length === 0)) {
    const result = { valid: false, message: '请先选择文件', files: [] };
    if (props.autoShowMessage) {
      message.warning(result.message);
    }
    emit('validate', result);
    return result;
  }

  // ✅ 如果不是自动上传模式，检查文件状态
  if (!props.autoUpload) {
    // 获取已选择的文件（status 为 ready 或有 originFileObj）
    const selectedFiles = fileList.value.filter(
      (file) => !file.status || file.originFileObj,
    );

    // 如果有已选择的文件，验证通过（可以在表单提交时统一上传）
    if (selectedFiles.length > 0) {
      const result = { valid: true, message: '验证通过', files: selectedFiles };
      emit('validate', result);
      return result;
    }

    // 如果没有文件，验证失败
    const result = { valid: false, message: '请先选择文件', files: [] };
    if (props.autoShowMessage) {
      message.warning(result.message);
    }
    emit('validate', result);
    return result;
  }

  // 检查是否有正在上传的文件
  const uploadingFiles = fileList.value.filter(
    (file) => file.status === 'uploading',
  );
  if (uploadingFiles.length > 0) {
    const result = {
      valid: false,
      message: '文件正在上传中，请稍候',
      files: [],
    };
    if (props.autoShowMessage) {
      message.warning(result.message);
    }
    emit('validate', result);
    return result;
  }

  // 检查是否有上传失败的文件
  const errorFiles = fileList.value.filter((file) => file.status === 'error');
  if (errorFiles.length > 0) {
    const result = {
      valid: false,
      message: `文件 ${errorFiles[0]?.name ?? ''} 上传失败，请重新上传`,
      files: [],
    };
    if (props.autoShowMessage) {
      message.error(result.message);
    }
    emit('validate', result);
    return result;
  }

  // 检查是否有上传成功的文件
  const successFiles = fileList.value.filter((file) => file.status === 'done');
  if (successFiles.length === 0) {
    const result = {
      valid: false,
      message: props.autoUpload ? '请等待文件上传完成' : '请先上传文件',
      files: [],
    };
    if (props.autoShowMessage) {
      message.warning(result.message);
    }
    emit('validate', result);
    return result;
  }

  const result = { valid: true, message: '验证通过', files: successFiles };
  emit('validate', result);
  return result;
};

// 暴露方法给父组件
defineExpose({
  fileList,
  clearFiles: () => {
    fileList.value = [];
  },
  validateFileList,
  startUpload,
});
</script>

<template>
  <!-- :custom-request="handleCustomRequest" -->

  <div class="base-upload">
    <Upload
      v-model:file-list="fileList"
      :action="action"
      :accept="accept"
      :multiple="multiple"
      :max-count="maxCount"
      :list-type="listType"
      :disabled="disabled"
      :before-upload="handleBeforeUpload"
      :on-change="handleChange"
      :on-remove="handleRemove"
      :on-preview="handlePreview"
      :show-upload-list="{
        showPreviewIcon: true,
        showRemoveIcon: !disabled,
      }"
    >
      <Button v-if="showButton" :disabled="disabled">
        {{ buttonText }}
      </Button>

      <!-- picture-card 模式 -->
      <div
        v-if="listType === 'picture-card' && showButton"
        class="upload-card-button"
      >
        <span class="upload-card-icon">+</span>
        <div class="upload-card-text">{{ buttonText }}</div>
      </div>
    </Upload>

    <!-- 提示文字 -->
    <div v-if="tip" class="upload-tip">
      {{ tip }}
    </div>
  </div>
</template>

<style scoped>
.base-upload {
  width: 100%;
}

.upload-tip {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.5;
  color: #999;
}

.upload-card-button {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

.upload-card-icon {
  font-size: 32px;
  color: #999;
}

.upload-card-text {
  margin-top: 8px;
  font-size: 14px;
  color: #666;
}

/* 适配暗色主题 */
[data-theme='dark'] .upload-tip {
  color: rgb(255 255 255 / 45%);
}

[data-theme='dark'] .upload-card-text {
  color: rgb(255 255 255 / 65%);
}
</style>
