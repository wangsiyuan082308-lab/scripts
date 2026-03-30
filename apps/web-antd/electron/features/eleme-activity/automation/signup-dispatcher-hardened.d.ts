/**
 * 活动报名调度器 - 固化版
 * 1) 品牌活动入口权限感知分支
 * 2) cross-origin fallback失败强制落盘
 */
import { Page, Frame } from 'playwright';
export type ActivityType = 'super_brand' | 'brand_coupon' | 'flash_sale' | 'boom_coupon' | 'other';
export type AccountType = 'same_account' | 'control_account' | 'unknown';
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
        accountType: AccountType;
    };
}
export interface SignupResult {
    success: boolean;
    message: string;
    storesSelected?: number;
    screenshot?: string;
    crossOriginShellOnly?: boolean;
    evidencePath?: string;
    accountType?: AccountType;
    brandFallbackUsed?: boolean;
}
export declare function dispatchSignup(ctx: SignupContext): Promise<SignupResult>;
