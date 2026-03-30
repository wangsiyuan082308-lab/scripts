import type {
  ActivityDecisionCandidate,
  ActivityDecisionSuggestedAction,
} from './activity-decision';

interface ActivityAiSuggestion {
  name: string;
  reasons?: string[];
  riskNotes?: string[];
  riskScoreAdjustment?: number;
  scoreAdjustment?: number;
  suggestedAction?: ActivityDecisionSuggestedAction;
}

interface ActivityAiResponse {
  items?: ActivityAiSuggestion[];
}

function clamp(value: number, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function cleanJsonBlock(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }
  return trimmed;
}

function parseAiResponse(text: string): ActivityAiResponse | null {
  try {
    return JSON.parse(cleanJsonBlock(text)) as ActivityAiResponse;
  } catch {
    return null;
  }
}

function getModelConfig() {
  const apiKey = process.env.DECISION_AI_API_KEY?.trim();
  const baseUrl = process.env.DECISION_AI_BASE_URL?.trim();
  const model = process.env.DECISION_AI_MODEL?.trim();

  if (!apiKey || !baseUrl || !model) {
    return null;
  }

  return {
    apiKey,
    baseUrl: baseUrl.replace(/\/$/, ''),
    model,
  };
}

function buildPrompt(storeName: string, candidates: ActivityDecisionCandidate[]) {
  const compactCandidates = candidates.slice(0, 6).map((item) => ({
    daysToDeadline: item.daysToDeadline,
    decision: item.decision,
    inventorySignals: item.inventorySignals,
    level: item.level,
    merchantCost: item.merchantCost,
    name: item.name,
    platformSubsidy: item.platformSubsidy,
    riskLevel: item.riskLevel,
    riskScore: item.riskScore,
    roi: item.roi,
    score: item.score,
  }));

  return [
    '你是即时零售活动运营分析助手。',
    '请基于候选活动给出更自然的推荐理由、风险提示，以及小幅度的评分修正建议。',
    '不要突破原有硬规则边界，不要把 block 提升为 auto_apply。',
    '只返回 JSON。',
    '',
    '返回格式：',
    '{"items":[{"name":"活动名","scoreAdjustment":0.02,"riskScoreAdjustment":-0.03,"suggestedAction":"review","reasons":["..."],"riskNotes":["..."]}]}',
    '',
    `门店：${storeName}`,
    '候选活动：',
    JSON.stringify(compactCandidates, null, 2),
  ].join('\n');
}

export async function getActivityAiSuggestions(
  storeName: string,
  candidates: ActivityDecisionCandidate[],
) {
  const config = getModelConfig();
  if (!config || candidates.length === 0) {
    return new Map<string, ActivityAiSuggestion>();
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages: [
        {
          role: 'system',
          content:
            '你是即时零售运营 AI 决策增强层。只能输出 JSON，不要输出 Markdown 或解释。',
        },
        {
          role: 'user',
          content: buildPrompt(storeName, candidates),
        },
      ],
      model: config.model,
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    return new Map<string, ActivityAiSuggestion>();
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    return new Map<string, ActivityAiSuggestion>();
  }

  const parsed = parseAiResponse(content);
  if (!parsed?.items || !Array.isArray(parsed.items)) {
    return new Map<string, ActivityAiSuggestion>();
  }

  const map = new Map<string, ActivityAiSuggestion>();
  for (const item of parsed.items) {
    if (!item?.name) continue;
    map.set(item.name, {
      ...item,
      riskScoreAdjustment: Number.isFinite(item.riskScoreAdjustment)
        ? clamp(Number(item.riskScoreAdjustment), -0.2, 0.2)
        : 0,
      scoreAdjustment: Number.isFinite(item.scoreAdjustment)
        ? clamp(Number(item.scoreAdjustment), -0.2, 0.2)
        : 0,
    });
  }
  return map;
}
