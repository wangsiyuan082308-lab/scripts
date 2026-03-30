import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    meta: {
      icon: 'ri:archive-stack-fill',
      order: 6,
      title: '商品中心',
    },
    name: 'Product',
    path: '/product',
    redirect: '/product/master',
    children: [
      {
        name: 'ProductMaster',
        path: '/product/master',
        component: () => import('#/views/dashboard/tools/product-master.vue'),
        meta: {
          icon: 'ri:archive-drawer-line',
          title: '商品总表',
          order: 0,
        },
      },
      {
        name: 'ProductCompare',
        path: '/product/compare',
        component: () => import('#/views/product/compare/index.vue'),
        meta: {
          icon: 'ri:git-merge-line',
          title: '商品比对',
          order: 1,
        },
      },
    ],
  },
];

export default routes;
