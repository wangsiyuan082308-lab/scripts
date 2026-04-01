import { getDecisionModelConfig } from './model-config';

export interface SiteSelectionInput {
  limit?: number;
  query?: string;
  scenePreference?: string;
}

export interface SiteSelectionRecommendation {
  avgMonthlyIncome: null | number;
  businessAreaType: string;
  city: string;
  coreAdvantages: string[];
  district: string;
  estimatedDailyOrders: null | number;
  grade: 'A' | 'B' | 'C' | 'D';
  id: string;
  locationName: string;
  nextActions: string[];
  population3km: null | number;
  populationDensity: null | number;
  recommendation: string;
  riskLevel: 'high' | 'low' | 'medium';
  riskNotes: string[];
  score: number;
  summary: string;
  topCompetitor9999Count: null | number;
}

export interface SiteSelectionResult {
  assumptions: string[];
  citySummary: string;
  generatedAt: string;
  items: SiteSelectionRecommendation[];
  marketVerdict: string;
  model: string;
  modelSource: string;
  nextActions: string[];
  query: string;
  total: number;
}

interface SiteSelectionAiItem {
  avgMonthlyIncome?: number | string;
  businessAreaType?: string;
  city?: string;
  coreAdvantages?: string[];
  district?: string;
  estimatedDailyOrders?: number | string;
  grade?: string;
  locationName?: string;
  nextActions?: string[];
  pointName?: string;
  population3km?: number | string;
  populationDensity?: number | string;
  recommendation?: string;
  riskLevel?: string;
  riskNotes?: string[];
  score?: number | string;
  summary?: string;
  topCompetitor9999Count?: number | string;
}

interface SiteSelectionAiResponse {
  assumptions?: string[];
  citySummary?: string;
  items?: SiteSelectionAiItem[];
  marketVerdict?: string;
  nextActions?: string[];
}

const DEFAULT_LIMIT = 3;

function normalizeText(value: unknown) {
  return String(value ?? '').trim();
}

function toNumber(value: unknown): null | number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  const text = normalizeText(value).replace(/,/g, '');
  if (!text) {
    return null;
  }
  const parsed = Number.parseFloat(text.replace(/[^\d.-]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function cleanJsonBlock(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith('```')) {
    return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  }
  return trimmed;
}

function extractMessageContent(payload: any) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === 'string') {
          return item;
        }
        if (typeof item?.text === 'string') {
          return item.text;
        }
        return '';
      })
      .join('\n');
  }
  return '';
}

function parseAiResponse(content: string): null | SiteSelectionAiResponse {
  const cleaned = cleanJsonBlock(content);
  try {
    return JSON.parse(cleaned) as SiteSelectionAiResponse;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) {
      return null;
    }
    try {
      return JSON.parse(match[0]) as SiteSelectionAiResponse;
    } catch {
      return null;
    }
  }
}

function toStringList(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => normalizeText(item)).filter(Boolean);
}

function resolveGrade(score: number, value: unknown): SiteSelectionRecommendation['grade'] {
  const normalized = normalizeText(value).toUpperCase();
  if (normalized === 'A' || normalized === 'B' || normalized === 'C' || normalized === 'D') {
    return normalized;
  }
  if (score >= 85) return 'A';
  if (score >= 75) return 'B';
  if (score >= 65) return 'C';
  return 'D';
}

function resolveRiskLevel(
  value: unknown,
  score: number,
): SiteSelectionRecommendation['riskLevel'] {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high') {
    return normalized;
  }
  if (score >= 85) return 'low';
  if (score >= 70) return 'medium';
  return 'high';
}

function resolveRecommendation(value: unknown, index: number) {
  const normalized = normalizeText(value);
  if (normalized) {
    return normalized;
  }
  return index === 0 ? '首选' : `备选${index}`;
}

function resolveLocationName(item: SiteSelectionAiItem, index: number) {
  const locationName =
    normalizeText(item.locationName) || normalizeText(item.pointName);
  return locationName || `候选点位${index}`;
}

function buildPrompt(input: Required<Pick<SiteSelectionInput, 'limit' | 'query'>> &
  Pick<SiteSelectionInput, 'scenePreference'>) {
  const preferenceText = normalizeText(input.scenePreference) || '不限';

  return [
    '你是即时零售门店选址分析助手，要把 openclaw 里的“其乐科技门店选址技能”迁移成结构化决策结果。',
    '业务背景：oby 便利超市，模式是前置仓 + 30分钟配送，目标客群是学生、白领、年轻家庭，客单价 25-35 元，毛利率约 25%。',
    '固定成本模型：房租 6000 + 人工 20000 + 水电 2000 + 杂费 2000 = 30000 元/月。',
    '盈亏线：133 单/天，安全线：200 单/天，优秀线：300 单/天。',
    '必须综合以下六个维度做判断：3公里人口、人口密度、区县 GDP、商圈热度、工资水平、旅游人口。',
    '一票否决项：3公里内 9999+ 便利店 > 5 家；存在月销 20000+ 绝对头部；无法办证；无法在 30 分钟内覆盖核心区域。',
    '评分口径：总分 100 分，85+ 为 A，75-84 为 B，65-74 为 C，<65 为 D。',
    '请只输出 2-3 个候选点位，并按推荐优先级排序。',
    '如果无法确认精确数据，可以基于常识做保守估算，但必须把不确定性写入 assumptions，不要假装是官方数据。',
    '只返回 JSON，不要输出 Markdown，不要解释。',
    '',
    '返回格式：',
    JSON.stringify(
      {
        assumptions: ['如果有数据不确定请写在这里'],
        citySummary: '一句话总结目标城市/区域是否值得进入',
        marketVerdict: '值得进入/谨慎进入/不建议进入',
        nextActions: ['下一步动作1', '下一步动作2'],
        items: [
          {
            recommendation: '首选',
            locationName: '吴兴万达广场附近',
            city: '湖州',
            district: '吴兴区',
            businessAreaType: '购物中心',
            population3km: 180000,
            populationDensity: 2600,
            avgMonthlyIncome: 6800,
            topCompetitor9999Count: 2,
            estimatedDailyOrders: 260,
            score: 88,
            grade: 'A',
            riskLevel: 'medium',
            summary: '商圈流量强、白领和社区客群兼顾，适合首店。',
            coreAdvantages: ['商圈自带流量', '周边住宅密集'],
            riskNotes: ['租金偏高', '需确认 3 公里内头部竞品数量'],
            nextActions: ['核实竞品', '确认仓储面积'],
          },
        ],
      },
      null,
      2,
    ),
    '',
    `用户需求：${input.query}`,
    `偏好场景：${preferenceText}`,
    `返回候选点位数量：${input.limit}`,
  ].join('\n');
}

