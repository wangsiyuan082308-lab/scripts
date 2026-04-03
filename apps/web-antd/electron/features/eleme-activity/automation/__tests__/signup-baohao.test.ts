// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  isRepeatSignupCandidate,
  resolveListTabForSource,
} from '../signup-baohao';

describe('baohao scan routing', () => {
  it('uses 全部活动 as the list source for already signed activities', () => {
    expect(resolveListTabForSource('未报名活动')).toBe('未报名活动');
    expect(resolveListTabForSource('已报名活动')).toBe('全部活动');
  });

  it('only treats already signed cards in 全部活动 as repeat-signup candidates', () => {
    expect(
      isRepeatSignupCandidate({
        fullText: '爆好价4-6月-畅销食品 商品特价淘宝闪购补贴 报名中 查看详情',
        hasSignupBtn: false,
      }),
    ).toBe(true);

    expect(
      isRepeatSignupCandidate({
        fullText: '爆好价4-6月-畅销食品 商品特价淘宝闪购补贴 立即报名',
        hasSignupBtn: true,
      }),
    ).toBe(false);

    expect(
      isRepeatSignupCandidate({
        fullText: '爆好价4-6月-畅销食品 商品特价淘宝闪购补贴 已结束',
        hasSignupBtn: false,
      }),
    ).toBe(false);
  });
});
