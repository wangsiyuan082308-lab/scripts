#!/usr/bin/env node

/**
 * Usage:
 *   pnpm exec tsx apps/web-antd/electron/features/withdrawal-task/withdrawal-cli.ts
 *   pnpm exec tsx apps/web-antd/electron/features/withdrawal-task/withdrawal-cli.ts --stores "Oby便利超市(安吉店),Oby便利超市(长兴店)"
 *   pnpm exec tsx apps/web-antd/electron/features/withdrawal-task/withdrawal-cli.ts --dry-run
 */

import { executeWithdrawalSession } from './automation-bridge.ts';

const DEFAULT_STORES = [
  { id: 'OBYJA002', name: 'Oby便利超市(安吉店)' },
  { id: 'OBYCX001', name: 'Oby便利超市(长兴店)' },
];

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  let stores = DEFAULT_STORES;
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--stores' && args[i + 1]) {
      const storeNames = args[i + 1]
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean);
      stores = storeNames.map((name, index) => ({
        id: `store_${index}`,
        name,
      }));
      i++;
      continue;
    }

    if (args[i] === '--dry-run') {
      dryRun = true;
    }
  }

  return { dryRun, stores };
}

async function main() {
  console.log('[CLI] 提现任务启动 -', new Date().toLocaleString('zh-CN'));

  const { dryRun, stores } = parseArgs(process.argv);
  if (dryRun) {
    process.env.WITHDRAWAL_DRY_RUN = '1';
  }

  const task = {
    createdAt: new Date().toISOString(),
    failedCount: 0,
    id: `cli_${Date.now()}`,
    results: [],
    status: 'pending' as const,
    storeCount: stores.length,
    storeIds: stores.map((store) => store.id),
    storeNames: stores.map((store) => store.name),
    successCount: 0,
    taskId: `task_${Date.now()}`,
    taskType: 'eleme_withdrawal' as const,
    triggerMode: 'daily' as const,
    updatedAt: new Date().toISOString(),
  };

  console.log(`[CLI] 目标门店: ${stores.map((store) => store.name).join(', ')}`);
  if (dryRun) {
    console.log('[CLI] 模式: dry-run');
  }

  try {
    const result = await executeWithdrawalSession(task);

    console.log('\n[CLI] ========== 执行摘要 ==========');
    console.log(`[CLI] 成功: ${result.successCount}, 失败: ${result.failedCount}`);
    console.log(`[CLI] 状态: ${result.status}`);
    console.log(`[CLI] 摘要: ${result.summary}`);
    console.log('[CLI] ================================');

    process.exit(result.failedCount > 0 ? 1 : 0);
  } catch (error: any) {
    console.error('[CLI] 执行失败:', error?.message || error);
    process.exit(1);
  }
}

main();
