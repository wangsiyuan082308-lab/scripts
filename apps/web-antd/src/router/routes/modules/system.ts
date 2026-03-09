import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    meta: {
      icon: 'lucide:settings',
      order: 100,
      title: '系统设置',
    },
    name: 'System',
    path: '/system',
    redirect: '/system/store',
    children: [
      {
        name: 'SystemMerchantList',
        path: '/system/merchant',
        component: () => import('#/views/merchant/index.vue'),
        meta: {
          icon: 'ant-design:unordered-list-outlined',
          title: '商户列表',
        },
      },
      {
        name: 'SystemSupplierList',
        path: '/system/supplier',
        component: () => import('#/views/supplier/index.vue'),
        meta: {
          icon: 'ant-design:solution-outlined',
          title: '供应商列表',
        },
      },
      {
        name: 'SystemStoreList',
        path: '/system/store',
        component: () => import('#/views/store/index.vue'),
        meta: {
          icon: 'ant-design:shop-outlined',
          title: '门店列表',
        },
      },
    ],
  },
];

export default routes;
