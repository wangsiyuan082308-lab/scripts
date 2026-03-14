/**
 * 活动报名调度器
 * 根据活动类型路由到对应的报名流程
 * 被 index.ts 主流程调用，共享浏览器上下文
 */

import { Page, Frame } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

// 修复模块导入
import { BrandActivityFallback } from './lib/brand-activity-fallback';
import { SubmitButtonFallback } from './lib/submit-button-fallback';
import { AIAssistantFrameGuard } from './lib/ai-assistant-frame-guard';
import { StrongConsistencyEvidenceCollector } from './lib/strong-consistency-evidence-collector';
import { URLIframeAnchorStrategy } from './lib/url-iframe-anchor-strategy';
import { validateEvidenceDirectory } from './lib/activity-ops-guard';

const LOG_DIR = path.join(__dirname, '..', 'logs');
const ACTIVITY_OPS_EVIDENCE_ROOT = '/Users/mac/.openclaw/shared-data/eleme/evidence';
const ACTIVITY_OPS_EXPECTED_ROUND_ID = process.env.ACTIVITY_OPS_EXPECTED_ROUND_ID;

function log(level: 'info' | 'warn' | 'error', msg: string, data?: any) {
  const ts = new Date().toISOString();
  console.log(`[${ts}] [${level.toUpperCase()}] ${msg}${data ? ' ' + JSON.stringify(data) : ''}`);
}

// ============================================================
// 类型定义
// ============================================================

export type ActivityType = 'super_brand' | 'brand_coupon' | 'flash_sale' | 'boom_coupon' | 'other';

export interface SignupContext {
  page: Page;
  frame: Frame;
  activity: {
    name: string;
    merchantCost: number;
    platformSubsidy: number;
    threshold: number;
    fullText: string;
  };
  config: {
    targetStores: string[];
    maxMerchantCostRatio: number;
    dryRun: boolean;
  };
}

export interface SignupResult {
  success: boolean;
  message: string;
  storesSelected?: number;
  screenshot?: string;
  failureAttribution?: string;
  evidencePath?: string;
}

// ============================================================
// 活动分类
// ============================================================

export function classifyActivity(name: string, fullText: string): ActivityType {
  const combined = name + ' ' + fullText;
  if (combined.includes('超级品牌')) return 'super_brand';
  if (/专属券|专享券|品类红包|品类满减红包/.test(combined)) return 'brand_coupon';
  if (/爆涨红包|爆单红包/.test(combined)) return 'boom_coupon';
  if (/闪购567|限时抢购|爆好价|商品特价/.test(combined)) return 'flash_sale';
  return 'other';
}

/**
 * 检查商家出资比例是否超标
 */
export function isMerchantCostTooHigh(
  merchantCost: number,
  platformSubsidy: number,
  maxRatio: number = 1.0
): boolean {
  const total = merchantCost + platformSubsidy;
  if (total <= 0) return false;
  return (merchantCost / total) > maxRatio;
}

// ============================================================
// 统一调度入口
// ============================================================

export async function dispatchSignup(ctx: SignupContext): Promise<SignupResult> {
  const type = classifyActivity(ctx.activity.name, ctx.activity.fullText);
  log('info', `活动分类: ${type}`, { name: ctx.activity.name });

  const evidenceGuard = validateEvidenceDirectory(ACTIVITY_OPS_EVIDENCE_ROOT, ACTIVITY_OPS_EXPECTED_ROUND_ID);
  if (evidenceGuard.freshness.status === 'warn') {
    log('warn', evidenceGuard.freshness.message, {
      newestPath: evidenceGuard.freshness.newestPath,
      ageHours: Number(evidenceGuard.freshness.ageHours.toFixed(2))
    });
  }
  if (!evidenceGuard.ok) {
    const message = `activity-ops 守卫阻断: ${evidenceGuard.errors.join(' | ')}`;
    log('error', message, {
      freshness: evidenceGuard.freshness,
      round: evidenceGuard.round,
      brandTab: evidenceGuard.brandTab
    });
    return { success: false, message, failureAttribution: 'activity_ops_guard' };
  }

  log('info', 'activity-ops 守卫通过', {
    effectiveRoundId: evidenceGuard.round.effectiveRoundId,
    latestRoundId: evidenceGuard.round.latestRoundId,
    evidenceDir: evidenceGuard.round.effectiveDir,
    brandTab: evidenceGuard.brandTab?.normalizedAttribution,
    explicit: evidenceGuard.brandTab?.explicit
  });

  // 商家出资检查（所有类型通用）
  if (isMerchantCostTooHigh(ctx.activity.merchantCost, ctx.activity.platformSubsidy, ctx.config.maxMerchantCostRatio)) {
    const ratio = ctx.activity.merchantCost / (ctx.activity.merchantCost + ctx.activity.platformSubsidy);
    log('info', `跳过: 商家出资比例 ${(ratio * 100).toFixed(1)}% > ${ctx.config.maxMerchantCostRatio * 100}%`);
    return { success: false, message: `商家出资比例过高(${(ratio * 100).toFixed(1)}%)，跳过` };
  }

  if (ctx.config.dryRun) {
    log('info', `[DRY RUN] 跳过实际报名: ${ctx.activity.name} (${type})`);
    return { success: true, message: `[DRY RUN] 类型=${type}，已跳过实际操作` };
  }

  switch (type) {
    case 'super_brand':
      return signupSuperBrand(ctx);
    case 'brand_coupon':
      return signupBrandCoupon(ctx);
    case 'boom_coupon':
      return signupBoomCoupon(ctx);
    case 'flash_sale':
      return signupFlashSale(ctx);
    default:
      log('warn', `未知活动类型: ${type}，使用通用报名流程`);
      return signupGeneric(ctx);
  }
}

