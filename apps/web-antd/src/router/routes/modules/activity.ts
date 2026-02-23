import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    meta: {
      icon: 'lucide:megaphone',
      order: 1,
      title: '活动中心',
    },
    name: 'Activity',
    path: '/activity',
    children: [
      {
        name: 'ActivityList',
        path: '/activity/list',
        component: () => import('#/views/activity/list/index.vue'),
        meta: {
          icon: 'lucide:list-checks',
          title: '活动列表',
        },
      },
      {
        name: 'ActivityDetail',
        path: '/activity/detail/:id',
        component: () => import('#/views/activity/detail/index.vue'),
        meta: {
          hideInMenu: true,
          title: '活动详情',
          activePath: '/activity/list',
        },
      },
      {
        name: 'ActivityRecords',
        path: '/activity/records',
        component: () => import('#/views/activity/records/index.vue'),
        meta: {
          icon: 'lucide:clipboard-list',
          title: '报名记录',
        },
      },
      {
        name: 'ActivityLogs',
        path: '/activity/logs',
        component: () => import('#/views/activity/execution-logs/index.vue'),
        meta: {
          icon: 'lucide:scroll-text',
          title: '执行日志',
        },
      },
    ],
  },
];

export default routes;