export function normalizeSiteSelectionResponse(
  input: SiteSelectionInput,
  response: null | SiteSelectionAiResponse,
  metadata: { model: string; source: string },
): SiteSelectionResult {
  const query = normalizeText(input.query);
  const limit = clamp(
    Math.round(toNumber(input.limit) ?? DEFAULT_LIMIT),
    1,
    5,
  );

  const normalizedItems = (response?.items || [])
    .map((item, index) => {
      const score = clamp(Math.round(toNumber(item.score) ?? 0), 0, 100);
      return {
        avgMonthlyIncome: toNumber(item.avgMonthlyIncome),
        businessAreaType: normalizeText(item.businessAreaType) || '综合商圈',
        city: normalizeText(item.city),
        coreAdvantages: toStringList(item.coreAdvantages),
        district: normalizeText(item.district),
        estimatedDailyOrders: toNumber(item.estimatedDailyOrders),
        grade: resolveGrade(score, item.grade),
        id: `${normalizeText(item.city) || 'site'}-${normalizeText(item.district) || 'district'}-${index + 1}`,
        locationName: resolveLocationName(item, index + 1),
        nextActions: toStringList(item.nextActions),
        population3km: toNumber(item.population3km),
        populationDensity: toNumber(item.populationDensity),
        recommendation: normalizeText(item.recommendation),
        riskLevel: resolveRiskLevel(item.riskLevel, score),
        riskNotes: toStringList(item.riskNotes),
        score,
        summary: normalizeText(item.summary),
        topCompetitor9999Count: toNumber(item.topCompetitor9999Count),
      } satisfies SiteSelectionRecommendation;
    })
    .filter((item) => item.locationName || item.summary)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item, index) => ({
      ...item,
      recommendation: resolveRecommendation(item.recommendation, index),
    }));

  const marketVerdict = normalizeText(response?.marketVerdict)
    || ((normalizedItems[0]?.score ?? 0) >= 75
      ? '值得进入'
      : normalizedItems.length > 0
        ? '谨慎进入'
        : '');

  return {
    assumptions: toStringList(response?.assumptions),
    citySummary: normalizeText(response?.citySummary),
    generatedAt: new Date().toISOString(),
    items: normalizedItems,
    marketVerdict,
    model: metadata.model,
    modelSource: metadata.source,
    nextActions: toStringList(response?.nextActions),
    query,
    total: normalizedItems.length,
  };
}

export async function recommendSiteSelection(
  input: SiteSelectionInput,
): Promise<SiteSelectionResult> {
  const query = normalizeText(input.query);
  if (!query) {
    return normalizeSiteSelectionResponse(
      input,
      {
        citySummary: '',
        items: [],
        marketVerdict: '',
      },
      {
        model: '',
        source: '',
      },
    );
  }

  const config = await getDecisionModelConfig();
  if (!config) {
    throw new Error(
      '未配置可用模型，请先设置 DECISION_AI_* 环境变量，或在商品比对模型配置中录入 API Key / Base URL / 模型。',
    );
  }

  const limit = clamp(
    Math.round(toNumber(input.limit) ?? DEFAULT_LIMIT),
    1,
    5,
  );

  const response = await fetch(config.baseUrl, {
    body: JSON.stringify({
      messages: [
        {
          content:
            '你是即时零售选址 AI 决策层。只能返回 JSON，不要返回 Markdown、解释或额外说明。',
          role: 'system',
        },
        {
          content: buildPrompt({
            limit,
            query,
            scenePreference: input.scenePreference,
          }),
          role: 'user',
        },
      ],
      model: config.model,
      temperature: 0.2,
    }),
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  if (!response.ok) {
    throw new Error(`选址模型请求失败: ${response.status}`);
  }

  const payload = await response.json();
  if (payload?.error?.message) {
    throw new Error(`选址模型请求失败: ${payload.error.message}`);
  }

  const content = extractMessageContent(payload);
  if (!content) {
    throw new Error('选址模型未返回可解析内容');
  }

  const parsed = parseAiResponse(content);
  if (!parsed?.items || !Array.isArray(parsed.items) || parsed.items.length === 0) {
    throw new Error('选址模型未返回有效点位结果');
  }

  return normalizeSiteSelectionResponse(input, parsed, {
    model: config.model,
    source: config.source,
  });
}
