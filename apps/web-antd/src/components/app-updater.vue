<script lang="ts" setup>
import { onMounted, onUnmounted, ref } from 'vue';

import { Button, notification, Progress } from 'ant-design-vue';
import { h } from 'vue';

const ipc = (window as any).ipcRenderer;
const isElectron = !!ipc;

const downloading = ref(false);
const percent = ref(0);
const notificationKey = 'app-updater';

function onUpdateAvailable(_e: any, info: { version: string }) {
  notification.info({
    key: notificationKey,
    message: '发现新版本',
    description: `新版本 ${info?.version || ''} 可用，正在准备下载...`,
    duration: 0,
  });
}

function onDownloadProgress(
  _e: any,
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

function onUpdateDownloaded(_e: any, info: { version: string }) {
  downloading.value = false;
  notification.success({
    key: notificationKey,
    message: '更新已就绪',
    description: `版本 ${info?.version || ''} 已下载完成`,
    duration: 0,
    btn: () =>
      h(
        Button,
        { type: 'primary', size: 'small', onClick: installUpdate },
        () => '立即重启更新',
      ),
  });
}

function onUpdateError(_e: any, message: string) {
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

  ipc.on('update-available', onUpdateAvailable);
  ipc.on('update-download-progress', onDownloadProgress);
  ipc.on('update-downloaded', onUpdateDownloaded);
  ipc.on('update-error', onUpdateError);

  listeners = [
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
