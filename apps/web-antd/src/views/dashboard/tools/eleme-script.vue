<script setup lang="ts">
import { ref } from 'vue';

import { Page } from '@vben/common-ui';

import { Button, Card, message, Textarea } from 'ant-design-vue';

const inputString = ref('');
const loading = ref(false);

const handleGenerate = async () => {
  if (!inputString.value.trim()) {
    message.warning('请输入门店ID字符串');
    return;
  }

  try {
    loading.value = true;
    const result = await window.ipcRenderer.invoke(
      'generate-eleme-activity',
      {
        inputString: inputString.value,
      },
    );

    if (result.success) {
      message.success(`成功生成文件: ${result.outputPath}`);
    } else if (result.canceled) {
      message.info('已取消保存');
    } else {
      message.error(`生成失败: ${result.message}`);
    }
  } catch (error: any) {
    message.error(`系统错误: ${error.message}`);
  } finally {
    loading.value = false;
  }
};
</script>

<template>
  <Page title="饿了么活动报名小工具">
    <div class="p-4">
      <Card title="批量生成报名表">
        <div class="mb-4">
          <div class="mb-2 text-gray-500">
            请输入商品UPC字符串，使用分号 (;) 分割。例如: 123456789012; 098765432109; 112233445566
          </div>
          <Textarea
            v-model:value="inputString"
            :rows="10"
            placeholder="在此粘贴商品UPC字符串..."
            allow-clear
          />
        </div>

        <div class="flex justify-end">
          <Button type="primary" :loading="loading" @click="handleGenerate">
            生成 Excel
          </Button>
        </div>
      </Card>
    </div>
  </Page>
</template>
