import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    meta: {
      icon: 'lucide:megaphone',
      order: 1,
      title: '运营中心',
    },
    name: 'Activity',
    path: '/activity',
    redirect: '/activity/taobao/baohaojia',
    children: [
      {
        name: 'ActivityOverview',
        path: '/activity/overview',
        component: () => import('#/views/activity/list/index.vue'),
        meta: {
          hideInMenu: true,
          title: '运营总览',
        },
      },
      {
        name: 'TaobaoOperation',
        path: '/activity/taobao',
        redirect: '/activity/taobao/baohaojia',
        meta: {
          icon: 'lucide:shopping-bag',
          title: '淘宝运营',
        },
        children: [
          {
            name: 'TaobaoBaohaojiaTask',
            path: '/activity/taobao/baohaojia',
            component: () => import('#/views/activity/taobao-baohaojia/index.vue'),
            meta: {
              icon: 'lucide:ticket-percent',
              title: '爆好价活动报名',
            },
          },
          {
            name: 'TaobaoSuperBrandTask',
            path: '/activity/taobao/super-brand',
            component: () => import('#/views/activity/taobao-super-brand/index.vue'),
            meta: {
              icon: 'lucide:gift',
              sceneKey: 'super_brand',
              title: '超级品牌红包报名',
            },
          },
          {
            name: 'TaobaoMarketingTagTask',
            path: '/activity/taobao/tag/:sceneKey',
            component: () => import('#/views/activity/taobao-super-brand/index.vue'),
            meta: {
              activePath: '/activity/taobao/super-brand',
              hideInMenu: true,
              title: '营销标签活动报名',
            },
          },
        ],
      },
      {
        name: 'MeituanOperation',
        path: '/activity/meituan',
        redirect: '/activity/meituan/overview',
        meta: {
          icon: 'lucide:store',
          title: '美团运营',
        },
        children: [
          {
            name: 'MeituanOperationOverview',
            path: '/activity/meituan/overview',
            component: () => import('#/views/activity/meituan/index.vue'),
            meta: {
              icon: 'lucide:layout-dashboard',
              title: '运营看板',
            },
          },
        ],
      },
      {
        name: 'ActivityDetail',
        path: '/activity/detail/:id',
        component: () => import('#/views/activity/detail/index.vue'),
        meta: {
          hideInMenu: true,
          title: '活动详情',
          activePath: '/activity/overview',
        },
      },
      {
        name: 'ActivityRecords',
        path: '/activity/records',
        component: () => import('#/views/activity/records/index.vue'),
        meta: {
          hideInMenu: true,
          title: '报名记录',
        },
      },
      {
        name: 'ActivityLogs',
        path: '/activity/logs',
        component: () => import('#/views/activity/execution-logs/index.vue'),
        meta: {
          hideInMenu: true,
          title: '执行日志',
        },
      },
    ],
  },
];

export default routes;
