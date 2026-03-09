import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    meta: {
      icon: 'lucide:wallet',
      order: 2,
      title: '提现管理',
    },
    name: 'Withdrawal',
    path: '/withdrawal',
    children: [
      {
        name: 'WithdrawalOverview',
        path: '/withdrawal/overview',
        component: () => import('#/views/withdrawal/overview.vue'),
        meta: {
          icon: 'lucide:layout-dashboard',
          title: '提现总览',
        },
      },
      {
        name: 'WithdrawalStoreStats',
        path: '/withdrawal/store-stats',
        component: () => import('#/views/withdrawal/store-stats.vue'),
        meta: {
          icon: 'lucide:store',
          title: '门店统计',
        },
      },
      {
        name: 'WithdrawalTask',
        path: '/withdrawal/task',
        component: () => import('#/views/withdrawal/task.vue'),
        meta: {
          icon: 'lucide:list-checks',
          title: '提现任务',
        },
      },
      {
        name: 'WithdrawalLogs',
        path: '/withdrawal/logs',
        component: () => import('#/views/withdrawal/logs.vue'),
        meta: {
          icon: 'lucide:scroll-text',
          title: '运行日志',
        },
      },
      {
        name: 'WithdrawalOptimization',
        path: '/withdrawal/optimization',
        component: () => import('#/views/withdrawal/optimization-history.vue'),
        meta: {
          icon: 'lucide:brain',
          title: '优化历史',
        },
      },
    ],
  },
];

export default routes;
