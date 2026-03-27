<script lang="ts" setup>
import { Page } from '@vben/common-ui';

import { Card, message, Modal } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';

import { readFileAsBuffer } from '#/utils/file';

// 定义表单数据引用

const [Form, formApi] = useVbenForm({
  handleSubmit: onSubmit,
  schema: [
    {
      component: 'RadioGroup',
      componentProps: {
        options: [{ label: '翱象', value: 'aoxiang' }],
      },
      defaultValue: 'aoxiang',
      fieldName: 'type',
      label: '目标平台',
      rules: 'required',
    },
    {
      component: 'Upload',
      componentProps: {
        accept: '.xlsx,.xls',
        beforeUpload: () => false, // 阻止自动上传
        dragger: true,
        multiple: true,
        text: '点击或拖拽上传文件 (支持多个)',
      },
      fieldName: 'files',
      label: '上传文件',
      rules: 'required',
    },
  ],
  submitButtonOptions: {
    content: '生成计划',
  },
});

// 确认转换
async function onSubmit(values: any) {
  try {
    const { files, type } = values;

    if (!files || files.length === 0) {
      message.error('请至少上传一个文件');
      return;
    }

    // 1. 读取文件流
    const fileBuffers = await Promise.all(
      (Array.isArray(files) ? files : [files]).map((file: any) =>
        readFileAsBuffer(file.originFileObj || file),
      ),
    );

    message.loading({ content: '正在处理数据...', key: 'processPlan' });

    // 调用 IPC
    const result = await window.ipcRenderer.invoke(
      'generate-procurement-plan',
      {
        buffers: fileBuffers,
        type,
      },
    );

    if (result.canceled) {
      message.info({ content: '已取消保存', key: 'processPlan' });
      return;
    }

    if (result.success) {
      message.success({ content: '生成成功', key: 'processPlan' });
      Modal.success({
        title: '生成完成',
        content: result.summary || `文件已保存至: ${result.outputPath}`,
        okText: '知道了',
      });
      await formApi.resetForm();
    } else {
      throw new Error(result.message || '生成失败');
    }
  } catch (error: any) {
    console.error(error);
    message.error({
      content: `生成失败: ${error.message}`,
      key: 'processPlan',
    });
  }
}
</script>

<template>
  <Page title="采购计划生成工具">
    <Card class="p-4" title="采购计划生成工具">
      <div class="mb-4 text-gray-500">
        <p>功能说明：</p>
        <ul class="list-inside list-disc">
          <li>批量上传一个或多个牵牛花采购计划模版 Excel 文件。</li>
          <li>当前仅支持生成翱象采购计划。</li>
          <li>系统将自动合并数据并按现有翱象模版导出文件。</li>
        </ul>
      </div>
      <Form />
    </Card>
  </Page>
</template>
