import type { Recordable, UserInfo } from '@vben/types';
import type { AuthApi } from '#/api/core/auth';

import { ref } from 'vue';
import { useRouter } from 'vue-router';

import { LOGIN_PATH } from '@vben/constants';
import { preferences } from '@vben/preferences';
import { resetAllStores, useAccessStore, useUserStore } from '@vben/stores';

import { notification } from 'ant-design-vue';
import { defineStore } from 'pinia';

import { getAccessCodesApi, getUserInfoApi, loginApi, logoutApi } from '#/api';
import { $t } from '#/locales';

/**
 * 认证 Store。
 * 负责登录、登出、恢复用户信息以及同步权限相关状态。
 */
export const useAuthStore = defineStore('auth', () => {
  const accessStore = useAccessStore();
  const userStore = useUserStore();
  const router = useRouter();

  const loginLoading = ref(false);
  const loginStage = ref<'credentials' | 'merchantSelection'>('credentials');
  const merchantOptions = ref<AuthApi.MerchantOption[]>([]);
  const pendingLoginForm = ref<null | Recordable<any>>(null);
  const pendingLoginRealName = ref('');
  const pendingLoginUsername = ref('');
  const selectedMerchantId = ref('');

  function clearPendingLoginState() {
    loginStage.value = 'credentials';
    merchantOptions.value = [];
    pendingLoginForm.value = null;
    pendingLoginRealName.value = '';
    pendingLoginUsername.value = '';
    selectedMerchantId.value = '';
  }

  async function finalizeLogin(
    user: AuthApi.LoginUser,
    onSuccess?: () => Promise<void> | void,
  ) {
    const accessToken = user.accessToken;
    if (!accessToken) {
      throw new Error('登录返回缺少访问令牌');
    }
    accessStore.setAccessToken(accessToken);

    const roles = Array.isArray(user.roles)
      ? user.roles
      : user.role
        ? [user.role]
        : [];

    const userInfo = {
      ...user,
      realName: user.realName || user.username,
      roles,
    } as unknown as UserInfo;

    const accessCodes = await getAccessCodesApi();

    userStore.setUserInfo(userInfo);
    accessStore.setAccessCodes(accessCodes);
    clearPendingLoginState();

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

    return userInfo;
  }

  /**
   * 异步处理登录操作
   * Asynchronously handle the login process
   * @param params 登录表单数据
   */
  async function authLogin(
    params: Recordable<any>,
    onSuccess?: () => Promise<void> | void,
  ) {
    let userInfo: null | UserInfo = null;
    try {
      pendingLoginUsername.value = `${params?.username || pendingLoginUsername.value || ''}`.trim();
      loginLoading.value = true;
      const result = await loginApi(params);
      if (result.stage === 'select_merchant') {
        loginStage.value = 'merchantSelection';
        merchantOptions.value = result.merchantOptions || [];
        pendingLoginForm.value = { ...params };
        pendingLoginRealName.value = result.realName || '';
        pendingLoginUsername.value =
          result.username || pendingLoginUsername.value;
        selectedMerchantId.value =
          merchantOptions.value.find((item) => item.isDefault)?.merchantId ||
          merchantOptions.value[0]?.merchantId ||
          '';
      } else if (result.success && result.user) {
        userInfo = await finalizeLogin(result.user, onSuccess);
      } else {
        notification.error({
          message: '登录失败',
          description: result.message || '登录失败，请检查输入后重试。',
          duration: 3,
        });
      }
    } catch (error: any) {
      notification.error({
        message: '登录失败',
        description: error?.message || '登录失败，请稍后重试。',
        duration: 3,
      });
    } finally {
      loginLoading.value = false;
    }

    return {
      userInfo,
    };
  }

  async function confirmMerchantSelection(
    onSuccess?: () => Promise<void> | void,
  ) {
    if (!pendingLoginForm.value || !selectedMerchantId.value) {
      notification.warning({
        message: '请选择商户',
        description: '选择商户后才能继续登录。',
        duration: 3,
      });
      return {
        userInfo: null,
      };
    }

    return authLogin(
      {
        ...pendingLoginForm.value,
        merchantId: selectedMerchantId.value,
      },
      onSuccess,
    );
  }

  function backToCredentialStage() {
    loginStage.value = 'credentials';
    merchantOptions.value = [];
    pendingLoginForm.value = pendingLoginForm.value
      ? {
          ...pendingLoginForm.value,
          password: '',
        }
      : null;
    pendingLoginRealName.value = '';
    selectedMerchantId.value = '';
  }

  /**
   * 退出登录并清空所有 Store 状态。
   * 默认会跳回登录页，并带上当前页面地址用于登录后回跳。
   */
  async function logout(redirect: boolean = true) {
    try {
      await logoutApi();
    } catch {
      // 不做任何处理
    }
    clearPendingLoginState();
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

  /**
   * 获取当前用户信息。
   * 优先读取本地 Store；若为空则通过接口恢复用户信息与权限码。
   */
  async function fetchUserInfo() {
    let userInfo = userStore.userInfo;
    if (userInfo) {
      return userInfo;
    }

    // 通过后端接口恢复用户信息
    try {
      const user = await getUserInfoApi();
      if (user) {
        const roles = Array.isArray((user as any).roles)
          ? (user as any).roles
          : (user as any).role
            ? [(user as any).role]
            : [];

        userInfo = {
          ...user,
          realName: (user as any).realName || (user as any).username,
          roles,
        } as unknown as UserInfo;
        userStore.setUserInfo(userInfo);

        // 获取用户权限码
        const accessCodes = await getAccessCodesApi();
        accessStore.setAccessCodes(accessCodes);
      }
    } catch (error) {
      console.error('Failed to restore user info from API:', error);
    }

    return userInfo;
  }

  /**
   * 重置认证 Store 的瞬时状态。
   */
  function $reset() {
    clearPendingLoginState();
    loginLoading.value = false;
  }

  return {
    $reset,
    authLogin,
    backToCredentialStage,
    confirmMerchantSelection,
    fetchUserInfo,
    loginLoading,
    loginStage,
    logout,
    merchantOptions,
    pendingLoginRealName,
    pendingLoginUsername,
    selectedMerchantId,
  };
});
