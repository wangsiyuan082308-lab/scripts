import { defineEventHandler, getRouterParam, setResponseStatus } from 'h3';

import { enqueueSiteSelectionTask } from '~/utils/decision/site-selection-task-store';
import { useResponseError, useResponseSuccess } from '~/utils/response';

export default defineEventHandler(async (event) => {
  try {
    const taskId = `${getRouterParam(event, 'id') || ''}`.trim();
    if (!taskId) {
      throw new Error('缺少选址任务ID');
    }
    const task = enqueueSiteSelectionTask(taskId);
    return useResponseSuccess(task);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : '选址任务执行失败';
    setResponseStatus(event, 500);
    return useResponseError(message, message);
  }
});
