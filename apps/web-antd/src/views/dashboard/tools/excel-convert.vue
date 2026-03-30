<script lang="ts" setup>
import { Page } from '@vben/common-ui';

import { useVbenForm } from '#/adapter/form';

import { message, Modal } from 'ant-design-vue';

import { readFileAsBuffer } from '#/utils/file';

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
        beforeUpload: () => false,
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
  submitButtonOptions: {
    content: '开始转换',
  },
});

async function onSubmit(values: any) {
  try {
    const { files, mode } = values;

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

    const { listFile, refFile } = analyzeFiles(files, mode);
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

const analyzeFiles = (files: File[], mode: string) => {
  const isNoCompare = mode === 'none';
  if (!files || files.length < (isNoCompare ? 1 : 2)) {
    throw new Error(
      isNoCompare
        ? '请上传【补货清单】Excel 文件'
        : '请至少上传两个 Excel 文件，系统会优先按文件名辅助识别，再由内容校验确认',
    );
  }

  const normalizedFiles = files.map((file: any) => file.originFileObj || file);
  const listFile =
    normalizedFiles.find((file) => file.name.includes('补货清单')) || normalizedFiles[0] || null;
  const refFile =
    isNoCompare
      ? null
      : normalizedFiles.find((file) => file.name.includes('补货参考')) ||
        normalizedFiles.find((file) => file !== listFile) ||
        null;

  if (!listFile) {
    throw new Error('未找到可处理的补货清单文件');
  }

  if (!isNoCompare && !refFile) {
    throw new Error('未找到可处理的补货参考文件');
  }

  return { listFile, refFile };
};

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

    const listBuffer = await readFileAsBuffer(listFile);
    const refBuffer = refFile
      ? await readFileAsBuffer(refFile)
      : new ArrayBuffer(0);

    message.loading({ content: '正在处理数据...', key: 'processExcel' });

    const result = await window.ipcRenderer.invoke('process-excel-buffers', {
      listBuffer,
      refBuffer,
      mode,
      originalName: listFile.name.replace(/\.[^/.]+$/, ''),
    });

    if (result.success) {
      if (result.canceled) {
        message.info({ content: '已取消保存', key: 'processExcel' });
        return false;
      }

      message.success({ content: '处理成功', key: 'processExcel' });
      Modal.success({
        title: '处理完成',
        content: result.summary || `文件已保存至: ${result.outputPath}`,
        okText: '知道了',
      });
      return true;
    }

    throw new Error(result.message || '处理失败');
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
          <li>按周/按月模式请上传【补货清单】和【补货参考】两个 Excel 文件。</li>
          <li>系统会优先参考文件名分配文件，但最终以表头内容识别和校验结果为准。</li>
          <li>文件名不规范也可上传；若内容无法识别，会返回明确的字段缺失提示。</li>
        </ul>
      </div>
      <Form />
    </div>
  </Page>
</template>
