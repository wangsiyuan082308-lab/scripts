<script lang="ts" setup>
import { reactive, ref } from 'vue';

import { Page } from '@vben/common-ui';

import {
  Alert,
  Button,
  Card,
  Descriptions,
  DescriptionsItem,
  Form,
  FormItem,
  InputNumber,
  message,
} from 'ant-design-vue';

import {
  getProductCompareAiConfig,
  saveProductCompareAiConfig,
  type ProductCompareAiConfig,
} from '#/api/decision-center';

const loading = ref(false);
const saving = ref(false);
const config = reactive<ProductCompareAiConfig>({
  apiKey: '',
  baseUrl: '',
  matchPromptTemplate: '',
  model: '',
  newProductMonthlySalesThreshold: 10,
});

async function loadConfig() {
  loading.value = true;
  try {
    const result = await getProductCompareAiConfig();
    Object.assign(config, result);
  } catch (error: any) {
    message.error(error.message || '获取决策中心配置失败');
  } finally {
    loading.value = false;
  }
}

async function saveConfig() {
  saving.value = true;
  try {
    const result = await saveProductCompareAiConfig({
      ...config,
    });
    Object.assign(config, result);
    message.success('决策中心配置已保存');
  } catch (error: any) {
    message.error(error.message || '保存决策中心配置失败');
  } finally {
    saving.value = false;
  }
}

void loadConfig();
</script>

<template>
  <Page title="决策中心">
    <div class="decision-center-page">
      <Card :bordered="false" class="center-card" :loading="loading">
        <div class="center-head">
          <div>
            <div class="center-title">商品比对决策配置</div>
            <div class="center-subtitle">
              当前先支持维护“新品引入候选”的月销判断阈值，后续可以继续扩展更多决策规则。
            </div>
          </div>
          <Button type="primary" :loading="saving" @click="saveConfig">
            保存配置
          </Button>
        </div>

        <Alert
          type="info"
          show-icon
          class="mb-4"
          message="未匹配商品在商品比对中会按这里的月销阈值进行判断，超过阈值会归类为新品引入候选。"
        />

        <Form layout="vertical">
          <FormItem label="新品引入月销阈值">
            <InputNumber
              v-model:value="config.newProductMonthlySalesThreshold"
              :min="0"
              :precision="0"
              style="width: 100%"
            />
          </FormItem>
        </Form>
      </Card>

      <Card :bordered="false" class="center-card">
        <Descriptions :column="1" bordered size="small" title="当前模型信息">
          <DescriptionsItem label="模型">
            {{ config.model || '-' }}
          </DescriptionsItem>
          <DescriptionsItem label="Base URL">
            {{ config.baseUrl || '-' }}
          </DescriptionsItem>
        </Descriptions>
      </Card>
    </div>
  </Page>
</template>

<style scoped>
.decision-center-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.center-card {
  border-radius: 20px;
}

.center-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 20px;
}

.center-title {
  color: #0f172a;
  font-size: 18px;
  font-weight: 600;
}

.center-subtitle {
  margin-top: 6px;
  color: #64748b;
  line-height: 1.6;
}

@media (max-width: 960px) {
  .center-head {
    flex-direction: column;
  }
}
</style>
