/**
 * 饿了么活动报名 - 共享工具函数
 * 门店选择、iframe定位、协议勾选等通用逻辑
 */
import { Page, Frame } from 'playwright';
export type BaohaoStep2Surface = {
    activeTab: '' | '批量上传' | '选择商品';
    hasBulkUploadTab: boolean;
    hasChooseProductTab: boolean;
    hasDropzone: boolean;
    hasExportButton: boolean;
    hasFileInput: boolean;
    hasTemplateDownload: boolean;
};
export type BaohaoStep2Decision = {
    action: 'ready';
    reason?: string;
} | {
    action: 'switch_bulk_upload';
    reason: string;
} | {
    action: 'manual_only';
    reason: string;
} | {
    action: 'unknown';
    reason: string;
};
/** 获取饿了么业务iframe（ms.ele.me / ebai-zs-webapp） */
export declare function getTargetFrame(page: Page): Promise<Frame>;
export declare function decideBaohaoStep2Action(surface: BaohaoStep2Surface): BaohaoStep2Decision;
/** 全选当前活动可报名门店 + 勾选协议 + 点击下一步，返回已选门店快照 */
export declare function selectStoresAndNext(frame: Frame, page: Page): Promise<{
    storeCount: number;
    success: boolean;
    error?: string;
    storeIds?: string[];
    storeNames?: string[];
}>;
/** JS点击有尺寸的报名按钮（详情页可能是“立即报名/追加报名”） */
export declare function clickSignupButton(frame: Frame): Promise<boolean>;
