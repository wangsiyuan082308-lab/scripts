<script lang="ts" setup>
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';

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

const router = useRouter();

interface ProductCompareAiConfig {
  apiKey: string;
  baseUrl: string;
  matchPromptTemplate: string;
  model: string;
  newProductMonthlySalesThreshold: number;
}

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
    const result = await window.ipcRenderer.invoke('get-product-compare-ai-config');
    if (!result.success) {
      throw new Error(result.message || '获取决策中心配置失败');
    }
    Object.assign(config, result.data);
  } catch (error: any) {
    message.error(error.message || '获取决策中心配置失败');
  } finally {
    loading.value = false;
  }
}

async function saveConfig() {
  saving.value = true;
  try {
    const result = await window.ipcRenderer.invoke('save-product-compare-ai-config', {
      ...config,
    });
    if (!result.success) {
      throw new Error(result.message || '保存决策中心配置失败');
    }
    Object.assign(config, result.data);
    message.success('决策中心配置已保存');
  } catch (error: any) {
    message.error(error.message || '保存决策中心配置失败');
  } finally {
    saving.value = false;
  }
}

function goToSiteSelection() {
  void router.push('/decision-center/site-selection');
}

void loadConfig();
</script>

<template>
  <Page title="模型配置">
    <div class="decision-center-page">
      <Card :bordered="false" class="center-card" :loading="loading">
        <div class="center-head">
          <div>
            <div class="center-title">本地模型配置</div>
            <div class="center-subtitle">
              当前决策中心会复用这里的本地模型信息，商品比对和其他 AI 能力都会优先读取这套配置。
            </div>
          </div>
          <div class="center-actions">
            <Button @click="goToSiteSelection">前往门店选址</Button>
            <Button type="primary" :loading="saving" @click="saveConfig">
              保存配置
            </Button>
          </div>
        </div>

        <Alert
          type="info"
          show-icon
          class="mb-4"
          message="未匹配商品在商品比对中会按这里的月销阈值进行判断，超过阈值会归类为新品引入候选。其他 AI 能力也会优先复用这里保存的本地模型配置。"
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

.center-actions {
  display: flex;
  gap: 12px;
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

  .center-actions {
    width: 100%;
  }
}
</style>