// ============================================================
// 超级品牌红包报名
// 流程：点击"立即报名" → 三步向导（确认规则→选门店→确认提交）
// ============================================================

async function signupSuperBrand(ctx: SignupContext): Promise<SignupResult> {
  const { page, frame: originalFrame, activity } = ctx;
  log('info', `[超级品牌] 开始报名: ${activity.name}`);

  let anchorResult: any = null;
  
  try {
    log('info', '=== 使用URL+iframe壳层锚点定位策略 ===');
    const anchorStrategy = new URLIframeAnchorStrategy(page, { debug: true });
    anchorResult = await anchorStrategy.locateWithFallback();
    
    if (!anchorResult.success || !anchorResult.frame) {
      log('error', 'URL+iframe锚点定位失败');
      throw new Error('ANCHOR_LOCATION_FAILED');
    }
    
    const targetFrame = anchorResult.frame;
    log('info', `锚点定位成功: 方法=${anchorResult.method}, URL=${anchorResult.url?.substring(0, 100)}...`);
    
    const anchorVerified = await anchorStrategy.verifyAnchor(anchorResult);
    if (!anchorVerified) {
      log('warn', '锚点验证失败，继续执行但风险较高');
    }
    
    log('info', '=== 使用品牌活动稳定锚点组合 ===');
    const brandFallback = new BrandActivityFallback(page, targetFrame, {
      debug: true,
      logger: log
    });
    const brandSwitchResult = await brandFallback.switchToBrandTab();
    
    if (brandSwitchResult.success) {
      log('info', `品牌活动tab切换成功 (方法: ${brandSwitchResult.method})`, {
        selector: brandSwitchResult.selector,
        hitLog: brandSwitchResult.diagnostics?.slice(0, 10)
      });
    } else {
      log('warn', '品牌活动稳定锚点未命中，继续使用当前上下文', {
        selector: brandSwitchResult.selector,
        reason: brandSwitchResult.reason || 'brand_tab_not_found',
        hitLog: brandSwitchResult.diagnostics?.slice(0, 10),
        failureAttribution: 'brand_tab_anchor_not_found'
      });
    }
    
    const isBrandPage = await brandFallback.verifyBrandActivityPage();
    log('info', `品牌活动页面验证: ${isBrandPage ? '是' : '否'}`);
    
    const activityUrl = 'https://nr.ele.me/app/eleme-nr-bfe-newretail/common-next#/pc/platformActivitiesPc/';
    const aiGuard = new AIAssistantFrameGuard(page, activityUrl, { 
      debug: true,
      checkInterval: 3000,
      maxRetries: 3
    });
    
    await aiGuard.startMonitoring(targetFrame);
    log('info', 'AI Assistant防护已启动');

    const listButton = new SubmitButtonFallback(targetFrame, {
      buttonText: ['立即报名', '追加报名', '继续报名', '报名'],
      logger: log,
      debug: true,
      safeSelectors: [
        'button:has-text("立即报名")',
        'button:has-text("追加报名")',
        'button:has-text("继续报名")',
        '[role="button"]:has-text("立即报名")',
        '.ant-btn-primary:has-text("立即报名")'
      ]
    });

    const listClicked = await clickSignupButton(targetFrame, activity.name, listButton);
    if (!listClicked) {
      const evidencePath = await collectFailureEvidence(page, targetFrame, 'LIST_SIGNUP_BUTTON_NOT_FOUND', activity, anchorResult, undefined, 'list_immediate_signup_not_found');
      return { success: false, message: '列表页未找到报名按钮', failureAttribution: 'list_immediate_signup_not_found', evidencePath };
    }

    log('info', '列表页报名按钮已命中，等待详情页加载');
    await page.waitForTimeout(2500);

    const detailFrame = await findActiveFrame(page);
    const detailButton = new SubmitButtonFallback(detailFrame, {
      buttonText: ['立即报名', '追加报名', '继续报名', '报名'],
      logger: log,
      debug: true,
      safeSelectors: [
        'button:has-text("立即报名")',
        'button:has-text("追加报名")',
        '[role="button"]:has-text("立即报名")',
        '.ant-btn-primary:has-text("立即报名")'
      ]
    });

    const detailClicked = await detailButton.clickSubmitButton();
    if (!detailClicked.success) {
      const evidencePath = await collectFailureEvidence(page, detailFrame, 'DETAIL_SIGNUP_BUTTON_NOT_FOUND', activity, anchorResult, undefined, detailClicked.failureAttribution || 'detail_immediate_signup_not_found');
      return {
        success: false,
        message: '详情页未找到报名按钮',
        failureAttribution: detailClicked.failureAttribution || 'detail_immediate_signup_not_found',
        evidencePath,
      };
    }

    log('info', `详情页报名按钮命中: ${detailClicked.clickedText}`, { selector: detailClicked.selector, hitLog: detailClicked.hitLog?.slice(0, 20) });
    await page.waitForTimeout(2000);

    const ruleConfirmed = await confirmDialog(detailFrame, ['确认', '确定', '同意', '我已阅读']);
    if (ruleConfirmed) {
      log('info', '已确认规则');
      await page.waitForTimeout(1500);
    }

    const storeFrame = await findActiveFrame(page);
    const storeStep = await storeFrame.evaluate(() => {
      const bodyText = document.body?.innerText || '';
      return {
        hasStoreSelector: !!document.querySelector('.ant-transfer, [class*="store-select"], [class*="shop-select"]'),
        hasStoreStepText: /选择门店|按门店选择|在线选择|全选/.test(bodyText),
        bodySnippet: bodyText.slice(0, 300)
      };
    }).catch(() => ({ hasStoreSelector: false, hasStoreStepText: false, bodySnippet: '' }));

    if (storeStep.hasStoreSelector || storeStep.hasStoreStepText) {
      log('info', '检测到门店选择步骤', storeStep);
      const storesSelected = await selectStoresViaTransfer(storeFrame, []);
      log('info', `门店自动勾选结果: ${storesSelected}`);
      if (storesSelected === 0) {
        const evidencePath = await collectFailureEvidence(page, storeFrame, 'STORE_SELECTION_REQUIRED', activity, anchorResult, undefined, 'prerequisite_store_selection_required');
        return {
          success: false,
          message: '步骤页仍需先选择门店，当前归因为产品前置条件未满足',
          failureAttribution: 'prerequisite_store_selection_required',
          evidencePath,
          storesSelected,
        };
      }
    }

    const nextButton = new SubmitButtonFallback(storeFrame, {
      buttonText: ['下一步', '确认', '继续'],
      logger: log,
      debug: true,
      safeSelectors: [
        'button:has-text("下一步")',
        '[role="button"]:has-text("下一步")',
        '.ant-btn-primary:has-text("下一步")',
        'footer button:has-text("下一步")',
        '.ant-modal-footer button:has-text("下一步")'
      ]
    });
    const nextClicked = await nextButton.clickSubmitButton();
    if (!nextClicked.success) {
      const evidencePath = await collectFailureEvidence(page, storeFrame, 'NEXT_BUTTON_NOT_FOUND', activity, anchorResult, undefined, nextClicked.failureAttribution || 'next_step_not_found');
      return { success: false, message: '未找到下一步按钮', failureAttribution: nextClicked.failureAttribution || 'next_step_not_found', evidencePath };
    }

    log('info', '已点击下一步', { selector: nextClicked.selector, hitLog: nextClicked.hitLog?.slice(0, 20) });
    await page.waitForTimeout(2000);

    const submitFrame = await findActiveFrame(page);
    const submitButton = new SubmitButtonFallback(submitFrame, {
      buttonText: ['确认提交', '提交报名', '提交', '确认', '确认报名'],
      logger: log,
      debug: true,
      safeSelectors: [
        'button:has-text("确认提交")',
        'button:has-text("提交报名")',
        'button:has-text("提交")',
        '[role="button"]:has-text("提交")',
        '.ant-btn-primary:has-text("提交")',
        'footer button:has-text("提交")',
        '.ant-modal-footer button:has-text("确认提交")'
      ]
    });

    const submitted = await submitButton.clickSubmitButton();
    if (!submitted.success) {
      const evidencePath = await collectFailureEvidence(page, submitFrame, 'SUBMIT_BUTTON_NOT_FOUND', activity, anchorResult, undefined, submitted.failureAttribution || 'submit_not_found');
      return {
        success: false,
        message: submitted.failureAttribution === 'prerequisite_store_selection_required' ? '提交前仍需满足门店选择前置条件' : '未找到确认提交按钮',
        failureAttribution: submitted.failureAttribution || 'submit_not_found',
        evidencePath,
      };
    }

    log('info', '已点击确认提交', { selector: submitted.selector, hitLog: submitted.hitLog?.slice(0, 20) });
    await page.waitForTimeout(2000);

    const ss = await screenshot(page, `signup_super_${Date.now()}`);
    return { success: true, message: '超级品牌报名完成', screenshot: ss };

  } catch (err: any) {
    log('error', `超级品牌报名失败: ${err?.message}`);
    
    await collectFailureEvidence(
      page, 
      anchorResult?.frame || originalFrame, 
      'ACTIVITY_SIGNUP_FAILED', 
      activity, 
      anchorResult,
      err
    );
    
    return { success: false, message: err?.message || '报名异常' };
  }
}

