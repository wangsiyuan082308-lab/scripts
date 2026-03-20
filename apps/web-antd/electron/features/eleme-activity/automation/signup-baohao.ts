/**
 * 爆好价活动自动报名（最终闭环版）
 * 流程：活动列表 → 详情报名 → 选择门店 → 导出商品数据 → 转换Excel → 上传 → 提交
 */
import { chromium, Frame, Page, Download } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import * as ExcelJS from 'exceljs';
import { execSync } from 'node:child_process';
import { getTargetFrame, clickSignupButton, selectStoresAndNext } from './shared-utils';
import { transformBaohaojia } from './transform-baohao';

const LOG_DIR = path.join(__dirname, '..', 'logs');
const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const today = new Date().toISOString().split('T')[0].replace(/-/g, '');
const LOG_FILE = path.join(LOG_DIR, `baohao_${today}.log`);
const ACTIVITY_URL = 'https://nr.ele.me/app/eleme-nr-bfe-newretail/common-next#/pc/platformActivitiesPc/';
const KNOWN_BAOHAO_KEYWORDS = [
  '宁波-热销品-3-6月',
  '宁波-畅销品爆好价-3-6月',
  '宁波-高搜流量品-3-6月',
  '【组包】宁波-高搜流量品-3-6月',
];

function log(level: string, msg: string, data?: any) {
  const ts = new Date().toISOString();
  const text = `[${ts}] [${level.toUpperCase()}] ${msg}${data ? ' ' + JSON.stringify(data) : ''}`;
  console.log(text);
  fs.appendFileSync(LOG_FILE, JSON.stringify({ ts, level, msg, ...(data ? { data } : {}) }) + '\n');
}

function isTarget(name: string, fullText: string): boolean {
  const combined = `${name} ${fullText}`;
  if (!(combined.includes('爆好价') || (combined.includes('商品特价') && combined.includes('宁波')))) {
    if (!KNOWN_BAOHAO_KEYWORDS.some(k => combined.includes(k))) return false;
  }
  // 只处理3月份开始的活动，跳过1-2月
  if (combined.includes('03/01') || combined.includes('3-6月') || combined.includes('3.1-')) return true;
  // 排除已过期的1-2月活动
  if (combined.includes('01/') || combined.includes('02/28') || combined.includes('1.19-') || combined.includes('1.26-')) return false;
  return true;
}

async function saveShot(page: Page, name: string): Promise<string> {
  const file = `${name}_${Date.now()}.png`;
  await page.screenshot({ path: path.join(LOG_DIR, file), fullPage: false }).catch(() => {});
  return file;
}

async function ensureActivityPage(page: Page): Promise<void> {
  await page.goto(ACTIVITY_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(8000);

  if (page.url().includes('login') || page.url().includes('sso')) {
    log('warn', '检测到未登录，等待手动登录');
    try { execSync('say "请登录饿了么"', { stdio: 'ignore' }); } catch {}
    await page.waitForFunction(() => !window.location.href.includes('login') && !window.location.href.includes('sso'), { timeout: 300000 });
    await page.waitForTimeout(3000);
  }

  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(3000);
}

async function scanCards(frame: Frame) {
  return frame.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.zs-act-view-v2, .zs-act-view, [class*="act-view"]'));
    return cards.map((card, i) => {
      const text = (card.textContent || '').replace(/\s+/g, ' ');
      const id = text.substring(0, 120);
      const name = text.substring(0, 120).trim();
      const status = text.includes('已结束') ? 'expired' : text.includes('已报名') ? 'signed_up' : 'available';
      const hasSignupBtn = Array.from(card.querySelectorAll('button, a, span')).some(el => {
        const t = (el.textContent || '').trim();
        return t === '立即报名' || t === '追加报名' || t === '继续报名' || t === '已报名';
      });
      return { index: i, name, fullText: text.substring(0, 800), status, id, hasSignupBtn };
    });
  });
}

async function toPage(frame: Frame, pageNum: number): Promise<void> {
  await frame.evaluate((pn: number) => {
    document.querySelector('.ant-pagination')?.querySelectorAll('li').forEach(li => {
      if (li.textContent?.trim() === String(pn)) (li as HTMLElement).click();
    });
  }, pageNum);
}

