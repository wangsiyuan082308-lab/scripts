import { defineEventHandler, getQuery } from 'h3';

import { useResponseError } from '../../utils/response';
import { scanFinanceReports } from '../../utils/finance/report-reader';

export default defineEventHandler((event) => {
  const query = getQuery(event);
  const month = query.month as string;
  const store = query.store as string;
  const type = query.type as '' | 'abnormal' | 'store' | 'summary' | 'unknown';

  try {
    const reports = scanFinanceReports({ month, store, type });

    return {
      code: 0,
      data: {
        list: reports,
        total: reports.length,
      },
    };
  } catch (e: any) {
    return useResponseError(e.message, e.message);
  }
});
