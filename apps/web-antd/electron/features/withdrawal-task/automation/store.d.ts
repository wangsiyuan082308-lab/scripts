import type { Page } from 'playwright';
export declare function switchStore(page: Page, targetStore: string): Promise<void>;
export declare function navigateToFinance(page: Page): Promise<void>;
export declare function handleWithdrawal(page: Page, storeName: string): Promise<'blocked' | 'fail' | 'success'>;
