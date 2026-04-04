import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  findTaobaoMarketingTagSceneByTag,
  resolveTaobaoMarketingEntryScope,
} from '../../../../src/features/taobao-marketing-tag/config';
import { getTargetFrame } from './shared-utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ACTIVITY_URL =
  'https://nr.ele.me/app/eleme-nr-bfe-newretail/common-next#/pc/platformActivitiesPc/';

export interface SuperBrandAutomationLogEntry {
  data?: any;
  level: 'error' | 'info' | 'warn';
  msg: string;
  ts: string;
}

export type RuntimeOptions = {
  entryScope: 'brand_activity' | 'unsigned_activity';
  marketingTag: string;
  onLog?: (entry: SuperBrandAutomationLogEntry) => void;
  reportPath?: string;
  runtimeBaseDir?: string;
};

type SignupResultStatus = 'failed' | 'partial_success' | 'succeeded';

type SignupResult = {
  activityId: string;
  activityName: string;
  detailRoute?: string;
  marketingTag: string;
  merchantRatio?: number;
  message: string;
  screenshot?: string;
  sourceTab: '品牌活动';
  status: SignupResultStatus;
  storeCount?: number;
  storeIds?: string[];
  storeNames?: string[];
  success: boolean;
};

function isConfirmedSuperBrandActivity(text: string) {
  return /超级品牌|超级品牌红包/u.test(text);
}

function isExcludedActivityCandidate(text: string) {
  return /专属券|专享券|品类红包|品类满减红包|爆单红包|爆涨红包|爆好价/u.test(text);
}

function extractActivityIdFromRoute(route?: string) {
  const value = `${route || ''}`;
  const match = value.match(/activityId=(\d+)/u);
  return match?.[1] || '';
}

function parseRuntimeOptions(): RuntimeOptions {
  let entryScope: 'brand_activity' | 'unsigned_activity' = 'brand_activity';
  let marketingTag = '超级品牌红包';
  let reportPath = '';

  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];

    if (arg === '--marketing-tag' && process.argv[index + 1]) {
      marketingTag = `${process.argv[index + 1] || ''}`.trim() || marketingTag;
      index += 1;
      continue;
    }

    if (arg === '--entry-scope' && process.argv[index + 1]) {
      const raw = `${process.argv[index + 1] || ''}`.trim();
      if (raw === 'brand_activity' || raw === 'unsigned_activity') {
        entryScope = raw;
      }
      index += 1;
      continue;
    }

    if (arg === '--report-path' && process.argv[index + 1]) {
      reportPath = `${process.argv[index + 1] || ''}`.trim();
      index += 1;
    }
  }

  return {
    entryScope,
    marketingTag,
    reportPath: reportPath || undefined,
  };
}

function resolveRuntimeOptions(runtimeOptions: RuntimeOptions) {
  const runtimeScene = findTaobaoMarketingTagSceneByTag(runtimeOptions.marketingTag);
  const marketingTag = runtimeOptions.marketingTag || runtimeScene.marketingTag;
  const runtimeEntryScope = resolveTaobaoMarketingEntryScope({
    marketingTag,
    requestedEntryScope: runtimeOptions.entryScope,
    sceneKey: runtimeScene.key,
  });

  return {
    requestedEntryScope: runtimeOptions.entryScope,
    runtimeOptions: {
      ...runtimeOptions,
      entryScope: runtimeEntryScope,
      marketingTag,
    } satisfies RuntimeOptions,
  };
}
const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
let runtimeLogForwarder: RuntimeOptions['onLog'];
let runtimePaths:
  | {
      dataDir: string;
      logDir: string;
      userDataDir: string;
    }
  | undefined;

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function resolveRuntimeBaseDir(runtimeBaseDir?: string) {
  return `${runtimeBaseDir || process.env.DESKTOP_AUTOMATION_BASE_DIR || path.join(__dirname, '..')}`.trim();
}

function setRuntimePaths(runtimeBaseDir?: string) {
  const baseDir = resolveRuntimeBaseDir(runtimeBaseDir);
  runtimePaths = {
    dataDir: path.join(baseDir, 'data'),
    logDir: path.join(baseDir, 'logs'),
    userDataDir: path.join(baseDir, 'user_data'),
  };

  ensureDir(runtimePaths.dataDir);
  ensureDir(runtimePaths.logDir);
  ensureDir(runtimePaths.userDataDir);
}

