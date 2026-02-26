import { contextBridge, ipcRenderer } from 'electron';

const INVOKE_CHANNELS = [
  'process-excel-buffers',
  'generate-eleme-activity',
  'process-eleme-baohaojia',
  'generate-procurement-plan',
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
    ipcRenderer.on(channel, (_event, ...args) => listener(...args));
    return { channel, listener };
  },
  off(channel: string, listener: (...args: any[]) => void) {
    ipcRenderer.off(channel, listener);
  },
});
