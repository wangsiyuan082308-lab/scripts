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

// 这是一个示例数据，实际项目中需要根据实际情况进行调整
// url 也可以是内部路由，在 navTo 方法中识别处理，进行内部跳转
// 例如：url: /dashboard/workspace
const projectItems: WorkbenchProjectItem[] = [
  {
    color: '#1D6F42',
    content: '采购计划Excel转换',
    date: '2021-04-01',
    group: '采购脚本',
    icon: 'ri:file-excel-2-fill',
    title: '采购计划Excel转换',
    url: '/dashboard/tools/excel-convert',
  },
  {
    color: '#0080FF',
    content: '现在的你决定将来的你。',
    date: '2021-04-01',
    group: '采购脚本',
    icon: 'ri:code-box-fill',
    title: '饿了么活动报名脚本转换',
    url: '/dashboard/tools/eleme-script',
  },
  {
    color: '#FF6600',
    content: '生成饿了么爆好价活动报名Excel',
    date: '2024-03-20',
    group: '采购脚本',
    icon: 'ri:shopping-bag-3-fill',
    title: '饿了么爆好价活动助手',
    url: '/dashboard/tools/eleme-baohaojia',
  },
  {
    color: '#8A2BE2',
    content: '批量生成牵牛花/翱象采购计划',
    date: '2024-03-21',
    group: '采购脚本',
    icon: 'ri:file-list-3-fill',
    title: '采购计划生成',
    url: '/dashboard/tools/procurement-plan',
  },
];

// 同样，这里的 url 也可以使用以 http 开头的外部链接
const router = useRouter();

// 这是一个示例方法，实际项目中需要根据实际情况进行调整
// This is a sample method, adjust according to the actual project requirements
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
    <WorkbenchHeader
      :avatar="userStore.userInfo?.avatar || preferences.app.defaultAvatar"
    >
      <template #title>
        早安, {{ userStore.userInfo?.realName }}, 开始您一天的工作吧！
      </template>
      <template #description> 今日晴，20℃ - 32℃！ </template>
    </WorkbenchHeader>

    <div class="mt-5 flex flex-col lg:flex-row">
      <div class="mr-4 w-full lg:w-3/5">
        <WorkbenchProject :items="projectItems" title="项目" @click="navTo" />
      </div>
    </div>
  </div>
</template>
