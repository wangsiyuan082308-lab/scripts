import { Buffer } from 'node:buffer';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { autoUpdater } from 'electron-updater';

import { ElemeActivityGenerator } from './features/eleme-activity/index';
import { ElemeBaohaojiaAnalyzer } from './features/eleme-baohaojia/index';
import { ProcurementAnalyzer } from './features/procurement/index';
import { ProcurementPlanGenerator } from './features/procurement/plan-generator';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.APP_ROOT = path.join(__dirname, '..');

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron');
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist');

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, 'public')
  : RENDERER_DIST;

let win: BrowserWindow | null;

async function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'favicon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  });

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString());
  });

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'));
  }

  // 注册 F12 快捷键打开/关闭开发者工具
  win.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      win?.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  // 检查更新
  if (!VITE_DEV_SERVER_URL) {
    autoUpdater.checkForUpdatesAndNotify();
  }
}

// 自动更新事件监听
autoUpdater.on('update-available', (info) => {
  win?.webContents.send('update-available', {
    version: info.version,
    releaseDate: info.releaseDate,
  });
});

autoUpdater.on('download-progress', (progress) => {
  win?.webContents.send('update-download-progress', {
    percent: progress.percent,
    bytesPerSecond: progress.bytesPerSecond,
    transferred: progress.transferred,
    total: progress.total,
  });
});

autoUpdater.on('update-downloaded', (info) => {
  win?.webContents.send('update-downloaded', {
    version: info.version,
  });
  // 下载完成后 3 秒自动重启安装
  setTimeout(() => {
    autoUpdater.quitAndInstall();
  }, 3000);
});

autoUpdater.on('error', (err) => {
  console.error('[AutoUpdater] Error:', err);
  win?.webContents.send('update-error', err.message || String(err));
});

// 手动检查更新
ipcMain.on('check-for-update', () => {
  autoUpdater.checkForUpdatesAndNotify();
});

// 安装更新并重启
ipcMain.on('install-update', () => {
  autoUpdater.quitAndInstall();
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
    win = null;
  }
});

app.on('activate', async () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    await createWindow();
  }
});

// 注册 IPC 处理器
function registerIpcHandlers() {
  /**
   * 生成饿了么活动报名表
   */
  ipcMain.handle('generate-eleme-activity', async (_event, { inputString }) => {
    try {
      // 1. 调用已有的生成逻辑获取 Excel Buffer
      const buffer = await ElemeActivityGenerator.run(inputString);

      // 2. 弹出原生保存对话框
      const { filePath, canceled } = await dialog.showSaveDialog({
        title: '保存饿了么活动报名表',
        defaultPath: `饿了么活动报名表_${Date.now()}.xlsx`,
        filters: [{ name: 'Excel Files', extensions: ['xlsx'] }],
      });

      // 3. 用户取消保存
      if (canceled || !filePath) {
        return { success: false, canceled: true };
      }

      // 4. 写入文件到磁盘
      await fs.writeFile(filePath, buffer);

      return { success: true, outputPath: filePath };
    } catch (error: any) {
      console.error('生成饿了么活动报名表失败:', error);
      return { success: false, message: error.message };
    }
  });

  /**
   * 处理饿了么爆好价活动助手
   */
  ipcMain.handle(
    'process-eleme-baohaojia',
    async (_event, { fileBuffer, originalName, initialStock }) => {
      try {
        const { buffer, summary } = await ElemeBaohaojiaAnalyzer.run({
          fileBuffer: Buffer.from(fileBuffer),
          initialStock: Number(initialStock) || 9999,
        });

        const { filePath, canceled } = await dialog.showSaveDialog({
          title: '保存爆好价活动报名表',
          defaultPath: `爆好价报名_${originalName}`,
          filters: [{ name: 'Excel Files', extensions: ['xlsx'] }],
        });

        if (canceled || !filePath) {
          return { success: false, canceled: true };
        }

        await fs.writeFile(filePath, buffer);
        return { success: true, outputPath: filePath, summary };
      } catch (error: any) {
        console.error('处理爆好价活动失败:', error);
        return { success: false, message: error.message };
      }
    },
  );

  /**
   * 处理采购计划 Excel 转换
   */
  ipcMain.handle(
    'process-excel-buffers',
    async (_event, { listBuffer, refBuffer, originalName, mode }) => {
      try {
        // 2. 调用分析逻辑 (注意：IPC 传输的 ArrayBuffer 需要转为 Buffer)
        const { buffer, summary, storeNames } = await ProcurementAnalyzer.run({
          listBuffer: Buffer.from(listBuffer),
          refBuffer: Buffer.from(refBuffer),
          mode,
        });

        // 拼接门店名称到文件名 (如果有多个门店，取第一个，或者用逗号连接)
        const storeSuffix =
          storeNames.length > 0 ? `-${storeNames.join(',')}` : '';

        // 3. 弹出原生保存对话框
        const { filePath, canceled } = await dialog.showSaveDialog({
          title: '保存采购计划转换结果',
          defaultPath: `${originalName}${storeSuffix}-补货计划`,
          filters: [{ name: 'Excel Files', extensions: ['xlsx'] }],
        });

        if (canceled || !filePath) {
          return { success: false, canceled: true };
        }

        // 4. 写入文件到磁盘
        await fs.writeFile(filePath, buffer);

        return { success: true, outputPath: filePath, summary };
      } catch (error: any) {
        console.error('处理采购计划失败:', error);
        return { success: false, message: error.message };
      }
    },
  );

  /**
   * 生成采购计划 (牵牛花/翱象)
   */
  ipcMain.handle(
    'generate-procurement-plan',
    async (_event, { buffers, type }) => {
      try {
        const {
          buffer,
          summary,
          outputPath: defaultPath,
        } = await ProcurementPlanGenerator.run({
          buffers: buffers.map((b: ArrayBuffer) => Buffer.from(b)),
          type,
        });

        const { filePath, canceled } = await dialog.showSaveDialog({
          title: `保存${type === 'qianniuhua' ? '牵牛花' : '翱象'}采购计划`,
          defaultPath,
          filters: [{ name: 'Excel Files', extensions: ['xlsx'] }],
        });

        if (canceled || !filePath) {
          return { success: false, canceled: true };
        }

        await fs.writeFile(filePath, buffer);
        return { success: true, outputPath: filePath, summary };
      } catch (error: any) {
        console.error('生成采购计划失败:', error);
        return { success: false, message: error.message };
      }
    },
  );
}

app.whenReady().then(async () => {
  registerIpcHandlers();
  await createWindow();
});