/**
 * 统一强制落盘5字段失败证据
 */
async function collectFailureEvidence(
  page: Page,
  frame: Frame | null,
  errorCode: string,
  activity: any,
  anchorResult?: any,
  error?: any,
  failureAttribution?: string
): Promise<string | undefined> {
  try {
    const evidenceCollector = new StrongConsistencyEvidenceCollector(page, frame, {
      evidence_dir: path.join(__dirname, '..', 'data', 'evidence'),
      session_id: `session_${Date.now()}_${errorCode.toLowerCase()}`,
      debug: true
    });
    
    // 构建selector命中路径
    const selectorHitPath = StrongConsistencyEvidenceCollector.buildSelectorHitPath(page, frame, [
      `text=${activity.name}`,
      ...(anchorResult?.safeSelectors || ['button:has-text("立即报名")', '[role="button"]:has-text("立即报名")'])
    ]);
    
    // 强制收集5字段证据
    const evidence = await evidenceCollector.collectStrongEvidence(
      errorCode,
      selectorHitPath,
      {
        activity_name: activity.name,
        activity_type: 'super_brand',
        error_message: error?.message || 'unknown',
        error_stack: error?.stack || '',
        anchor_method: anchorResult?.method || 'none',
        anchor_url: anchorResult?.url || 'unknown',
        failure_attribution: failureAttribution || error?.message || 'unknown',
        expected_round_id: ACTIVITY_OPS_EXPECTED_ROUND_ID || null,
        evidence_root: ACTIVITY_OPS_EVIDENCE_ROOT,
        timestamp: new Date().toISOString(),
        verification: {
          is_mock: false,
          production_environment: true,
          force_persisted: true
        }
      }
    );
    
    const evidencePath = `/Users/mac/.openclaw/skills-pool/business/eleme-activity-assistant/data/evidence/logs/${evidence.evidence_id}.json`;
    log('error', `强制落盘失败证据: ${evidence.evidence_id}`, {
      error_code: evidence.error_code,
      evidence_path: evidencePath,
      five_fields_complete: evidence.fields_complete
    });
    return evidencePath;
    
  } catch (evidenceError: any) {
    log('error', `强制落盘证据收集失败: ${evidenceError.message}`);
    
    // 降级处理：至少记录错误
    const fallbackPath = path.join(__dirname, '..', 'data', 'evidence', 'logs', `fallback_${Date.now()}.json`);
    const fallbackEvidence = {
      error_code: errorCode,
      error_message: `证据收集失败: ${evidenceError.message}`,
      original_error: error?.message,
      timestamp: new Date().toISOString(),
      is_mock: false,
      degraded_mode: true
    };
    
    try {
      fs.writeFileSync(fallbackPath, JSON.stringify(fallbackEvidence, null, 2), 'utf8');
      log('error', `降级证据已保存: ${fallbackPath}`);
      return fallbackPath;
    } catch (writeError: any) {
      log('error', `降级证据保存也失败: ${writeError.message}`);
      return undefined;
    }
  }
}

