<script lang="ts" setup>
import { Page } from '@vben/common-ui';

import { message, Modal } from 'ant-design-vue';

import { useVbenForm } from '#/adapter/form';
import { lookupProductMasterRecords } from '#/api/product-master';
import { readFileAsBuffer } from '#/utils/file';

// 定义表单数据引用
const [Form, formApi] = useVbenForm({
  handleSubmit: onSubmit,
  schema: [
    {
      component: 'InputNumber',
      componentProps: {
        placeholder: '请输入活动初始库存',
        min: 0,
        precision: 0,
      },
      defaultValue: 9999,
      fieldName: 'initialStock',
      label: '初始库存',
      rules: 'required',
    },
    {
      component: 'Upload',
      componentProps: {
        accept: '.xlsx,.xls',
        beforeUpload: () => false, // 阻止自动上传
        dragger: true,
        maxCount: 1,
        multiple: false,
        text: '点击或拖拽上传Excel文件',
      },
      fieldName: 'file',
      label: '上传文件',
      rules: 'required',
    },
  ],
  submitButtonOptions: {
    content: '开始处理',
  },
});

// 提交处理
async function onSubmit(values: any) {
  try {
    const { file, initialStock } = values;

    if (!file || file.length === 0) {
      message.error('请上传Excel文件');
      return;
    }

    // 获取原生文件对象
    const uploadFile = file[0];
    const rawFile = uploadFile.originFileObj || uploadFile;

    await processExcelFile(rawFile, initialStock);
  } catch (error: any) {
    message.error(error.message);
  }
}

// Excel 处理器
const processExcelFile = async (file: File, initialStock: number) => {
  try {
    message.loading({
      content: `正在读取文件: ${file.name}...`,
      key: 'processBaohaojia',
    });

    const fileBuffer = await readFileAsBuffer(file);
    const codeResult = await window.ipcRenderer.invoke(
      'extract-eleme-baohaojia-codes',
      { fileBuffer },
    );

    if (!codeResult?.success) {
      throw new Error(codeResult?.message || '提取条码失败');
    }

    const productMasterRecords = await lookupProductMasterRecords(
      codeResult.data || [],
    );

    message.loading({ content: '正在处理数据...', key: 'processBaohaojia' });

    // 调用 IPC
    const result = await window.ipcRenderer.invoke('process-eleme-baohaojia', {
      fileBuffer,
      originalName: file.name.replace(/\.[^/.]+$/, ''),
      initialStock,
      productMasterRecords,
    });

    if (result.success) {
      if (result.canceled) {
        message.info({ content: '已取消保存', key: 'processBaohaojia' });
      } else {
        message.success({ content: '处理成功', key: 'processBaohaojia' });
        Modal.success({
          title: '处理完成',
          content:
            result.summary ||
            `上传文件已保存至: ${result.outputPath}\n审计文件已保存至: ${result.auditPath}`,
          okText: '知道了',
        });
        await formApi.resetForm();
      }
    } else {
      throw new Error(result.message || '处理失败');
    }
  } catch (error: any) {
    console.error(error);
    message.error({
      content: `处理失败: ${error.message}`,
      key: 'processBaohaojia',
    });
  }
};
</script>

<template>
  <Page title="饿了么爆好价活动助手">
    <div class="rounded-md bg-white p-4">
      <div class="mb-4 text-gray-500">
        <p>功能说明：</p>
        <ul class="list-inside list-disc">
          <li>
            上传Excel文件，自动提取"条码"、"活动价上限"、"是否组包"、"组包件数"列。
          </li>
          <li>
            自动查询商品总表的最小单位采购价，过滤最小单位采购价 >
            活动价的商品。
          </li>
          <li>生成两个文件：平台上传文件严格模板 + 审计文件。</li>
        </ul>
      </div>
      <Form />
    </div>
  </Page>
</template>
