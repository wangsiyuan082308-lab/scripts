/**
 * 统一导出所有公共 Pinia Store 模块。
 */
export * from './modules';

/**
 * 导出 Pinia 初始化与重置工具。
 */
export * from './setup';

/**
 * 透传常用 Pinia API，方便业务侧统一从 `@vben/stores` 引入。
 */
export { defineStore, storeToRefs } from 'pinia';