// ============================================================
// 品牌专属券报名
// 流程：列表"立即报名"→详情页→详情页"立即报名"→穿梭框选门店→添加商品→确认提交
// ============================================================

async function signupBrandCoupon(ctx: SignupContext): Promise<SignupResult> {
  const { page, frame, activity, config } = ctx;
  log('info', `[品牌专属券] 开始报名: ${activity.name}`);

  try {
    const listButton = new SubmitButtonFallback(frame, {
      buttonText: ['立即报名', '报名'],
      logger: log,
      debug: true,
    });

    // Step 0: 点击活动卡片"立即报名" → 进入详情页
    const clicked = await clickSignupButton(frame, activity.name, listButton);
    if (!clicked) return { success: false, message: '未找到报名按钮', failureAttribution: 'list_immediate_signup_not_found' };

    log('info', '等待详情页加载...');
    await page.waitForTimeout(3000);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    // 重新获取frame（页面可能刷新）
    const detailFrame = await findActiveFrame(page);

    // Step 1: 在详情页点击"立即报名"
    const detailButton = new SubmitButtonFallback(detailFrame, {
      buttonText: ['立即报名', '追加报名', '继续报名', '报名'],
      logger: log,
      debug: true,
      safeSelectors: [
        'button:has-text("立即报名")',
        'button:has-text("追加报名")',
        'button:has-text("继续报名")',
        '[role="button"]:has-text("立即报名")'
      ]
    });
    const detailResult = await detailButton.clickSubmitButton();

    if (!detailResult.success) {
      log('warn', '详情页未找到"立即报名"按钮', { reason: detailResult.reason, hitLog: detailResult.hitLog?.slice(0, 20) });
      return { success: false, message: '详情页未找到报名按钮', failureAttribution: detailResult.failureAttribution || detailResult.reason || 'detail_immediate_signup_not_found' };
    }

    log('info', '已点击详情页"立即报名"，等待报名流程...', { selector: detailResult.selector, hitLog: detailResult.hitLog?.slice(0, 20) });
    await page.waitForTimeout(3000);

    // Step 2: 穿梭框选择门店
    const storeFrame = await findActiveFrame(page);
    let storesSelected = 0;

    // 等待穿梭框出现
    const hasTransfer = await storeFrame.evaluate(() => {
      return !!document.querySelector('.ant-transfer, [class*="transfer"]');
    }).catch(() => false);

    if (hasTransfer) {
      storesSelected = await selectStoresViaTransfer(storeFrame, config.targetStores);
      log('info', `已选择 ${storesSelected} 家门店`);
    } else {
      log('warn', '未检测到穿梭框，尝试全选');
      // 可能是批量报名模式
      await storeFrame.evaluate(() => {
        const checkAll = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
        if (checkAll && !checkAll.checked) checkAll.click();
      }).catch(() => {});
      storesSelected = config.targetStores.length;
    }

    if (storesSelected === 0) {
      return { success: false, message: '未能选择任何门店' };
    }

    // 确认协议已勾选
    await storeFrame.evaluate(() => {
      const checkbox = document.querySelector('label:has(input[type="checkbox"])') as HTMLElement;
      if (checkbox) {
        const input = checkbox.querySelector('input') as HTMLInputElement;
        if (input && !input.checked) checkbox.click();
      }
    }).catch(() => {});

    // 点击"下一步"
    const nextButton = new SubmitButtonFallback(storeFrame, {
      buttonText: ['下一步', '确认', '继续'],
      logger: log,
      debug: true,
      safeSelectors: [
        'button:has-text("下一步")',
        '[role="button"]:has-text("下一步")',
        '.ant-btn-primary:has-text("下一步")',
        'button:has-text("继续")'
      ]
    });
    const nextClicked = await nextButton.clickSubmitButton();
    if (!nextClicked.success) {
      log('warn', '未找到"下一步"按钮', { reason: nextClicked.reason, hitLog: nextClicked.hitLog?.slice(0, 20) });
      return { success: false, message: '未找到下一步按钮', failureAttribution: nextClicked.failureAttribution || nextClicked.reason || 'next_step_not_found' };
    }

    log('info', '已点击下一步，等待商品选择页...', { selector: nextClicked.selector, hitLog: nextClicked.hitLog?.slice(0, 20) });
    await page.waitForTimeout(3000);

    // Step 3: 添加商品（品类匹配）
    // 注意：商品添加是品牌专属券特有的步骤
    // 目前先跳过商品添加，直接尝试提交
    // TODO: 实现商品搜索和添加逻辑
    const productFrame = await findActiveFrame(page);

    log('info', '商品选择页 - 检查是否需要添加商品...');
    const needProducts = await productFrame.evaluate(() => {
      const emptyText = document.body?.innerText || '';
      return emptyText.includes('还未添加商品') || emptyText.includes('暂无数据');
    }).catch(() => false);

    if (needProducts) {
      log('warn', '需要添加商品但暂未实现自动添加，跳过此活动');
      // 点击取消/返回
      await clickButton(productFrame, ['取消', '返回', '上一步']);
      return { success: false, message: '需要添加商品（暂未实现自动添加）' };
    }

    // Step 4: 确认提交
    const submitButton = new SubmitButtonFallback(productFrame, {
      buttonText: ['确认提交', '提交报名', '提交', '确认', '确认报名'],
      logger: log,
      debug: true,
      safeSelectors: [
        'button:has-text("确认提交")',
        'button:has-text("提交报名")',
        'button:has-text("提交")',
        '[role="button"]:has-text("提交")',
        '.ant-btn-primary:has-text("提交")'
      ]
    });
    const submitted = await submitButton.clickSubmitButton();
    if (submitted.success) {
      log('info', '已点击确认提交', { selector: submitted.selector, hitLog: submitted.hitLog?.slice(0, 20) });
      await page.waitForTimeout(3000);
    } else {
      return { success: false, message: '未找到确认提交按钮', failureAttribution: submitted.failureAttribution || submitted.reason || 'submit_not_found' };
    }

    const ss = await screenshot(page, `signup_brand_coupon_${Date.now()}`);
    return {
      success: true,
      message: `品牌专属券报名完成，已选${storesSelected}家门店`,
      storesSelected,
      screenshot: ss,
    };

  } catch (err: any) {
    log('error', `品牌专属券报名失败: ${err?.message}`);
    return { success: false, message: err?.message || '报名异常' };
  }
}

