import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export interface SharedAiModelConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

interface LegacyProductCompareAiConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

interface RuntimePaths {
  configPath: string;
  dataDir: string;
}

const AI_MODEL_DIRNAME = 'ai-model';
const AI_MODEL_CONFIG_FILENAME = 'config.json';
const LEGACY_PRODUCT_COMPARE_DIRNAME = 'product-compare';
const LEGACY_PRODUCT_COMPARE_CONFIG_FILENAME = 'ai-config.json';
const DEFAULT_MODEL = 'qwen3.5-plus';
const DEFAULT_BASE_URL = 'https://coding.dashscope.aliyuncs.com/v1/chat/completions';

function normalizeText(value: unknown) {
  return String(value ?? '').trim();
}

export function normalizeChatCompletionsUrl(value: unknown) {
  const normalized = normalizeText(value).replace(/\/$/, '');
  if (!normalized) {
    return DEFAULT_BASE_URL;
  }
  if (normalized.includes('/chat/completions')) {
    return normalized;
  }
  return `${normalized}/chat/completions`;
}

function getRuntimeRoot() {
  if (process.env.SCRIPTAI_AI_CONFIG_HOME) {
    return process.env.SCRIPTAI_AI_CONFIG_HOME;
  }
  if (process.env.SCRIPTAI_AI_MODEL_HOME) {
    return process.env.SCRIPTAI_AI_MODEL_HOME;
  }
  return path.join(os.homedir(), '.scriptai', AI_MODEL_DIRNAME);
}

function getRuntimePaths(): RuntimePaths {
  if (process.env.SCRIPTAI_AI_CONFIG_PATH) {
    const configPath = process.env.SCRIPTAI_AI_CONFIG_PATH;
    return {
      configPath,
      dataDir: path.dirname(configPath),
    };
  }
  if (process.env.SCRIPTAI_AI_MODEL_CONFIG_PATH) {
    const configPath = process.env.SCRIPTAI_AI_MODEL_CONFIG_PATH;
    return {
      configPath,
      dataDir: path.dirname(configPath),
    };
  }

  const dataDir = getRuntimeRoot();
  return {
    configPath: path.join(dataDir, AI_MODEL_CONFIG_FILENAME),
    dataDir,
  };
}

function getLegacyProductCompareConfigPath() {
  if (process.env.PRODUCT_COMPARE_HOME) {
    return path.join(
      process.env.PRODUCT_COMPARE_HOME,
      LEGACY_PRODUCT_COMPARE_CONFIG_FILENAME,
    );
  }

  return path.join(
    os.homedir(),
    '.scriptai',
    LEGACY_PRODUCT_COMPARE_DIRNAME,
    LEGACY_PRODUCT_COMPARE_CONFIG_FILENAME,
  );
}

async function ensureDirectory(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function readJsonFile<T>(filePath: string): Promise<null | T> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content) as T;
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function writeJsonAtomic(filePath: string, data: unknown) {
  await ensureDirectory(path.dirname(filePath));
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
  await fs.rename(tempPath, filePath);
}

export function normalizeSharedAiModelConfig(
  input?: null | Partial<SharedAiModelConfig>,
): SharedAiModelConfig {
  return {
    apiKey: normalizeText(input?.apiKey),
    baseUrl: normalizeChatCompletionsUrl(input?.baseUrl),
    model: normalizeText(input?.model) || DEFAULT_MODEL,
  };
}

export function extractSharedAiConfig(
  input?: null | Partial<SharedAiModelConfig>,
): SharedAiModelConfig {
  return normalizeSharedAiModelConfig(input);
}

async function readLegacyProductCompareAiConfig() {
  const rawConfig = await readJsonFile<LegacyProductCompareAiConfig>(
    getLegacyProductCompareConfigPath(),
  );
  return rawConfig ? normalizeSharedAiModelConfig(rawConfig) : null;
}

export async function readSharedAiModelConfig() {
  const paths = getRuntimePaths();
  const rawConfig = await readJsonFile<Partial<SharedAiModelConfig>>(paths.configPath);
  if (rawConfig) {
    return normalizeSharedAiModelConfig(rawConfig);
  }
  return readLegacyProductCompareAiConfig();
}

export async function getSharedAiModelConfig() {
  const stored = await readSharedAiModelConfig();
  return stored ?? normalizeSharedAiModelConfig();
}

export async function getSharedAiConfig() {
  return getSharedAiModelConfig();
}

export async function saveSharedAiModelConfig(input: Partial<SharedAiModelConfig>) {
  const paths = getRuntimePaths();
  const current = await getSharedAiModelConfig();
  const normalized = normalizeSharedAiModelConfig({
    ...current,
    ...input,
  });

  await ensureDirectory(paths.dataDir);
  await writeJsonAtomic(paths.configPath, normalized);
  return normalized;
}

export async function saveSharedAiConfig(input: Partial<SharedAiModelConfig>) {
  return saveSharedAiModelConfig(input);
}
