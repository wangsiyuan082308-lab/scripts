import {
  calculateActivityRoi,
  getStoreMetrics,
  loadActivityCatalog,
  type ActivityRecord,
} from './activity-catalog';
import { getActivityAiSuggestions } from './activity-ai';

export type ActivityDecision = 'allow' | 'block' | 'review';
export type ActivityDecisionSuggestedAction =
  | 'auto_apply'
  | 'manual_review'
  | 'skip';
export type ActivityRiskLevel = 'high' | 'low' | 'medium';

export interface ActivityInventorySignal {
  availableDays?: number;
  availableStock?: number;
}

export interface ActivityHistorySignal {
  avgRoi?: number;
  successRate?: number;
}

export interface ActivityDecisionThresholds {
  autoAllowMaxRiskScore?: number;
  autoAllowMinScore?: number;
  reviewMaxRiskScore?: number;
  reviewMinScore?: number;
}

export interface ActivityDecisionInput {
  activities?: ActivityRecord[];
  currentPromotionNames?: string[];
  historySummary?: Record<string, ActivityHistorySignal>;
  inventoryByActivityName?: Record<string, ActivityInventorySignal>;
  status?: string;
  storeName?: string;
  thresholds?: ActivityDecisionThresholds;
}

export interface ActivityDecisionCandidate {
  decision: ActivityDecision;
  daysToDeadline: number;
  hardBlocked?: boolean;
  immediateSignup: boolean;
  inventorySignals?: ActivityInventorySignal;
  level?: string;
  merchantCost: number;
  name: string;
  platform: string;
  platformSubsidy: number;
  reasons: string[];
  recommendedAction: ActivityDecisionSuggestedAction;
  riskLevel: ActivityRiskLevel;
  riskNotes: string[];
  riskScore: number;
  roi: number;
  ruleHits: string[];
  score: number;
  status: string;
}

export interface ActivityDecisionResult {
  candidates: ActivityDecisionCandidate[];
  decision: ActivityDecision;
  reasons: string[];
  recommendedAction: ActivityDecisionSuggestedAction;
  riskLevel: ActivityRiskLevel;
  riskScore: number;
  ruleHits: string[];
  score: number;
  storeName: string;
  summary: {
    allow: number;
    block: number;
    review: number;
    total: number;
  };
}

const DEFAULT_THRESHOLDS = {
  autoAllowMaxRiskScore: 0.35,
  autoAllowMinScore: 0.78,
  reviewMaxRiskScore: 0.65,
  reviewMinScore: 0.48,
} satisfies Required<ActivityDecisionThresholds>;

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function uniq(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function mergeThresholds(input?: ActivityDecisionThresholds) {
  return {
    ...DEFAULT_THRESHOLDS,
    ...input,
  };
}

function normalizeNameSet(values?: string[]) {
  return new Set(
    (values || [])
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => item.toLowerCase()),
  );
}

function resolveInventorySignals(
  input: ActivityDecisionInput,
  activity: ActivityRecord,
) {
  return input.inventoryByActivityName?.[activity.name];
}

function resolveHistorySignals(
  input: ActivityDecisionInput,
  activity: ActivityRecord,
) {
  return input.historySummary?.[activity.name];
}