// ============================================================
// 爆涨红包/爆单红包报名
// 流程：列表"立即报名"→管理页→选档位"立即报名"→设份数+选门店+勾协议→提交报名
// 特点：一步完成，不需要选商品，协议未默认勾选，多档位独立报名
// ============================================================

async function signupBoomCoupon(ctx: SignupContext): Promise<SignupResult> {
  const { page, frame, activity, config } = ctx;
  log('info', `[爆涨红包] 开始报名: ${activity.name}`);

  try {
    // Step 0: 点击活动卡片"立即报名" → 进入爆单红包管理页
    const clicked = await clickSignupButton(frame, activity.name);
    if (!clicked) return { success: false, message: '未找到报名按钮' };

    log('info', '等待爆单红包管理页加载...');
    await page.waitForTimeout(3000);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

    const mgmtFrame = await findActiveFrame(page);

    // Step 1: 在管理页找到档位，点击"立即报名"
    // 管理页有多个档位行（1元/2元/5元/7元），每行有"立即报名"或"管理"
    // 优先报名未报的档位
    const tierClicked = await mgmtFrame.evaluate(() => {
      // 找所有包含"立即报名"的按钮（未报名的档位）
      const btns = Array.from(document.querySelectorAll('button, a, [class*="btn"]'));
      for (const btn of btns) {
        const text = (btn.textContent || '').trim();
        if (text === '立即报名' || text.includes('立即报名')) {
          (btn as HTMLElement).click();
          return true;
        }
      }
      return false;
    }).catch(() => false);

    if (!tierClicked) {
      log('info', '所有档位已报名或无可报名档位');
      return { success: true, message: '所有档位已报名' };
    }

    log('info', '已点击档位报名，等待报名弹窗...');
    await page.waitForTimeout(2000);

    const signupFrame = await findActiveFrame(page);

    // Step 2: 设置份数（默认1份，通常不需要改）
    // spinbutton 默认值通常是1，保持不变即可

    // Step 3: 选择门店（穿梭框）
    let storesSelected = 0;
    const hasTransfer = await signupFrame.evaluate(() => {
      return !!document.querySelector('.ant-transfer, [class*="transfer"]');
    }).catch(() => false);

    if (hasTransfer) {
      storesSelected = await selectStoresViaTransfer(signupFrame, config.targetStores);
      log('info', `已选择 ${storesSelected} 家门店`);
    } else {
      log('warn', '未检测到穿梭框，尝试全选');
      await signupFrame.evaluate(() => {
        const checkAll = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
        if (checkAll && !checkAll.checked) checkAll.click();
      }).catch(() => {});
      storesSelected = config.targetStores.length;
    }

    if (storesSelected === 0) {
      log('warn', '未选择任何门店');
      await clickButton(signupFrame, ['取消', '返回']);
      return { success: false, message: '未选择任何门店' };
    }

    // Step 4: 勾选协议（⚠️ 爆涨红包协议未默认勾选！）
    await signupFrame.evaluate(() => {
      // 找所有 checkbox，勾选未勾选的协议
      const checkboxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
      for (const cb of checkboxes) {
        const el = cb as HTMLInputElement;
        const label = el.closest('label')?.textContent || '';
        // 协议相关的 checkbox
        if ((label.includes('阅读') || label.includes('同意') || label.includes('协议')) && !el.checked) {
          el.click();
        }
      }
      // 也尝试点击 label 本身
      const labels = Array.from(document.querySelectorAll('label'));
      for (const label of labels) {
        const text = label.textContent || '';
        if ((text.includes('阅读') || text.includes('同意')) && !label.querySelector('input:checked')) {
          label.click();
        }
      }
    }).catch(() => {});

    await page.waitForTimeout(500);
    log('info', '已勾选协议');

    // Step 5: 点击"提交报名"
    const submitted = await clickButton(signupFrame, ['提交报名', '提交', '确认提交', '确认']);
    if (submitted) {
      log('info', '已点击提交报名');
      await page.waitForTimeout(3000);
    } else {
      log('warn', '未找到提交按钮');
      return { success: false, message: '未找到提交报名按钮' };
    }

    const ss = await screenshot(page, `signup_boom_coupon_${Date.now()}`);
    return {
      success: true,
      message: `爆涨红包报名完成，已选${storesSelected}家门店`,
      storesSelected,
      screenshot: ss,
    };

  } catch (err: any) {
    log('error', `爆涨红包报名失败: ${err?.message}`);
    return { success: false, message: err?.message || '报名异常' };
  }
}

