import { beforeEach, describe, expect, it, vi } from 'vitest';

const postMock = vi.fn();

vi.mock('#/api/request', () => {
  return {
    baseRequestClient: {
      post: postMock,
    },
    requestClient: {
      get: vi.fn(),
    },
  };
});

describe('auth api', () => {
  beforeEach(() => {
    postMock.mockReset();
    // @ts-expect-error happy-dom window augmentation for tests
    delete window.ipcRenderer;
  });

  it('normalizes merchant selection result', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        code: 0,
        data: {
          merchantOptions: [
            {
              isDefault: true,
              merchantId: 'm-1',
              merchantName: '商户 A',
              role: 'merchant_admin',
            },
          ],
          realName: 'Multi Admin',
          stage: 'select_merchant',
          username: 'multiadmin',
        },
        message: 'ok',
      },
    });

    const { loginApi } = await import('../auth');
    const result = await loginApi({
      password: 'wsy082308',
      username: 'multiadmin',
    });

    expect(result.success).toBe(false);
    expect(result.stage).toBe('select_merchant');
    expect(result.merchantOptions?.[0]?.merchantId).toBe('m-1');
    expect(result.username).toBe('multiadmin');
  });

  it('normalizes authenticated login result', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        code: 0,
        data: {
          accessToken: 'token',
          merchantId: 'm-1',
          merchantName: '商户 A',
          role: 'merchant_admin',
          roles: ['merchant_admin'],
          username: 'admin',
        },
        message: 'ok',
      },
    });

    const { loginApi } = await import('../auth');
    const result = await loginApi({
      password: 'wsy082308',
      username: 'admin',
    });

    expect(result.success).toBe(true);
    expect(result.stage).toBe('authenticated');
    expect(result.user?.accessToken).toBe('token');
    expect(result.user?.merchantName).toBe('商户 A');
  });

  it('passes cookie config to refresh and logout requests', async () => {
    postMock.mockResolvedValue({
      data: 'refreshed-token',
    });

    const { logoutApi, refreshTokenApi } = await import('../auth');

    await refreshTokenApi();
    await logoutApi();

    expect(postMock).toHaveBeenNthCalledWith(
      1,
      '/auth/refresh',
      undefined,
      { withCredentials: true },
    );
    expect(postMock).toHaveBeenNthCalledWith(
      2,
      '/auth/logout',
      undefined,
      { withCredentials: true },
    );
  });
});
