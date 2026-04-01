import { defineEventHandler, readBody, setResponseStatus } from 'h3';

import { recommendSiteSelection } from '~/utils/decision/site-selection';
import { useResponseError, useResponseSuccess } from '~/utils/response';

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const result = await recommendSiteSelection(body || {});
    return useResponseSuccess(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '门店选址推荐执行失败';
    setResponseStatus(event, 500);
    return useResponseError(message, message);
  }
});
