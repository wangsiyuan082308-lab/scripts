import { Buffer } from 'node:buffer';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import { autoUpdater } from 'electron-updater';

import pkg from '../package.json';

import { ElemeActivityGenerator } from './features/eleme-activity/index';
import { ElemeBaohaojiaAnalyzer } from './features/eleme-baohaojia/index';
import { getExecutionLogs } from './features/execution-logs/index';
import { ProcurementTaskRunner } from './features/procurement-task/runner';
import { ProcurementAnalyzer } from './features/procurement/index';
import { ProcurementPlanGenerator } from './features/procurement/plan-generator';
import {
  getProductCompareAiConfig,
  runProductCompare,
  saveProductCompareAiConfig,
} from './features/product-compare/index';
import {
  clearProductMaster,
  getProductMasterFilterOptions,
  getProductMasterStatus,
  importProductMasterJson,
  listProductMasterRecords,
  refreshProductMasterIndex,
} from './features/product-master/index';
import { authFeature } from './features/auth/index';
import { StoreMasterFeature } from './features/store-master/index';
import { SupplierMasterFeature } from './features/supplier-master/index';
import { addLogListener } from './features/withdrawal-task/automation/logger.js';
import { WithdrawalTaskRunner } from './features/withdrawal-task/runner.js';
import {
  storeStorage,
  supplierStorage,
  taskStorage,
  merchantStorage,
} from './shared/storage';

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
let currentAuthUser:
  | null
  | {
      accessToken: string;
      id: string;
      merchantId?: string;
      name?: string;
      role: 'merchant_admin' | 'super_admin' | 'user';
      username: string;
    } = null;

const ELECTRON_BACKEND_BASE_URL =
  process.env.ELECTRON_BACKEND_BASE_URL || 'http://127.0.0.1:3030';

function buildLocalAccessCodes(role: string) {
  if (role === 'super_admin') {
    return ['AC_100100', 'AC_100110', 'AC_100120', 'AC_100010'];
  }
  if (role === 'merchant_admin') {
    return ['AC_100100', 'AC_100110'];
  }
  return ['AC_1000001', 'AC_1000002'];
}

function buildLocalUserPayload() {
  if (!currentAuthUser) {
    return null;
  }
  return {
    accessToken: currentAuthUser.accessToken,
    id: currentAuthUser.id,
    merchantId: currentAuthUser.merchantId,
    realName: currentAuthUser.name || currentAuthUser.username,
    role: currentAuthUser.role,
    roles: [currentAuthUser.role],
    username: currentAuthUser.username,
    homePath: '/dashboard',
  };
}

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
    // 延迟 3 秒检查更新，避免阻塞启动
    setTimeout(() => {
      autoUpdater.logger = console;
      autoUpdater.checkForUpdatesAndNotify();
    }, 3000);
  }
}

// 自动更新事件监听
autoUpdater.on('update-available', (info) => {
  console.log('[AutoUpdater] Update available:', info.version);
  win?.webContents.send('update-available', {
    version: info.version,
    releaseDate: info.releaseDate,
  });
});

autoUpdater.on('download-progress', (progress) => {
  console.log(`[AutoUpdater] Download progress: ${progress.percent.toFixed(1)}%`);
  win?.webContents.send('update-download-progress', {
    percent: progress.percent,
    bytesPerSecond: progress.bytesPerSecond,
    transferred: progress.transferred,
    total: progress.total,
  });
});

