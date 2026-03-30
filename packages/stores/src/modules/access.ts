import type { RouteRecordRaw } from 'vue-router';

import type { MenuRecordRaw } from '@vben-core/typings';

import { acceptHMRUpdate, defineStore } from 'pinia';

type AccessToken = null | string;

interface AccessState {
  /**
   * 权限码
   */
  accessCodes: string[];
  /**
   * 可访问的菜单列表
   */
  accessMenus: MenuRecordRaw[];
  /**
   * 可访问的路由列表
   */
  accessRoutes: RouteRecordRaw[];
  /**
   * 登录 accessToken
   */
  accessToken: AccessToken;
  /**
   * 是否已经检查过权限
   */
  isAccessChecked: boolean;
  /**
   * 是否锁屏状态
   */
  isLockScreen: boolean;
  /**
   * 锁屏密码
   */
  lockScreenPassword?: string;
  /**
   * 登录是否过期
   */
  loginExpired: boolean;
  /**
   * 登录 accessToken
   */
  refreshToken: AccessToken;
}

/**
 * @zh_CN 权限访问 Store
 * @description 管理令牌、菜单、路由、权限码以及锁屏状态。
 */
export const useAccessStore = defineStore('core-access', {
  actions: {
    /**
     * 根据路由路径递归查找当前用户可访问的菜单项。
     */
    getMenuByPath(path: string) {
      function findMenu(
        menus: MenuRecordRaw[],
        path: string,
      ): MenuRecordRaw | undefined {
        for (const menu of menus) {
          if (menu.path === path) {
            return menu;
          }
          if (menu.children) {
            const matched = findMenu(menu.children, path);
            if (matched) {
              return matched;
            }
          }
        }
      }
      return findMenu(this.accessMenus, path);
    },

    /**
     * 进入锁屏状态，并记录锁屏密码。
     */
    lockScreen(password: string) {
      this.isLockScreen = true;
      this.lockScreenPassword = password;
    },

    /**
     * 更新权限码列表。
     */
    setAccessCodes(codes: string[]) {
      this.accessCodes = codes;
    },

    /**
     * 更新可访问菜单列表。
     */
    setAccessMenus(menus: MenuRecordRaw[]) {
      this.accessMenus = menus;
    },

    /**
     * 更新可访问路由列表。
     */
    setAccessRoutes(routes: RouteRecordRaw[]) {
      this.accessRoutes = routes;
    },

    /**
     * 更新访问令牌。
     */
    setAccessToken(token: AccessToken) {
      this.accessToken = token;
    },

    /**
     * 标记权限检查流程是否已完成。
     */
    setIsAccessChecked(isAccessChecked: boolean) {
      this.isAccessChecked = isAccessChecked;
    },

    /**
     * 标记当前登录态是否已过期。
     */
    setLoginExpired(loginExpired: boolean) {
      this.loginExpired = loginExpired;
    },

    /**
     * 更新刷新令牌。
     */
    setRefreshToken(token: AccessToken) {
      this.refreshToken = token;
    },

    /**
     * 解除锁屏并清除锁屏密码。
     */
    unlockScreen() {
      this.isLockScreen = false;
      this.lockScreenPassword = undefined;
    },
  },
  persist: {
    // 持久化
    pick: [
      'accessToken',
      'refreshToken',
      'accessCodes',
      'isLockScreen',
      'lockScreenPassword',
    ],
  },
  state: (): AccessState => ({
    accessCodes: [],
    accessMenus: [],
    accessRoutes: [],
    accessToken: null,
    isAccessChecked: false,
    isLockScreen: false,
    lockScreenPassword: undefined,
    loginExpired: false,
    refreshToken: null,
  }),
});

// 解决热更新问题
const hot = import.meta.hot;
if (hot) {
  hot.accept(acceptHMRUpdate(useAccessStore, hot));
}