async function openDownloadCenter(page: Page, frame: Frame): Promise<void> {
  const clickedInPage = await page.evaluate(() => {
    const findAndClick = () => {
      const els = Array.from(document.querySelectorAll('a, button, span, div'));
      for (const el of els) {
        const text = (el.textContent || '').trim();
        const rect = el.getBoundingClientRect();
        const visible = rect.width > 0 && rect.height > 0;
        if (!visible || !text.includes('下载中心')) continue;

        const clickable =
          (el.closest('button, a, [role="button"], .ant-btn, .ant-dropdown-trigger') as HTMLElement | null) ||
          (el as HTMLElement);
        clickable.click();
        return true;
      }
      return false;
    };
    return findAndClick();
  });

  if (!clickedInPage) {
    const clickedInFrame = await frame.evaluate(() => {
      const findAndClick = () => {
        const els = Array.from(document.querySelectorAll('a, button, span, div'));
        for (const el of els) {
          const text = (el.textContent || '').trim();
          const rect = el.getBoundingClientRect();
          const visible = rect.width > 0 && rect.height > 0;
          if (!visible || !text.includes('下载中心')) continue;

          const clickable =
            (el.closest('button, a, [role="button"], .ant-btn, .ant-dropdown-trigger') as HTMLElement | null) ||
            (el as HTMLElement);
          clickable.click();
          return true;
        }
        return false;
      };
      return findAndClick();
    });

    if (!clickedInFrame) {
      throw new Error('未找到下载中心入口');
    }
  }

  await page.waitForTimeout(1200);
}

async function clickDownloadInCenter(page: Page, frame: Frame): Promise<Download> {
  const waitDownloadAfterAction = async (waitMs: number): Promise<Download | null> => {
    const dl = await Promise.race([
      page.waitForEvent('download', { timeout: waitMs }).catch(() => null),
      page.waitForTimeout(waitMs + 200).then(() => null),
    ]);
    return dl;
  };

  const clickFromPage = async () => {
    return page.evaluate(() => {
      const isVisible = (el: Element) => {
        const rect = (el as HTMLElement).getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const normalize = (t: string) => t.replace(/\s+/g, ' ').trim();
      const actionText = /^(立即下载|重新下载|下载文件|下载)$/;
      const weakActionText = /(下载|重下|重新)/;
      const nonActionText = /(下载中心|下载已完成|已下载|下载完成|导出邀约商品数据|任务详情|记录|时间|状态|文件名)/;

      const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], .ant-btn, .ant-btn-link'));

      const exactTarget = candidates.find(el => {
        const text = normalize(el.textContent || '');
        if (!isVisible(el) || !text || nonActionText.test(text)) return false;
        return actionText.test(text);
      });

      if (exactTarget) {
        (exactTarget as HTMLElement).click();
        return `clicked:${normalize(exactTarget.textContent || '')}`;
      }

      const fallbackTarget = candidates.find(el => {
        const text = normalize(el.textContent || '');
        if (!isVisible(el) || !text || nonActionText.test(text)) return false;
        return weakActionText.test(text);
      });

      if (fallbackTarget) {
        (fallbackTarget as HTMLElement).click();
        return `clicked:${normalize(fallbackTarget.textContent || '')}`;
      }

      const iconTarget = Array.from(document.querySelectorAll('button[class*="download"], a[class*="download"], [role="button"][class*="download"], [aria-label*="下载"]')).find(isVisible);
      if (iconTarget) {
        (iconTarget as HTMLElement).click();
        return 'clicked:icon-download';
      }

      const visibleTexts = candidates
        .map(el => normalize(el.textContent || ''))
        .filter(t => t && t.length <= 30)
        .slice(0, 30);
      return `none:${visibleTexts.join('|')}`;
    });
  };

  const clickFromFrame = async () => {
    return frame.evaluate(() => {
      const isVisible = (el: Element) => {
        const rect = (el as HTMLElement).getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const normalize = (t: string) => t.replace(/\s+/g, ' ').trim();
      const actionText = /^(立即下载|重新下载|下载文件|下载)$/;
      const weakActionText = /(下载|重下|重新)/;
      const nonActionText = /(下载中心|下载已完成|已下载|下载完成|导出邀约商品数据|任务详情|记录|时间|状态|文件名)/;

      const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], .ant-btn, .ant-btn-link'));

      const exactTarget = candidates.find(el => {
        const text = normalize(el.textContent || '');
        if (!isVisible(el) || !text || nonActionText.test(text)) return false;
        return actionText.test(text);
      });

      if (exactTarget) {
        (exactTarget as HTMLElement).click();
        return `clicked:${normalize(exactTarget.textContent || '')}`;
      }

      const fallbackTarget = candidates.find(el => {
        const text = normalize(el.textContent || '');
        if (!isVisible(el) || !text || nonActionText.test(text)) return false;
        return weakActionText.test(text);
      });

      if (fallbackTarget) {
        (fallbackTarget as HTMLElement).click();
        return `clicked:${normalize(fallbackTarget.textContent || '')}`;
      }

      const iconTarget = Array.from(document.querySelectorAll('button[class*="download"], a[class*="download"], [role="button"][class*="download"], [aria-label*="下载"]')).find(isVisible);
      if (iconTarget) {
        (iconTarget as HTMLElement).click();
        return 'clicked:icon-download';
      }

      const visibleTexts = candidates
        .map(el => normalize(el.textContent || ''))
        .filter(t => t && t.length <= 30)
        .slice(0, 30);
      return `none:${visibleTexts.join('|')}`;
    });
  };

  for (let i = 1; i <= 25; i++) {
    const pageResult = await clickFromPage();
    const frameResult = pageResult.startsWith('clicked:') ? 'skip' : await clickFromFrame();

    if (pageResult.startsWith('clicked:') || frameResult.startsWith('clicked:')) {
      log('info', `  → 下载中心点击下载尝试#${i}`, { pageResult, frameResult });
      const maybeDownload = await waitDownloadAfterAction(4500);
      if (maybeDownload) return maybeDownload;
    } else if (i === 1 || i % 5 === 0) {
      log('info', `  → 下载中心尚未出现下载动作#${i}`, { pageResult, frameResult });
    }

    await page.waitForTimeout(1200);
  }

  throw new Error('下载中心中未找到可点击的下载按钮（已轮询等待）');
}

