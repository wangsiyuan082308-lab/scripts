import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    meta: {
      icon: 'ant-design:shop-outlined',
      order: 100,
      title: '商户管理',
    },
    name: 'Merchant',
    path: '/merchant',
    children: [
      {
        name: 'MerchantList',
        path: '/merchant/list',
        component: () => import('#/views/merchant/index.vue'),
        meta: {
          icon: 'ant-design:unordered-list-outlined',
          title: '商户列表',
        },
      },
    ],
  },
];

export default routes;
