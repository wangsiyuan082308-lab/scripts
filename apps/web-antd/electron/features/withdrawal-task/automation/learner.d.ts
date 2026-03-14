interface LearningState {
    lastAnalyzedAt: string;
    totalExecutions: number;
    storeStats: Record<string, {
        successRate: number;
        avgDurationMs: number;
        totalAttempts: number;
        lastAmount: number | null;
        amountHistory: {
            date: string;
            amount: number;
        }[];
    }>;
    bestHours: number[];
    selectorHealth: Record<string, number>;
    riskTrend: {
        date: string;
        level: number;
        count: number;
    }[];
    recommendations: string[];
}
export declare function analyze(days?: number): LearningState;
export {};
