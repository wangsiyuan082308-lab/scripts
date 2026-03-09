import type { Recordable, UserInfo } from '@vben/types';

import { ref } from 'vue';
import { useRouter } from 'vue-router';

import { LOGIN_PATH } from '@vben/constants';
import { preferences } from '@vben/preferences';
import { resetAllStores, useAccessStore, useUserStore } from '@vben/stores';

import { notification } from 'ant-design-vue';
import { defineStore } from 'pinia';

import { getAccessCodesApi, loginApi, logoutApi } from '#/api';
import { $t } from '#/locales';

export const useAuthStore = defineStore('auth', () => {
  const accessStore = useAccessStore();
  const userStore = useUserStore();
  const router = useRouter();

  const loginLoading = ref(false);

  /**
   * 异步处理登录操作
   * Asynchronously handle the login process
   * @param params 登录表单数据
   */
  async function authLogin(
    params: Recordable<any>,
    onSuccess?: () => Promise<void> | void,
  ) {
    // 异步处理用户登录操作并获取 accessToken
    let userInfo: null | UserInfo = null;
    try {
      loginLoading.value = true;
      const { success, user } = await loginApi(params);

      // 如果成功获取到用户信息
      if (success && user) {
        // 由于是 IPC 登录，模拟一个 accessToken
        const accessToken = 'ipc-token';
        accessStore.setAccessToken(accessToken);

        // 构造用户信息
        userInfo = {
          ...user,
          realName: user.username,
          roles: [user.role],
        } as unknown as UserInfo;

        // 获取用户权限码
        const accessCodes = await getAccessCodesApi();

        userStore.setUserInfo(userInfo);
        accessStore.setAccessCodes(accessCodes);

        if (accessStore.loginExpired) {
          accessStore.setLoginExpired(false);
        } else {
          onSuccess
            ? await onSuccess?.()
            : await router.push(
                userInfo.homePath || preferences.app.defaultHomePath,
              );
        }

        if (userInfo?.realName) {
          notification.success({
            description: `${$t('authentication.loginSuccessDesc')}:${userInfo?.realName}`,
            duration: 3,
            message: $t('authentication.loginSuccess'),
          });
        }
      }
    } finally {
      loginLoading.value = false;
    }

    return {
      userInfo,
    };
  }

  async function logout(redirect: boolean = true) {
    try {
      await logoutApi();
    } catch {
      // 不做任何处理
    }
    resetAllStores();
    accessStore.setLoginExpired(false);

    // 回登录页带上当前路由地址
    await router.replace({
      path: LOGIN_PATH,
      query: redirect
        ? {
            redirect: encodeURIComponent(router.currentRoute.value.fullPath),
          }
        : {},
    });
  }

  async function fetchUserInfo() {
    let userInfo = userStore.userInfo;
    if (userInfo) {
      return userInfo;
    }

    // 尝试从主进程恢复用户信息
    try {
      const user = await (window as any).ipcRenderer.invoke('get-current-user');
      if (user) {
        userInfo = {
          ...user,
          realName: user.username,
          roles: [user.role],
        } as unknown as UserInfo;
        userStore.setUserInfo(userInfo);

        // 获取用户权限码
        const accessCodes = await getAccessCodesApi();
        accessStore.setAccessCodes(accessCodes);
      }
    } catch (error) {
      console.error('Failed to restore user info from IPC:', error);
    }

    return userInfo;
  }

  function $reset() {
    loginLoading.value = false;
  }

  return {
    $reset,
    authLogin,
    fetchUserInfo,
    loginLoading,
    logout,
  };
});
