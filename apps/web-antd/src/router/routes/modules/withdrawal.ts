import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    meta: {
      icon: 'lucide:wallet',
      order: 5,
      title: '财务中心',
    },
    name: 'Withdrawal',
    path: '/withdrawal',
    redirect: '/withdrawal/task',
    children: [
      {
        name: 'WithdrawalTaskLegacy',
        path: '/withdrawal-task',
        redirect: '/withdrawal/task',
        meta: {
          hideInMenu: true,
          title: '提现管理',
        },
      },
      {
        name: 'WithdrawalTask',
        path: '/withdrawal/task',
        component: () => import('#/views/withdrawal-task/index.vue'),
        meta: {
          icon: 'ant-design:wallet-outlined',
          title: '提现管理',
        },
      },
      {
        name: 'FinancialReport',
        path: '/withdrawal/report',
        component: () => import('#/views/financial-report/index.vue'),
        meta: {
          icon: 'ant-design:file-text-outlined',
          title: '财务管理',
        },
      },
    ],
  },
];

export default routes;
