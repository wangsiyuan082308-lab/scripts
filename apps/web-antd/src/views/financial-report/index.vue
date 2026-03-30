<script lang="ts" setup>
import type { UploadFile } from 'ant-design-vue';
import type { Dayjs } from 'dayjs';
import type {
  FinancialReportFile,
  FinancialStoreReport,
} from '#/api/financial-report';

import { computed, ref } from 'vue';

import { Page } from '@vben/common-ui';
import { downloadFileFromBlobPart } from '@vben/utils';

import dayjs from 'dayjs';
import {
  Button,
  Card,
  DatePicker,
  Empty,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Tag,
  Upload,
  message,
} from 'ant-design-vue';

import {
  buildFinancialStoreReports,
  parseFinancialExcelFile,
} from '#/api/financial-report';
import { exportToExcel } from '#/utils/export-excel';
import { readFileAsBuffer } from '#/utils/file';

const modalOpen = ref(false);
const uploadFiles = ref<UploadFile[]>([]);
const reportMonth = ref<Dayjs | undefined>(dayjs());
const searchKeyword = ref('');
const parsing = ref(false);
const parsedFiles = ref<FinancialReportFile[]>([]);
const storeReports = ref<FinancialStoreReport[]>([]);
const selectedStoreName = ref('');

const storeColumns = [
  { dataIndex: 'storeName', key: 'storeName', title: '门店名称', width: 220 },
  { dataIndex: 'rowCount', key: 'rowCount', title: '记录数', width: 110 },
  { dataIndex: 'amountSummaryText', key: 'amountSummaryText', title: '汇总' },
];

const filteredReports = computed(() => {
  const keyword = searchKeyword.value.trim();
  if (!keyword) return storeReports.value;
  return storeReports.value.filter((item) => item.storeName.includes(keyword));
});

const monthLabel = computed(() =>
  reportMonth.value ? reportMonth.value.format('YYYY-MM') : '',
);

const selectedStoreOptions = computed(() =>
  filteredReports.value.map((item) => ({
    label: item.storeName,
    value: item.storeName,
  })),
);

const selectedStore = computed(() => {
  const list = filteredReports.value;
  if (selectedStoreName.value) {
    const matched = list.find((item) => item.storeName === selectedStoreName.value);
    if (matched) return matched;
  }
  return list[0] || null;
});

const selectedStoreColumns = computed(() => {
  const firstRow = selectedStore.value?.rows?.[0];
  if (!firstRow) return [];
  return Object.keys(firstRow)
    .filter((key) => !key.startsWith('__'))
    .map((key) => ({
      dataIndex: key,
      key,
      title: key,
      width: 180,
    }));
});

const selectedStoreJson = computed(() =>
  JSON.stringify(selectedStore.value, null, 2),
);

function resetModalForm() {
  uploadFiles.value = [];
  reportMonth.value = dayjs();
}

function handleFileChange(info: { fileList: UploadFile[] }) {
  uploadFiles.value = info.fileList;
}

async function handleGenerateReport() {
  if (!reportMonth.value) {
    message.warning('请选择月份');
    return;
  }
  if (uploadFiles.value.length === 0) {
    message.warning('请上传 Excel 文件');
    return;
  }

  parsing.value = true;

  try {
    const files = uploadFiles.value
      .map((item) => item.originFileObj)
      .filter(Boolean) as File[];

    const parsed = await Promise.all(
      files.map(async (file) => {
        const buffer = await readFileAsBuffer(file);
        return parseFinancialExcelFile(buffer, file.name);
      }),
    );

    parsedFiles.value = parsed;
    storeReports.value = buildFinancialStoreReports(parsed, monthLabel.value);
    selectedStoreName.value = storeReports.value[0]?.storeName || '';
    modalOpen.value = false;

    message.success(`已生成 ${storeReports.value.length} 个门店报表`);
  } catch (error: any) {
    console.error(error);
    message.error(error?.message || '生成失败');
  } finally {
    parsing.value = false;
  }
}

function handleOpenModal() {
  resetModalForm();
  modalOpen.value = true;
}

function handleDownloadJson() {
  if (!selectedStore.value) {
    message.warning('当前没有可下载的数据');
    return;
  }

  downloadFileFromBlobPart({
    fileName: `${selectedStore.value.storeName}_${monthLabel.value || '财务报表'}.json`,
    source: new Blob([selectedStoreJson.value], {
      type: 'application/json;charset=utf-8',
    }),
  });
}

