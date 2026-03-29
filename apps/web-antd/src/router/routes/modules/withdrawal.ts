import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    meta: {
      icon: 'lucide:wallet',
      order: 5,
      title: '提现管理',
    },
    name: 'Withdrawal',
    path: '/withdrawal',
    redirect: '/withdrawal/task',
    children: [
      {
        name: 'WithdrawalTask',
        path: '/withdrawal/task',
        component: () => import('#/views/withdrawal-task/index.vue'),
        meta: {
          icon: 'ant-design:wallet-outlined',
          title: '提现任务',
        },
      },
    ],
  },
];

export default routes;
