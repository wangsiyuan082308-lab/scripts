import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    meta: {
      icon: 'lucide:megaphone',
      order: 1,
      title: '运营中心',
    },
    name: 'Operations',
    path: '/activity',
    redirect: '/activity/eleme',
    children: [
      {
        name: 'ElemeOperations',
        path: '/activity/eleme',
        component: () => import('#/views/activity/eleme/index.vue'),
        meta: {
          icon: 'lucide:utensils-crossed',
          title: '饿了么运营',
        },
      },
      {
        name: 'MeituanOperations',
        path: '/activity/meituan',
        component: () => import('#/views/activity/meituan/index.vue'),
        meta: {
          icon: 'lucide:shopping-bag',
          title: '美团运营',
        },
      },
      {
        name: 'ActivityList',
        path: '/activity/list',
        component: () => import('#/views/activity/list/index.vue'),
        meta: {
          hideInMenu: true,
          title: '饿了么活动列表',
          activePath: '/activity/eleme',
        },
      },
      {
        name: 'ActivityDetail',
        path: '/activity/detail/:id',
        component: () => import('#/views/activity/detail/index.vue'),
        meta: {
          hideInMenu: true,
          title: '饿了么活动详情',
          activePath: '/activity/eleme',
        },
      },
      {
        name: 'ActivityRecords',
        path: '/activity/records',
        component: () => import('#/views/activity/records/index.vue'),
        meta: {
          hideInMenu: true,
          title: '饿了么报名记录',
          activePath: '/activity/eleme',
        },
      },
      {
        name: 'ActivityLogs',
        path: '/activity/logs',
        component: () => import('#/views/activity/execution-logs/index.vue'),
        meta: {
          hideInMenu: true,
          title: '饿了么执行日志',
          activePath: '/activity/eleme',
        },
      },
    ],
  },
];

export default routes;