async function handleDownloadExcel() {
  if (!selectedStore.value) {
    message.warning('当前没有可下载的数据');
    return;
  }

  const columns = selectedStoreColumns.value;
  const rows = selectedStore.value.rows.map((row) => {
    const current: Record<string, any> = {};
    for (const column of columns) {
      current[column.dataIndex] = row[column.dataIndex];
    }
    return current;
  });

  await exportToExcel(
    columns.map((column) => ({
      dataIndex: column.dataIndex,
      title: column.title,
      width: 24,
    })),
    rows,
    `${selectedStore.value.storeName}_${monthLabel.value || '财务报表'}`,
  );
}
</script>

<template>
  <Page title="财务报表">
    <div class="financial-report-page">
      <Card :bordered="false" class="report-card">
        <div class="entry-bar">
          <div>
            <div class="entry-title">财务报表</div>
            <div class="entry-desc">
              点击按钮，在弹框里上传 Excel 并选择月份即可生成。
            </div>
          </div>
          <Button type="primary" @click="handleOpenModal">上传并生成</Button>
        </div>
      </Card>

      <Card v-if="storeReports.length > 0" :bordered="false" class="report-card">
        <div class="toolbar">
          <Space wrap>
            <Tag color="processing">{{ monthLabel }}</Tag>
            <Tag>{{ parsedFiles.length }} 个文件</Tag>
            <Tag color="success">{{ storeReports.length }} 个门店</Tag>
          </Space>
          <Space wrap>
            <Input
              v-model:value="searchKeyword"
              allow-clear
              placeholder="搜索门店"
              style="width: 220px"
            />
            <Select
              v-model:value="selectedStoreName"
              :options="selectedStoreOptions"
              allow-clear
              placeholder="选择门店"
              style="width: 220px"
            />
            <Button :disabled="!selectedStore" @click="handleDownloadExcel">
              下载 Excel
            </Button>
            <Button :disabled="!selectedStore" @click="handleDownloadJson">
              下载 JSON
            </Button>
          </Space>
        </div>

        <Table
          :columns="storeColumns"
          :data-source="filteredReports"
          :pagination="{ pageSize: 8 }"
          row-key="storeName"
          class="result-table"
        />
      </Card>

      <Card v-if="selectedStore" :bordered="false" class="report-card">
        <div class="detail-title">{{ selectedStore.storeName }}</div>
        <Table
          :columns="selectedStoreColumns"
          :data-source="selectedStore.rows"
          :pagination="{ pageSize: 8 }"
          :scroll="{ x: 1200 }"
          row-key="__rowKey"
        />
      </Card>

      <Card v-if="!storeReports.length" :bordered="false" class="report-card empty-card">
        <Empty description="暂未生成财务报表" />
      </Card>

      <Modal
        v-model:open="modalOpen"
        title="上传财务报表 Excel"
        :confirm-loading="parsing"
        ok-text="生成"
        cancel-text="取消"
        @ok="handleGenerateReport"
      >
        <div class="modal-form">
          <div class="field-label">报表月份</div>
          <DatePicker
            v-model:value="reportMonth"
            picker="month"
            style="width: 100%"
            placeholder="选择月份"
          />

          <div class="field-label">Excel 文件</div>
          <Upload.Dragger
            accept=".xlsx,.xls"
            :before-upload="() => false"
            :file-list="uploadFiles"
            multiple
            @change="handleFileChange"
          >
            <p>点击或拖拽上传 Excel</p>
          </Upload.Dragger>
        </div>
      </Modal>
    </div>
  </Page>
</template>

<style scoped>
.financial-report-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.report-card {
  border-radius: 20px;
}

:deep(.report-card .ant-card-body) {
  padding: 20px;
}

.entry-bar,
.toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.entry-title,
.detail-title {
  font-size: 20px;
  font-weight: 700;
}

.entry-desc {
  margin-top: 6px;
  color: rgb(100 116 139);
  font-size: 14px;
}

.modal-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.field-label {
  font-size: 13px;
  font-weight: 600;
}

.empty-card {
  padding-top: 10px;
}

.result-table {
  margin-top: 16px;
}
</style>
