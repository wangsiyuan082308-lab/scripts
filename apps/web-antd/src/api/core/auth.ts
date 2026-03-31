import { baseRequestClient, requestClient } from '#/api/request';

export namespace AuthApi {
  /** 登录接口参数 */
  export interface LoginParams {
    merchantId?: string;
    password?: string;
    username?: string;
  }

  export interface MerchantOption {
    isDefault?: boolean;
    merchantId: string;
    merchantName: string;
    role?: string;
  }

  /** 登录成功返回的用户信息 */
  export interface LoginUser {
    accessToken?: string;
    merchantId?: string;
    role?: string;
    roles?: string[];
    username: string;
    [key: string]: any;
  }

  /** 供 store 消费的登录结果 */
  export interface LoginResult {
    message?: string;
    merchantOptions?: MerchantOption[];
    realName?: string;
    success: boolean;
    stage?: 'authenticated' | 'select_merchant';
    user?: LoginUser;
    username?: string;
  }

  export interface RefreshTokenResult {
    data: string;
    status: number;
  }
}

function hasElectronAuthBridge() {
  return typeof window !== 'undefined' && window.ipcRenderer !== undefined;
}

/**
 * 登录
 */
export async function loginApi(
  data: AuthApi.LoginParams,
): Promise<AuthApi.LoginResult> {
  if (hasElectronAuthBridge()) {
    const result = await window.ipcRenderer.invoke('local-auth-login', data);
    return normalizeLoginResult(result);
  }
  try {
    const response = await baseRequestClient.post('/auth/login', data, {
      withCredentials: true,
    });
    return normalizeLoginResult((response as any)?.data);
  } catch (error: any) {
    return {
      success: false,
      message: error?.error ?? error?.message ?? '登录失败，请稍后重试。',
    } satisfies AuthApi.LoginResult;
  }
}

/**
 * 刷新accessToken
 */
export async function refreshTokenApi() {
  if (hasElectronAuthBridge()) {
    return {
      data: 'local-refresh-token',
      status: 0,
    } as AuthApi.RefreshTokenResult;
  }
  return baseRequestClient.post<AuthApi.RefreshTokenResult>(
    '/auth/refresh',
    undefined,
    {
      withCredentials: true,
    },
  );
}

/**
 * 退出登录
 */
export async function logoutApi() {
  if (hasElectronAuthBridge()) {
    return window.ipcRenderer.invoke('local-auth-logout');
  }
  return baseRequestClient.post('/auth/logout', undefined, {
    withCredentials: true,
  });
}

/**
 * 获取用户权限码
 */
export async function getAccessCodesApi() {
  if (hasElectronAuthBridge()) {
    return window.ipcRenderer.invoke('local-auth-get-access-codes');
  }
  return requestClient.get<string[]>('/auth/codes');
}

function normalizeLoginResult(payload: any): AuthApi.LoginResult {
  const body = payload?.data ? payload.data : payload;

  if (payload?.code === 0 && body?.stage === 'select_merchant') {
    return {
      message: payload?.message || '请选择商户后继续登录。',
      merchantOptions: Array.isArray(body?.merchantOptions)
        ? body.merchantOptions
        : [],
      realName: body?.realName,
      stage: 'select_merchant',
      success: false,
      username: body?.username,
    } satisfies AuthApi.LoginResult;
  }

  if (payload?.code === 0 && body) {
    return {
      message: payload?.message,
      stage: 'authenticated',
      success: true,
      user: body,
    } satisfies AuthApi.LoginResult;
  }

  if (body?.success && body?.user) {
    return {
      message: body?.message,
      stage: 'authenticated',
      success: true,
      user: body.user,
    } satisfies AuthApi.LoginResult;
  }

  return {
    message:
      payload?.error ??
      payload?.message ??
      body?.error ??
      body?.message ??
      '登录失败，请稍后重试。',
    success: false,
  } satisfies AuthApi.LoginResult;
}