async function exportTemplate(page: Page, frame: Frame): Promise<string> {
  log('info', '  → 导出商品数据模板（导出后进入下载中心下载）');

  const candidateButtons = [
    'button:has-text("导出商品数据")',
    'button:has-text("导出招商商品数据")',
    'button:has-text("导出招商文件")',
    'button:has-text("导出")',
  ];

  let clicked = false;

  for (const sel of candidateButtons) {
    const btn = frame.locator(sel);
    if (await btn.count() > 0) {
      await btn.first().click();
      clicked = true;
      log('info', `  → 已点击导出按钮: ${sel}`);
      break;
    }
  }

  if (!clicked) {
    throw new Error('未找到导出按钮（导出商品数据/导出招商文件）');
  }

  await page.waitForTimeout(2000);

  let download: Download | null = null;
  const directDownload = await page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
  if (directDownload) {
    log('info', '  → 导出后直接触发下载（兜底路径）');
    download = directDownload;
  } else {
    await openDownloadCenter(page, frame);
    await page.waitForTimeout(1500);
    download = await clickDownloadInCenter(page, frame);
    log('info', '  → 已在下载中心点击下载');
  }

  const suggested = download.suggestedFilename() || `baohao_export_${Date.now()}.xlsx`;
  const savePath = path.join(DATA_DIR, `${Date.now()}_${suggested}`);
  await download.saveAs(savePath);
  log('info', '  → 导出文件已保存', { file: savePath });
  return savePath;
}

async function countExcelDataRows(filePath: string): Promise<number> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);
  const ws = wb.worksheets[0];
  if (!ws) return 0;

  let count = 0;
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const values = [1, 2, 3, 4, 5].map(c => String(row.getCell(c).value || '').trim());
    const hasAny = values.some(v => v.length > 0);
    if (hasAny) count++;
  });

  return count;
}

async function uploadProcessedExcel(page: Page, frame: Frame, filePath: string): Promise<void> {
  log('info', '  → 上传处理后的Excel');
  const fileInput = frame.locator('input[type="file"]');
  if (await fileInput.count() === 0) {
    throw new Error('未找到上传文件输入框 input[type="file"]');
  }
  await fileInput.first().setInputFiles(filePath);
  await page.waitForTimeout(6000);
}