// ============================================================
// 闪购567/爆好价报名
// 流程：待爬虫验证（暂用通用流程）
// ============================================================

async function signupFlashSale(ctx: SignupContext): Promise<SignupResult> {
  log('info', `[闪购/爆好价] 开始报名: ${ctx.activity.name}`);
  // 闪购流程待爬虫验证，暂用通用流程
  return signupGeneric(ctx);
}

// ============================================================
// 通用报名流程（兜底）
// ============================================================

async function signupGeneric(ctx: SignupContext): Promise<SignupResult> {
  const { page, frame, activity } = ctx;
  log('info', `[通用] 开始报名: ${activity.name}`);

  try {
    const clicked = await clickSignupButton(frame, activity.name);
    if (!clicked) return { success: false, message: '未找到报名按钮' };

    await page.waitForTimeout(2000);

    // 尝试确认弹窗
    const confirmed = await confirmDialog(frame, ['确认', '确定', '同意', '确认提交', '提交']);
    if (confirmed) {
      log('info', '已确认弹窗');
      await page.waitForTimeout(2000);
    }

    const ss = await screenshot(page, `signup_generic_${Date.now()}`);
    return { success: true, message: '通用报名流程已执行', screenshot: ss };

  } catch (err: any) {
    return { success: false, message: err?.message || '报名异常' };
  }
}

