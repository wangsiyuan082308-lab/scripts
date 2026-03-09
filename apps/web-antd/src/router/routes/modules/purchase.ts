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
          order: 0,
        },
      },
      {
        meta: {
          icon: 'ant-design:solution-outlined',
          title: '供应商管理',
          order: 10,
        },
        name: 'Supplier',
        path: '/supplier',
        component: () => import('#/views/supplier/index.vue'),
      },
      {
        meta: {
          icon: 'ant-design:shop-outlined',
          title: '店铺管理',
          order: 20,
        },
        name: 'Store',
        path: '/store',
        component: () => import('#/views/store/index.vue'),
      },
      {
        meta: {
          icon: 'ant-design:schedule-outlined',
          title: '采购任务管理',
          order: 30,
        },
        name: 'ProcurementTask',
        path: '/procurement-task',
        component: () => import('#/views/procurement-task/index.vue'),
      },
    ],
  },
];

export default routes;
