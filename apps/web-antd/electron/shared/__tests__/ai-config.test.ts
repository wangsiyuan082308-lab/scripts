// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const originalAiConfigHome = process.env.SCRIPTAI_AI_CONFIG_HOME;
const originalCompareHome = process.env.PRODUCT_COMPARE_HOME;
const tempDirs: string[] = [];

function createTempDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  process.env.SCRIPTAI_AI_CONFIG_HOME = originalAiConfigHome;
  process.env.PRODUCT_COMPARE_HOME = originalCompareHome;
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

describe('shared ai config', () => {
  it('reads normalized values from the project local config file', async () => {
    process.env.SCRIPTAI_AI_CONFIG_HOME = createTempDir('ai-config-home-');

    const { getSharedAiConfig, saveSharedAiConfig } = await import('../ai-config');
    await saveSharedAiConfig({
      apiKey: 'test-key',
      baseUrl: 'https://example.com/v1',
      model: 'custom-model',
    });

    await expect(getSharedAiConfig()).resolves.toEqual({
      apiKey: 'test-key',
      baseUrl: 'https://example.com/v1/chat/completions',
      model: 'custom-model',
    });
  });

  it('falls back to legacy product compare config before the shared file is created', async () => {
    process.env.SCRIPTAI_AI_CONFIG_HOME = createTempDir('ai-config-home-');
    process.env.PRODUCT_COMPARE_HOME = createTempDir('product-compare-home-');

    fs.writeFileSync(
      path.join(process.env.PRODUCT_COMPARE_HOME, 'ai-config.json'),
      JSON.stringify({
        apiKey: 'legacy-key',
        baseUrl: 'https://legacy.example.com/v1',
        model: 'legacy-model',
      }),
      'utf8',
    );

    const { getSharedAiConfig } = await import('../ai-config');

    await expect(getSharedAiConfig()).resolves.toEqual({
      apiKey: 'legacy-key',
      baseUrl: 'https://legacy.example.com/v1/chat/completions',
      model: 'legacy-model',
    });
  });
});
