import { describe, expect, it } from 'vitest';

import { recommendActivityDecisions } from '../activity-decision';

describe('recommendActivityDecisions', () => {
  it('blocks activities that fail hard rules', async () => {
    const result = await recommendActivityDecisions({
      activities: [
        {
          immediateSignup: false,
          merchantCost: 20,
          name: '连锁账号活动',
          platformSubsidy: 5,
          requiresChainAccount: true,
          status: 'available',
        },
      ],
      storeName: '安吉店',
    });

    expect(result.candidates[0]?.decision).toBe('block');
    expect(result.candidates[0]?.recommendedAction).toBe('skip');
  });

  it('returns allow or review for healthy candidates', async () => {
    const result = await recommendActivityDecisions({
      activities: [
        {
          daysToDeadline: 1,
          immediateSignup: true,
          merchantCost: 2,
          name: '高补贴秒杀活动',
          platformSubsidy: 18,
          status: 'available',
        },
      ],
      historySummary: {
        高补贴秒杀活动: {
          avgRoi: 2.1,
          successRate: 0.92,
        },
      },
      inventoryByActivityName: {
        高补贴秒杀活动: {
          availableDays: 10,
          availableStock: 120,
        },
      },
      storeName: '安吉店',
    });

    expect(['allow', 'review']).toContain(result.candidates[0]?.decision);
    expect(result.candidates[0]?.reasons.length).toBeGreaterThan(0);
  });
});