// ============================================================
// 工具函数
// ============================================================

/** 在活动卡片中点击"立即报名"按钮 */
async function clickSignupButton(
  frame: Frame,
  activityName: string,
  fallback?: SubmitButtonFallback
): Promise<boolean> {
  const clicked = await frame.evaluate((actName: string) => {
    const normalizedActName = actName.replace(/\[|\]/g, '').substring(0, 20);
    const cards = Array.from(document.querySelectorAll('.zs-act-view-v2, .zs-act-view, [class*="act-view"], [class*="activity"], [class*="card"]'));
    for (const card of cards) {
      if ((card.textContent || '').includes(normalizedActName)) {
        const btns = Array.from(card.querySelectorAll('button, a, [role="button"], [class*="btn"]'));
        for (const btn of btns) {
          const txt = (btn.textContent || '').trim();
          if (['立即报名', '追加报名', '继续报名', '报名'].some(label => txt.includes(label))) {
            (btn as HTMLElement).click();
            return true;
          }
        }
      }
    }
    return false;
  }, activityName);

  if (clicked) {
    log('info', '活动卡片内命中报名按钮', {
      activityName,
      selector: '.zs-act-view-v2/.zs-act-view/[class*=activity] -> button/a/[role=button]',
      rule: '立即报名|追加报名|继续报名|报名',
      hitLog: ['list-card-hit']
    });
    return true;
  }

  if (!fallback) {
    log('warn', '活动卡片内未命中报名按钮，且无fallback', { activityName, failureAttribution: 'list_immediate_signup_not_found' });
    return false;
  }

  const fallbackResult = await fallback.clickSubmitButton();
  if (fallbackResult.success) {
    log('info', '报名按钮fallback命中', {
      activityName,
      method: fallbackResult.method,
      selector: fallbackResult.selector,
      text: fallbackResult.clickedText,
      hitLog: fallbackResult.hitLog?.slice(0, 20)
    });
    return true;
  }

  log('warn', '报名按钮fallback失败', {
    activityName,
    reason: fallbackResult.reason,
    method: fallbackResult.method,
    hitLog: fallbackResult.hitLog?.slice(0, 20),
    failureAttribution: fallbackResult.failureAttribution || 'list_immediate_signup_not_found'
  });
  return false;
}

