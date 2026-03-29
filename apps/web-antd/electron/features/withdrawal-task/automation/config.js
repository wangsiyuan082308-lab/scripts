import * as fs from 'node:fs';
import * as path from 'node:path';
import 'dotenv/config';

const EVOLUTION_FILE = path.join(process.cwd(), 'evolution.json');

const DEFAULT_EVOLUTION_CONFIG = {
    baseWaitTime: 1000,
    failureThreshold: 3,
    maxWaitTime: 10_000,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
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
        }
        catch {
            console.error('Failed to load evolution config, using defaults.');
        }
    }
    return { ...DEFAULT_EVOLUTION_CONFIG };
}

export function saveEvolutionConfig(config) {
    try {
        fs.writeFileSync(EVOLUTION_FILE, JSON.stringify(config, null, 2));
        console.log('Evolution config updated.');
    }
    catch (error) {
        console.error('Failed to save evolution config', error);
    }
}

export const evolutionConfig = loadEvolutionConfig();

export const CONFIG = {
    url: 'https://nr.ele.me/app/eleme-nr-bfe-newretail/common-next#/pc/orderProcessingPc/tab',
    financeUrl: 'https://nr.ele.me/app/eleme-nr-bfe-newretail/common-next#/pc/accountManagementPc/accountFlow',
    password: process.env.ELEME_PASSWORD || '130816',
    targetStores: process.env.ELEME_TARGET_STORES
        ? process.env.ELEME_TARGET_STORES.split(',').map((store) => store.trim()).filter(Boolean)
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

export function loadCoords() {
    if (fs.existsSync(CONFIG.coordsFile)) {
        try {
            return JSON.parse(fs.readFileSync(CONFIG.coordsFile, 'utf8'));
        }
        catch {
            console.error('Failed to read coords file, using empty history.');
        }
    }
    return {};
}

export function saveCoords(coords) {
    fs.writeFileSync(CONFIG.coordsFile, JSON.stringify(coords, null, 2));
}
