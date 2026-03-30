import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    meta: {
      icon: 'ri:settings-3-line',
      order: 7,
      title: '决策中心',
    },
    name: 'DecisionCenter',
    path: '/decision-center',
    redirect: '/decision-center/index',
    children: [
      {
        name: 'DecisionCenterIndex',
        path: '/decision-center/index',
        component: () => import('#/views/decision-center/index.vue'),
        meta: {
          icon: 'ri:brain-line',
          title: '决策中心',
        },
      },
    ],
  },
];

export default routes;