function evaluateHardRules(
  activity: ActivityRecord,
  netProfitPerOrder: number,
  currentPromotions: Set<string>,
  inventory?: ActivityInventorySignal,
) {
  const ruleHits: string[] = [];
  const blockReasons: string[] = [];

  if (activity.status !== 'available') {
    blockReasons.push('活动当前不可报名');
  } else {
    ruleHits.push('status_available');
  }

  if (activity.immediateSignup === false) {
    blockReasons.push('该活动不支持即时报名');
  } else {
    ruleHits.push('immediate_signup_ok');
  }

  if (activity.requiresChainAccount) {
    blockReasons.push('该活动要求连锁账号处理');
  } else {
    ruleHits.push('account_scope_ok');
  }

  if (netProfitPerOrder <= 0) {
    blockReasons.push('活动成本已经压穿当前毛利红线');
  } else {
    ruleHits.push('margin_ok');
  }

  const lowerName = activity.name.toLowerCase();
  if ([...currentPromotions].some((item) => lowerName.includes(item) || item.includes(lowerName))) {
    blockReasons.push('当前活动与已在执行的促销可能冲突');
  } else {
    ruleHits.push('promotion_conflict_free');
  }

  if (inventory?.availableStock !== undefined && inventory.availableStock <= 0) {
    blockReasons.push('库存为 0，不满足自动报名条件');
  } else {
    ruleHits.push('inventory_stock_ok');
  }

  return {
    blockReasons,
    ruleHits,
  };
}

function buildHeuristicReasoning(params: {
  activity: ActivityRecord;
  history?: ActivityHistorySignal;
  inventory?: ActivityInventorySignal;
  netProfitPerOrder: number;
  roi: number;
  storeName: string;
}) {
  const reasons: string[] = [];
  const riskNotes: string[] = [];

  if ((params.activity.platformSubsidy || 0) >= 15) {
    reasons.push('平台补贴力度较高');
  } else if ((params.activity.platformSubsidy || 0) >= 5) {
    reasons.push('平台补贴达到可报名区间');
  }

  if (params.roi >= 3) {
    reasons.push('预估 ROI 很高，属于优先关注活动');
  } else if (params.roi >= 1.5) {
    reasons.push('预估 ROI 达到正向回报区间');
  } else if (params.roi >= 1) {
    reasons.push('预估 ROI 勉强正向，需要关注执行细节');
  }

  if ((params.activity.daysToDeadline || 999) <= 1) {
    reasons.push('活动即将截止，时效价值较高');
    riskNotes.push('剩余报名时间短，执行失败会损失窗口');
  }

  if (params.inventory?.availableDays !== undefined) {
    if (params.inventory.availableDays >= 7) {
      reasons.push('库存覆盖天数充足，可承接活动增量');
    } else if (params.inventory.availableDays < 3) {
      riskNotes.push('库存覆盖天数偏低，需谨慎放量');
    }
  } else {
    riskNotes.push('缺少库存覆盖天数，库存风险判断不完整');
  }

  if (params.history?.avgRoi !== undefined) {
    if (params.history.avgRoi >= 1.5) {
      reasons.push('历史同类活动表现较好');
    } else if (params.history.avgRoi < 1) {
      riskNotes.push('历史同类活动回报偏低');
    }
  }

  if (params.history?.successRate !== undefined && params.history.successRate < 0.7) {
    riskNotes.push('历史执行成功率偏低，需关注提报稳定性');
  }

  if (params.netProfitPerOrder < 3) {
    riskNotes.push(
      `门店 ${params.storeName} 当前单笔净利润空间较薄，活动成本容错率低`,
    );
  }

  return {
    reasons: uniq(reasons),
    riskNotes: uniq(riskNotes),
  };
}

