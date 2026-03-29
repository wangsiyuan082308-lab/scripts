export const STORE_ALIAS_MAP = new Map([
    ['Oby便利超市(安吉店)', ['OBy24h便利', 'OBy24h便利连锁']],
    ['Oby便利超市(长兴店)', ['OBy24h便利', 'OBy24h便利连锁']],
    ['OBy24h便利', ['OBy24h便利连锁']],
]);
export function normalizeStoreName(value) {
    return `${value ?? ''}`
        .replaceAll(/\s+/g, '')
        .replaceAll('（', '(')
        .replaceAll('）', ')')
        .toLowerCase();
}
export function buildStoreCandidates(targetStore) {
    const candidates = [targetStore];
    const aliases = STORE_ALIAS_MAP.get(targetStore) ?? [];
    for (const alias of aliases) {
        candidates.push(alias);
    }
    if (`${targetStore ?? ''}`.includes('便利')) {
        candidates.push('OBy24h便利');
        candidates.push('OBy24h便利连锁');
    }
    return [...new Set(candidates.filter(Boolean))];
}
export function buildStoreVerificationCandidates(targetStore) {
    const branchMatch = `${targetStore ?? ''}`.match(/\(([^()]+)\)/);
    const branchName = branchMatch?.[1]?.trim();
    return [...new Set([
            targetStore,
            `${targetStore}单店`,
            branchName,
        ].filter(Boolean).map(normalizeStoreName))];
}
export function isCurrentStoreMatched(currentStoreText, targetStore) {
    const normalizedCurrent = normalizeStoreName(currentStoreText);
    if (!normalizedCurrent) {
        return false;
    }
    return buildStoreVerificationCandidates(targetStore).some((candidate) => normalizedCurrent.includes(candidate));
}
export function buildPreciseStoreSearchCandidates(targetStore) {
    const branchMatch = `${targetStore ?? ''}`.match(/\(([^()]+)\)/);
    const branchName = branchMatch?.[1]?.trim();
    return [...new Set([
            targetStore,
            `${targetStore}单店`,
            branchName,
        ].filter(Boolean))];
}
export function findBestStoreOption(targetStore, options) {
    const candidates = buildStoreCandidates(targetStore).map(normalizeStoreName);
    const rankedOptions = options
        .map((option) => ({ option, normalized: normalizeStoreName(option) }))
        .filter(({ normalized }) => normalized && normalized !== '暂无数据');
    for (const candidate of candidates) {
        const exact = rankedOptions.find(({ normalized }) => normalized === candidate);
        if (exact) {
            return exact.option;
        }
        const inclusive = rankedOptions.find(({ normalized }) => normalized.includes(candidate) || candidate.includes(normalized));
        if (inclusive) {
            return inclusive.option;
        }
    }
    if (candidates.some((candidate) => candidate.includes('便利'))) {
        const convenience = rankedOptions.find(({ normalized }) => normalized.includes('便利'));
        if (convenience) {
            return convenience.option;
        }
    }
    return null;
}
export function findPreciseStoreOption(query, options) {
    const normalizedQuery = normalizeStoreName(query);
    const normalizedOptions = options
        .map((option) => ({ option, normalized: normalizeStoreName(option) }))
        .filter(({ normalized }) => normalized && normalized !== '暂无数据');
    return normalizedOptions.find(({ normalized }) => normalized === normalizedQuery)?.option
        ?? normalizedOptions.find(({ normalized }) => normalized.includes(normalizedQuery))?.option
        ?? null;
}
export function normalizeAccountName(value, fallbackIndex = 0) {
    const text = `${value ?? ''}`;
    if (text.includes('主资金')) {
        return '主资金账户';
    }
    if (text.includes('网商云')) {
        return '网商云账户';
    }
    return `账户${fallbackIndex + 1}`;
}
export function extractMaxAmount(value) {
    const matches = `${value ?? ''}`.match(/\d[\d,]*\.?\d*/g) ?? [];
    let max = null;
    for (const match of matches) {
        const amount = Number.parseFloat(match.replaceAll(',', ''));
        if (!Number.isNaN(amount)) {
            max = max === null ? amount : Math.max(max, amount);
        }
    }
    return max;
}
export function buildAccountExecutionPlan(accounts, minWithdrawAmount = 0) {
    const uniqueAccounts = [];
    const seen = new Set();
    for (const account of accounts) {
        const key = `${account.name}_${account.amount}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        uniqueAccounts.push(account);
    }
    const actionableAccounts = uniqueAccounts.filter((account) => account.amount > minWithdrawAmount);
    return {
        actionableAccounts,
        uniqueAccounts,
    };
}
