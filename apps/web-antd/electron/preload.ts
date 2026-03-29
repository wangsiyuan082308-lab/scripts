import { contextBridge, ipcRenderer } from 'electron';

const INVOKE_CHANNELS = [
  'process-excel-buffers',
  'generate-eleme-activity',
  'process-eleme-baohaojia',
  'generate-procurement-plan',
  'execute-procurement-task',
  'execute-withdrawal-task',
  // Storage
  'get-stores',
  'save-stores',
  'add-store',
  'update-store',
  'delete-store',
  'get-suppliers',
  'save-suppliers',
  'add-supplier',
  'update-supplier',
  'delete-supplier',
  'get-tasks',
  'save-tasks',
  'add-task',
  'update-task',
  'delete-task',
  // Merchant
  'get-merchants',
  'add-merchant',
  'update-merchant',
  'delete-merchant',
];

const SEND_CHANNELS = [
  'install-update',
  'check-for-update',
];

const ON_CHANNELS = [
  'update-available',
  'update-download-progress',
  'update-downloaded',
  'update-error',
  'update-checking',
  'main-process-message',
  'withdrawal-log',
];

contextBridge.exposeInMainWorld('ipcRenderer', {
  invoke(channel: string, ...args: any[]) {
    if (!INVOKE_CHANNELS.includes(channel)) {
      throw new Error(`IPC invoke not allowed: ${channel}`);
    }
    return ipcRenderer.invoke(channel, ...args);
  },
  send(channel: string, ...args: any[]) {
    if (!SEND_CHANNELS.includes(channel)) {
      throw new Error(`IPC send not allowed: ${channel}`);
    }
    ipcRenderer.send(channel, ...args);
  },
  on(channel: string, listener: (...args: any[]) => void) {
    if (!ON_CHANNELS.includes(channel)) {
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
