import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    meta: {
      icon: 'lucide:shopping-cart',
      order: 4,
      title: '采购管理',
    },
    name: 'Purchase',
    path: '/purchase',
    children: [
      {
        name: 'PurchaseOverview',
        path: '/purchase/overview',
        component: () => import('#/views/purchase/overview.vue'),
        meta: {
          icon: 'lucide:layout-dashboard',
          title: '采购总览',
        },
      },
    ],
  },
];

export default routes;