function getRuntimePaths() {
  if (!runtimePaths) {
    setRuntimePaths();
  }
  return runtimePaths!;
}

function getLogFile() {
  return path.join(getRuntimePaths().logDir, `super_brand_${today}.log`);
}

function log(level: 'info' | 'warn' | 'error', msg: string, data?: any) {
  const ts = new Date().toISOString();
  const line = JSON.stringify({ ts, level, msg, ...(data ? { data } : {}) });
  console.log(`[${ts}] [${level.toUpperCase()}] ${msg}${data ? ` ${JSON.stringify(data)}` : ''}`);
  fs.appendFileSync(getLogFile(), `${line}\n`);
  runtimeLogForwarder?.({ data, level, msg, ts });
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function readFrameText(frame: any) {
  return frame.evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').trim()).catch(
    () => '',
  );
}

async function clickLabeledControl(
  frame: any,
  labels: string[],
  options: { exact?: boolean } = {},
) {
  for (const label of labels) {
    const escaped = escapeRegex(label);
    const matcher = options.exact ? new RegExp(`^\\s*${escaped}\\s*$`) : new RegExp(escaped);
    const locatorCandidates = [
      frame.getByRole('button', { name: matcher }).first(),
      frame.locator(`button:has-text("${label}")`).first(),
      frame.locator(`.ant-btn:has-text("${label}")`).first(),
      frame.getByText(matcher).first(),
    ];

    for (const locator of locatorCandidates) {
      try {
        if ((await locator.count()) > 0) {
          await locator.click();
          return { clicked: true, label };
        }
      } catch {}
    }
  }

  const clickedLabel = await frame
    .evaluate(
      ({ exact, labels }) => {
        const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();
        const isVisible = (el: Element | null) => {
          if (!el) return false;
          const rect = (el as HTMLElement).getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        };

        const nodes = Array.from(
          document.querySelectorAll('button, a, span, div, label, [role="button"], [role="tab"]'),
        );
        for (const label of labels as string[]) {
          const target = nodes.find((node) => {
            const text = normalize(node.textContent || '');
            if (!isVisible(node)) return false;
            return exact ? text === label : text.includes(label);
          }) as HTMLElement | undefined;
          if (target) {
            target.click();
            return label;
          }
        }
        return '';
      },
      { exact: !!options.exact, labels },
    )
    .catch(() => '');

  return { clicked: !!clickedLabel, label: clickedLabel || labels[0] || '' };
}

async function clickMarketingFilter(frame: any, marketingTag: string) {
  return clickLabeledControl(frame, [marketingTag], { exact: false });
}

async function clickActivitySignupFromCard(frame: any, cardIndex: number) {
  const locator = frame.locator('.zs-act-view-v2').nth(cardIndex);
  const directCandidates = [
    locator.getByRole('button', { name: /立即报名|追加报名|继续报名|报名/ }).first(),
    locator.locator('button:has-text("立即报名")').first(),
    locator.locator('button:has-text("追加报名")').first(),
    locator.locator('text=立即报名').first(),
  ];

  for (const candidate of directCandidates) {
    try {
      if ((await candidate.count()) > 0) {
        await candidate.click();
        return true;
      }
    } catch {}
  }

  return frame
    .evaluate((index) => {
      const cards = Array.from(document.querySelectorAll('.zs-act-view-v2'));
      const card = cards[index];
      if (!card) return false;
      const nodes = Array.from(
        card.querySelectorAll('button, a, span, div, [role="button"]'),
      ) as HTMLElement[];
      const target = nodes.find((node) => {
        const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
        return ['立即报名', '追加报名', '继续报名', '报名'].some((label) => text.includes(label));
      });
      if (!target) return false;
      target.click();
      return true;
    }, cardIndex)
    .catch(() => false);
}

function createActivityId(name: string, pageNum: number, index: number) {
  const normalized = name.replace(/\s+/g, '_').slice(0, 40) || 'super_brand_activity';
  return `${normalized}_${pageNum}_${index}`;
}

