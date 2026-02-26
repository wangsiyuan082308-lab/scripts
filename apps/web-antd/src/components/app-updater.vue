<script lang="ts" setup>
import { onMounted, onUnmounted, ref } from 'vue';

import { notification, Progress } from 'ant-design-vue';
import { h } from 'vue';

const ipc = (window as any).ipcRenderer;
const isElectron = !!ipc;

const downloading = ref(false);
const percent = ref(0);
const notificationKey = 'app-updater';

function onUpdateChecking() {
  notification.info({
    key: notificationKey,
    message: '正在检查更新',
    description: '正在连接服务器检查新版本...',
    duration: 0,
  });
}

function onUpdateAvailable(info: { version: string }) {
  notification.info({
    key: notificationKey,
    message: '发现新版本',
    description: `新版本 ${info?.version || ''} 可用，正在准备下载...`,
    duration: 0,
  });
}

function onDownloadProgress(
  progress: { percent: number; bytesPerSecond: number; transferred: number; total: number },
) {
  downloading.value = true;
  percent.value = Math.round(progress.percent);

  const speed = (progress.bytesPerSecond / 1024 / 1024).toFixed(1);
  notification.info({
    key: notificationKey,
    message: '正在下载更新',
    description: h('div', [
      h(Progress, { percent: percent.value, size: 'small', status: 'active' }),
      h('span', { style: 'color: #999; font-size: 12px' }, `${speed} MB/s`),
    ]),
    duration: 0,
  });
}

function onUpdateDownloaded(info: { version: string }) {
  downloading.value = false;
  notification.info({
    key: notificationKey,
    message: '更新即将安装',
    description: `版本 ${info?.version || ''} 已下载完成，3 秒后自动重启更新...`,
    duration: 0,
  });
}

function onUpdateError(message: string) {
  downloading.value = false;
  const errMsg = message || '未知错误';
  console.error('[AppUpdater] Error:', errMsg);
  notification.error({
    key: notificationKey,
    message: '更新失败',
    description: errMsg,
    duration: 0,
  });
}

function installUpdate() {
  ipc?.send('install-update');
}

let listeners: Array<() => void> = [];

onMounted(() => {
  if (!isElectron) return;

  ipc.on('update-checking', onUpdateChecking);
  ipc.on('update-available', onUpdateAvailable);
  ipc.on('update-download-progress', onDownloadProgress);
  ipc.on('update-downloaded', onUpdateDownloaded);
  ipc.on('update-error', onUpdateError);

  listeners = [
    () => ipc.off('update-checking', onUpdateChecking),
    () => ipc.off('update-available', onUpdateAvailable),
    () => ipc.off('update-download-progress', onDownloadProgress),
    () => ipc.off('update-downloaded', onUpdateDownloaded),
    () => ipc.off('update-error', onUpdateError),
  ];
});

onUnmounted(() => {
  listeners.forEach((off) => off());
});
</script>

<template>
  <span />
</template>
