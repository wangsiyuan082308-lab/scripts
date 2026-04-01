import { defineEventHandler, getRouterParam, readBody, setResponseStatus } from 'h3';

import {
  deleteSiteSelectionTask,
  getSiteSelectionTask,
  updateSiteSelectionTask,
} from '~/utils/decision/site-selection-task-store';
import { useResponseError, useResponseSuccess } from '~/utils/response';

export default defineEventHandler(async (event) => {
  try {
    const taskId = `${getRouterParam(event, 'id') || ''}`.trim();
    if (!taskId) {
      throw new Error('缺少选址任务ID');
    }

    if (event.method === 'GET') {
      return useResponseSuccess(getSiteSelectionTask(taskId));
    }

    if (event.method === 'PUT') {
      const body = await readBody(event);
      return useResponseSuccess(updateSiteSelectionTask(taskId, body || {}));
    }

    if (event.method === 'DELETE') {
      deleteSiteSelectionTask(taskId);
      return useResponseSuccess(true);
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
