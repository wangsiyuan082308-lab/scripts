import { baseRequestClient, requestClient } from '#/api/request';

export namespace AuthApi {
  /** 登录接口参数 */
  export interface LoginParams {
    password?: string;
    username?: string;
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
    success: boolean;
    user?: LoginUser;
  }

  export interface RefreshTokenResult {
    data: string;
    status: number;
  }
}

/**
 * 登录
 */
export async function loginApi(data: AuthApi.LoginParams) {
  try {
    const response = await baseRequestClient.post('/auth/login', data, {
      withCredentials: true,
    });
    const payload = (response as any)?.data;
    if (payload?.code === 0 && payload?.data) {
      return {
        success: true,
        user: payload.data,
      } satisfies AuthApi.LoginResult;
    }
    return {
      success: false,
      message: payload?.error ?? payload?.message ?? '登录失败，请稍后重试。',
    } satisfies AuthApi.LoginResult;
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
  return baseRequestClient.post<AuthApi.RefreshTokenResult>('/auth/refresh', {
    withCredentials: true,
  });
}

/**
 * 退出登录
 */
export async function logoutApi() {
  return baseRequestClient.post('/auth/logout', {
    withCredentials: true,
  });
}

/**
 * 获取用户权限码
 */
export async function getAccessCodesApi() {
  return requestClient.get<string[]>('/auth/codes');
}
