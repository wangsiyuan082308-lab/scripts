import { launchBrowser, navigateAndLogin, closeBrowser } from './automation/browser';
import { switchStore, handleWithdrawal, readCurrentStoreLabel } from './automation/store';
import { CONFIG } from './automation/config';
import { updateRiskLevel, getDelayMultiplier } from './automation/retry';
import { createLogger } from './automation/logger';
import { isCurrentStoreMatched } from './automation/store-rules.js';
const log = createLogger('withdrawal');
async function hasReadyFinanceFrame(page) {
    for (const frame of page.frames()) {
        if (!frame.url().includes('accountFlow')) {
            continue;
        }
        const text = await frame.locator('body').innerText().catch(() => '');
        if (text.includes('账户总览') || text.includes('提现')) {
            return true;
        }
    }
    return false;
}
async function ensureFinanceRouteReady(page) {
    for (let attempt = 0; attempt < 3; attempt++) {
        await page.goto(CONFIG.financeUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 120_000,
        }).catch(() => { });
        await page.waitForLoadState('networkidle', {
            timeout: 10_000,
        }).catch(() => { });
        await new Promise((resolve) => setTimeout(resolve, 5000));
        if (await hasReadyFinanceFrame(page)) {
            return true;
        }
        log.warn(`财务页未就绪，第 ${attempt + 1} 次重试...`);
        await page.reload({
            waitUntil: 'domcontentloaded',
            timeout: 120_000,
        }).catch(() => { });
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return false;
}
/**
 * 执行提现会话
 */
export async function executeWithdrawalSession(task) {
    const startedAt = Date.now();
    const results = [];
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
                const currentStoreBeforeSwitch = await readCurrentStoreLabel(page);
                if (currentStoreBeforeSwitch) {
                    log.info(`切店前当前门店: ${currentStoreBeforeSwitch}`);
                }
                // 切换门店
                await switchStore(page, storeName);
                const currentStoreAfterSwitch = await readCurrentStoreLabel(page);
                if (currentStoreAfterSwitch) {
                    log.info(`切店后当前门店: ${currentStoreAfterSwitch}`);
                }
                if (!isCurrentStoreMatched(currentStoreAfterSwitch, storeName)) {
                    throw new Error(`门店切换校验失败: 目标=${storeName}，当前=${currentStoreAfterSwitch || 'unknown'}`);
                }
                const financeReady = await ensureFinanceRouteReady(page);
                if (!financeReady) {
                    throw new Error(`财务页面未就绪: ${storeName}`);
                }
                const currentStoreBeforeWithdrawal = await readCurrentStoreLabel(page);
                if (currentStoreBeforeWithdrawal) {
                    log.info(`提现前当前门店: ${currentStoreBeforeWithdrawal}`);
                }
                if (!isCurrentStoreMatched(currentStoreBeforeWithdrawal, storeName)) {
                    throw new Error(`提现前门店上下文异常: 目标=${storeName}，当前=${currentStoreBeforeWithdrawal || 'unknown'}`);
                }
                // 执行提现
                const result = await handleWithdrawal(page, storeName);
                let status = 'failed';
                let message = '';
                let withdrawAmount;
                if (result === 'success') {
                    status = 'success';
                    message = '提现成功';
                    updateRiskLevel('success');
                }
                else if (result === 'blocked') {
                    status = 'failed';
                    message = '风控拦截';
                    updateRiskLevel('blocked');
                }
                else {
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
            }
            catch (error) {
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
    }
    catch (error) {
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
function buildSummary(successCount, failedCount, total) {
    if (total === 0)
        return '暂无执行记录';
    if (successCount === total)
        return `全部 ${total} 家门店提现成功`;
    if (failedCount === total)
        return `全部 ${total} 家门店提现失败`;
    return `${successCount} 家成功，${failedCount} 家失败`;
}
// 导出兼容接口
export const executeWithdrawalSessionViaBridge = executeWithdrawalSession;
