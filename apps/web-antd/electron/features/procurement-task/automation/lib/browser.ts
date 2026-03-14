import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as http from 'http';
import * as crypto from 'crypto';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { log } from './utils';

const DEFAULT_USER_DATA_DIR = path.resolve(__dirname, '../../../eleme-activity-assistant/user_data');
const COOKIE_BACKUP_FILE = path.resolve(__dirname, '../../data/cookies-backup.json');
const DEFAULT_CDP_PORT = 18792;
const DEFAULT_VIEWPORT = { width: 1440, height: 900 };
const RELAY_TOKEN_CONTEXT = 'openclaw-extension-relay-v1';
const RELAY_AUTH_HEADER = 'x-openclaw-relay-token';

let muteViolationCount = 0;

export function getMuteComplianceStatus(): 'PASS' | 'FAIL' {
  return muteViolationCount > 0 ? 'FAIL' : 'PASS';
}


interface BrowserOptions {
  headless?: boolean;
  viewport?: { width: number; height: number };
  cdpPort?: number;
  userDataDir?: string;
}

function isProfileInUseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /ProcessSingleton|profile directory.*already in use|SingletonLock/i.test(message);
}

async function launchPersistentContextWithFallback(
  userDataDir: string,
  options: { headless: boolean; viewport: { width: number; height: number } },
): Promise<{ context: BrowserContext; actualUserDataDir: string; usingTempProfile: boolean }> {
  const launchOptions = {
    channel: 'chrome' as const,
    headless: options.headless,
    viewport: options.viewport,
    args: ['--disable-blink-features=AutomationControlled', '--mute-audio', '--autoplay-policy=user-gesture-required'],
  };

  try {
    const context = await chromium.launchPersistentContext(userDataDir, launchOptions);
    return { context, actualUserDataDir: userDataDir, usingTempProfile: false };
  } catch (error) {
    if (!isProfileInUseError(error)) {
      throw error;
    }

    const tempUserDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qnh-browser-profile-'));
    log('检测到持久化 profile 正被占用，改用临时 profile 启动: ' + tempUserDataDir);
    const context = await chromium.launchPersistentContext(tempUserDataDir, launchOptions);
    return { context, actualUserDataDir: tempUserDataDir, usingTempProfile: true };
  }
}

/**
 * 从环境变量或 openclaw.json 获取 gateway token
 */
