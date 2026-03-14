#!/usr/bin/env node
/**
 * 提现任务 CLI 入口
 * 
 * 用法：
 *   node withdrawal-cli.js [--stores "安吉店,长兴店"]
 * 
 * Cron 示例：
 *   0 6 * * * cd /path/to/scripts && node apps/web-antd/electron/features/withdrawal-task/withdrawal-cli.js
 */

import { executeWithdrawalSession } from './automation-bridge.js';

// 默认门店列表
const DEFAULT_STORES = [
  { id: 'OBYJA002', name: 'Oby便利超市(安吉店)' },
  { id: 'OBYCX001', name: 'Oby便利超市(长兴店)' },
];

async function main() {
  console.log('[CLI] 提现任务启动 -', new Date().toLocaleString('zh-CN'));
  
  // 解析命令行参数
  const args = process.argv.slice(2);
  let stores = DEFAULT_STORES;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--stores' && args[i + 1]) {
      const storeNames = args[i + 1].split(',');
      stores = storeNames.map((name, idx) => ({
        id: `store_${idx}`,
        name: name.trim(),
      }));
      i++;
    }
  }
  
  const task = {
    id: `cli_${Date.now()}`,
    taskId: `task_${Date.now()}`,
    taskType: 'eleme_withdrawal' as const,
    triggerMode: 'daily' as const,
    status: 'pending' as const,
    storeIds: stores.map(s => s.id),
    storeNames: stores.map(s => s.name),
    storeCount: stores.length,
    successCount: 0,
    failedCount: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    results: [],
  };
  
  console.log(`[CLI] 目标门店: ${stores.map(s => s.name).join(', ')}`);
  
  try {
    const result = await executeWithdrawalSession(task);
    
    console.log('\n[CLI] ========== 执行摘要 ==========');
    console.log(`[CLI] 成功: ${result.successCount}, 失败: ${result.failedCount}`);
    console.log(`[CLI] 状态: ${result.status}`);
    console.log(`[CLI] 摘要: ${result.summary}`);
    console.log('[CLI] ================================');
    
    // 退出码：有失败返回 1，全成功返回 0
    process.exit(result.failedCount > 0 ? 1 : 0);
    
  } catch (error: any) {
    console.error('[CLI] 执行失败:', error.message);
    process.exit(1);
  }
}

main();