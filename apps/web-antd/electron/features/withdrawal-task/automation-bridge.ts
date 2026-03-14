/**
 * 提现自动化 - 内置版
 * 
 * 直接执行提现流程，不依赖外部脚本
 */
import type { WithdrawalExecutionResult, WithdrawalTask, WithdrawalTaskResult } from './runner';
import { launchBrowser, navigateAndLogin, closeBrowser } from './automation/browser';
import { switchStore, navigateToFinance, handleWithdrawal } from './automation/store';
import { CONFIG } from './automation/config';
import { updateRiskLevel, getDelayMultiplier } from './automation/retry';
import { createLogger } from './automation/logger';

const log = createLogger('withdrawal');

/**
 * 执行提现会话
 */
export async function executeWithdrawalSession(
  task: WithdrawalTask,
): Promise<WithdrawalExecutionResult> {
  const startedAt = Date.now();
  const results: WithdrawalTaskResult[] = [];
  
  log.info('=== 提现自动化启动 ===');
  log.info(`门店: ${task.storeNames.join(', ')}`);
  
  try {
    // 1. 启动浏览器并登录
    const { context, page } = await launchBrowser();
    await navigateAndLogin(page);
    
    // 2. 逐个门店处理
    for (let i = 0; i < task.storeIds.length; i++) {
      const storeId = task.storeIds[i];
      const storeName = task.storeNames[i] || storeId;
      
      log.info(`\n=== 处理门店: ${storeName} ===`);
      
      try {
        // 切换门店
        await switchStore(page, storeName);
        
        // 进入财务页面
        await navigateToFinance(page);
        
        // 执行提现
        const result = await handleWithdrawal(page, storeName);
        
        let status: 'success' | 'failed' = 'failed';
        let message = '';
        let withdrawAmount: number | undefined;
        
        if (result === 'success') {
          status = 'success';
          message = '提现成功';
          updateRiskLevel('success');
        } else if (result === 'blocked') {
          status = 'failed';
          message = '风控拦截';
          updateRiskLevel('blocked');
        } else {
          status = 'failed';
          message = '提现失败';
          updateRiskLevel('fail');
        }
        
        results.push({
          executedAt: new Date().toISOString(),
          message,
          status,
          storeId,
          storeName,
          withdrawAmount,
        });
        
        log.info(`门店 ${storeName}: ${status}`);
        
      } catch (error: any) {
        results.push({
          executedAt: new Date().toISOString(),
          message: error.message || '执行失败',
          status: 'failed',
          storeId,
          storeName,
        });
        log.error(`门店 ${storeName} 失败: ${error.message}`);
      }
      
      // 门店间等待
      await new Promise(resolve => setTimeout(resolve, CONFIG.baseWaitTime * getDelayMultiplier()));
    }
    
    // 3. 关闭浏览器
    await closeBrowser(context);
    
  } catch (error: any) {
    log.error(`提现会话失败: ${error.message}`);
    
    // 如果整体失败，标记所有门店为失败
    if (results.length === 0) {
      for (let i = 0; i < task.storeIds.length; i++) {
        results.push({
          executedAt: new Date().toISOString(),
          message: error.message || '会话失败',
          status: 'failed',
          storeId: task.storeIds[i],
          storeName: task.storeNames[i] || task.storeIds[i],
        });
      }
    }
  }
  
  // 生成摘要
  const successCount = results.filter(r => r.status === 'success').length;
  const failedCount = results.length - successCount;
  
  log.info('\n=== 执行摘要 ===');
  log.info(`成功: ${successCount}, 失败: ${failedCount}`);
  
  return {
    failedCount,
    finishedAt: new Date().toISOString(),
    lastRunAt: new Date().toISOString(),
    results,
    startedAt: new Date(startedAt).toISOString(),
    status: successCount > 0 && failedCount === 0 
      ? 'success' 
      : successCount > 0 && failedCount > 0 
        ? 'partial_success' 
        : 'failed',
    successCount,
    summary: buildSummary(successCount, failedCount, results.length),
  };
}

function buildSummary(successCount: number, failedCount: number, total: number) {
  if (total === 0) return '暂无执行记录';
  if (successCount === total) return `全部 ${total} 家门店提现成功`;
  if (failedCount === total) return `全部 ${total} 家门店提现失败`;
  return `${successCount} 家成功，${failedCount} 家失败`;
}

// 导出兼容接口
export const executeWithdrawalSessionViaBridge = executeWithdrawalSession;