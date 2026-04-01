<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import { Page } from '@vben/common-ui';

import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  DescriptionsItem,
  message,
  Row,
  Skeleton,
  Statistic,
  Tag,
} from 'ant-design-vue';

import { requestClient } from '#/api/request';

interface ActivitySummary {
  available: number;
  expired: number;
  p0: number;
  p1: number;
  p2: number;
  p3: number;
  signedUp: number;
  total: number;
}

interface RecordsResponse {
  total?: number;
}

interface LogsResponse {
  total?: number;
}

const router = useRouter();

const loading = ref(false);
const summary = ref<ActivitySummary>({
  total: 0,
  available: 0,
  signedUp: 0,
  expired: 0,
  p0: 0,
  p1: 0,
  p2: 0,
  p3: 0,
});
const recordTotal = ref(0);
const logTotal = ref(0);

async function loadOverview() {
  loading.value = true;
  try {
    const [activities, records, logs] = await Promise.all([
      requestClient.get<{ summary?: ActivitySummary }>('/eleme/activities'),
      requestClient.get<RecordsResponse>('/eleme/records'),
      requestClient.get<LogsResponse>('/eleme/logs'),
    ]);
    summary.value = {
      ...summary.value,
      ...activities.summary,
    };
    recordTotal.value = records.total || 0;
    logTotal.value = logs.total || 0;
  } catch (error) {
    console.error(error);
    message.error('加载饿了么运营概览失败');
  } finally {
    loading.value = false;
  }
}

function goTo(path: string) {
  void router.push(path);
}

onMounted(loadOverview);
</script>

<template>
  <Page title="饿了么运营">
    <div class="operation-page">
      <Alert
        type="info"
        show-icon
        message="当前页面作为饿了么运营总入口，活动列表、报名记录和执行日志统一从这里进入。"
      />

      <Skeleton :loading="loading" active>
        <Row :gutter="[16, 16]">
          <Col :xs="12" :sm="6">
            <Card class="stat-card" size="small">
              <Statistic title="活动总数" :value="summary.total" />
            </Card>
          </Col>
          <Col :xs="12" :sm="6">
            <Card class="stat-card" size="small">
              <Statistic
                title="可报名"
                :value="summary.available"
                :value-style="{ color: '#1677ff' }"
              />
            </Card>
          </Col>
          <Col :xs="12" :sm="6">
            <Card class="stat-card" size="small">
              <Statistic
                title="已报名"
                :value="summary.signedUp"
                :value-style="{ color: '#52c41a' }"
              />
            </Card>
          </Col>
          <Col :xs="12" :sm="6">
            <Card class="stat-card" size="small">
              <Statistic title="执行日志" :value="logTotal" />
            </Card>
          </Col>
        </Row>

        <Row :gutter="[16, 16]" class="mt-4">
          <Col :xs="24" :lg="8">
            <Card title="活动列表" :bordered="false" class="entry-card">
              <p class="entry-text">
                查看当前可报名活动、推荐等级、平台补贴和适用门店。
              </p>
              <div class="entry-footer">
                <Tag color="blue">可报名 {{ summary.available }}</Tag>
                <Button type="primary" @click="goTo('/activity/list')">
                  进入列表
                </Button>
              </div>
            </Card>
          </Col>
          <Col :xs="24" :lg="8">
            <Card title="报名记录" :bordered="false" class="entry-card">
              <p class="entry-text">
                查看已报名活动、报名日期、成本和门店覆盖情况。
              </p>
              <div class="entry-footer">
                <Tag color="green">记录 {{ recordTotal }}</Tag>
                <Button type="primary" @click="goTo('/activity/records')">
                  查看记录
                </Button>
              </div>
            </Card>
          </Col>
          <Col :xs="24" :lg="8">
            <Card title="执行日志" :bordered="false" class="entry-card">
              <p class="entry-text">
                查看活动执行过程中的日志、结果和来源，支持按日期筛选。
              </p>
              <div class="entry-footer">
                <Tag color="purple">日志 {{ logTotal }}</Tag>
                <Button type="primary" @click="goTo('/activity/logs')">
                  查看日志
                </Button>
              </div>
            </Card>
          </Col>
        </Row>

        <Card title="运营概览" :bordered="false" class="mt-4">
          <Descriptions :column="2" bordered size="small">
            <DescriptionsItem label="今日必报">
              {{ summary.p0 }}
            </DescriptionsItem>
            <DescriptionsItem label="值得报名">
              {{ summary.p1 }}
            </DescriptionsItem>
            <DescriptionsItem label="可选活动">
              {{ summary.p2 }}
            </DescriptionsItem>
            <DescriptionsItem label="暂不推荐">
              {{ summary.p3 }}
            </DescriptionsItem>
            <DescriptionsItem label="已过期">
              {{ summary.expired }}
            </DescriptionsItem>
            <DescriptionsItem label="默认入口"> 饿了么运营 </DescriptionsItem>
          </Descriptions>
        </Card>
      </Skeleton>
    </div>
  </Page>
</template>

<style scoped>
.operation-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.stat-card,
.entry-card {
  border-radius: 18px;
}

.entry-text {
  min-height: 44px;
  color: rgb(100 116 139);
  line-height: 1.7;
}

.entry-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 16px;
}
</style>