function computeScores(params: {
  activity: ActivityRecord;
  history?: ActivityHistorySignal;
  inventory?: ActivityInventorySignal;
  roi: number;
}) {
  const subsidy = params.activity.platformSubsidy || 0;
  const daysToDeadline = params.activity.daysToDeadline ?? 999;
  const historySuccessRate = params.history?.successRate ?? 0.7;
  const historyRoi = params.history?.avgRoi ?? Math.min(params.roi, 2);

  const roiScore = clamp(params.roi / 3);
  const subsidyScore = clamp(subsidy / 20);
  const urgencyScore = daysToDeadline <= 1 ? 1 : daysToDeadline <= 3 ? 0.7 : 0.4;
  const historyScore = clamp(historyRoi / 2) * 0.6 + clamp(historySuccessRate) * 0.4;

  const score = clamp(
    roiScore * 0.45 +
      subsidyScore * 0.15 +
      urgencyScore * 0.15 +
      historyScore * 0.25,
  );

  const merchantCost = params.activity.merchantCost || 0;
  const marginRisk = clamp(merchantCost / Math.max(merchantCost + params.roi, 1));
  const inventoryRisk =
    params.inventory?.availableDays === undefined
      ? 0.2
      : params.inventory.availableDays < 3
        ? 0.5
        : params.inventory.availableDays < 7
          ? 0.25
          : 0.05;
  const deadlineRisk = daysToDeadline <= 1 ? 0.3 : daysToDeadline <= 3 ? 0.18 : 0.08;
  const historyRisk = params.history?.successRate === undefined
    ? 0.12
    : params.history.successRate < 0.7
      ? 0.35
      : 0.1;

  const riskScore = clamp(
    marginRisk * 0.35 +
      inventoryRisk * 0.25 +
      deadlineRisk * 0.15 +
      historyRisk * 0.25,
  );

  return {
    riskScore,
    score,
  };
}

function resolveDecision(
  hasHardBlock: boolean,
  score: number,
  riskScore: number,
  thresholds: Required<ActivityDecisionThresholds>,
) {
  if (hasHardBlock) {
    return {
      decision: 'block' as const,
      recommendedAction: 'skip' as const,
      riskLevel: 'high' as const,
    };
  }

  if (
    score >= thresholds.autoAllowMinScore &&
    riskScore <= thresholds.autoAllowMaxRiskScore
  ) {
    return {
      decision: 'allow' as const,
      recommendedAction: 'auto_apply' as const,
      riskLevel: 'low' as const,
    };
  }

  if (
    score >= thresholds.reviewMinScore &&
    riskScore <= thresholds.reviewMaxRiskScore
  ) {
    return {
      decision: 'review' as const,
      recommendedAction: 'manual_review' as const,
      riskLevel: 'medium' as const,
    };
  }

  return {
    decision: 'block' as const,
    recommendedAction: 'skip' as const,
    riskLevel: 'high' as const,
  };
}

function sortCandidates(candidates: ActivityDecisionCandidate[]) {
  const order: Record<ActivityDecision, number> = {
    allow: 0,
    review: 1,
    block: 2,
  };

  return [...candidates].sort((left, right) => {
    const decisionGap = order[left.decision] - order[right.decision];
    if (decisionGap !== 0) return decisionGap;
    return right.score - left.score;
  });
}

function mergeAiSuggestion(
  candidate: ActivityDecisionCandidate,
  aiSuggestion?: {
    reasons?: string[];
    riskNotes?: string[];
    riskScoreAdjustment?: number;
    scoreAdjustment?: number;
    suggestedAction?: ActivityDecisionSuggestedAction;
  },
  thresholds?: Required<ActivityDecisionThresholds>,
) {
  if (!aiSuggestion) return candidate;

  const nextScore = clamp(candidate.score + (aiSuggestion.scoreAdjustment || 0));
  const nextRiskScore = clamp(
    candidate.riskScore + (aiSuggestion.riskScoreAdjustment || 0),
  );

  const resolved = resolveDecision(
    candidate.hardBlocked === true,
    nextScore,
    nextRiskScore,
    thresholds || DEFAULT_THRESHOLDS,
  );

  const suggestedAction = aiSuggestion.suggestedAction === 'skip'
    ? 'skip'
    : aiSuggestion.suggestedAction === 'manual_review'
      ? 'manual_review'
      : aiSuggestion.suggestedAction === 'auto_apply'
        ? resolved.recommendedAction === 'allow' ? 'auto_apply' : resolved.recommendedAction
        : resolved.recommendedAction;

  return {
    ...candidate,
    decision: resolved.decision,
    reasons: uniq([...candidate.reasons, ...(aiSuggestion.reasons || [])]),
    recommendedAction: suggestedAction,
    riskLevel: resolved.riskLevel,
    riskNotes: uniq([...candidate.riskNotes, ...(aiSuggestion.riskNotes || [])]),
    riskScore: nextRiskScore,
    score: nextScore,
  } satisfies ActivityDecisionCandidate;
}

