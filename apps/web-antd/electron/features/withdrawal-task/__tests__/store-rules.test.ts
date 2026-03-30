import { describe, expect, it } from 'vitest';

import {
  buildAccountExecutionPlan,
  buildPreciseStoreSearchCandidates,
  buildStoreCandidates,
  extractMaxAmount,
  findPreciseStoreOption,
  isCurrentStoreMatched,
  normalizeAccountName,
} from '../automation/store-rules.js';

describe('withdrawal store rules', () => {
  it('matches the active store using exact name, branch name, and single-store labels', () => {
    expect(isCurrentStoreMatched('Oby便利超市(安吉店)', 'Oby便利超市(安吉店)')).toBe(true);
    expect(isCurrentStoreMatched('Oby便利超市(安吉店)单店', 'Oby便利超市(安吉店)')).toBe(true);
    expect(isCurrentStoreMatched('当前门店：安吉店', 'Oby便利超市(安吉店)')).toBe(true);
    expect(isCurrentStoreMatched('当前门店：安吉店', 'Oby便利超市（安吉店）')).toBe(true);
    expect(isCurrentStoreMatched('OBy24h便利', 'Oby便利超市(安吉店)')).toBe(false);
  });

  it('keeps precise search candidates store-specific and excludes chain aliases', () => {
    expect(buildPreciseStoreSearchCandidates('Oby便利超市(长兴店)')).toEqual([
      'Oby便利超市(长兴店)',
      'Oby便利超市(长兴店)单店',
      '长兴店',
    ]);

    expect(buildPreciseStoreSearchCandidates('Oby便利超市（长兴店）')).toEqual([
      'Oby便利超市（长兴店）',
      'Oby便利超市(长兴店)',
      'Oby便利超市（长兴店）单店',
      'Oby便利超市(长兴店)单店',
      '长兴店',
    ]);

    expect(buildStoreCandidates('Oby便利超市(长兴店)')).toContain('OBy24h便利连锁');
    expect(buildStoreCandidates('Oby便利超市（长兴店）')).toContain('OBy24h便利连锁');
  });

  it('finds only precise dropdown options for the target store', () => {
    const options = [
      'OBy24h便利连锁',
      'Oby便利超市(安吉店)单店',
      'Oby便利超市(长兴店)单店',
    ];

    expect(findPreciseStoreOption('Oby便利超市(长兴店)', options)).toBe('Oby便利超市(长兴店)单店');
    expect(findPreciseStoreOption('长兴店', options)).toBe('Oby便利超市(长兴店)单店');
    expect(findPreciseStoreOption('Oby便利超市(吴兴店)', options)).toBeNull();
  });

  it('extracts account names and the largest amount from account card text', () => {
    expect(normalizeAccountName('主资金账户 (元) + 5,027.52 提现', 0)).toBe('主资金账户');
    expect(normalizeAccountName('网商云资金账户 (元) 0.00 提现', 1)).toBe('网商云账户');
    expect(normalizeAccountName('未知账户', 2)).toBe('账户3');
    expect(extractMaxAmount('账户可用总金额（元） = 5,027.52 主资金账户 (元) + 5,027.52 提现')).toBe(5027.52);
    expect(extractMaxAmount('网商云资金账户 (元) 0.00 提现')).toBe(0);
  });

  it('deduplicates accounts and keeps only actionable balances for success checks', () => {
    const accountA = { amount: 5027.52, name: '主资金账户' };
    const accountB = { amount: 0, name: '网商云账户' };
    const duplicateA = { amount: 5027.52, name: '主资金账户' };

    const { actionableAccounts, uniqueAccounts } = buildAccountExecutionPlan(
      [accountA, accountB, duplicateA],
      0,
    );

    expect(uniqueAccounts).toEqual([accountA, accountB]);
    expect(actionableAccounts).toEqual([accountA]);
  });
});
