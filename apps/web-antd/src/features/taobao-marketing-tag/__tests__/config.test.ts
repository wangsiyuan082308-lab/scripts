// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  findTaobaoMarketingTagSceneByTag,
  getTaobaoMarketingTagScene,
  normalizeTaobaoMarketingTaskLike,
  resolveTaobaoMarketingEntryScope,
} from '../config';

describe('taobao marketing tag scene config', () => {
  it('defaults unknown scene keys to super brand', () => {
    const scene = getTaobaoMarketingTagScene('unknown-scene');

    expect(scene.key).toBe('super_brand');
    expect(scene.entryScope).toBe('brand_activity');
    expect(scene.marketingTag).toBe('超级品牌红包');
  });

  it('resolves super brand scene from marketing tag text', () => {
    const scene = findTaobaoMarketingTagSceneByTag('超级品牌红包');

    expect(scene.key).toBe('super_brand');
    expect(scene.entryScope).toBe('brand_activity');
  });

  it('forces super brand to use brand activity even when unsigned activity is requested', () => {
    const entryScope = resolveTaobaoMarketingEntryScope({
      marketingTag: '超级品牌红包',
      requestedEntryScope: 'unsigned_activity',
    });

    expect(entryScope).toBe('brand_activity');
  });

  it('normalizes stale task data back to brand activity for super brand', () => {
    const normalized = normalizeTaobaoMarketingTaskLike({
      entryScope: 'unsigned_activity' as const,
      id: 'task_1',
      marketingTag: '超级品牌红包',
    });

    expect(normalized.entryScope).toBe('brand_activity');
    expect(normalized.id).toBe('task_1');
    expect(normalized.marketingTag).toBe('超级品牌红包');
  });
});