async function ensureMainAccount(page: any) {
  const pageText = await page.locator('body').innerText().catch(() => '');
  if (/杭州货百盈/.test(pageText)) {
    log('info', '账号门禁通过：当前为"杭州货百盈"总账号');
    return;
  }

  log('info', '当前非"杭州货百盈"总账号，尝试自动切换...');
  await page.click('.account-switch .account-switch-trigger').catch(() => {});
  await page.waitForTimeout(800);
  await page.waitForSelector('.account-switch-dropdown', { timeout: 5000 });

  const items = await page.$$('.cascade-menu-item, .account-switch-dropdown li, [class*="menu-item"]');
  for (const item of items) {
    const text = await item.textContent();
    if (!text?.includes('杭州货百盈')) continue;
    await item.click();
    await page.waitForTimeout(3000);
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
    const newPageText = await page.locator('body').innerText().catch(() => '');
    if (/杭州货百盈/.test(newPageText)) {
      log('info', '账号切换成功：已切换到"杭州货百盈"总账号');
      return;
    }
  }

  throw new Error('账号门禁未通过：未找到可用的"杭州货百盈"总账号');
}

async function restoreFilterView(
  page: any,
  marketingTag: string,
  entryScope: 'brand_activity' | 'unsigned_activity',
) {
  const frame = await getTargetFrame(page);
  const scopeText = entryScope === 'brand_activity' ? '品牌活动' : '未报名活动';
  const scopeResult = await clickLabeledControl(frame, [scopeText], { exact: true });
  if (scopeResult.clicked) {
    await page.waitForTimeout(1500);
  } else {
    log('warn', `未找到"${scopeText}"入口，继续当前视图`, {
      frameSnippet: (await readFrameText(frame)).slice(0, 200),
    });
  }

  const filterResult = await clickMarketingFilter(frame, marketingTag);
  if (filterResult.clicked) {
    await page.waitForTimeout(2000);
    log('info', `已切换到"${scopeText} / ${marketingTag}"视图`);
  } else {
    log('warn', `未找到"${marketingTag}"筛选，继续按卡片文本扫描`, {
      frameSnippet: (await readFrameText(frame)).slice(0, 200),
    });
  }

  return frame;
}

async function captureStoreSelection(frame: any) {
  return frame.evaluate(() => {
    const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();
    const rows = Array.from(document.querySelectorAll('.ant-table-tbody tr'));
    const selectedNames = rows
      .map((row) => normalize((row as HTMLElement).innerText || ''))
      .filter(Boolean)
      .map((text) => text.split(/\s+/)[0])
      .filter(Boolean);
    const selectedIds = rows
      .map((row, index) =>
        (row as HTMLElement).getAttribute('data-row-key') || `store_${index + 1}`,
      )
      .filter(Boolean);
    return {
      storeCount: rows.length,
      storeIds: selectedIds,
      storeNames: selectedNames,
    };
  });
}

async function selectStoresAndSubmit(frame: any, page: any) {
  const selectAll = await clickLabeledControl(frame, ['全选'], { exact: true });
  if (selectAll.clicked) {
    await page.waitForTimeout(1000);
  } else {
    const storeCheckboxes = frame.locator('.ant-checkbox-input, .ant-checkbox');
    const checkboxCount = await storeCheckboxes.count();
    for (let index = 0; index < checkboxCount; index += 1) {
      const checkbox = storeCheckboxes.nth(index);
      const checked = await checkbox.isChecked().catch(() => false);
      if (!checked) {
        await checkbox.click().catch(() => {});
        await page.waitForTimeout(200);
      }
    }
  }

  const storeSnapshot = await captureStoreSelection(frame).catch(() => ({
    storeCount: 0,
    storeIds: [],
    storeNames: [],
  }));

  const submitResult = await clickLabeledControl(frame, ['确认提交', '提交报名', '提交', '确认', '确认报名']);
  if (submitResult.clicked) {
    log('info', `已点击"${submitResult.label || '提交'}"按钮`);
    await page.waitForTimeout(4000);
  } else {
    throw new Error('未找到提交报名按钮');
  }

  const confirmButton = frame.locator('.ant-modal .ant-btn-primary').first();
  if (await confirmButton.count()) {
    await confirmButton.click();
    log('info', '确认弹窗已点击');
    await page.waitForTimeout(2000);
  }

  return storeSnapshot;
}