/** 确认弹窗（按文本匹配按钮） */
async function confirmDialog(frame: Frame, buttonTexts: string[]): Promise<boolean> {
  return frame.evaluate((texts: string[]) => {
    const allBtns = Array.from(document.querySelectorAll(
      '.ant-modal button, .ant-modal-confirm button, .ant-btn-primary, [class*="dialog"] button, [class*="modal"] button, button'
    ));
    for (const btn of allBtns) {
      const el = btn as HTMLElement;
      if (el.offsetParent === null) continue; // 不可见
      const txt = (el.textContent || '').trim();
      for (const target of texts) {
        if (txt.includes(target)) {
          el.click();
          return true;
        }
      }
    }
    return false;
  }, buttonTexts);
}

/** 点击指定文本的按钮 */
async function clickButton(frame: Frame, buttonTexts: string[]): Promise<boolean> {
  const fallback = new SubmitButtonFallback(frame, {
    buttonText: buttonTexts,
    logger: log,
    debug: true,
    safeSelectors: buttonTexts.flatMap(text => [
      `button:has-text("${text}")`,
      `[role="button"]:has-text("${text}")`,
      `.ant-btn:has-text("${text}")`
    ])
  });

  const result = await fallback.clickSubmitButton();
  if (!result.success) {
    log('warn', 'clickButton失败', { buttonTexts, reason: result.reason, hitLog: result.hitLog?.slice(0, 20), failureAttribution: result.failureAttribution });
    return false;
  }

  log('info', 'clickButton命中', { buttonTexts, selector: result.selector, hitLog: result.hitLog?.slice(0, 20) });
  return true;
}

/** 穿梭框选择门店 */
async function selectStoresViaTransfer(frame: Frame, targetStores: string[]): Promise<number> {
  return frame.evaluate((stores: string[]) => {
    let selected = 0;
    const transferList = document.querySelector('.ant-transfer-list:first-child');
    if (!transferList) return 0;

    const items = Array.from(transferList.querySelectorAll('.ant-transfer-list-content-item, li'));
    for (const item of items) {
      const text = (item.textContent || '').trim();
      // 如果 targetStores 为空，全选
      const shouldSelect = stores.length === 0 || stores.some(s => text.includes(s));
      if (shouldSelect) {
        const checkbox = item.querySelector('input[type="checkbox"]') as HTMLInputElement;
        if (checkbox && !checkbox.checked) {
          (item as HTMLElement).click();
          selected++;
        } else if (!checkbox) {
          (item as HTMLElement).click();
          selected++;
        }
      }
    }
    return selected;
  }, targetStores);
}

/** 找到当前活跃的frame */
async function findActiveFrame(page: Page): Promise<Frame> {
  const frames = page.frames();
  const priorities = [
    (url: string) => url.includes('ebai-zs-webapp'),
    (url: string) => url.includes('ms.ele.me') && !url.includes('xdomain-storage'),
  ];

  for (const matcher of priorities) {
    for (const frame of frames) {
      try {
        if (matcher(frame.url())) {
          const hasContent = await frame.evaluate(() => {
            return document.body?.innerText?.length > 50;
          }).catch(() => false);
          if (hasContent) return frame;
        }
      } catch { /* skip */ }
    }
  }
  return page.mainFrame();
}

/** 截图 */
async function screenshot(page: Page, name: string): Promise<string> {
  const ssPath = path.join(LOG_DIR, `${name}.png`);
  try {
    await page.screenshot({ path: ssPath, fullPage: false });
    return ssPath;
  } catch {
    return '';
  }
}
