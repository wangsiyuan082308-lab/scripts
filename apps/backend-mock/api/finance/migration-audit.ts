import { defineEventHandler, getQuery } from 'h3';

import { auditFinanceMigration } from '../../utils/finance/migration-audit';
import { useResponseError } from '../../utils/response';

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const month = `${query.month || ''}`.trim();

  if (!month) {
    return useResponseError('month is required', '月份不能为空');
  }

  try {
    const result = await auditFinanceMigration(month);
    return {
      code: 0,
      data: result,
    };
  } catch (error: any) {
    return useResponseError(error?.message || 'finance migration audit failed');
  }
});
