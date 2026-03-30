import { requestClient } from './request';

export type ActivityDecision = 'allow' | 'block' | 'review';
export type ActivityRecommendedAction =
  | 'auto_apply'
  | 'manual_review'
  | 'skip';
export type ActivityRiskLevel = 'high' | 'low' | 'medium';

export interface ActivityDecisionInventorySignal {
  availableDays?: number;
  availableStock?: number;
}

export interface ActivityDecisionHistorySignal {
  avgRoi?: number;
  successRate?: number;
}

export interface ActivityDecisionInput {
  activities?: Array<Record<string, any>>;
  currentPromotionNames?: string[];
  historySummary?: Record<string, ActivityDecisionHistorySignal>;
  inventoryByActivityName?: Record<string, ActivityDecisionInventorySignal>;
  status?: string;
  storeName?: string;
  thresholds?: {
    autoAllowMaxRiskScore?: number;
    autoAllowMinScore?: number;
    reviewMaxRiskScore?: number;
    reviewMinScore?: number;
  };
}

export interface ActivityDecisionCandidate {
  decision: ActivityDecision;
  daysToDeadline: number;
  hardBlocked?: boolean;
  immediateSignup: boolean;
  inventorySignals?: ActivityDecisionInventorySignal;
  level?: string;
  merchantCost: number;
  name: string;
  platform: string;
  platformSubsidy: number;
  reasons: string[];
  recommendedAction: ActivityRecommendedAction;
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
  recommendedAction: ActivityRecommendedAction;
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

export async function recommendActivities(data: ActivityDecisionInput) {
  return requestClient.post<ActivityDecisionResult>(
    '/decision/activity/recommend',
    data,
  );
}