async function submitAndVerify(page: Page, frame: Frame): Promise<{ success: boolean; message: string }> {
  log('info', '  → 提交报名');

  const clickSubmitInFrame = async (): Promise<boolean> => {
    return frame.evaluate(() => {
      const isVisible = (el: Element) => {
        const rect = (el as HTMLElement).getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const normalize = (t: string) => t.replace(/\s+/g, ' ').trim();
      const submitTexts = ['提交报名', '确认报名', '提交', '确认'];
      const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], .ant-btn'));

      const target = candidates.find(el => {
        const text = normalize(el.textContent || '');
        if (!isVisible(el) || !text) return false;
        if ((el as HTMLButtonElement).disabled) return false;
        return submitTexts.some(t => text === t || text.includes(t));
      });

      if (target) {
        (target as HTMLElement).click();
        return true;
      }
      return false;
    });
  };

  const clickSubmitInPage = async (): Promise<boolean> => {
    return page.evaluate(() => {
      const isVisible = (el: Element) => {
        const rect = (el as HTMLElement).getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const normalize = (t: string) => t.replace(/\s+/g, ' ').trim();
      const submitTexts = ['提交报名', '确认报名', '提交', '确认'];
      const candidates = Array.from(document.querySelectorAll('button, a, [role="button"], .ant-btn'));

      const target = candidates.find(el => {
        const text = normalize(el.textContent || '');
        if (!isVisible(el) || !text) return false;
        if ((el as HTMLButtonElement).disabled) return false;
        return submitTexts.some(t => text === t || text.includes(t));
      });

      if (target) {
        (target as HTMLElement).click();
        return true;
      }
      return false;
    });
  };

  let clicked = await clickSubmitInFrame();
  if (!clicked) clicked = await clickSubmitInPage();

  if (!clicked) {
    const pageBtnTexts = await page.evaluate(() =>
      Array.from(document.querySelectorAll('button, a, [role="button"], .ant-btn'))
        .map(el => (el.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(t => t && t.length <= 20)
        .slice(0, 25)
    ).catch(() => [] as string[]);

    const frameBtnTexts = await frame.evaluate(() =>
      Array.from(document.querySelectorAll('button, a, [role="button"], .ant-btn'))
        .map(el => (el.textContent || '').replace(/\s+/g, ' ').trim())
        .filter(t => t && t.length <= 20)
        .slice(0, 25)
    ).catch(() => [] as string[]);

    log('warn', '  → 未找到提交按钮', { pageBtnTexts, frameBtnTexts });
    return { success: false, message: '未找到提交按钮（可能需要人工确认页面状态）' };
  }

  await page.waitForTimeout(2500);

  const frameConfirmBtn = frame.locator('.ant-modal .ant-btn-primary');
  if (await frameConfirmBtn.count() > 0) {
    await frameConfirmBtn.first().click();
    await page.waitForTimeout(2000);
    log('info', '  → 已确认弹窗(frame)');
  }

  const pageConfirmBtn = page.locator('.ant-modal .ant-btn-primary');
  if (await pageConfirmBtn.count() > 0) {
    await pageConfirmBtn.first().click();
    await page.waitForTimeout(2000);
    log('info', '  → 已确认弹窗(page)');
  }

  const frameText = await frame.evaluate(() => document.body.innerText.substring(0, 6000)).catch(() => '');
  const pageText = await page.evaluate(() => document.body.innerText.substring(0, 6000)).catch(() => '');
  const resultText = `${frameText}\n${pageText}`;

  if (resultText.includes('报名成功') || resultText.includes('已报名') || resultText.includes('报名完成')) {
    return { success: true, message: '报名成功' };
  }
  if (resultText.includes('报名失败')) {
    return { success: false, message: '报名失败' };
  }
  if (resultText.includes('商品为空') || resultText.includes('未选择商品') || resultText.includes('请先添加商品')) {
    return { success: false, message: '提交失败：商品为空或未正确导入' };
  }
  if (resultText.includes('添加商品') || resultText.includes('选择商品') || resultText.includes('UPC')) {
    return { success: false, message: '仍停留在商品步骤，可能存在校验未通过' };
  }

  return { success: false, message: '已点击提交，但结果未明确（需人工复核）' };
}

async function searchKeyword(page: Page, frame: Frame, keyword: string): Promise<void> {
  // 优先在 frame 中操作搜索
  const filled = await frame.evaluate((kw) => {
    const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
    for (const input of inputs) {
      const p = (input.placeholder || '').trim();
      if (p.includes('搜索') || p.includes('活动') || p.includes('名称') || input.type === 'text') {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
        if (nativeInputValueSetter) nativeInputValueSetter.call(input, kw);
        else input.value = kw;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        return `filled:${p}`;
      }
    }
    return 'no-input';
  }, keyword).catch(() => 'error');

  log('info', `搜索关键词: ${keyword}`, { filled });

  // 也尝试点击搜索按钮
  await frame.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, .ant-btn, [role="button"]'));
    const searchBtn = btns.find(el => {
      const text = (el.textContent || '').trim();
      return text === '搜索' || text === '查询';
    }) as HTMLElement | undefined;
    if (searchBtn) searchBtn.click();
  }).catch(() => {});

  await page.waitForTimeout(2000);
}

async function clickFilterTag(page: Page, frame: Frame, tagText: string): Promise<boolean> {
  const clicked = await frame.evaluate((tag) => {
    const isVisible = (el: Element) => {
      const rect = (el as HTMLElement).getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const candidates = Array.from(document.querySelectorAll('span, a, div, label, button, [class*="tag"], [class*="filter"], [class*="label"]'));
    const target = candidates.find(el => {
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      return isVisible(el) && (text === tag || text.startsWith(tag));
    }) as HTMLElement | undefined;

    if (target) {
      const clickable = (target.closest('a, button, [role="button"], label, [class*="tag"], [class*="filter"]') as HTMLElement | null) || target;
      clickable.click();
      return true;
    }
    return false;
  }, tagText).catch(() => false);

  if (clicked) {
    log('info', `已点击筛选标签: ${tagText}`);
    await page.waitForTimeout(3000);
  }
  return clicked;
}

async function switchToAllActivities(page: Page, frame: Frame): Promise<void> {
  const clickInPage = await page.evaluate(() => {
    const isVisible = (el: Element) => {
      const rect = (el as HTMLElement).getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const nodes = Array.from(document.querySelectorAll('.ant-tabs-tab, button, a, span, div'));
    const tab = nodes.find(el => {
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      return isVisible(el) && (text === '全部活动' || text.includes('全部活动'));
    }) as HTMLElement | undefined;

    if (!tab) return false;
    const clickable = (tab.closest('[role="tab"], .ant-tabs-tab, button, a') as HTMLElement | null) || tab;
    clickable.click();
    return true;
  });

  if (!clickInPage) {
    await frame.evaluate(() => {
      const isVisible = (el: Element) => {
        const rect = (el as HTMLElement).getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const nodes = Array.from(document.querySelectorAll('.ant-tabs-tab, button, a, span, div'));
      const tab = nodes.find(el => {
        const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
        return isVisible(el) && (text === '全部活动' || text.includes('全部活动'));
      }) as HTMLElement | undefined;

      if (!tab) return;
      const clickable = (tab.closest('[role="tab"], .ant-tabs-tab, button, a') as HTMLElement | null) || tab;
      clickable.click();
    }).catch(() => {});
  }

  await page.waitForTimeout(2000);
}

async function backToList(page: Page, frame: Frame): Promise<Frame> {
  const bc = frame.locator('text=平台活动').first();
  if (await bc.count() > 0) {
    await bc.click();
    await page.waitForTimeout(3000);
  } else {
    await ensureActivityPage(page);
  }
  return await getTargetFrame(page);
}

async function runOneActivity(page: Page, frame: Frame, target: any, idx: number) {
  const shots: string[] = [];

  const card = frame.locator('.zs-act-view-v2, .zs-act-view, [class*="act-view"]').nth(target.index);
  const cardSignupBtn = card.locator('text=/立即报名|追加报名|继续报名/');
  if (await cardSignupBtn.count() > 0) {
    await cardSignupBtn.first().click();
  } else {
    const opened = await card.evaluate((el) => {
      const candidates = Array.from(el.querySelectorAll('button, a, span, div'));
      const targetEl = candidates.find(node => {
        const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
        return text.includes('已报名') || text.includes('追加报名') || text.includes('继续报名');
      }) as HTMLElement | undefined;
      if (targetEl) {
        const clickable = (targetEl.closest('button, a, [role="button"], .ant-btn') as HTMLElement | null) || targetEl;
        clickable.click();
        return true;
      }
      return false;
    });

    if (!opened) {
      await card.click().catch(() => {});
    }
  }

  await page.waitForTimeout(5000);
  shots.push(await saveShot(page, `baohao_detail_${idx}`));

  let detailFrame = await getTargetFrame(page);

  // 诊断：详情页按钮快照
  const detailBtns = await detailFrame.evaluate(() => {
    return Array.from(document.querySelectorAll('button, a, [role="button"], .ant-btn'))
      .map(el => {
        const rect = (el as HTMLElement).getBoundingClientRect();
        return {
          text: (el.textContent || '').replace(/\s+/g, ' ').trim().substring(0, 40),
          tag: el.tagName,
          visible: rect.width > 0 && rect.height > 0,
          disabled: (el as HTMLButtonElement).disabled || false,
        };
      })
      .filter(b => b.text.length > 0 && b.text.length <= 30);
  }).catch(() => []);
  log('info', `  → 详情页按钮列表`, { buttons: detailBtns.slice(0, 20) });

  // 优先检查"操作进度"按钮（已报名活动）
  let clickedDetail = false;
  const hasProgressBtn = detailBtns.some(b => b.text === '操作进度' && b.visible);
  
  if (hasProgressBtn) {
    // 已报名活动：点击"操作进度"进入追加商品流程
    const clickedProgress = await detailFrame.evaluate(() => {
      const labels = ['操作进度', '追加商品', '添加商品'];
      for (const btn of Array.from(document.querySelectorAll('button, a, [role="button"], .ant-btn'))) {
        const text = (btn.textContent || '').replace(/\s+/g, ' ').trim();
        if (labels.some(label => text === label)) {
          const r = (btn as HTMLElement).getBoundingClientRect();
          if (r.width > 0 && r.height > 0) { (btn as HTMLElement).click(); return text; }
        }
      }
      return '';
    }).catch(() => '');

    if (!clickedProgress) {
      const clickedProgressPage = await page.evaluate(() => {
        const labels = ['操作进度', '追加商品', '添加商品'];
        for (const btn of Array.from(document.querySelectorAll('button, a, [role="button"], .ant-btn'))) {
          const text = (btn.textContent || '').replace(/\s+/g, ' ').trim();
          if (labels.some(label => text === label)) {
            const r = (btn as HTMLElement).getBoundingClientRect();
            if (r.width > 0 && r.height > 0) { (btn as HTMLElement).click(); return text; }
          }
        }
        return '';
      }).catch(() => '');

      if (clickedProgressPage) {
        log('info', `  → 已点击: ${clickedProgressPage}（page层）`);
        clickedDetail = true;
      }
    } else {
      log('info', `  → 已点击: ${clickedProgress}（frame层）`);
      clickedDetail = true;
    }

    if (clickedDetail) {
      await page.waitForTimeout(5000);
      shots.push(await saveShot(page, `baohao_progress_${idx}`));

      // 进入操作进度后，诊断当前页面按钮
      const progressFrame = await getTargetFrame(page);
      const progressBtns = await progressFrame.evaluate(() => {
        return Array.from(document.querySelectorAll('button, a, [role="button"], .ant-btn'))
          .map(el => {
            const rect = (el as HTMLElement).getBoundingClientRect();
            return {
              text: (el.textContent || '').replace(/\s+/g, ' ').trim().substring(0, 40),
              visible: rect.width > 0 && rect.height > 0,
            };
          })
          .filter(b => b.visible && b.text.length > 0 && b.text.length <= 30);
      }).catch(() => []);
      log('info', '  → 操作进度页按钮', { buttons: progressBtns });

      // 尝试点击"追加报名"或"追加商品"
      const clickedAppend = await progressFrame.evaluate(() => {
        const labels = ['追加报名', '追加商品', '添加商品', '继续报名', '立即报名'];
        for (const btn of Array.from(document.querySelectorAll('button, a, [role="button"], .ant-btn'))) {
          const text = (btn.textContent || '').replace(/\s+/g, ' ').trim();
          if (labels.some(label => text === label || text.includes(label))) {
            const r = (btn as HTMLElement).getBoundingClientRect();
            if (r.width > 0 && r.height > 0) { (btn as HTMLElement).click(); return text; }
          }
        }
        return '';
      }).catch(() => '');

      if (clickedAppend) {
        log('info', `  → 已点击追加入口: ${clickedAppend}`);
        await page.waitForTimeout(5000);
        // 重新获取frame，因为点击后页面可能变化
        detailFrame = await getTargetFrame(page);
      } else {
        return { success: false, message: '进入操作进度后未找到追加报名/追加商品入口', screenshots: shots };
      }
    }
  } else {
    // 新活动：点击"立即报名"
    log('info', '  → 新活动，尝试点击"立即报名"');
    
    clickedDetail = await clickSignupButton(detailFrame);
    
    if (!clickedDetail) {
      clickedDetail = await page.evaluate(() => {
        const labels = ['立即报名', '追加报名', '继续报名', '报名'];
        for (const btn of Array.from(document.querySelectorAll('button, a, [role="button"], .ant-btn'))) {
          const text = (btn.textContent || '').replace(/\s+/g, ' ').trim();
          if (labels.some(label => text === label)) {
            const r = (btn as HTMLElement).getBoundingClientRect();
            if (r.width > 0 && r.height > 0) { (btn as HTMLElement).click(); return true; }
          }
        }
        return false;
      }).catch(() => false);
    }
    
    if (clickedDetail) {
      log('info', '  → 已点击"立即报名"');
    }
  }

  if (!clickedDetail) {
    return { success: false, message: `详情页未找到可点击报名按钮`, screenshots: shots };
  }

  await page.waitForTimeout(5000);

  const storeResult = await selectStoresAndNext(detailFrame, page);
  if (!storeResult.success) {
    return {
      success: false,
      message: `门店/向导步骤失败: ${storeResult.error || '未知错误'}`,
      screenshots: shots,
    };
  }

  shots.push(await saveShot(page, `baohao_step2_${idx}`));

  const exported = await exportTemplate(page, detailFrame);
  shots.push(await saveShot(page, `baohao_exported_${idx}`));

  const exportedRowCount = await countExcelDataRows(exported);
  log('info', '  → 导出文件数据行统计', { file: exported, rows: exportedRowCount });

  if (exportedRowCount === 0) {
    return {
      success: false,
      message: '导出商品数据为空，已跳过上传和提交（无需执行下一步）',
      screenshots: shots,
      exported,
      processed: null,
      storeCount: storeResult.storeCount,
      exportedRowCount,
      processedRowCount: 0,
    };
  }

  const processed = await transformBaohaojia(exported, 9999);
  const processedRowCount = await countExcelDataRows(processed);
  log('info', '  → 转换完成', { input: exported, output: processed, rows: processedRowCount });

  if (processedRowCount === 0) {
    return {
      success: false,
      message: '转换后Excel为空，已跳过上传和提交（需人工核查转换规则）',
      screenshots: shots,
      exported,
      processed,
      storeCount: storeResult.storeCount,
      exportedRowCount,
      processedRowCount,
    };
  }

  await uploadProcessedExcel(page, detailFrame, processed);
  shots.push(await saveShot(page, `baohao_uploaded_${idx}`));

  const submitResult = await submitAndVerify(page, detailFrame);
  shots.push(await saveShot(page, `baohao_submitted_${idx}`));

  return {
    success: submitResult.success,
    message: submitResult.message,
    screenshots: shots,
    exported,
    processed,
    storeCount: storeResult.storeCount,
  };
}

async function main() {
  log('info', '=== 爆好价活动最终闭环报名启动 ===');

  const userDataDir = path.join(__dirname, '..', 'user_data');
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
    acceptDownloads: true,
  });

  const page = context.pages()[0] || await context.newPage();
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  const results: any[] = [];
  const processedIds = new Set<string>();
  let found = 0;

  try {
    await ensureActivityPage(page);
    let frame = await getTargetFrame(page);
    await switchToAllActivities(page, frame);
    frame = await getTargetFrame(page);
    // 不再搜索特定关键词，直接扫描未报名活动
    // await searchKeyword(page, frame, '宁波');
    await page.waitForTimeout(3000);
    frame = await getTargetFrame(page);

    // 如果搜索没生效，尝试点击"商品特价"筛选标签
    const cardsAfterSearch = await scanCards(frame);
    const hasTarget = cardsAfterSearch.some(c => isTarget(c.name, c.fullText));
    if (!hasTarget) {
      log('info', '搜索后未找到目标，尝试点击"商品特价"筛选标签');
      await clickFilterTag(page, frame, '商品特价');
      frame = await getTargetFrame(page);
    }

    // 诊断：搜索后页面内容快照
    const diagCards = await frame.evaluate(() => {
      const selectors = ['.zs-act-view-v2', '.zs-act-view', '[class*="act-view"]', '[class*="activity"]', '[class*="card"]'];
      const result: Record<string, number> = {};
      for (const sel of selectors) {
        result[sel] = document.querySelectorAll(sel).length;
      }
      return result;
    }).catch(() => ({}));

    const diagPageCards = await page.evaluate(() => {
      const selectors = ['.zs-act-view-v2', '.zs-act-view', '[class*="act-view"]', '[class*="activity"]', '[class*="card"]'];
      const result: Record<string, number> = {};
      for (const sel of selectors) {
        result[sel] = document.querySelectorAll(sel).length;
      }
      return result;
    }).catch(() => ({}));

    const diagBodyText = await frame.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim().substring(0, 1500)).catch(() => '');
    const diagPageText = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim().substring(0, 1500)).catch(() => '');

    log('info', '诊断-frame选择器命中', diagCards);
    log('info', '诊断-page选择器命中', diagPageCards);
    log('info', '诊断-frame文本快照', { text: diagBodyText.substring(0, 800) });
    log('info', '诊断-page文本快照', { text: diagPageText.substring(0, 800) });

    await saveShot(page, 'diag_after_search');


    try {
      await frame.waitForSelector('.zs-act-view-v2', { timeout: 30000 });
    } catch {
      await page.waitForTimeout(5000);
    }

    const totalPages = await frame.evaluate(() => {
      const pag = document.querySelector('.ant-pagination');
      if (!pag) return 1;
      let max = 1;
      pag.querySelectorAll('li').forEach(li => {
        const n = parseInt(li.textContent?.trim() || '');
        if (!isNaN(n)) max = Math.max(max, n);
      });
      return max;
    });

    log('info', `共 ${totalPages} 页，开始扫描爆好价活动`);

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      log('info', `--- 第 ${pageNum}/${totalPages} 页 ---`);

      while (true) {
        const cards = await scanCards(frame);
        if (cards.length === 0) {
          const bodySample = await frame.evaluate(() => document.body.innerText.replace(/\s+/g, ' ').trim().substring(0, 500)).catch(() => '');
          log('warn', '当前页未扫描到活动卡片', { pageNum, bodySample });
        }

        for (const c of cards) {
          if (isTarget(c.name, c.fullText) && !processedIds.has(c.id)) {
            log('info', `  发现: [${c.status}] ${c.name.substring(0, 60)} ${c.hasSignupBtn ? '(可报名)' : ''}`);
          }
        }

        const target = cards.find((c: any) =>
          isTarget(c.name, c.fullText) && c.status !== 'expired' && !processedIds.has(c.id)
        );

        if (!target) {
          log('info', '本页无更多未处理爆好价活动');
          break;
        }

        processedIds.add(target.id);
        found++;
        log('info', `[爆好价] #${found} ${target.name}`);

        try {
          const result = await runOneActivity(page, frame, target, found);
          results.push({ name: target.name, ...result });
          log('info', `  → 活动处理完成: ${result.message}`);
        } catch (err: any) {
          const errShot = await saveShot(page, `baohao_error_${found}`);
          results.push({ name: target.name, success: false, message: `流程异常: ${err?.message || '未知错误'}`, screenshots: [errShot] });
          log('error', '  → 活动处理异常', { error: err?.message || String(err) });
        }

        frame = await backToList(page, frame);
        await page.waitForTimeout(2000);

        if (pageNum > 1) {
          await toPage(frame, pageNum);
          await page.waitForTimeout(3000);
        }
      }

      if (pageNum < totalPages) {
        await toPage(frame, pageNum + 1);
        await page.waitForTimeout(5000);
      }
    }

    log('info', '=== 爆好价报名汇总 ===');
    log('info', `找到: ${found} 个`);
    log('info', `成功: ${results.filter(r => r.success).length}`);
    log('info', `失败/需人工: ${results.filter(r => !r.success).length}`);

    console.log('\n══════════════════════════════════════════');
    console.log(`  爆好价活动报名结果 | ${new Date().toISOString().split('T')[0]}`);
    console.log('══════════════════════════════════════════');
    for (const r of results) {
      console.log(`  ${r.success ? '✅' : '❌'} ${r.name.substring(0, 60)}`);
      console.log(`     ${r.message}`);
    }
    console.log('══════════════════════════════════════════\n');

    fs.writeFileSync(
      path.join(DATA_DIR, `baohao_signup_${today}.json`),
      JSON.stringify({ timestamp: new Date().toISOString(), found, results }, null, 2)
    );
  } catch (err: any) {
    log('error', '执行失败', { error: err?.message || String(err) });
    await saveShot(page, 'baohao_fatal');
    throw err;
  } finally {
    await context.close();
    log('info', '=== 爆好价活动最终闭环报名完成 ===');
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
