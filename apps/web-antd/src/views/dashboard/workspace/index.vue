<script lang="ts" setup>
import type {
  WorkbenchProjectItem,
  WorkbenchQuickNavItem,
  WorkbenchTodoItem,
  WorkbenchTrendItem,
} from '@vben/common-ui';

import { useRouter } from 'vue-router';

import { WorkbenchHeader, WorkbenchProject } from '@vben/common-ui';
import { preferences } from '@vben/preferences';
import { useUserStore } from '@vben/stores';
import { openWindow } from '@vben/utils';

const userStore = useUserStore();
const router = useRouter();

// --- 数据定义 ---

// 3. 待办事项 (Todo)
const todoItems: WorkbenchTodoItem[] = [
  {
    completed: false,
    content: '检查饿了么Cookie是否过期',
    date: '2024-03-24',
    title: 'Cookie 检查',
  },
  {
    completed: true,
    content: '备份上周的采购数据',
    date: '2024-03-23',
    title: '数据备份',
  },
  {
    completed: false,
    content: '更新自动化脚本到最新版本',
    date: '2024-03-25',
    title: '系统更新',
  },
  {
    completed: false,
    content: '审核新的补货建议表',
    date: '2024-03-24',
    title: '业务审核',
  },
];

// 4. 最新动态 (Trends)
const trendItems: WorkbenchTrendItem[] = [
  {
    avatar: userStore.userInfo?.avatar || preferences.app.defaultAvatar,
    content: '成功执行了 <a>采购计划生成</a> 任务，导出了 12 个文件',
    date: '刚刚',
    title: userStore.userInfo?.realName || '管理员',
  },
  {
    avatar: 'https://api.dicebear.com/7.x/miniavs/svg?seed=2',
    content: '系统自动完成了 <a>饿了么自动撤单</a> (模拟模式)',
    date: '1小时前',
    title: '系统机器人',
  },
  {
    avatar: userStore.userInfo?.avatar || preferences.app.defaultAvatar,
    content: '更新了 <a>爆好价活动助手</a> 的配置文件',
    date: '昨天',
    title: userStore.userInfo?.realName || '管理员',
  },
  {
    avatar: 'https://api.dicebear.com/7.x/miniavs/svg?seed=4',
    content: '发布了 ScriptAi v1.2.0 版本，新增了多项功能',
    date: '3天前',
    title: 'ScriptAi Team',
  },
];

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
  {
    color: '#00BFFF',
    content: '财务报表计算工具',
    date: '2024-03-25',
    group: '财务工具',
    icon: 'ri:money-cny-box-fill',
    title: '财务报表计算',
    url: '/dashboard/tools/finance-report',
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
