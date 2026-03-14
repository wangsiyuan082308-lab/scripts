import * as fs from 'node:fs';
import * as path from 'node:path';
import 'dotenv/config';

// --- 进化配置 ---
const EVOLUTION_FILE = path.join(process.cwd(), 'evolution.json');

const DEFAULT_EVOLUTION_CONFIG = {
  baseWaitTime: 1000,
  failureThreshold: 3,
  maxWaitTime: 10_000,
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

export function loadEvolutionConfig() {
  if (fs.existsSync(EVOLUTION_FILE)) {
    try {
      const data = fs.readFileSync(EVOLUTION_FILE, 'utf8');
      const config = JSON.parse(data);
      if (Array.isArray(config.userAgents)) {
        config.userAgent = config.userAgents[0];
      }
      return { ...DEFAULT_EVOLUTION_CONFIG, ...config };
    } catch {
      console.error('加载进化配置失败，使用默认值');
    }
  }
  return { ...DEFAULT_EVOLUTION_CONFIG };
}

export function saveEvolutionConfig(config: any) {
  try {
    fs.writeFileSync(EVOLUTION_FILE, JSON.stringify(config, null, 2));
    console.log('进化配置已更新');
  } catch (error) {
    console.error('保存进化配置失败', error);
  }
}

// 全局进化配置（可变，运行时可更新）
export const evolutionConfig = loadEvolutionConfig();

// --- 应用配置 ---
export const CONFIG = {
  url: 'https://nr.ele.me/app/eleme-nr-bfe-newretail/common-next#/pc/orderProcessingPc/tab',
  password: process.env.ELEME_PASSWORD || '130816',
  targetStores: process.env.ELEME_TARGET_STORES
    ? process.env.ELEME_TARGET_STORES.split(',')
    : ['Oby便利超市(安吉店)', 'Oby便利超市(长兴店)'],
  userDataDir: path.join(process.cwd(), 'user_data'),
  coordsFile: path.join(process.cwd(), 'coords.json'),
  baseWaitTime: evolutionConfig.baseWaitTime,
  minWithdrawAmount: (() => {
    const raw = process.env.MIN_WITHDRAW_AMOUNT ?? process.env.MIN_WITHDRAW_BALANCE ?? '0';
    const n = Number.parseFloat(raw);
    return Number.isNaN(n) ? 0 : n;
  })(),
};

// --- 坐标持久化 ---
export interface Coords {
  [storeName: string]: { x: number; y: number }[];
}

export function loadCoords(): Coords {
  if (fs.existsSync(CONFIG.coordsFile)) {
    try {
      return JSON.parse(fs.readFileSync(CONFIG.coordsFile, 'utf8'));
    } catch {
      console.error('读取坐标文件失败，将使用空记录');
    }
  }
  return {};
}

export function saveCoords(coords: Coords) {
  fs.writeFileSync(CONFIG.coordsFile, JSON.stringify(coords, null, 2));
}
