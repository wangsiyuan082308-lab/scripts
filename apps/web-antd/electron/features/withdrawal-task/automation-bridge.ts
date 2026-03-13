/**
 * 提现自动化桥接层
 * 
 * 调用现有的 eleme-auto-withdrawal 脚本，复用稳定的提现流程
 * 同时利用 Scripts 的 UI 优势
 */
import { spawn } from 'child_process';
import type { WithdrawalExecutionResult, WithdrawalTask, WithdrawalTaskResult } from '../runner';

// 现有提现脚本路径
const WITHDRAWAL_SCRIPT_DIR = '/Users/mac/.openclaw/skills-pool/business/eleme-auto-withdrawal';

/**
 * 执行提现会话（调用现有脚本）
 */
export async function executeWithdrawalSessionViaBridge(
  task: WithdrawalTask,
): Promise<WithdrawalExecutionResult> {
  const startedAt = Date.now();
  
  // 构建参数
  const storeArgs = task.storeIds.join(',');
  const storeNameArgs = task.storeNames.join(',');
  
  return new Promise((resolve, reject) => {
    const child = spawn(
      'npx',
      ['ts-node', 'src/bridge-run.ts', '--stores', storeArgs, '--names', storeNameArgs],
      {
        cwd: WITHDRAWAL_SCRIPT_DIR,
        env: {
          ...process.env,
          NODE_ENV: 'production',
        },
      }
    );
    
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      // 可以在这里发送进度更新到UI
      console.log('[withdrawal]', text.trim());
    });
    
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    child.on('close', (code) => {
      if (code === 0) {
        try {
          // 解析执行结果
          const result = parseExecutionResult(stdout, task, startedAt);
          resolve(result);
        } catch (error) {
          reject(new Error(`解析结果失败: ${error}`));
        }
      } else {
        reject(new Error(`提现脚本执行失败: ${stderr || stdout}`));
      }
    });
    
    child.on('error', (error) => {
      reject(new Error(`启动提现脚本失败: ${error.message}`));
    });
  });
}

/**
 * 解析执行结果
 */
function parseExecutionResult(
  output: string,
  task: WithdrawalTask,
  startedAt: number,
): WithdrawalExecutionResult {
  const results: WithdrawalTaskResult[] = [];
  
  // 尝试从JSON结果中解析
  const jsonMatch = output.match(/=== JSON_RESULT ===\n([\s\S]*?)\n=== END_JSON_RESULT ===/);
  
  if (jsonMatch) {
    try {
      const jsonResults = JSON.parse(jsonMatch[1]);
      for (const r of jsonResults) {
        results.push({
          executedAt: new Date().toISOString(),
          message: r.message,
          status: r.status === 'success' ? 'success' : 'failed',
          storeId: r.storeId,
          storeName: r.storeName,
          withdrawAmount: r.withdrawAmount,
        });
      }
    } catch (e) {
      console.error('解析JSON结果失败:', e);
    }
  }
  
  // 如果没有解析到结果，使用回退逻辑
  if (results.length === 0) {
    const lines = output.split('\n');
    
    for (let i = 0; i < task.storeIds.length; i++) {
      const storeId = task.storeIds[i];
      const storeName = task.storeNames[i] || storeId;
      
      const resultLine = lines.find(line => 
        line.includes(storeName) || line.includes(storeId)
      );
      
      let status: 'success' | 'failed' = 'failed';
      let message = '';
      
      if (resultLine) {
        if (resultLine.includes('✅') || resultLine.includes('success')) {
          status = 'success';
          message = '提现成功';
        } else if (resultLine.includes('❌') || resultLine.includes('fail')) {
          status = 'failed';
          message = '提现失败';
        } else if (resultLine.includes('⚠️') || resultLine.includes('blocked')) {
          status = 'failed';
          message = '风控拦截';
        }
      } else {
        message = '未找到执行结果';
      }
      
      results.push({
        executedAt: new Date().toISOString(),
        message,
        status,
        storeId,
        storeName,
      });
    }
  }
  
  const successCount = results.filter(r => r.status === 'success').length;
  const failedCount = results.length - successCount;
  
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