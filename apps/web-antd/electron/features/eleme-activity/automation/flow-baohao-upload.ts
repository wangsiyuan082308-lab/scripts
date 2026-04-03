import fs from 'node:fs';
import { chromium } from 'playwright';
import * as path from 'path';
import { fileURLToPath } from 'node:url';
import { getTargetFrame, selectStoresAndNext, clickSignupButton } from './shared-utils';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_DIR = path.join(__dirname, '..', 'logs');

function resolveLatestUploadFile() {
  const dataDir = path.join(__dirname, '..', 'data');
  const candidates = fs
    .readdirSync(dataDir)
    .filter((file) => file.endsWith('_报名.xlsx'))
    .sort((left, right) => {
      const leftStat = fs.statSync(path.join(dataDir, left)).mtimeMs;
      const rightStat = fs.statSync(path.join(dataDir, right)).mtimeMs;
      return rightStat - leftStat;
    });

  if (candidates.length === 0) {
    throw new Error('未找到可用的爆好价上传文件');
  }

  return path.join(dataDir, candidates[0]!);
}

async function main() {
  const uploadFile = resolveLatestUploadFile();
  const userDataDir = path.join(__dirname, '..', 'user_data');
  const url = 'https://nr.ele.me/app/eleme-nr-bfe-newretail/common-next#/pc/platformActivitiesPc/';

  const ctx = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });

  const page = ctx.pages()[0] || await ctx.newPage();
  await page.addInitScript(() => {
    (window as any).__name = (target: any) => target;
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  try {
    console.log('【1】打开活动列表...');
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(10000);

    const frame = await getTargetFrame(page);

    // 找爆好价并点击
    const cards = await frame.evaluate(() => {
      return Array.from(document.querySelectorAll('.zs-act-view-v2')).map((c, i) => ({
        index: i, text: (c.textContent || '').replace(/\s+/g, ' ').substring(0, 100),
      }));
    });
    const bao = cards.filter(c => c.text.includes('爆好价'));
    if (bao.length === 0) { console.log('❌ 没有爆好价'); return; }
    await frame.locator('.zs-act-view-v2').nth(bao[0].index).locator('text=立即报名').first().click();
    await page.waitForTimeout(5000);

    // 详情页"立即报名"
    console.log('【2】点击"立即报名"...');
    await clickSignupButton(frame);
    await page.waitForTimeout(5000);

    // 选门店 + 下一步（一行搞定）
    console.log('【3】选择门店...');
    const { storeCount, success, error } = await selectStoresAndNext(frame, page);
    console.log(`  已选门店: ${storeCount}, 成功: ${success}${error ? ', 错误: ' + error : ''}`);
    if (!success) { console.log('❌ 停止'); return; }

    // 上传文件
    console.log('【4】上传文件...');
    const fileInput = frame.locator('input[type="file"]');
    if (await fileInput.count() === 0) { console.log('❌ 未找到file input'); return; }
    await fileInput.first().setInputFiles(uploadFile);
    console.log('✅ 已上传: ' + path.basename(uploadFile));
    await page.waitForTimeout(8000);
    await page.screenshot({ path: path.join(LOG_DIR, 'upload_v3_result.png') });

    // 检查结果
    const result = await frame.evaluate(() => {
      const text = document.body.innerText;
      const err = document.querySelector('.ant-message-error');
      return {
        err: err ? (err.textContent || '').trim() : '',
        text: text.substring(0, 500),
      };
    });
    console.log(result.text.substring(0, 300).replace(/\n/g, ' | '));
    if (result.err) console.log('❌ ' + result.err);

    const btns = await frame.evaluate(() =>
      Array.from(document.querySelectorAll('button'))
        .filter(b => (b as HTMLElement).offsetParent !== null && !b.disabled)
        .map(b => (b.textContent || '').trim())
        .filter(t => t.length > 0 && t.length < 20)
    );
    console.log('可用按钮: ' + btns.join(', '));

    console.log('【5】提交报名...');
    const submitClicked = await frame.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button')).find(
        (item) => (item.textContent || '').trim() === '确认提交' && !item.disabled,
      ) as HTMLButtonElement | undefined;
      if (!btn) return false;
      btn.click();
      return true;
    });

    if (!submitClicked) {
      console.log('❌ 未找到可点击的确认提交按钮');
      return;
    }

    await page.waitForTimeout(3000);

    const modalConfirm = page.locator('.ant-modal .ant-btn-primary');
    if (await modalConfirm.count()) {
      await modalConfirm.first().click();
      console.log('✅ 已确认弹窗');
      await page.waitForTimeout(3000);
    }

    await page.screenshot({ path: path.join(LOG_DIR, 'upload_v3_submitted.png') });

    const submitResult = await frame.evaluate(() => {
      const text = document.body.innerText.replace(/\s+/g, ' ').trim();
      return text.substring(0, 800);
    }).catch(() => '');
    const pageResult = await page.evaluate(() => {
      return document.body.innerText.replace(/\s+/g, ' ').trim().substring(0, 800);
    }).catch(() => '');

    console.log('提交后(frame): ' + submitResult);
    console.log('提交后(page): ' + pageResult);

  } catch (err: any) {
    console.error('错误: ' + err.message);
  } finally {
    await ctx.close();
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
