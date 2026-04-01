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
    redirect: '/decision-center/site-selection',
    children: [
      {
        name: 'DecisionCenterSiteSelection',
        path: '/decision-center/site-selection',
        component: () => import('#/views/decision-center/site-selection/index.vue'),
        meta: {
          icon: 'ri:map-pin-2-line',
          title: '门店选址',
        },
      },
      {
        name: 'DecisionCenterIndex',
        path: '/decision-center/index',
        component: () => import('#/views/decision-center/index.vue'),
        meta: {
          icon: 'ri:robot-2-line',
          title: '模型配置',
        },
      },
    ],
  },
];

export default routes;
