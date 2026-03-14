import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import { Page } from 'playwright';
import * as ExcelJS from 'exceljs';
import { NoStockSku, DOWNLOADS_DIR } from './types-v2';
import { log } from './utils';
import { ensureDir, closeModals } from './page-helpers';

export function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(dest);
    proto.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        const redirectUrl = res.headers.location;
        if (redirectUrl) {
          file.close();
          fs.unlinkSync(dest);
          return downloadFile(redirectUrl, dest).then(resolve).catch(reject);
        }
      }
      if (res.statusCode !== 200) {
        file.close();
        reject(new Error('下载失败: HTTP ' + res.statusCode));
        return;
      }
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

export async function downloadViaPage(page: Page, url: string, dest: string): Promise<void> {
  const base64 = await page.evaluate(async (fetchUrl: string) => {
    const resp = await fetch(fetchUrl);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const blob = await resp.blob();
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1] || '');
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }, url);

  fs.writeFileSync(dest, Buffer.from(base64, 'base64'));
}

export async function exportViaTaskCenter(
  page: Page,
  clickExport: () => Promise<void>,
  queryType: string,
  config: { exportPollInterval: number; exportMaxWait: number },
): Promise<string> {
  ensureDir(DOWNLOADS_DIR);

  const beforeExport = new Date();

  await clickExport();
  await page.waitForTimeout(2000);

  await closeModals(page);

  const today = new Date();
  const startDate = new Date(today.getTime() - 7 * 86400000);
  const fmtDate = (d: Date) => d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0');
  const fmtDateCompact = (d: Date) => d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');

  const pollBody = {
    queryType,
    date: [fmtDate(startDate), fmtDate(today)],
    pageSize: 20,
    startTime: fmtDateCompact(startDate),
    endTime: fmtDateCompact(today),
    page: 1,
    taskMode: '',
  };

  log('  轮询任务状态 (queryType=' + queryType + ')...');
  const startTime = Date.now();

  while (Date.now() - startTime < config.exportMaxWait) {
    await page.waitForTimeout(config.exportPollInterval);

    const result = await page.evaluate(async (body) => {
      try {
        const resp = await fetch('/api/v1/task/queryTasks?yodaReady=h5&csecplatform=4&csecversion=4.2.0', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        return await resp.json();
      } catch (e: any) {
        return { code: -1, msg: e.message };
      }
    }, pollBody);

    if (result.code !== 0 || !result.data?.list?.length) {
      log('  任务查询: 无结果，继续等待...');
      continue;
    }

    if (!queryType && Date.now() - startTime < 15000) {
      result.data.list.slice(0, 3).forEach((t: any) => {
        log('    [' + t.taskType + '] ' + t.executingState + ' | ' + t.taskName + ' | ' + t.opTime + ' | handleResult=' + (t.handleResult || '').substring(0, 80));
      });
    }

    const task = result.data.list[0];
    const taskTime = new Date(task.opTime.replace(/\./g, '-'));

    let targetTask = task;
    if (taskTime < beforeExport && result.data.list.length > 1) {
      const newerTask = result.data.list.find((t: any) => new Date(t.opTime.replace(/\./g, '-')) >= beforeExport);
      if (newerTask) targetTask = newerTask;
    }

    const state = targetTask.executingState;
    const elapsed = Math.round((Date.now() - startTime) / 1000);

    if (state === '已完成') {
      const dlUrl = targetTask.handleResult || targetTask.oprLinkUrl || '';
      if (dlUrl && (dlUrl.startsWith('http://') || dlUrl.startsWith('https://') || dlUrl.startsWith('{'))) {
        return await downloadTaskResult(targetTask, page, '');
      } else {
        throw new Error('导出任务已完成但无有效下载URL (taskId=' + targetTask.taskId + ', taskType=' + targetTask.taskType + ')');
      }
    }

    if (state === '失败' || state === '已失败' || state === '处理失败') {
      const reason = targetTask.taskResult || targetTask.handleResult || '未知原因';
      throw new Error('导出任务失败 (taskId=' + targetTask.taskId + '): ' + reason);
    }

    log('  任务 ' + targetTask.taskId + ' 状态: ' + state + ' (' + elapsed + 's)');
  }

  throw new Error('导出超时: ' + config.exportMaxWait / 1000 + '秒内任务未完成');
}
export async function downloadTaskResult(task: any, page: Page | undefined, baseUrl: string): Promise<string> {
  ensureDir(DOWNLOADS_DIR);
  let downloadUrl = task.handleResult || task.oprLinkUrl || '';

  if (downloadUrl && downloadUrl.startsWith('{')) {
    try {
      const parsed = JSON.parse(downloadUrl);
      log('  handleResult JSON: ' + JSON.stringify(parsed));
    } catch { /* ignore */ }

    if (task.oprLinkUrl) {
      const oprUrl = task.oprLinkUrl.startsWith('http')
        ? task.oprLinkUrl
        : baseUrl + task.oprLinkUrl;
      downloadUrl = oprUrl;
      log('  使用 oprLinkUrl: ' + downloadUrl);
    } else {
      throw new Error('handleResult是JSON但无oprLinkUrl, taskId=' + task.taskId);
    }
  }

  if (!downloadUrl || (!downloadUrl.startsWith('http://') && !downloadUrl.startsWith('https://'))) {
    log('  无效下载URL: ' + JSON.stringify(task.handleResult || '').substring(0, 300));
    log('  任务详情: taskId=' + task.taskId + ', state=' + task.executingState + ', taskType=' + task.taskType);
    if (task.oprLinkUrl) {
      downloadUrl = task.oprLinkUrl.startsWith('http') ? task.oprLinkUrl : baseUrl + task.oprLinkUrl;
      log('  fallback oprLinkUrl: ' + downloadUrl.substring(0, 100));
    } else {
      throw new Error('Invalid download URL: ' + (downloadUrl || '(empty)'));
    }
  }

  let filename = 'export.xlsx';
  try {
    const urlObj = new URL(downloadUrl);
    const pathName = urlObj.pathname.split('/').pop() || '';
    if (pathName && pathName.includes('.')) {
      filename = decodeURIComponent(pathName);
    } else {
      try {
        const parsed = JSON.parse(task.handleResult || '{}');
        if (parsed.fileName) filename = parsed.fileName;
      } catch { /* ignore */ }
    }
  } catch {
    // URL解析失败，用默认文件名
  }
  const filepath = path.join(DOWNLOADS_DIR, Date.now() + '-' + filename);

  log('  任务完成! 下载: ' + filename);

  if (page && downloadUrl.includes('/api/v1/task/exportData')) {
    await downloadViaPage(page, downloadUrl, filepath);
  } else {
    await downloadFile(downloadUrl, filepath);
  }

  const stat = fs.statSync(filepath);
  log('  文件已下载: ' + filepath + ' (' + Math.round(stat.size / 1024) + 'KB)');
  return filepath;
}
export async function filterPlanExcel(planFile: string, noStockSkus: NoStockSku[]): Promise<string> {
  if (noStockSkus.length === 0) return planFile;
  const noStockSet = new Set(noStockSkus.map(s => s.sku));
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(planFile);
  const ws = wb.worksheets[0];
  if (!ws) return planFile;

  let skuColIdx = -1;
  const headerRow = ws.getRow(1);
  headerRow.eachCell((cell, colNumber) => {
    const val = String(cell.value || '');
    if (val.includes('SKU') || val.includes('sku')) skuColIdx = colNumber;
  });
  if (skuColIdx === -1) {
    log('  未找到SKU列，无法过滤');
    return planFile;
  }

  const rowsToDelete: number[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const sku = String(row.getCell(skuColIdx).value || '').trim();
    if (noStockSet.has(sku)) rowsToDelete.push(rowNumber);
  });
  for (let i = rowsToDelete.length - 1; i >= 0; i--) {
    ws.spliceRows(rowsToDelete[i], 1);
  }

  const newFile = planFile.replace('.xlsx', '-filtered-' + Date.now() + '.xlsx');
  await wb.xlsx.writeFile(newFile);
  log('  已剔除 ' + rowsToDelete.length + ' 个无库存SKU，新文件: ' + newFile);
  return newFile;
}

export function isDeadLoop(prevSkus: NoStockSku[], currSkus: NoStockSku[]): boolean {
  if (prevSkus.length === 0 || currSkus.length === 0) return false;
  if (prevSkus.length !== currSkus.length) return false;
  const prevSet = new Set(prevSkus.map(s => s.sku));
  return currSkus.every(s => prevSet.has(s.sku));
}
