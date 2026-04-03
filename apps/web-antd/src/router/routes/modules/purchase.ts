import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    meta: {
      icon: 'lucide:shopping-cart',
      order: 4,
      title: '采购中心',
    },
    name: 'Purchase',
    path: '/purchase',
    redirect: '/purchase/tasks',
    children: [
      {
        name: 'PurchaseOverview',
        path: '/purchase/overview',
        component: () => import('#/views/purchase/overview.vue'),
        meta: {
          hideInMenu: true,
          icon: 'lucide:layout-dashboard',
          title: '采购总览',
          order: 0,
        },
      },
      {
        name: 'PurchaseWorkbench',
        path: '/purchase/workbench',
        component: () => import('#/views/purchase/workbench.vue'),
        meta: {
          hideInMenu: true,
          icon: 'lucide:workflow',
          title: '采购作业台',
          order: 5,
        },
      },
      {
        meta: {
          icon: 'ant-design:schedule-outlined',
          title: '采购任务',
          order: 0,
        },
        name: 'ProcurementTask',
        path: '/purchase/tasks',
        component: () => import('#/views/procurement-task/index.vue'),
      },
      {
        meta: {
          icon: 'ant-design:table-outlined',
          title: '门店售罄日志',
          order: 10,
        },
        name: 'ProcurementDailySummary',
        path: '/purchase/daily-summary',
        component: () => import('#/views/purchase/daily-summary/index.vue'),
      },
      {
        meta: {
          hideInMenu: true,
          icon: 'lucide:bell-ring',
          title: '提醒中心',
          order: 20,
        },
        name: 'ProcurementAlerts',
        path: '/purchase/alerts',
        component: () => import('#/views/purchase/alerts/index.vue'),
      },
      {
        meta: {
          hideInMenu: true,
          icon: 'lucide:settings-2',
          title: '基础配置',
          order: 30,
        },
        name: 'ProcurementConfig',
        path: '/purchase/config',
        component: () => import('#/views/purchase/config/index.vue'),
      },
      {
        meta: {
          hideInMenu: true,
          title: '采购任务管理',
        },
        name: 'ProcurementTaskLegacy',
        path: '/procurement-task',
        component: () => import('#/views/procurement-task/index.vue'),
      },
    ],
  },
];

export default routes;
