<script setup lang="ts">
import { useRouter } from 'vue-router';

import { Page } from '@vben/common-ui';

import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  DescriptionsItem,
  Empty,
  Row,
  Tag,
} from 'ant-design-vue';

const router = useRouter();

function goToEleme() {
  void router.push('/activity/eleme');
}
</script>

<template>
  <Page title="美团运营">
    <div class="operation-page">
      <Alert
        type="warning"
        show-icon
        message="美团运营入口已建立，当前前后端还没有接入独立的美团运营数据链路。"
      />

      <Row :gutter="[16, 16]">
        <Col :xs="24" :lg="14">
          <Card title="当前状态" :bordered="false" class="panel-card">
            <Descriptions :column="1" bordered size="small">
              <DescriptionsItem label="菜单状态">
                <Tag color="processing">已上线</Tag>
              </DescriptionsItem>
              <DescriptionsItem label="数据接入">
                <Tag color="warning">待接入</Tag>
              </DescriptionsItem>
              <DescriptionsItem label="建议动作">
                先补齐美团活动列表、报名记录、执行日志接口，再在本页接入实际运营看板。
              </DescriptionsItem>
            </Descriptions>
          </Card>
        </Col>
        <Col :xs="24" :lg="10">
          <Card title="后续规划" :bordered="false" class="panel-card">
            <div class="plan-list">
              <div class="plan-item">活动列表</div>
              <div class="plan-item">报名记录</div>
              <div class="plan-item">执行日志</div>
              <div class="plan-item">平台专项配置</div>
            </div>
            <div class="mt-4">
              <Button @click="goToEleme">参考饿了么运营结构</Button>
            </div>
          </Card>
        </Col>
      </Row>

      <Card :bordered="false" class="panel-card">
        <Empty description="美团运营能力建设中，当前先保留平台入口和扩展位。" />
      </Card>
    </div>
  </Page>
</template>

<style scoped>
.operation-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.panel-card {
  border-radius: 18px;
}

.plan-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.plan-item {
  padding: 14px 16px;
  border: 1px solid rgb(226 232 240);
  border-radius: 14px;
  color: rgb(15 23 42);
  font-weight: 500;
  text-align: center;
  background: rgb(248 250 252);
}

@media (max-width: 768px) {
  .plan-list {
    grid-template-columns: 1fr;
  }
}
</style>
