<script lang="ts" setup>
import type {
  WorkbenchProjectItem,
  WorkbenchQuickNavItem,
} from '@vben/common-ui';

import { useRouter } from 'vue-router';

import { WorkbenchHeader, WorkbenchProject } from '@vben/common-ui';
import { preferences } from '@vben/preferences';
import { useUserStore } from '@vben/stores';
import { openWindow } from '@vben/utils';

const userStore = useUserStore();
const router = useRouter();

// --- 数据定义 ---

// 1. 核心工具 (Projects)
const projectItems: WorkbenchProjectItem[] = [
  {
    color: '#1D6F42',
    content: '一键将采购计划转换为标准Excel格式',
    date: '2024-03-20',
    group: '数据处理',
    icon: 'ri:file-excel-2-fill',
    title: '采购计划Excel转换',
    url: '/dashboard/tools/excel-convert',
  },
  {
    color: '#0080FF',
    content: '自动转换饿了么活动报名脚本数据',
    date: '2024-03-21',
    group: '自动化脚本',
    icon: 'ri:code-box-fill',
    title: '活动报名脚本转换',
    url: '/dashboard/tools/eleme-script',
  },
  {
    color: '#FF6600',
    content: '快速生成饿了么爆好价活动报名表格',
    date: '2024-03-22',
    group: '活动助手',
    icon: 'ri:shopping-bag-3-fill',
    title: '爆好价活动助手',
    url: '/dashboard/tools/eleme-baohaojia',
  },
  {
    color: '#8A2BE2',
    content: '批量生成牵牛花/翱象采购计划',
    date: '2024-03-23',
    group: '采购计划',
    icon: 'ri:file-list-3-fill',
    title: '采购计划生成',
    url: '/dashboard/tools/procurement-plan',
  },
  {
    color: '#E53E3E',
    content: '饿了么商品毛利分析工具',
    date: '2024-03-24',
    group: '数据分析',
    icon: 'ri:pie-chart-2-fill',
    title: '订单毛利分析',
    url: '/dashboard/tools/eleme-margin-analyzer',
  },
];

// 2. 快捷导航 (Quick Nav)
const quickNavItems: WorkbenchQuickNavItem[] = [
  {
    color: '#1ab192',
    icon: 'ri:settings-3-line',
    title: '系统设置',
    url: '/preferences/global', // 假设的路由
  },
  {
    color: '#707070',
    icon: 'ri:github-fill',
    title: 'GitHub',
    url: 'https://github.com/wangsiyuan082308-lab/scripts',
  },
  {
    color: '#409eff',
    icon: 'ri:book-read-line',
    title: '使用文档',
    url: 'https://doc.scriptai.com', // 假设链接
  },
  {
    color: '#e6a23c',
    icon: 'ri:customer-service-2-line',
    title: '联系支持',
    url: 'mailto:support@scriptai.com',
  },
];

// --- 导航逻辑 ---

function navTo(nav: WorkbenchProjectItem | WorkbenchQuickNavItem) {
  if (nav.url?.startsWith('http')) {
    openWindow(nav.url);
    return;
  }

  if (nav.url?.startsWith('/')) {
    router.push(nav.url).catch((error) => {
      console.error('Navigation failed:', error);
    });
  } else {
    console.warn(`Unknown URL for navigation item: ${nav.title} -> ${nav.url}`);
  }
}
</script>

<template>
  <div class="p-5">
    <!-- 头部欢迎区 -->
    <WorkbenchHeader
      :avatar="userStore.userInfo?.avatar || preferences.app.defaultAvatar"
    >
      <template #title>
        早安, {{ userStore.userInfo?.realName }}, 愿你今天的工作高效又顺心！
      </template>
    </WorkbenchHeader>

    <div class="mt-5 flex flex-col gap-5 lg:flex-row">
      <!-- 左侧主区域 (70%) -->
      <div class="flex flex-1 flex-col gap-5">
        <!-- 效率工具 -->
        <WorkbenchProject
          :items="projectItems"
          title="效率工具"
          class="rounded-lg shadow-sm"
          @click="navTo"
        />

        <!-- 最新动态 -->
        <WorkbenchTrends
          :items="trendItems"
          title="最新动态"
          class="rounded-lg shadow-sm"
        />
      </div>

      <!-- 右侧侧边栏 (30%) -->
      <div class="flex w-full flex-col gap-5 lg:w-1/3">
        <!-- 快捷导航 -->
        <WorkbenchQuickNav
          :items="quickNavItems"
          title="快捷导航"
          class="rounded-lg shadow-sm"
          @click="navTo"
        />

        <!-- 待办事项 -->
        <WorkbenchTodo
          :items="todoItems"
          title="待办清单"
          class="rounded-lg shadow-sm"
        />

        <!-- 广告/插画占位 -->
        <div
          class="card-box rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 p-4 text-white shadow-md"
        >
          <h3 class="mb-2 text-lg font-bold">ScriptAi Pro</h3>
          <p class="mb-4 text-sm opacity-90">
            解锁更多高级自动化功能，提升您的业务效率。
          </p>
          <button
            class="rounded-md bg-white px-4 py-2 text-sm font-medium text-indigo-600 transition hover:bg-opacity-90"
          >
            了解更多
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 简单的卡片通用样式补丁 */
:deep(.vben-workbench-project),
:deep(.vben-workbench-trends),
:deep(.vben-workbench-quick-nav),
:deep(.vben-workbench-todo) {
  @apply border border-border bg-white dark:bg-[#151515];
}
</style>
