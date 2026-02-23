import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    meta: {
      icon: 'lucide:bar-chart-3',
      order: 3,
      title: '财务管理',
    },
    name: 'Finance',
    path: '/finance',
    children: [
      {
        name: 'FinanceOverview',
        path: '/finance/overview',
        component: () => import('#/views/finance/overview.vue'),
        meta: {
          icon: 'lucide:layout-dashboard',
          title: '财务总览',
        },
      },
      {
        name: 'FinanceReports',
        path: '/finance/reports',
        component: () => import('#/views/finance/report-list.vue'),
        meta: {
          icon: 'lucide:file-spreadsheet',
          title: '报表列表',
        },
      },
      {
        name: 'FinanceStoreConfig',
        path: '/finance/store-config',
        component: () => import('#/views/finance/store-config.vue'),
        meta: {
          icon: 'lucide:settings',
          title: '门店配置',
        },
      },
    ],
  },
];

export default routes;
