import { defineEventHandler } from 'h3';
import {
  clearRefreshTokenCookie,
  getRefreshTokenFromCookie,
  setRefreshTokenCookie,
} from '~/utils/cookie-utils';
import { generateAccessToken, verifyRefreshToken } from '~/utils/jwt-utils';
import { MOCK_USERS } from '~/utils/mock-data';
import { forbiddenResponse } from '~/utils/response';

export default defineEventHandler(async (event) => {
  const refreshToken = getRefreshTokenFromCookie(event);
  if (!refreshToken) {
    return forbiddenResponse(event, '登录状态已过期，请重新登录。');
  }

  clearRefreshTokenCookie(event);

  const userinfo = verifyRefreshToken(refreshToken);
  if (!userinfo) {
    return forbiddenResponse(event, '登录状态已过期，请重新登录。');
  }

  const findUser = MOCK_USERS.find(
    (item) => item.username === userinfo.username,
  );
  if (!findUser) {
    return forbiddenResponse(event, '登录状态已过期，请重新登录。');
  }
  const accessToken = generateAccessToken(findUser);

  setRefreshTokenCookie(event, refreshToken);

  return accessToken;
});