async function returnToFilteredList(
  page: any,
  pageNum: number,
  marketingTag: string,
  entryScope: 'brand_activity' | 'unsigned_activity',
) {
  let targetFrame = await getTargetFrame(page);
  const breadcrumb = targetFrame.locator('text=平台活动').first();
  if (await breadcrumb.count()) {
    await breadcrumb.click();
    await page.waitForTimeout(3000);
  } else {
    await page.goto(ACTIVITY_URL, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.waitForTimeout(3000);
  }

  targetFrame = await restoreFilterView(page, marketingTag, entryScope);

  if (pageNum > 1) {
    for (let current = 2; current <= pageNum; current += 1) {
      await targetFrame.evaluate((targetPage) => {
        document.querySelectorAll('.ant-pagination li').forEach((node) => {
          if ((node.textContent || '').trim() === String(targetPage)) {
            (node as HTMLElement).click();
          }
        });
      }, current);
      await page.waitForTimeout(2500);
    }
  }

  return targetFrame;
}

async function main(runtimeInput: RuntimeOptions = parseRuntimeOptions()) {
  const previousLogForwarder = runtimeLogForwarder;
  const { requestedEntryScope, runtimeOptions } = resolveRuntimeOptions(runtimeInput);
  setRuntimePaths(runtimeOptions.runtimeBaseDir);
  runtimeLogForwarder = runtimeOptions.onLog;

  if (runtimeOptions.entryScope !== requestedEntryScope) {
    log(
      'warn',
      `[super-brand-guard] entryScope corrected: ${requestedEntryScope} -> ${runtimeOptions.entryScope}`,
    );
  }
  log('info', '=== 超级品牌红包活动自动报名启动 ===', runtimeOptions);

  const userDataDir = getRuntimePaths().userDataDir;
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });

  const page = context.pages()[0] || (await context.newPage());
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const results: SignupResult[] = [];
  const processedCardIds = new Set<string>();
  const processedDetailActivityIds = new Set<string>();

  try {
    log('info', '打开活动页面...');
    await page.goto(ACTIVITY_URL, { waitUntil: 'networkidle', timeout: 60_000 });

    if (page.url().includes('login') || page.url().includes('sso')) {
      log('warn', '需要登录，等待手动登录（最多5分钟）...');
      try {
        execSync('say "请登录饿了么"', { stdio: 'ignore' });
      } catch {}
      await page.waitForFunction(
        () => !window.location.href.includes('login') && !window.location.href.includes('sso'),
        { timeout: 300_000 },
      );
      await page.waitForTimeout(3000);
    }

    await ensureMainAccount(page);
    let targetFrame = await restoreFilterView(
      page,
      runtimeOptions.marketingTag,
      runtimeOptions.entryScope,
    );

    const totalPages = await targetFrame.evaluate(() => {
      const pagination = document.querySelector('.ant-pagination');
      if (!pagination) return 1;
      let max = 1;
      pagination.querySelectorAll('li').forEach((node) => {
        const value = Number.parseInt((node.textContent || '').trim(), 10);
        if (Number.isFinite(value)) {
          max = Math.max(max, value);
        }
      });
      return max;
    });

    log('info', `开始扫描活动，共 ${totalPages} 页`);

    for (let pageNum = 1; pageNum <= totalPages; pageNum += 1) {
      log('info', `--- 第 ${pageNum}/${totalPages} 页 ---`);

      while (true) {
        const cards = await targetFrame.evaluate(() => {
          return Array.from(document.querySelectorAll('.zs-act-view-v2')).map((card, index) => {
            const text = (card.textContent || '').replace(/\s+/g, ' ');
            const name = text
              .replace(/立即报名.*$/u, '')
              .replace(/报名截止.*$/u, '')
              .trim()
              .slice(0, 120);
            const hasSignupBtn = Array.from(card.querySelectorAll('button, a, span')).some(
              (element) =>
                ['立即报名', '追加报名', '继续报名', '报名'].includes(
                  (element.textContent || '').replace(/\s+/g, ' ').trim(),
                ),
            );
            const status = text.includes('已报名')
              ? 'signed_up'
              : text.includes('已结束')
                ? 'expired'
                : text.includes('未开始')
                  ? 'pending'
                  : 'available';
            return {
              activityId: `${name}_${index}`,
              fullText: text.slice(0, 600),
              hasSignupBtn,
              index,
              name,
              status,
            };
          });
        });

        const target = cards.find(
          (card) =>
            card.hasSignupBtn &&
            card.status === 'available' &&
            !isExcludedActivityCandidate(`${card.name} ${card.fullText}`) &&
            !processedCardIds.has(card.activityId),
        );

        if (!target) {
          const availableCount = cards.filter((card) => card.status === 'available').length;
          const signupableCount = cards.filter(
            (card) => card.status === 'available' && card.hasSignupBtn,
          ).length;
          log('info', '本页无更多可报名的超级品牌红包活动', {
            availableCount,
            signupableCount,
            totalCards: cards.length,
          });
          break;
        }

        const activityId = createActivityId(target.name, pageNum, target.index + 1);
        processedCardIds.add(target.activityId);
        let detailActivityId = '';
        try {
          log('info', `进入详情页: ${target.name}`);
          const listClicked = await clickActivitySignupFromCard(targetFrame, target.index);
          if (!listClicked) {
            throw new Error(`列表页未找到报名按钮: ${target.name}`);
          }
          await page.waitForTimeout(5000);

          targetFrame = await getTargetFrame(page);
          const detailText = await targetFrame.evaluate(() => document.body.innerText).catch(() => '');
          const detailRoute = targetFrame.url();
          const combinedDetailText = `${target.name} ${detailText}`.replace(/\s+/g, ' ');
          detailActivityId = extractActivityIdFromRoute(detailRoute);

          if (detailActivityId && processedDetailActivityIds.has(detailActivityId)) {
            log('warn', '当前活动已处理过，跳过重复详情', {
              activityId: detailActivityId,
              activityName: target.name,
            });
            targetFrame = await returnToFilteredList(
              page,
              pageNum,
              runtimeOptions.marketingTag,
              runtimeOptions.entryScope,
            );
            continue;
          }

          if (!isConfirmedSuperBrandActivity(combinedDetailText)) {
            log('warn', '当前活动未命中超级品牌主体，已跳过', {
              activityName: target.name,
              detailSnippet: combinedDetailText.slice(0, 160),
            });
            if (detailActivityId) {
              processedDetailActivityIds.add(detailActivityId);
            }
            targetFrame = await returnToFilteredList(
              page,
              pageNum,
              runtimeOptions.marketingTag,
              runtimeOptions.entryScope,
            );
            continue;
          }

          let merchantRatio = 0;
          const tierMatch = detailText.match(
            /满\s*(\d+)\s*减\s*(\d+(?:\.\d+)?)\s*元.*?(?:淘宝闪购|平台)补(?:贴)?\s*(\d+(?:\.\d+)?)\s*元/u,
          );
          if (tierMatch) {
            const totalDiscount = Number.parseFloat(tierMatch[2] || '0');
            const platformSubsidy = Number.parseFloat(tierMatch[3] || '0');
            const merchantCost = totalDiscount - platformSubsidy;
            merchantRatio = totalDiscount > 0 ? merchantCost / totalDiscount : 0;
            log('info', '优惠信息已识别', {
              merchantRatio: Number((merchantRatio * 100).toFixed(1)),
              platformSubsidy,
              totalDiscount,
            });
          }

          if (merchantRatio >= 0.6) {
            if (detailActivityId) {
              processedDetailActivityIds.add(detailActivityId);
            }
            const result: SignupResult = {
              activityId,
              activityName: target.name,
              detailRoute,
              marketingTag: runtimeOptions.marketingTag,
              merchantRatio,
              message: `商家出资 ${(merchantRatio * 100).toFixed(1)}%（>=60%），按规则跳过报名`,
              sourceTab: '品牌活动',
              status: 'failed',
              success: false,
            };
            results.push(result);
            log('warn', result.message);
          } else {
            const alreadyInWizard = /选择门店|下一步|确认提交|提交报名/.test(detailText);
            if (!alreadyInWizard) {
              const detailSignupResult = await clickLabeledControl(targetFrame, [
                '立即报名',
                '追加报名',
                '继续报名',
                '报名',
              ]);
              if (!detailSignupResult.clicked) {
                throw new Error(`详情页未找到报名按钮: ${detailText.slice(0, 120)}`);
              }
              await page.waitForTimeout(4000);
            }

            const agreeCheckbox = targetFrame.locator('input[type="checkbox"]').first();
            if (await agreeCheckbox.count()) {
              const checked = await agreeCheckbox.isChecked().catch(() => false);
              if (!checked) {
                await agreeCheckbox.click();
                await page.waitForTimeout(600);
              }
            }

            const nextStepResult = await clickLabeledControl(targetFrame, ['下一步', '确认', '继续']);
            if (nextStepResult.clicked) {
              await page.waitForTimeout(4000);
            } else if (!/选择门店|提交报名|确认提交/.test(await readFrameText(targetFrame))) {
              throw new Error('未找到下一步按钮');
            }

            log('info', '向导第2步：选择门店...');
            const storeSelection = await selectStoresAndSubmit(targetFrame, page);
            const screenshotName = `signup_super_brand_${Date.now()}.png`;
            await page
              .screenshot({ path: path.join(getRuntimePaths().logDir, screenshotName), fullPage: false })
              .catch(() => {});

            const resultText = await targetFrame
              .evaluate(() => document.body.innerText.slice(0, 3000))
              .catch(() => '');
            const succeeded =
              resultText.includes('报名成功') ||
              resultText.includes('已报名') ||
              resultText.includes('报名完成');

            const result: SignupResult = {
              activityId,
              activityName: target.name,
              detailRoute,
              marketingTag: runtimeOptions.marketingTag,
              merchantRatio,
              message: succeeded ? '报名成功' : '已操作，待确认',
              screenshot: screenshotName,
              sourceTab: '品牌活动',
              status: succeeded ? 'succeeded' : 'partial_success',
              storeCount: storeSelection.storeCount,
              storeIds: storeSelection.storeIds,
              storeNames: storeSelection.storeNames,
              success: true,
            };
            if (detailActivityId) {
              processedDetailActivityIds.add(detailActivityId);
            }
            results.push(result);
            log('info', `结果: ${result.message}`);
          }
        } catch (error: any) {
          const messageText = `${error?.message || error || '活动处理失败'}`;
          log('warn', '当前活动点击失败或疑似熔断，已跳过', {
            activityName: target.name,
            error: messageText,
          });
          if (detailActivityId) {
            processedDetailActivityIds.add(detailActivityId);
          }
          results.push({
            activityId,
            activityName: target.name,
            marketingTag: runtimeOptions.marketingTag,
            message: `活动熔断或无法点击，已跳过：${messageText}`,
            sourceTab: '品牌活动',
            status: 'failed',
            success: false,
          });
        }

        targetFrame = await returnToFilteredList(
          page,
          pageNum,
          runtimeOptions.marketingTag,
          runtimeOptions.entryScope,
        );
      }

      if (pageNum < totalPages) {
        await targetFrame.evaluate((targetPage) => {
          document.querySelectorAll('.ant-pagination li').forEach((node) => {
            if ((node.textContent || '').trim() === String(targetPage)) {
              (node as HTMLElement).click();
            }
          });
        }, pageNum + 1);
        await page.waitForTimeout(4000);
      }
    }

    const successResults = results.filter((item) => item.status === 'succeeded');
    const partialResults = results.filter((item) => item.status === 'partial_success');
    const failedResults = results.filter((item) => item.status === 'failed');
    const bestStoreSnapshot =
      [...results]
        .sort((left, right) => Number(right.storeCount || 0) - Number(left.storeCount || 0))
        .find((item) => (item.storeCount || 0) > 0) || null;

    const summary = {
      actualStoreCount: Number(bestStoreSnapshot?.storeCount || 0),
      actualStoreIds: bestStoreSnapshot?.storeIds || [],
      actualStoreNames: bestStoreSnapshot?.storeNames || [],
      entryScope: runtimeOptions.entryScope,
      failedCount: failedResults.length,
      foundCount: results.length,
      marketingTag: runtimeOptions.marketingTag,
      results,
      successCount: successResults.length,
      timestamp: new Date().toISOString(),
    };

    const resultFile =
      runtimeOptions.reportPath ||
      path.join(getRuntimePaths().dataDir, `super_brand_signup_${today}_${Date.now()}.json`);
    fs.writeFileSync(resultFile, JSON.stringify(summary, null, 2), 'utf-8');

    log('info', '=== 报名汇总 ===');
    log('info', `营销标签: ${runtimeOptions.marketingTag}`);
    log('info', `命中活动: ${results.length}`);
    log('info', `执行成功: ${successResults.length}`);
    if (partialResults.length > 0) {
      log('info', `部分成功: ${partialResults.length}`);
    }
    log('info', `执行失败: ${failedResults.length}`);
    log('info', `结果已保存: ${resultFile}`);
  } catch (error: any) {
    log('error', '执行失败', { error: error?.message, stack: error?.stack });
    throw error;
  } finally {
    await context.close();
    runtimeLogForwarder = previousLogForwarder;
    log('info', '=== 超级品牌红包活动报名完成 ===');
  }
}

export async function runSuperBrandSignup(runtimeOptions: RuntimeOptions) {
  return main(runtimeOptions);
}

const isDirectRun =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  !!process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (isDirectRun) {
  main().catch((error) => {
    console.error('Fatal:', error);
    process.exit(1);
  });
}
