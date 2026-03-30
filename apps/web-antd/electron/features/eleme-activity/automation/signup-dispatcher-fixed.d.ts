/**
 * 活动报名调度器 - 修正版
 * cross-origin shell-only 场景状态口径修正
 * 集成入口回退链和下一步/提交回退链
 */
import { Page, Frame } from 'playwright';
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
    crossOriginShellOnly?: boolean;
    evidencePath?: string;
}
export declare function classifyActivity(name: string, fullText: string): ActivityType;
export declare function dispatchSignup(ctx: SignupContext): Promise<SignupResult>;
