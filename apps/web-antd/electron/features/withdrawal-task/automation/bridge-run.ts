/**
 * 提现脚本桥接入口
 * 
 * 供 Scripts Electron 调用，支持命令行参数
 * 
 * 用法: npx ts-node src/bridge-run.ts --stores store1,store2 -- names name1,name2
 */
import process from 'node:process';
import { CONFIG } from './config';
import { launchBrowser, navigateAndLogin, closeBrowser, delay } from './browser';
import { createLogger } from './logger';
import { switchStore, navigateToFinance, handleWithdrawal } from './store';
import { retryWithBackoff, updateRiskLevel, getDelayMultiplier, getRiskLevel, RiskLevel } from './retry';

const log = createLogger('bridge');

interface BridgeResult {
  storeId: string;
  storeName: string;
  status: 'success' | 'failed' | 'blocked';
  message: string;
  withdrawAmount?: number;
}

async function runBridge(storeIds: string[], storeNames: string[]) {
  const results: BridgeResult[] = [];
  
  log.info('=== 提现桥接启动 ===');
  log.info(`门店: ${storeNames.join(', ')}`);
  
  const { context, page } = await launchBrowser();
  await navigateAndLogin(page);
  
  for (let i = 0; i < storeIds.length; i++) {
    const storeId = storeIds[i];
    const storeName = storeNames[i] || storeId;
    
    log.info(`\n=== 处理门店: ${storeName} ===`);
    
    try {
      await switchStore(page, storeName);
      await navigateToFinance(page);
      
      const result = await handleWithdrawal(page, storeName);
      
      let status: 'success' | 'failed' | 'blocked' = 'failed';
      let message = '';
      
      if (result === 'success') {
        status = 'success';
        message = '提现成功';
        updateRiskLevel('success');
      } else if (result === 'blocked') {
        status = 'blocked';
        message = '风控拦截';
        updateRiskLevel('blocked');
      } else {
        status = 'failed';
        message = '提现失败';
        updateRiskLevel('fail');
      }
      
      results.push({
        storeId,
        storeName,
        status,
        message,
      });
      
      log.info(`门店 ${storeName}: ${status}`);
      
    } catch (error: any) {
      results.push({
        storeId,
        storeName,
        status: 'failed',
        message: error.message || '执行失败',
      });
      log.error(`门店 ${storeName} 失败: ${error.message}`);
    }
    
    // 门店间等待
    await delay(CONFIG.baseWaitTime * getDelayMultiplier());
  }
  
  await closeBrowser(context);
  
  // 输出结果摘要
  log.info('\n=== 执行摘要 ===');
  for (const r of results) {
    const icon = r.status === 'success' ? '✅' : r.status === 'blocked' ? '⚠️' : '❌';
    log.info(`${icon} ${r.storeName}: ${r.status}`);
  }
  
  const successCount = results.filter(r => r.status === 'success').length;
  const failCount = results.length - successCount;
  log.info(`总计: ${results.length}个门店, 成功${successCount}, 失败${failCount}`);
  
  // 输出JSON结果（供调用方解析）
  console.log('\n=== JSON_RESULT ===');
  console.log(JSON.stringify(results));
  console.log('=== END_JSON_RESULT ===');
  
  return results;
}

// 解析命令行参数
function parseArgs() {
  const args = process.argv.slice(2);
  const stores: string[] = [];
  const names: string[] = [];
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--stores' && args[i + 1]) {
      stores.push(...args[i + 1].split(',').map(s => s.trim()));
      i++;
    } else if (args[i] === '--names' && args[i + 1]) {
      names.push(...args[i + 1].split(',').map(s => s.trim()));
      i++;
    }
  }
  
  return { stores, names };
}

// 主入口
const { stores, names } = parseArgs();

if (stores.length === 0) {
  console.error('用法: npx ts-node src/bridge-run.ts --stores store1,store2 --names name1,name2');
  process.exit(1);
}

runBridge(stores, names)
  .then(() => {
    log.info('提现桥接完成');
    process.exit(0);
  })
  .catch((err) => {
    log.error(`提现桥接失败: ${err}`);
    process.exit(1);
  });