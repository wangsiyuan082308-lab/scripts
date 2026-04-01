import { defineEventHandler, getQuery } from 'h3';

import { readFinanceReportDetail } from '../../../utils/finance/report-reader';
import { useResponseError } from '../../../utils/response';

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const relativePath = `${query.relativePath || ''}`.trim();

  if (!relativePath) {
    return useResponseError('relativePath is required', '报表路径不能为空');
  }

  try {
    const detail = await readFinanceReportDetail(relativePath);
    return {
      code: 0,
      data: detail,
    };
  } catch (error: any) {
    return useResponseError(error?.message || 'read finance report failed');
  }
});
