import { defineEventHandler } from 'h3';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SKILL_DIR = join(
  process.env.HOME || '/Users/mac',
  '.openclaw/workspace/skills/eleme-auto-withdrawal',
);

export default defineEventHandler(() => {
  try {
    const optimPath = join(SKILL_DIR, 'optimization_history.json');
    const history = existsSync(optimPath)
      ? JSON.parse(readFileSync(optimPath, 'utf-8'))
      : [];

    const knowledgePath = join(SKILL_DIR, 'knowledge_base.json');
    const knowledge = existsSync(knowledgePath)
      ? JSON.parse(readFileSync(knowledgePath, 'utf-8'))
      : null;

    return {
      code: 0,
      data: {
        list: Array.isArray(history) ? history : [],
        knowledge,
      },
    };
  } catch (e: any) {
    return { code: -1, data: { history: [], knowledge: null }, message: e.message };
  }
});