autoUpdater.on('update-downloaded', (info) => {
  console.log('[AutoUpdater] Update downloaded:', info.version);
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
  // Electron 仅负责本地数据处理，认证交由 HTTP 接口处理。
  const requireAuth = () => {
    if (currentAuthUser) {
      return currentAuthUser;
    }
    throw new Error('请先登录后再执行该操作。');
  };

  ipcMain.handle('local-auth-login', async (_event, { password, username }) => {
    try {
      const response = await fetch(`${ELECTRON_BACKEND_BASE_URL}/api/auth/login`, {
        body: JSON.stringify({
          password: `${password || ''}`,
          username: `${username || ''}`,
        }),
        headers: {
          'Content-Type': 'application/json',
        },
        method: 'POST',
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            code?: number;
            data?: Record<string, any>;
            error?: string;
            message?: string;
          }
        | null;

      if (!response.ok || payload?.code !== 0 || !payload?.data?.accessToken) {
        return {
          message:
            payload?.error ||
            payload?.message ||
            '用户名或密码错误。',
          success: false,
        };
      }

      const user = payload.data;
      const role =
        user.role === 'merchant_admin' || user.role === 'user'
          ? user.role
          : 'super_admin';

      currentAuthUser = {
        accessToken: `${user.accessToken}`,
        id: `${user.userId || user.id || user.username || username || ''}`,
        merchantId: `${user.merchantId || ''}` || undefined,
        name: `${user.realName || user.username || ''}` || undefined,
        role,
        username: `${user.username || username || ''}`,
      };

      return {
        success: true,
        user: buildLocalUserPayload(),
      };
    } catch (error: any) {
      return {
        message: error?.message || '登录失败，请确认后端服务可用。',
        success: false,
      };
    }
  });

  ipcMain.handle('local-auth-logout', async () => {
    currentAuthUser = null;
    return { success: true };
  });

  ipcMain.handle('local-auth-get-user-info', async () => {
    if (!currentAuthUser) {
      return null;
    }
    return buildLocalUserPayload();
  });

  ipcMain.handle('local-auth-get-access-codes', async () => {
    if (!currentAuthUser) {
      return [];
    }
    return buildLocalAccessCodes(currentAuthUser.role);
  });
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
   * 生成采购计划 (仅翱象)
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
          title: '保存翱象采购计划',
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

  /**
   * 导入供应商主数据
   */
  ipcMain.handle('import-suppliers', async (_event, { fileBuffer }) => {
    try {
      const suppliers = await SupplierMasterFeature.importSuppliers(
        Buffer.from(fileBuffer),
      );
      return { success: true, data: suppliers };
    } catch (error: any) {
      console.error('导入供应商失败:', error);
      return { success: false, message: error.message };
    }
  });

  /**
   * 导入店铺主数据
   */
  ipcMain.handle('import-stores', async (_event, { fileBuffer }) => {
    try {
      const user = requireAuth();
      const stores = await StoreMasterFeature.importStores(
        Buffer.from(fileBuffer),
      );
      // Save imported stores to local JSON storage
      await storeStorage.save(stores, user);
      return { success: true, data: stores };
    } catch (error: any) {
      console.error('导入店铺失败:', error);
      return { success: false, message: error.message };
    }
  });

  /**
   * 获取商品总表状态
   */
  ipcMain.handle('get-product-master-status', async () => {
    try {
      const data = await getProductMasterStatus();
      return { success: true, data };
    } catch (error: any) {
      console.error('获取商品总表状态失败:', error);
      return { success: false, message: error.message };
    }
  });

  /**
   * 手动导入商品总表 JSON
   */
  ipcMain.handle(
    'import-product-master',
    async (_event, { fileBuffer, originalName }) => {
      try {
        const data = await importProductMasterJson(
          Buffer.from(fileBuffer),
          originalName || 'manual-upload.json',
        );
        return { success: true, data };
      } catch (error: any) {
        console.error('导入商品总表失败:', error);
        return { success: false, message: error.message };
      }
    },
  );

  ipcMain.handle('list-product-master-records', async (_event, params) => {
    try {
      const data = await listProductMasterRecords(params || {});
      return { success: true, data };
    } catch (error: any) {
      console.error('获取商品总表列表失败:', error);
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('get-product-master-filter-options', async () => {
    try {
      const data = await getProductMasterFilterOptions();
      return { success: true, data };
    } catch (error: any) {
      console.error('获取商品总表筛选项失败:', error);
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('refresh-product-master', async () => {
    try {
      const data = await refreshProductMasterIndex();
      return { success: true, data };
    } catch (error: any) {
      console.error('刷新商品总表失败:', error);
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('clear-product-master', async () => {
    try {
      const data = await clearProductMaster();
      return { success: true, data };
    } catch (error: any) {
      console.error('清空商品总表失败:', error);
      return { success: false, message: error.message };
    }
  });
  /**
   * 执行采购任务
   */
  ipcMain.handle(
    'run-product-compare',
    async (_event, { referenceBuffer, sourceMode, targetBuffer }) => {
      try {
        const data = await runProductCompare({
          referenceBuffer: referenceBuffer
            ? Buffer.from(referenceBuffer)
            : undefined,
          sourceMode,
          targetBuffer: Buffer.from(targetBuffer),
        });
        return { success: true, data };
      } catch (error: any) {
        console.error('商品比对失败:', error);
        return { success: false, message: error.message };
      }
    },
  );

  ipcMain.handle('get-product-compare-ai-config', async () => {
    try {
      const data = await getProductCompareAiConfig();
      return { success: true, data };
    } catch (error: any) {
      console.error('获取商品比对 AI 配置失败:', error);
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('save-product-compare-ai-config', async (_event, config) => {
    try {
      const data = await saveProductCompareAiConfig(config || {});
      return { success: true, data };
    } catch (error: any) {
      console.error('保存商品比对 AI 配置失败:', error);
      return { success: false, message: error.message };
    }
  });

  ipcMain.handle('execute-procurement-task', async (_event, task) => {
    console.info('[execute-procurement-task]', {
      platform: task?.platform,
      runId: task?.runId,
      taskId: task?.taskId,
    });
    return await ProcurementTaskRunner.executeTask(task);
  });

  ipcMain.handle('get-execution-logs', async (_event, params) => {
    requireAuth();
    return await getExecutionLogs(params || {});
  });

  /**
   * 执行提现任务，并将实时日志推送给当前渲染进程
   */
  ipcMain.handle('execute-withdrawal-task', async (event, task) => {
    const runId =
      task?.clientRequestId || task?.id || task?.taskId || `withdrawal_${Date.now()}`;
    const sendLog = (entry: Record<string, any>) => {
      event.sender.send('withdrawal-log', {
        entry,
        runId,
      });
    };

    const removeListener = addLogListener((entry) => {
      sendLog(entry);
    });

    sendLog({
      level: 'INFO',
      message: '提现任务已提交，开始执行。',
      module: 'withdrawal-ui',
      timestamp: new Date().toISOString(),
    });

    try {
      const result = await WithdrawalTaskRunner.executeTask(task);
      return {
        ...result,
        runId,
      };
    } catch (error: any) {
      sendLog({
        level: 'ERROR',
        message: error?.message || '提现任务执行失败',
        module: 'withdrawal-ui',
        timestamp: new Date().toISOString(),
      });
      throw error;
    } finally {
      removeListener();
    }
  });

  // --- Storage Management Handlers ---

  // Merchants
  ipcMain.handle('get-merchants', async () => {
    const user = requireAuth();
    return merchantStorage.get(user);
  });
  ipcMain.handle('add-merchant', async (_event, item) => {
    const user = requireAuth();
    return merchantStorage.add(item, user);
  });
  ipcMain.handle('update-merchant', async (_event, item) => {
    const user = requireAuth();
    return merchantStorage.update(item, user);
  });
  ipcMain.handle('delete-merchant', async (_event, id) => {
    const user = requireAuth();
    return merchantStorage.delete(id, user);
  });

  // Stores
  ipcMain.handle('get-stores', async () => {
    const user = requireAuth();
    return storeStorage.get(user);
  });
  ipcMain.handle('save-stores', async (_event, data) => {
    const user = requireAuth();
    return storeStorage.save(data, user);
  });
  ipcMain.handle('add-store', async (_event, item) => {
    const user = requireAuth();
    return storeStorage.add(item, user);
  });
  ipcMain.handle('update-store', async (_event, item) => {
    const user = requireAuth();
    return storeStorage.update(item, user);
  });
  ipcMain.handle('delete-store', async (_event, id) => {
    const user = requireAuth();
    return storeStorage.delete(id, user);
  });

  // Suppliers
  ipcMain.handle('get-suppliers', async () => {
    const user = requireAuth();
    return supplierStorage.get(user);
  });
  ipcMain.handle('save-suppliers', async (_event, data) => {
    const user = requireAuth();
    return supplierStorage.save(data, user);
  });
  ipcMain.handle('add-supplier', async (_event, item) => {
    const user = requireAuth();
    return supplierStorage.add(item, user);
  });
  ipcMain.handle('update-supplier', async (_event, item) => {
    const user = requireAuth();
    return supplierStorage.update(item, user);
  });
  ipcMain.handle('delete-supplier', async (_event, id) => {
    const user = requireAuth();
    return supplierStorage.delete(id, user);
  });

  // Tasks
  ipcMain.handle('get-tasks', async () => {
    const user = requireAuth();
    return taskStorage.get(user);
  });
  ipcMain.handle('save-tasks', async (_event, data) => {
    const user = requireAuth();
    return taskStorage.save(data, user);
  });
  ipcMain.handle('add-task', async (_event, item) => {
    const user = requireAuth();
    return taskStorage.add(item, user);
  });
  ipcMain.handle('update-task', async (_event, item) => {
    const user = requireAuth();
    return taskStorage.update(item, user);
  });
  ipcMain.handle('delete-task', async (_event, id) => {
    const user = requireAuth();
    return taskStorage.delete(id, user);
  });
}

app.whenReady().then(async () => {
  process.env.PRODUCT_MASTER_HOME = path.join(
    app.getPath('userData'),
    'product-master',
  );
  await authFeature.init();
  setupMenu();
  registerIpcHandlers();
  await createWindow();
});

function setupMenu() {
  const isMac = process.platform === 'darwin';
  const appName = '前端小工具';

  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? [
          {
            label: appName,
            submenu: [
              {
                label: `关于 ${appName}`,
                click: () => {
                  dialog.showMessageBox({
                    type: 'info',
                    title: `关于 ${appName}`,
                    message: appName,
                    detail: `版本: v${pkg.version}\n${pkg.description || ''}`,
                  });
                },
              },
              { type: 'separator' as const },
              {
                label: '检查更新...',
                click: () => {
                  win?.webContents.send('update-checking');
                  autoUpdater.checkForUpdatesAndNotify();
                },
              },
              { type: 'separator' as const },
              { label: `隐藏 ${appName}`, role: 'hide' as const },
              { label: '隐藏其他', role: 'hideOthers' as const },
              { label: '显示全部', role: 'unhide' as const },
              { type: 'separator' as const },
              { label: `退出 ${appName}`, role: 'quit' as const },
            ],
          } as Electron.MenuItemConstructorOptions,
        ]
      : []),
    {
      label: '文件',
      submenu: [
        ...(!isMac
          ? [
              {
                label: '检查更新...',
                click: () => {
                  win?.webContents.send('update-checking');
                  autoUpdater.checkForUpdatesAndNotify();
                },
              },
              { type: 'separator' as const },
            ]
          : []),
        { label: isMac ? '关闭窗口' : '退出', role: (isMac ? 'close' : 'quit') as const },
      ],
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo' as const },
        { label: '重做', role: 'redo' as const },
        { type: 'separator' as const },
        { label: '剪切', role: 'cut' as const },
        { label: '复制', role: 'copy' as const },
        { label: '粘贴', role: 'paste' as const },
        { label: '全选', role: 'selectAll' as const },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载', role: 'reload' as const },
        { label: '强制重新加载', role: 'forceReload' as const },
        { label: '开发者工具', role: 'toggleDevTools' as const },
        { type: 'separator' as const },
        { label: '实际大小', role: 'resetZoom' as const },
        { label: '放大', role: 'zoomIn' as const },
        { label: '缩小', role: 'zoomOut' as const },
        { type: 'separator' as const },
        { label: '全屏', role: 'togglefullscreen' as const },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { label: '最小化', role: 'minimize' as const },
        { label: '缩放', role: 'zoom' as const },
        ...(isMac
          ? [
              { type: 'separator' as const },
              { label: '前置全部窗口', role: 'front' as const },
            ]
          : [{ label: '关闭', role: 'close' as const }]),
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}