function resolveGatewayToken(): string | null {
  const envToken = process.env.OPENCLAW_GATEWAY_TOKEN?.trim() || process.env.CLAWDBOT_GATEWAY_TOKEN?.trim();
  if (envToken) return envToken;

  try {
    const configPath = path.join(process.env.HOME || '', '.openclaw', 'openclaw.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return config?.gateway?.auth?.token?.trim() || null;
  } catch {
    return null;
  }
}

/**
 * 派生 relay auth token
 */
function deriveRelayToken(gatewayToken: string, port: number): string {
  return crypto.createHmac('sha256', gatewayToken)
    .update(`${RELAY_TOKEN_CONTEXT}:${port}`)
    .digest('hex');
}

function getMuteInitScript(): string {
  return `(() => {
    const policy = (window.__openclawMutePolicy = window.__openclawMutePolicy || { violations: 0 });
    const forceMute = (el) => {
      try {
        if (!el) return;
        if (!el.muted || Number(el.volume) !== 0) {
          policy.violations += 1;
          try {
            if (typeof window.reportMuteViolation === 'function') {
              window.reportMuteViolation({
                tag: el.tagName || 'MEDIA',
                src: (el.currentSrc || el.src || '').slice(0, 200),
                reason: 'element-not-muted',
              });
            }
          } catch {}
        }
        el.muted = true;
        el.defaultMuted = true;
        el.volume = 0;
        if ('playsInline' in el) el.playsInline = true;
      } catch {}
    };

    const patchPlay = (proto) => {
      if (!proto || proto.__openclawMutePatched) return;
      const rawPlay = proto.play;
      if (typeof rawPlay === 'function') {
        proto.play = function(...args) {
          forceMute(this);
          return rawPlay.apply(this, args);
        };
      }
      proto.__openclawMutePatched = true;
    };

    patchPlay(window.HTMLMediaElement && window.HTMLMediaElement.prototype);
    patchPlay(window.HTMLAudioElement && window.HTMLAudioElement.prototype);
    patchPlay(window.HTMLVideoElement && window.HTMLVideoElement.prototype);

    const patchAudioCtor = () => {
      const RawAudio = window.Audio;
      if (typeof RawAudio !== 'function' || RawAudio.__openclawMutePatched) return;
      const Wrapped = function(...args) {
        const a = new RawAudio(...args);
        forceMute(a);
        return a;
      };
      Wrapped.prototype = RawAudio.prototype;
      Object.setPrototypeOf(Wrapped, RawAudio);
      Wrapped.__openclawMutePatched = true;
      window.Audio = Wrapped;
    };
    patchAudioCtor();

    const scanAndMute = () => {
      try {
        document.querySelectorAll('audio,video').forEach((el) => forceMute(el));
      } catch {}
    };

    scanAndMute();
    const mo = new MutationObserver(() => scanAndMute());
    mo.observe(document.documentElement || document, { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'autoplay', 'muted', 'volume'] });

    document.addEventListener('play', (ev) => forceMute(ev.target), true);
    document.addEventListener('volumechange', (ev) => forceMute(ev.target), true);
  })();`;
}

async function applyMuteToPageNow(page: Page): Promise<void> {
  await page.addInitScript({ content: getMuteInitScript() });
  await page.evaluate(getMuteInitScript()).catch(() => {});
}

async function enforceMutePolicy(context: BrowserContext): Promise<void> {
  try {
    await context.exposeBinding('reportMuteViolation', async (_source, payload) => {
      muteViolationCount += 1;
      log('P0违规: 检测到页面触发声音，已立即静音修复 | ' + JSON.stringify(payload || {}));
    });
  } catch {}

  await context.addInitScript({ content: getMuteInitScript() });

  for (const p of context.pages()) {
    p.on('console', msg => {
      const txt = msg.text();
      if (txt.includes('P0')) log(txt);
    });
    await applyMuteToPageNow(p);
  }

  context.on('page', async (p) => {
    p.on('console', msg => {
      const txt = msg.text();
      if (txt.includes('P0')) log(txt);
    });
    await applyMuteToPageNow(p);
  });
}

/**
 * 尝试通过 CDP 连接已登录的 Chrome（OpenClaw Browser Relay）
 * 失败则 fallback 到 persistent context（复用 cookie）
 */
export async function launchBrowser(options?: BrowserOptions): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
  const cdpPort = options?.cdpPort || DEFAULT_CDP_PORT;
  const userDataDir = options?.userDataDir || DEFAULT_USER_DATA_DIR;
  const headless = options?.headless ?? false;
  const viewport = options?.viewport || DEFAULT_VIEWPORT;

  // 全局静音硬规则：仅使用我们可控启动参数的浏览器实例（必须包含 --mute-audio）
  log('静音策略已启用：跳过 CDP 复用，使用 persistent context 启动（--mute-audio）');

  const { context, actualUserDataDir, usingTempProfile } = await launchPersistentContextWithFallback(userDataDir, {
    headless,
    viewport,
  });

  const page = context.pages()[0] || await context.newPage();

  // 恢复上次保存的 session cookie
  await restoreCookies(context);

  await enforceMutePolicy(context);
  log('浏览器已启动（persistent context，复用 cookie，静音强制）' + (usingTempProfile ? ' [临时 profile 回退]' : '') + ' userDataDir=' + actualUserDataDir);
  return { browser: null as any, context, page };
}

/**
 * 保存所有 cookie（含 session cookie）到文件
 * 在 context.close() 之前调用
 */
export async function saveCookies(context: BrowserContext): Promise<void> {
  try {
    const cookies = await context.cookies();
    const dir = path.dirname(COOKIE_BACKUP_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(COOKIE_BACKUP_FILE, JSON.stringify(cookies, null, 2));
    log('已保存 ' + cookies.length + ' 个 cookie');
  } catch (e: any) {
    log('保存 cookie 失败: ' + e.message);
  }
}

/**
 * 从文件恢复 session cookie
 * 在浏览器启动后、导航前调用
 */
async function restoreCookies(context: BrowserContext): Promise<void> {
  try {
    if (!fs.existsSync(COOKIE_BACKUP_FILE)) return;
    const raw = fs.readFileSync(COOKIE_BACKUP_FILE, 'utf-8');
    const cookies = JSON.parse(raw);
    if (!Array.isArray(cookies) || cookies.length === 0) return;
    await context.addCookies(cookies);
    log('已恢复 ' + cookies.length + ' 个 cookie');
  } catch (e: any) {
    log('恢复 cookie 失败: ' + e.message);
  }
}
