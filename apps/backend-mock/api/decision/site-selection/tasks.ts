import { defineEventHandler, getQuery, readBody, setResponseStatus } from 'h3';

import {
  createSiteSelectionTask,
  listSiteSelectionTasks,
} from '~/utils/decision/site-selection-task-store';
import { useResponseError, useResponseSuccess } from '~/utils/response';

export default defineEventHandler(async (event) => {
  try {
    if (event.method === 'GET') {
      const query = getQuery(event);
      const list = listSiteSelectionTasks({
        keyword: `${query.keyword || ''}`,
        status: `${query.status || ''}`,
      });
      return useResponseSuccess({
        items: list,
        total: list.length,
      });
    }

    if (event.method === 'POST') {
      const body = await readBody(event);
      return useResponseSuccess(createSiteSelectionTask(body || {}));
    }

    setResponseStatus(event, 405);
    return useResponseError('不支持的请求方式', '不支持的请求方式');
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '选址任务处理失败';
    setResponseStatus(event, 500);
    return useResponseError(message, message);
  }
});
