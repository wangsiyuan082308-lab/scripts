import * as fs from 'node:fs';
import * as path from 'node:path';

const EVOLUTION_FILE = path.join(process.cwd(), 'evolution.json');
let envLoaded = false;

const DEFAULT_EVOLUTION_CONFIG = {
    baseWaitTime: 1000,
    failureThreshold: 3,
    maxWaitTime: 10_000,
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

function stripWrappingQuotes(value) {
    if (value.length < 2) {
        return value;
    }
    const first = value[0];
    const last = value.at(-1);
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
        return value.slice(1, -1);
    }
    return value;
}

function parseEnvLine(line) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
        return null;
    }
    const matched = trimmed.match(/^([\w.-]+)\s*=\s*(.*)$/);
    if (!matched) {
        return null;
    }
    return {
        key: matched[1],
        value: stripWrappingQuotes(matched[2].trim()),
    };
}

function getEnvCandidateFiles() {
    const appRoot = path.join(__dirname, '..', '..', '..', '..');
    return [
        path.join(process.cwd(), '.env'),
        path.join(process.cwd(), '.env.local'),
        path.join(process.cwd(), 'apps', 'web-antd', '.env'),
        path.join(process.cwd(), 'apps', 'web-antd', '.env.local'),
        path.join(appRoot, '.env'),
        path.join(appRoot, '.env.local'),
    ];
}

export function ensureWithdrawalEnvLoaded() {
    if (envLoaded) {
        return;
    }
    envLoaded = true;
    const visited = new Set();
    for (const filePath of getEnvCandidateFiles()) {
        if (visited.has(filePath) || !fs.existsSync(filePath)) {
            continue;
        }
        visited.add(filePath);
        const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/u);
        for (const line of lines) {
            const parsed = parseEnvLine(line);
            if (!parsed || process.env[parsed.key] !== undefined) {
                continue;
            }
            process.env[parsed.key] = parsed.value;
        }
    }
}

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
ensureWithdrawalEnvLoaded();

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
