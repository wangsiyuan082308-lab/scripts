/**
 * 活动报名调度器
 * 根据活动类型路由到对应的报名流程
 * 被 index.ts 主流程调用，共享浏览器上下文
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
}
export declare function classifyActivity(name: string, fullText: string): ActivityType;
/**
 * 检查商家出资比例是否超标
 */
export declare function isMerchantCostTooHigh(merchantCost: number, platformSubsidy: number, maxRatio?: number): boolean;
export declare function dispatchSignup(ctx: SignupContext): Promise<SignupResult>;
