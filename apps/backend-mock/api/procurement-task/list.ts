import { defineEventHandler, getQuery, readBody } from 'h3';

interface ProcurementTask {
  taskId: string;
  platform: 'Aoxiang' | 'Qianniuhua';
  supplierId: string;
  supplierName?: string;
  status: 'Pending' | 'InProgress' | 'Completed' | 'Failed';
  scheduleType: 'Instant' | 'Weekly';
  schedule?: string;
  weekDay?: string;
  lastRunTime?: string;
  storeIds?: string[];
}

let tasks: ProcurementTask[] = [
  {
    taskId: '1',
    platform: 'Aoxiang',
    supplierId: '1',
    supplierName: 'Supplier A',
    status: 'Completed',
    scheduleType: 'Weekly',
    schedule: 'Weekly Wed',
    weekDay: 'Wed',
    lastRunTime: '2023-10-25 10:00:00',
    storeIds: ['S001', 'S003'],
  },
  {
    taskId: '2',
    platform: 'Qianniuhua',
    supplierId: '2',
    supplierName: 'Supplier B',
    status: 'Pending',
    scheduleType: 'Instant',
    schedule: 'Instant',
    lastRunTime: '-',
    storeIds: ['S002', 'S004'],
  },
];

export default defineEventHandler(async (event) => {
  const method = event.method;

  if (method === 'GET') {
    const query = getQuery(event);
    const { page = 1, pageSize = 10, platform, status } = query;
    
    let filtered = tasks;
    if (platform) {
      filtered = filtered.filter((t) => t.platform === platform);
    }
    if (status) {
      filtered = filtered.filter((t) => t.status === status);
    }

    const start = (Number(page) - 1) * Number(pageSize);
    const end = start + Number(pageSize);
    const list = filtered.slice(start, end);

    return {
      code: 0,
      data: {
        items: list,
        total: filtered.length,
      },
      message: 'success',
    };
  }

  if (method === 'POST') {
    const body = await readBody(event);
    const newTask = {
      ...body,
      taskId: body.taskId || String(Date.now()),
      status: body.status || 'Pending',
      lastRunTime: '-',
    };
    // Mock looking up supplier name if not provided (simulated)
    if (!newTask.supplierName && newTask.supplierId) {
        newTask.supplierName = `Supplier ${newTask.supplierId}`;
    }
    
    tasks.push(newTask);
    return { code: 0, data: newTask, message: 'Add success' };
  }

  if (method === 'PUT') {
    const body = await readBody(event);
    const index = tasks.findIndex((t) => t.taskId === body.taskId);
    if (index !== -1) {
      tasks[index] = { ...tasks[index], ...body };
      return { code: 0, data: tasks[index], message: 'Update success' };
    }
    return { code: 1, message: 'Task not found' };
  }

  if (method === 'DELETE') {
    const query = getQuery(event);
    const taskId = query.taskId as string;
    tasks = tasks.filter((t) => t.taskId !== taskId);
    return { code: 0, data: null, message: 'Delete success' };
  }
});
