<script lang="ts" setup>
import { Page, useVbenForm } from '@vben/common-ui';

import { message, Modal } from 'ant-design-vue';

// 工具函数：读取文件为 ArrayBuffer
function readFileAsBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as ArrayBuffer);
    reader.onerror = (e) => reject(e);
    reader.readAsArrayBuffer(file);
  });
}

const [Form, formApi] = useVbenForm({
  handleSubmit: onSubmit,
  schema: [
    {
      component: 'RadioGroup',
      componentProps: {
        options: [
          { label: '牵牛花', value: 'qianniuhua' },
          { label: '翱象', value: 'aoxiang' },
        ],
      },
      defaultValue: 'aoxiang',
      fieldName: 'platform',
      label: '目标平台',
      rules: 'required',
    },
    {
      component: 'InputNumber',
      componentProps: {
        min: 0,
        max: 100,
        precision: 2,
        addonAfter: '%',
        step: 0.1,
      },
      defaultValue: 2,
      fieldName: 'rate',
      label: '管理费率',
      rules: 'required',
      help: '默认费率为 2%',
    },
    {
      component: 'Upload',
      componentProps: {
        accept: '.xlsx,.xls',
        beforeUpload: () => false, // 阻止自动上传
        dragger: true,
        maxCount: 1,
        text: '点击或拖拽上传订单报表',
      },
      fieldName: 'file',
      label: '上传报表',
      rules: 'required',
    },
  ],
  showResetButton: false,
  submitButtonOptions: {
    content: '开始计算',
  },
});

async function onSubmit(values: any) {
  try {
    const { file, platform, rate } = values;

    if (!file) {
      message.error('请上传文件');
      return;
    }

    message.loading({ content: '正在计算...', key: 'processFinance' });

    // 读取文件
    const fileObj = Array.isArray(file) ? file[0] : file;
    const fileBuffer = await readFileAsBuffer(fileObj.originFileObj || fileObj);

    // 调用 Electron API
    const result = await window.electronAPI.invoke('generate-finance-report', {
      fileBuffer,
      platform,
      rate,
    });

    if (result.success) {
      message.success({ content: '计算完成并已保存', key: 'processFinance' });
      Modal.success({
        title: '处理成功',
        content: result.summary,
        okText: '好的',
      });
      await formApi.resetForm();
    } else if (result.canceled) {
      message.warning({ content: '已取消保存', key: 'processFinance' });
    } else {
      throw new Error(result.message);
    }

  } catch (error: any) {
    message.error({
      content: `计算失败: ${error.message}`,
      key: 'processFinance',
    });
  }
}
</script>

<template>
  <Page title="财务报表计算工具">
    <div class="rounded-md bg-white p-4 dark:bg-zinc-800">
      <div class="mb-4 text-gray-500">
        <p>功能说明：</p>
        <ul class="list-inside list-disc">
          <li>支持上传牵牛花或翱象的订单报表 Excel。</li>
          <li>自动统计总销售额（根据“实付金额/订单金额”列）。</li>
          <li>根据设定的费率（默认 2%）自动计算应收管理费。</li>
          <li>生成包含汇总和明细的 Excel 报表。</li>
        </ul>
      </div>
      <Form />
    </div>
  </Page>
</template>