export async function recommendActivityDecisions(
  input: ActivityDecisionInput,
): Promise<ActivityDecisionResult> {
  const storeName = input.storeName || '安吉店';
  const activities =
    input.activities && input.activities.length > 0
      ? input.activities
      : loadActivityCatalog({
          status: input.status || 'all',
          storeName,
        }).list;

  const store = getStoreMetrics(storeName);
  const thresholds = mergeThresholds(input.thresholds);
  const currentPromotions = normalizeNameSet(input.currentPromotionNames);

  const candidates = activities.map((activity) => {
    const inventory = resolveInventorySignals(input, activity);
    const history = resolveHistorySignals(input, activity);
    const roi = calculateActivityRoi(activity, storeName);
    const grossProfitPerOrder = store.avgOrderValue * store.grossMargin;
    const netProfitPerOrder = grossProfitPerOrder - (activity.merchantCost || 0);

    const hardRuleResult = evaluateHardRules(
      activity,
      netProfitPerOrder,
      currentPromotions,
      inventory,
    );

    const heuristic = buildHeuristicReasoning({
      activity,
      history,
      inventory,
      netProfitPerOrder,
      roi,
      storeName,
    });

    const scores = computeScores({
      activity,
      history,
      inventory,
      roi,
    });

    const resolved = resolveDecision(
      hardRuleResult.blockReasons.length > 0,
      scores.score,
      scores.riskScore,
      thresholds,
    );

    const reasons = hardRuleResult.blockReasons.length > 0
      ? hardRuleResult.blockReasons
      : heuristic.reasons;

    return {
      daysToDeadline: activity.daysToDeadline ?? 999,
      decision: resolved.decision,
      hardBlocked: hardRuleResult.blockReasons.length > 0,
      immediateSignup: activity.immediateSignup !== false,
      inventorySignals: inventory,
      level: activity.level,
      merchantCost: activity.merchantCost || 0,
      name: activity.name,
      platform: activity.platform || 'unknown',
      platformSubsidy: activity.platformSubsidy || 0,
      reasons,
      recommendedAction: resolved.recommendedAction,
      riskLevel: resolved.riskLevel,
      riskNotes: heuristic.riskNotes,
      riskScore: scores.riskScore,
      roi,
      ruleHits: hardRuleResult.ruleHits,
      score: scores.score,
      status: activity.status || 'unknown',
    } satisfies ActivityDecisionCandidate;
  });

  const aiSuggestions = await getActivityAiSuggestions(
    storeName,
    candidates.filter((item) => item.decision !== 'block'),
  );

  const mergedCandidates = sortCandidates(
    candidates.map((candidate) =>
      mergeAiSuggestion(candidate, aiSuggestions.get(candidate.name), thresholds),
    ),
  );

  const topCandidate = mergedCandidates[0];
  const summary = {
    allow: mergedCandidates.filter((item) => item.decision === 'allow').length,
    block: mergedCandidates.filter((item) => item.decision === 'block').length,
    review: mergedCandidates.filter((item) => item.decision === 'review').length,
    total: mergedCandidates.length,
  };

  if (!topCandidate) {
    return {
      candidates: [],
      decision: 'block',
      reasons: ['当前没有可评估的活动数据'],
      recommendedAction: 'skip',
      riskLevel: 'high',
      riskScore: 1,
      ruleHits: [],
      score: 0,
      storeName,
      summary,
    };
  }

  return {
    candidates: mergedCandidates,
    decision: topCandidate.decision,
    reasons: topCandidate.reasons,
    recommendedAction: topCandidate.recommendedAction,
    riskLevel: topCandidate.riskLevel,
    riskScore: topCandidate.riskScore,
    ruleHits: topCandidate.ruleHits,
    score: topCandidate.score,
    storeName,
    summary,
  };
}
