import { contextBridge, ipcRenderer } from 'electron';

const INVOKE_CHANNELS = new Set([
  'add-merchant',
  'add-store',
  'add-supplier',
  'add-task',
  'analyze-eleme-baohaojia-task',
  'continue-taobao-baohaojia-task-review',
  'create-taobao-baohaojia-local-run',
  'create-taobao-baohaojia-local-task',
  'create-taobao-super-brand-local-run',
  'create-taobao-super-brand-local-task',
  'delete-merchant',
  'delete-store',
  'delete-supplier',
  'delete-taobao-baohaojia-local-task',
  'delete-taobao-super-brand-local-task',
  'delete-task',
  'execute-procurement-task',
  'execute-taobao-baohaojia-task',
  'execute-taobao-super-brand-task',
  'execute-withdrawal-task',
  'extract-eleme-baohaojia-codes',
  'generate-eleme-activity',
  'generate-procurement-plan',
  'get-execution-logs',
  // Merchant
  'get-merchants',
  // Storage
  'get-stores',
  'get-suppliers',
  'get-taobao-baohaojia-local-task-detail',
  'get-taobao-super-brand-local-task-detail',
  'get-tasks',
  'list-taobao-baohaojia-local-run-logs',
  'list-taobao-baohaojia-local-runs',
  'list-taobao-baohaojia-local-tasks',
  'list-taobao-super-brand-local-run-logs',
  'list-taobao-super-brand-local-runs',
  'list-taobao-super-brand-local-tasks',
  'local-auth-get-access-codes',
  'local-auth-get-user-info',
  'local-auth-login',
  'local-auth-logout',
  'process-eleme-baohaojia',
  'process-excel-buffers',
  'run-finance-analysis',
  'save-stores',
  'save-suppliers',
  'save-tasks',
  'update-merchant',
  'update-store',
  'update-supplier',
  'update-task',
]);

const SEND_CHANNELS = new Set(['check-for-update', 'install-update']);

const ON_CHANNELS = new Set([
  'main-process-message',
  'update-available',
  'update-checking',
  'update-download-progress',
  'update-downloaded',
  'update-error',
  'withdrawal-log',
]);

contextBridge.exposeInMainWorld('ipcRenderer', {
  invoke(channel: string, ...args: any[]) {
    if (!INVOKE_CHANNELS.has(channel)) {
      throw new Error(`IPC invoke not allowed: ${channel}`);
    }
    return ipcRenderer.invoke(channel, ...args);
  },
  send(channel: string, ...args: any[]) {
    if (!SEND_CHANNELS.has(channel)) {
      throw new Error(`IPC send not allowed: ${channel}`);
    }
    ipcRenderer.send(channel, ...args);
  },
  on(channel: string, listener: (...args: any[]) => void) {
    if (!ON_CHANNELS.has(channel)) {
      throw new Error(`IPC on not allowed: ${channel}`);
    }
    const wrappedListener = (_event: unknown, ...args: any[]) =>
      listener(...args);
    ipcRenderer.on(channel, wrappedListener);
    return () => ipcRenderer.off(channel, wrappedListener);
  },
  off(channel: string, listener: (...args: any[]) => void) {
    ipcRenderer.off(channel, listener);
  },
});
