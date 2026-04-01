import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export interface DecisionModelConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  source:
    | 'decision_env'
    | 'openclaw_aliyun'
    | 'product_compare_config'
    | 'shared_env';
}

interface PersistedAiConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

interface OpenClawProviderModel {
  id?: string;
}

interface OpenClawProviderConfig {
  apiKey?: string;
  baseUrl?: string;
  models?: OpenClawProviderModel[];
}

interface OpenClawConfig {
  models?: {
    providers?: Record<string, OpenClawProviderConfig | undefined>;
  };
}

const DEFAULT_MODEL = 'qwen3.5-plus';
const DEFAULT_BASE_URL = 'https://coding.dashscope.aliyuncs.com/v1/chat/completions';
const PRODUCT_COMPARE_CONFIG_PATH = path.join(
  os.homedir(),
  '.scriptai',
  'product-compare',
  'ai-config.json',
);
const OPENCLAW_CONFIG_PATH = path.join(os.homedir(), '.openclaw', 'openclaw.json');

function normalizeText(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeChatCompletionsUrl(value: string) {
  const normalized = normalizeText(value).replace(/\/$/, '');
  if (!normalized) {
    return DEFAULT_BASE_URL;
  }
  if (normalized.includes('/chat/completions')) {
    return normalized;
  }
  return `${normalized}/chat/completions`;
}

async function readPersistedAiConfig(): Promise<null | PersistedAiConfig> {
  try {
    const content = await fs.readFile(PRODUCT_COMPARE_CONFIG_PATH, 'utf8');
    return JSON.parse(content) as PersistedAiConfig;
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    return null;
  }
}

async function readOpenClawAliyunConfig(): Promise<null | PersistedAiConfig> {
  try {
    const content = await fs.readFile(OPENCLAW_CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(content) as OpenClawConfig;
    const aliyun = parsed?.models?.providers?.aliyun;
    if (!aliyun) {
      return null;
    }

    return {
      apiKey: normalizeText(aliyun.apiKey),
      baseUrl: normalizeText(aliyun.baseUrl),
      model: normalizeText(aliyun.models?.[0]?.id) || DEFAULT_MODEL,
    };
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    return null;
  }
}

export async function getDecisionModelConfig(): Promise<DecisionModelConfig | null> {
  const persisted = await readPersistedAiConfig();
  const openClawAliyun = await readOpenClawAliyunConfig();

  const explicitApiKey = normalizeText(process.env.DECISION_AI_API_KEY);
  const explicitBaseUrl = normalizeText(process.env.DECISION_AI_BASE_URL);
  const explicitModel = normalizeText(process.env.DECISION_AI_MODEL);

  const persistedApiKey = normalizeText(persisted?.apiKey);
  const persistedBaseUrl = normalizeText(persisted?.baseUrl);
  const persistedModel = normalizeText(persisted?.model);

  const openClawApiKey = normalizeText(openClawAliyun?.apiKey);
  const openClawBaseUrl = normalizeText(openClawAliyun?.baseUrl);
  const openClawModel = normalizeText(openClawAliyun?.model);

  const sharedEnvApiKey =
    normalizeText(process.env.ALIYUN_API_KEY) ||
    normalizeText(process.env.DASHSCOPE_API_KEY) ||
    normalizeText(process.env.OPENAI_API_KEY);

  const apiKey =
    explicitApiKey || persistedApiKey || openClawApiKey || sharedEnvApiKey;
  if (!apiKey) {
    return null;
  }

  const source: DecisionModelConfig['source'] = explicitApiKey
    ? 'decision_env'
    : persistedApiKey
      ? 'product_compare_config'
      : openClawApiKey
        ? 'openclaw_aliyun'
        : 'shared_env';

  return {
    apiKey,
    baseUrl: normalizeChatCompletionsUrl(
      explicitBaseUrl || persistedBaseUrl || openClawBaseUrl,
    ),
    model: explicitModel || persistedModel || openClawModel || DEFAULT_MODEL,
    source,
  };
}
