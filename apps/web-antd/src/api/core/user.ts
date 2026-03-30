import type { UserInfo } from '@vben/types';

import { requestClient } from '#/api/request';

/**
 * 获取用户信息
 */
export async function getUserInfoApi() {
  if (typeof window !== 'undefined' && window.ipcRenderer !== undefined) {
    return window.ipcRenderer.invoke('local-auth-get-user-info');
  }
  return requestClient.get<UserInfo>('/user/info');
}
