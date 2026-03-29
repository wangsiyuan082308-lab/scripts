export declare const STORE_ALIAS_MAP: Map<string, string[]>;

export interface WithdrawalAccountLike {
  amount: number;
  name: string;
}

export declare function normalizeStoreName(value?: string | null): string;
export declare function buildStoreCandidates(targetStore: string): string[];
export declare function buildStoreVerificationCandidates(targetStore: string): string[];
export declare function isCurrentStoreMatched(currentStoreText: string, targetStore: string): boolean;
export declare function buildPreciseStoreSearchCandidates(targetStore: string): string[];
export declare function findBestStoreOption(targetStore: string, options: string[]): string | null;
export declare function findPreciseStoreOption(query: string, options: string[]): string | null;
export declare function normalizeAccountName(value: string, fallbackIndex?: number): string;
export declare function extractMaxAmount(value: string): number | null;
export declare function buildAccountExecutionPlan<T extends WithdrawalAccountLike>(
  accounts: T[],
  minWithdrawAmount?: number,
): {
  actionableAccounts: T[];
  uniqueAccounts: T[];
};
