<script lang="ts" setup>
import { Page, useVbenForm } from '@vben/common-ui';

import { message, Modal } from 'ant-design-vue';

// 定义表单数据引用

const [Form, formApi] = useVbenForm({
  handleSubmit: onSubmit,
  schema: [
    {
      component: 'RadioGroup',
      componentProps: {
        options: [
          { label: '按周比对', value: 'week' },
          { label: '按月比对', value: 'month' },
          { label: '不比对', value: 'none' },
        ],
      },
      defaultValue: 'week',
      fieldName: 'mode',
      label: '比对模式',
      rules: 'required',
    },
    {
      component: 'Upload',
      componentProps: {
        accept: '.xlsx,.xls',
        beforeUpload: () => false, // 阻止自动上传
        dragger: true,
        maxCount: 2,
        multiple: true,
        text: '点击或拖拽上传文件',
      },
      fieldName: 'files',
      label: '上传文件',
      rules: 'required',
    },
  ],
  showResetButton: false,
  submitButtonOptions: {
    content: '开始转换',
  },
});

// 确认转换
async function onSubmit(values: any) {
  try {
    const { files, mode } = values;

    // 二次确认：检查是否已完成补货检查
    await new Promise((resolve, reject) => {
      Modal.confirm({
        title: '操作确认',
        content:
          '请确认【补货清单】已完成“批量补货检查”后再进行转换，否则会导致数据不准确。',
        okText: '已确认，继续',
        cancelText: '取消',
        onOk: () => resolve(true),
        onCancel: () => reject(new Error('用户取消操作')),
      });
    });

    // 1. 分析文件
    const { listFile, refFile } = analyzeFiles(files, mode);

    // 2. 处理转换
    const success = await processExcelFiles(listFile, refFile, mode);
    if (success) {
      await formApi.resetForm();
    }
  } catch (error: any) {
    if (error.message !== '用户取消操作') {
      message.error(error.message);
    }
  }
}

// 文件分析器：识别补货清单和补货参考
const analyzeFiles = (files: File[], mode: string) => {
  const isNoCompare = mode === 'none';
  // 如果是不比对模式，只需要补货清单
  if (!files || files.length < (isNoCompare ? 1 : 2)) {
    throw new Error(
      isNoCompare
        ? '请上传【补货清单】Excel文件'
        : '请确保上传了两个文件（补货清单和补货参考）',
    );
  }

  let listFile: File | null = null;
  let refFile: File | null = null;

  files.forEach((file: any) => {
    const name = file.name;
    // Ant Design Vue Upload 组件返回的文件对象中，原始文件在 originFileObj 中
    // 如果是 beforeUpload 返回的原始文件，则直接使用 file
    const rawFile = file.originFileObj || file;

    if (name.includes('补货清单')) {
      listFile = rawFile;
    } else if (name.includes('补货参考')) {
      refFile = rawFile;
    }
  });

  if (!listFile) {
    throw new Error('文件识别失败，请检查文件名，必须包含“补货清单”');
  }

  if (isNoCompare) {
    // 强制置空，即使识别到了也不使用
    refFile = null;
  } else if (!refFile) {
    throw new Error('文件识别失败，请检查文件名，必须包含“补货参考”');
  }

  return { listFile, refFile };
};

// 辅助函数：读取文件为 ArrayBuffer
const readFileAsBuffer = (file: File): Promise<ArrayBuffer> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      if (e.target?.result) {
        resolve(e.target.result as ArrayBuffer);
      } else {
        reject(new Error('File read failed'));
      }
    };
    reader.onerror = (e) => reject(e);
    reader.readAsArrayBuffer(file);
  });
};

// Excel 处理器：调用 Electron 进行转换
const processExcelFiles = async (
  listFile: File,
  refFile: File | null,
  mode: string,
) => {
  try {
    message.loading({
      content: `正在读取文件...\n清单: ${listFile.name}\n参考: ${
        refFile?.name || '无'
      }`,
      key: 'processExcel',
    });

    // 1. 读取文件流
    const listBuffer = await readFileAsBuffer(listFile);
    const refBuffer = refFile
      ? await readFileAsBuffer(refFile)
      : new ArrayBuffer(0);

    message.loading({ content: '正在处理数据...', key: 'processExcel' });

    // 调用 IPC
    const result = await window.ipcRenderer.invoke('process-excel-buffers', {
      listBuffer,
      refBuffer,
      mode,
      // 去除文件后缀名，避免生成的默认文件名包含双重后缀
      originalName: listFile.name.replace(/\.[^/.]+$/, ''),
    });

    if (result.success) {
      if (result.canceled) {
        message.info({ content: '已取消保存', key: 'processExcel' });
        return false;
      } else {
        message.success({ content: '处理成功', key: 'processExcel' });
        Modal.success({
          title: '处理完成',
          content: result.summary || `文件已保存至: ${result.outputPath}`,
          okText: '知道了',
        });
        return true;
      }
    } else {
      throw new Error(result.message || '处理失败');
    }
  } catch (error: any) {
    console.error(error);
    message.error({
      content: `处理失败: ${error.message}`,
      key: 'processExcel',
    });
    return false;
  }
};
</script>

<template>
  <Page title="采购计划Excel转换">
    <div class="p-4 bg-white rounded-md">
      <div class="mb-4 text-gray-500 ">
        <p>功能说明：</p>
        <ul class="list-inside list-disc">
          <li>请同时上传【补货清单】和【补货参考】两个Excel文件。</li>
          <li>文件名必须包含“补货清单”和“补货参考”字样以自动识别。</li>
        </ul>
      </div>
      <Form />
    </div>
  </Page>
</template>

