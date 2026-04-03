export type TaobaoMarketingEntryScope = 'brand_activity' | 'unsigned_activity';

export interface TaobaoMarketingTagScene {
  description: string;
  entryScope: TaobaoMarketingEntryScope;
  key: string;
  marketingTag: string;
  pageTitle: string;
  taskNamePrefix: string;
}

export const TAOBAO_SUPER_BRAND_SCENE: TaobaoMarketingTagScene = {
  description:
    '超级品牌红包从品牌活动页进入，按营销标签筛选后直接报名，不依赖“未报名活动”分类。',
  entryScope: 'brand_activity',
  key: 'super_brand',
  marketingTag: '超级品牌红包',
  pageTitle: '超级品牌红包报名',
  taskNamePrefix: '超级品牌红包报名任务',
};

export const TAOBAO_MARKETING_TAG_SCENES = {
  [TAOBAO_SUPER_BRAND_SCENE.key]: TAOBAO_SUPER_BRAND_SCENE,
} satisfies Record<string, TaobaoMarketingTagScene>;

const TAOBAO_MARKETING_TAG_SCENE_LIST = Object.values(
  TAOBAO_MARKETING_TAG_SCENES,
) as TaobaoMarketingTagScene[];

export function getTaobaoMarketingTagScene(sceneKey?: string): TaobaoMarketingTagScene {
  const normalizedKey = `${sceneKey || ''}`.trim();
  if (
    normalizedKey &&
    Object.prototype.hasOwnProperty.call(TAOBAO_MARKETING_TAG_SCENES, normalizedKey)
  ) {
    return TAOBAO_MARKETING_TAG_SCENES[
      normalizedKey as keyof typeof TAOBAO_MARKETING_TAG_SCENES
    ]!;
  }
  return TAOBAO_MARKETING_TAG_SCENES.super_brand!;
}

export function findTaobaoMarketingTagSceneByTag(
  marketingTag?: string,
): TaobaoMarketingTagScene {
  const normalizedTag = `${marketingTag || ''}`.trim();
  if (!normalizedTag) {
    return TAOBAO_MARKETING_TAG_SCENES.super_brand!;
  }

  const matched = TAOBAO_MARKETING_TAG_SCENE_LIST.find(
    (scene) => scene.marketingTag === normalizedTag,
  );
  return matched || TAOBAO_MARKETING_TAG_SCENES.super_brand!;
}

export function resolveTaobaoMarketingEntryScope(options: {
  marketingTag?: string;
  requestedEntryScope?: TaobaoMarketingEntryScope;
  sceneKey?: string;
}): TaobaoMarketingEntryScope {
  const scene = options.sceneKey
    ? getTaobaoMarketingTagScene(options.sceneKey)
    : findTaobaoMarketingTagSceneByTag(options.marketingTag);

  return scene.entryScope;
}

export function normalizeTaobaoMarketingTaskLike<
  T extends {
    entryScope?: TaobaoMarketingEntryScope;
    marketingTag?: string;
  },
>(task: T): T & { entryScope: TaobaoMarketingEntryScope } {
  return {
    ...task,
    entryScope: resolveTaobaoMarketingEntryScope({
      marketingTag: task.marketingTag,
      requestedEntryScope: task.entryScope,
    }),
  };
}
