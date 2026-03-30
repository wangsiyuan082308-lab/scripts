/**
 * 饿了么活动报名 - 共享工具函数
 * 门店选择、iframe定位、协议勾选等通用逻辑
 */
import { Page, Frame } from 'playwright';
/** 获取饿了么业务iframe（ms.ele.me / ebai-zs-webapp） */
export declare function getTargetFrame(page: Page): Promise<Frame>;
/** 全选门店 + 勾选协议 + 点击下一步，返回已选门店数 */
export declare function selectStoresAndNext(frame: Frame, page: Page): Promise<{
    storeCount: number;
    success: boolean;
    error?: string;
}>;
/** JS点击有尺寸的报名按钮（详情页可能是“立即报名/追加报名”） */
export declare function clickSignupButton(frame: Frame): Promise<boolean>;
