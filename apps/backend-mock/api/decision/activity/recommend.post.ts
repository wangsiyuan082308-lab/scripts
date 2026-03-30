import { defineEventHandler, readBody, setResponseStatus } from 'h3';

import { recommendActivityDecisions } from '~/utils/decision/activity-decision';
import { useResponseError, useResponseSuccess } from '~/utils/response';

export default defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const result = await recommendActivityDecisions(body || {});
    return useResponseSuccess(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '活动推荐决策执行失败';
    setResponseStatus(event, 500);
    return useResponseError(message, message);
  }
});
