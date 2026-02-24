import type { RouteRecordRaw } from 'vue-router';

import { $t } from '#/locales';

const routes: RouteRecordRaw[] = [
  {
    meta: {
      icon: 'lucide:layout-dashboard',
      order: -1,
      title: $t('page.dashboard.title'),
    },
    name: 'Dashboard',
    path: '/dashboard',
    children: [
      {
        name: 'Workspace',
        path: '/dashboard/workspace',
        component: () => import('#/views/dashboard/workspace/index.vue'),
        meta: {
          affixTab: true,
          icon: 'carbon:workspace',
          title: $t('page.dashboard.workspace'),
        },
      },
      {
        name: 'ExcelConvert',
        path: '/dashboard/tools/excel-convert',
        component: () => import('#/views/dashboard/tools/excel-convert.vue'),
        meta: {
          hideInMenu: true,
          title: '采购计划Excel转换',
        },
      },
      {
        name: 'ElemeScript',
        path: '/dashboard/tools/eleme-script',
        component: () => import('#/views/dashboard/tools/eleme-script.vue'),
        meta: {
          hideInMenu: true,
          title: '饿了么活动报名脚本转换',
        },
      },
      {
        name: 'ElemeBaohaojia',
        path: '/dashboard/tools/eleme-baohaojia',
        component: () => import('#/views/dashboard/tools/eleme-baohaojia.vue'),
        meta: {
          hideInMenu: true,
          title: '饿了么爆好价活动助手',
        },
      },
      {
        name: 'ProcurementPlan',
        path: '/dashboard/tools/procurement-plan',
        component: () => import('#/views/dashboard/tools/procurement-plan.vue'),
        meta: {
          hideInMenu: true,
          title: '采购计划生成',
        },
      },
    ],
  },
];

export default routes;
