<script setup lang="tsx">
import type {
  SiteSelectionRecommendation,
  SiteSelectionTask,
} from '#/api/site-selection';

import { computed, h, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';

import { Page } from '@vben/common-ui';

import {
  Button,
  Descriptions,
  DescriptionsItem,
  Drawer,
  Form,
  Input,
  message,
  Modal,
  Popconfirm,
  Select,
  Table,
  Tag,
} from 'ant-design-vue';

import {
  createSiteSelectionTask,
  deleteSiteSelectionTask,
  executeSiteSelectionTask,
  getSiteSelectionTaskDetail,
  getSiteSelectionTasks,
  updateSiteSelectionTask,
} from '#/api/site-selection';
import SimpleTemplate from '#/components/base/SimpleTemplate/index.vue';

const router = useRouter();
const tableRef = ref();
const modalOpen = ref(false);
const drawerOpen = ref(false);
const submitting = ref(false);
const detailLoading = ref(false);
const editingId = ref('');
const detailTask = ref<null | SiteSelectionTask>(null);

const filters = reactive({
  keyword: '',
  page: 1,
  pageSize: 10,
  status: '',
});

const form = reactive({
  query: '',
  scenePreference: '',
  taskName: '',
});

const sceneOptions = [
  { label: '不限', value: '' },
  { label: '购物中心', value: '购物中心' },
  { label: '大学城', value: '大学城' },
  { label: '夜市旅游', value: '夜市旅游' },
  { label: '医院社区', value: '医院社区' },
];

const statusOptions = [
  { label: '草稿', value: 'draft' },
  { label: '待执行', value: 'pending' },
  { label: '执行中', value: 'running' },
  { label: '执行成功', value: 'succeeded' },
  { label: '执行失败', value: 'failed' },
];

const searchFormItems = [
  {
    label: '关键词',
    child: {
      placeholder: '任务名、选址需求、结果结论',
      renderType: 'input',
      valueKey: 'keyword',
    },
  },
  {
    label: '状态',
    child: {
      options: statusOptions,
      renderType: 'select',
      valueKey: 'status',
    },
  },
  {
    renderType: 'suffixButton',
    options: [
      {
        label: '搜索',
        renderType: 'search',
        type: 'primary',
      },
      {
        label: '重置',
        renderType: 'reset',
      },
    ],
  },
];

function refreshList() {
  tableRef.value?.search?.();
}

function resetForm() {
  form.query = '';
  form.scenePreference = '';
  form.taskName = '';
}

function statusColor(status: string) {
  switch (status) {
    case 'succeeded':
      return 'success';
    case 'failed':
      return 'error';
    case 'running':
      return 'processing';
    case 'pending':
      return 'warning';
    default:
      return 'default';
  }
}

function statusLabel(status: string) {
  return statusOptions.find((item) => item.value === status)?.label || status;
}

function recommendationColor(value: string) {
  if (value.includes('首选')) return 'green';
  if (value.includes('备选')) return 'blue';
  return 'default';
}

function openCreate() {
  editingId.value = '';
  resetForm();
  modalOpen.value = true;
}

function openEdit(task: SiteSelectionTask) {
  editingId.value = task.id;
  form.query = task.query;
  form.scenePreference = task.scenePreference || '';
  form.taskName = task.taskName;
  modalOpen.value = true;
}

async function openDetail(taskId: string) {
  detailLoading.value = true;
  drawerOpen.value = true;
  try {
    detailTask.value = await getSiteSelectionTaskDetail(taskId);
  } finally {
    detailLoading.value = false;
  }
}

async function handleSubmit() {
  if (!`${form.query}`.trim()) {
    message.warning('请先输入选址需求');
    return;
  }

  submitting.value = true;
  try {
    const payload = {
      query: form.query,
      scenePreference: form.scenePreference,
      taskName: form.taskName,
    };

    if (editingId.value) {
      await updateSiteSelectionTask(editingId.value, payload);
      message.success('选址任务已更新');
    } else {
      await createSiteSelectionTask(payload);
      message.success('选址任务已创建');
    }

    modalOpen.value = false;
    resetForm();
    refreshList();
  } finally {
    submitting.value = false;
  }
}

async function handleDelete(task: SiteSelectionTask) {
  await deleteSiteSelectionTask(task.id);
  message.success('选址任务已删除');
  refreshList();
}

async function handleExecute(task: SiteSelectionTask) {
  const result = await executeSiteSelectionTask(task.id);
  if (result.status === 'pending' || result.status === 'running') {
    message.success('选址任务已提交，后台开始执行');
  } else if (result.status === 'failed') {
    message.error(result.lastError || '选址任务执行失败');
  } else {
    message.success('选址任务状态已更新');
  }
  refreshList();
  if (drawerOpen.value && detailTask.value?.id === task.id) {
    detailTask.value = result;
  }
}

function goToModelConfig() {
  void router.push('/decision-center/index');
}

const resultColumns = [
  {
    dataIndex: 'recommendation',
    title: '推荐位次',
    width: 100,
    render: (value: string) => (
      <Tag color={recommendationColor(value)}>
        {value || '-'}
      </Tag>
    ),
  },
  { dataIndex: 'locationName', title: '候选点位', minWidth: 160 },
  { dataIndex: 'businessAreaType', title: '场景类型', width: 120 },
  {
    dataIndex: 'score',
    title: '评分',
    width: 90,
    render: (_value: number, record: SiteSelectionRecommendation) =>
      `${record.score}/${record.grade}`,
  },
  {
    dataIndex: 'estimatedDailyOrders',
    title: '预估日单',
    width: 100,
    render: (value: null | number) => (value ? `${value}单` : '-'),
  },
  {
    dataIndex: 'summary',
    title: '结论',
    minWidth: 260,
  },
];

const columns = [
  { dataIndex: 'taskName', title: '任务名称', minWidth: 180 },
  { dataIndex: 'query', title: '选址需求', minWidth: 240 },
  {
    dataIndex: 'scenePreference',
    title: '偏好场景',
    width: 120,
    render: (_h: any, { text }: { text?: string }) => text || '不限',
  },
  {
    dataIndex: 'status',
    title: '状态',
    width: 110,
    render: (_h: any, { text }: { text?: string }) => (
      <Tag color={statusColor(text || '')}>
        {statusLabel(text || '')}
      </Tag>
    ),
  },
  {
    dataIndex: 'latestResult',
    title: '市场结论',
    width: 120,
    render: (_h: any, { text }: { text?: SiteSelectionTask['latestResult'] }) =>
      text?.marketVerdict || '-',
  },
  {
    dataIndex: 'latestResult',
    title: '首推点位',
    minWidth: 180,
    render: (_h: any, { text }: { text?: SiteSelectionTask['latestResult'] }) =>
      text?.items?.[0]?.locationName || '-',
  },
  {
    dataIndex: 'lastRunAt',
    title: '最近执行',
    width: 180,
    render: (_h: any, { text }: { text?: string }) => text || '-',
  },
  {
    title: '操作',
    width: 260,
    fixed: 'right',
    render: (_value: unknown, ctx: { record?: SiteSelectionTask; row?: SiteSelectionTask }) => {
      const row = ctx?.row || ctx?.record;
      if (!row) return null;
      return h('div', { class: 'flex gap-1' }, [
        h(
          Button,
          {
            type: 'link',
            onClick: () => openDetail(row.id),
          },
          () => '查看',
        ),
        h(
          Button,
          {
            type: 'link',
            onClick: () => handleExecute(row),
          },
          () => '执行',
        ),
        h(
          Button,
          {
            type: 'link',
            onClick: () => openEdit(row),
          },
          () => '编辑',
        ),
        h(
          Popconfirm,
          {
            title: '确认删除该选址任务?',
            onConfirm: () => handleDelete(row),
          },
          {
            default: () =>
              h(
                Button,
                {
                  danger: true,
                  type: 'link',
                },
                () => '删除',
              ),
          },
        ),
      ]);
    },
  },
];

const headerOptions = [
  {
    label: '新建选址任务',
    renderType: 'button',
    type: 'primary',
    click: openCreate,
  },
  {
    label: '模型配置',
    renderType: 'button',
    click: goToModelConfig,
  },
];

const drawerResultRows = computed(() => detailTask.value?.latestResult?.items || []);

const serveMethods = async (params: any) => {
  const response = await getSiteSelectionTasks(params?.data || {});
  return {
    list: response.items || [],
    total: response.total || 0,
  };
};
</script>

<template>
  <Page title="门店选址">
    <SimpleTemplate
      ref="tableRef"
      v-model="filters"
      row-key="id"
      :search-form-items="searchFormItems"
      :columns="columns"
      :serve-methods="serveMethods"
      :header-options="headerOptions"
      :show-page="false"
    />

    <Modal
      v-model:open="modalOpen"
      :title="editingId ? '编辑选址任务' : '新建选址任务'"
      :confirm-loading="submitting"
      ok-text="保存"
      @ok="handleSubmit"
    >
      <Form layout="vertical">
        <Form.Item label="任务名称">
          <Input v-model:value="form.taskName" placeholder="不填则按需求自动生成" />
        </Form.Item>
        <Form.Item label="选址需求" required>
          <Input
            v-model:value="form.query"
            placeholder="例如：分析浙江湖州首店选址，优先大学城或购物中心"
          />
        </Form.Item>
        <Form.Item label="偏好场景">
          <Select v-model:value="form.scenePreference" :options="sceneOptions" />
        </Form.Item>
      </Form>
    </Modal>

    <Drawer
      v-model:open="drawerOpen"
      :title="detailTask?.taskName || '选址任务详情'"
      width="72%"
    >
      <template v-if="detailTask">
        <Descriptions :column="2" bordered size="small">
          <DescriptionsItem label="任务名称">
            {{ detailTask.taskName }}
          </DescriptionsItem>
          <DescriptionsItem label="状态">
            <Tag :color="statusColor(detailTask.status)">
              {{ statusLabel(detailTask.status) }}
            </Tag>
          </DescriptionsItem>
          <DescriptionsItem label="选址需求">
            {{ detailTask.query }}
          </DescriptionsItem>
          <DescriptionsItem label="偏好场景">
            {{ detailTask.scenePreference || '不限' }}
          </DescriptionsItem>
          <DescriptionsItem label="最近执行">
            {{ detailTask.lastRunAt || '-' }}
          </DescriptionsItem>
          <DescriptionsItem label="市场结论">
            {{ detailTask.latestResult?.marketVerdict || '-' }}
          </DescriptionsItem>
          <DescriptionsItem :span="2" label="失败原因">
            {{ detailTask.lastError || '-' }}
          </DescriptionsItem>
          <DescriptionsItem :span="2" label="城市摘要">
            {{ detailTask.latestResult?.citySummary || '-' }}
          </DescriptionsItem>
          <DescriptionsItem :span="2" label="执行假设">
            {{
              detailTask.latestResult?.assumptions?.length
                ? detailTask.latestResult?.assumptions.join('；')
                : '-'
            }}
          </DescriptionsItem>
        </Descriptions>

        <div class="mt-4">
          <Table
            :columns="resultColumns"
            :data-source="drawerResultRows"
            :loading="detailLoading"
            :pagination="false"
            row-key="id"
            :scroll="{ x: 920 }"
            size="small"
          />
        </div>
      </template>
    </Drawer>
  </Page>
</template>
