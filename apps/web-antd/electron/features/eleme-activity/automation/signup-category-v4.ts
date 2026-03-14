import { chromium, Frame, Page, BrowserContext } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';

const DATA_DIR = path.join(__dirname, '..', 'data');
const LOG_DIR = path.join(__dirname, '..', 'logs');
const today = new Date().toISOString().split('T')[0];
const LOG_FILE = path.join(LOG_DIR, `category_v4_${today}.log`);
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(LOG_DIR, { recursive: true });

function log(level: string, msg: string) {
  const ts = new Date().toISOString();
  fs.appendFileSync(LOG_FILE, JSON.stringify({ ts, level, msg }) + '\n');
  console.log(`[${ts}] [${level.toUpperCase()}] ${msg}`);
}

function generateExcel(upcs: string[], outputPath: string): boolean {
  const templatePath = path.join(DATA_DIR, 'template_商品品类券商家提报模板.xlsx');
  const pyFile = path.join(DATA_DIR, '_gen_excel.py');
  const pyScript = `import openpyxl, sys, json
upcs = json.loads(sys.argv[1])
wb = openpyxl.load_workbook(sys.argv[2])
ws = wb['跨店搭售']
for i, upc in enumerate(upcs):
    ws.cell(row=3+i, column=1, value=str(upc))
wb.save(sys.argv[3])
print('OK:' + str(len(upcs)))
`;
  try {
    fs.writeFileSync(pyFile, pyScript);
    const r = execSync(
      `python3 "${pyFile}" '${JSON.stringify(upcs)}' "${templatePath}" "${outputPath}"`,
      { encoding: 'utf-8', timeout: 15000 }
    );
    log('info', `  → Excel生成: ${r.trim()}`);
    return r.includes('OK:');
  } catch (e: any) {
    log('error', `Excel生成失败: ${e.message?.substring(0, 100)}`);
    return false;
  }
}

async function getTargetFrame(page: Page): Promise<Frame> {
  let frame = page.mainFrame();
  for (const f of page.frames()) {
    try {
      const url = f.url();
      if (url.includes('ms.ele.me') || url.includes('ebai-zs-webapp')) { frame = f; break; }
    } catch {}
  }
  return frame;
}

async function navigateToList(page: Page, activityUrl: string, pageNum: number, tab: string = '追加报名'): Promise<Frame> {
  await page.goto(activityUrl, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(5000);
  const frame = await getTargetFrame(page);

  // 点击指定tab（默认"追加报名"）
  await frame.evaluate((tabName: string) => {
    const tabs = document.querySelectorAll('.zs-homepage-v2-tab-item');
    for (const t of Array.from(tabs)) {
      if (t.textContent?.trim() === tabName) {
        (t as HTMLElement).click();
        break;
      }
    }
  }, tab);
  await page.waitForTimeout(5000);

  await frame.waitForSelector('.zs-act-view-v2', { timeout: 30000 }).catch(() => {});
  if (pageNum > 1) {
    await frame.evaluate((pn: number) => {
      document.querySelector('.ant-pagination')?.querySelectorAll('li').forEach(li => {
        if (li.textContent?.trim() === String(pn)) (li as HTMLElement).click();
      });
    }, pageNum);
    await page.waitForTimeout(5000);
  }
  return frame;
}

interface Result { name: string; success: boolean; message: string; }

async function processOneActivity(
  context: BrowserContext, page: Page, frame: Frame,
  cardIndex: number, activityName: string, excelTemplatePath: string
): Promise<Result> {
  // Step 1: 设置API拦截获取完整UPC列表
  let apiUpcs: string[] = [];
  const apiHandler = (response: any) => {
    const url = response.url();
    if (url.includes('getactivity') && !url.includes('getactivityinfo')) {
      response.json().then((json: any) => {
        try {
          const upcCode = json?.data?.data?.auditRuleInfoDTO?.upcCode || '';
          if (upcCode) {
            apiUpcs = upcCode.split(';').filter((s: string) => /^\d{13}$/.test(s));
          }
        } catch {}
      }).catch(() => {});
    }
  };
  page.on('response', apiHandler);

  // Step 2: 点击卡片进入详情页
  log('info', `  → 点击卡片...`);
  await frame.evaluate((idx: number) => {
    const card = document.querySelectorAll('.zs-act-view-v2')[idx];
    if (card) {
      (card as HTMLElement).scrollIntoView({ block: 'center' });
      const btn = Array.from(card.querySelectorAll('span, button')).find(
        (el: Element) => {
          const t = el.textContent?.trim();
          return t === '立即报名' || t === '追加报名';
        }
      );
      if (btn) (btn as HTMLElement).click();
    }
  }, cardIndex);
  await page.waitForTimeout(5000);

  // Step 3: 获取UPC条形码（优先用API拦截的完整列表）
  log('info', `  → 获取UPC...`);
  // 等待API响应
  await page.waitForTimeout(2000);
  let upcs = apiUpcs;
  if (upcs.length === 0) {
    // fallback: 从页面文本提取
    upcs = await frame.evaluate(() => {
      const text = document.body.innerText;
      const match = text.match(/条形码[：:]\s*([\d;]+)/);
      if (match) return match[1].split(';').filter((s: string) => s.length > 5);
      const all = text.match(/\b\d{13}\b/g);
      return all ? Array.from(new Set(all)) : [];
    });
  }
  page.removeListener('response', apiHandler);
  log('info', `  → UPC: ${upcs.length}个${apiUpcs.length > 0 ? '(API)' : '(页面)'}`);

  if (upcs.length === 0) {
    log('warn', `  → 未找到UPC`);
    return { name: activityName, success: false, message: '未找到UPC' };
  }

  // Step 4: 生成Excel
  const excelPath = path.join(DATA_DIR, `upload_${Date.now()}.xlsx`);
  if (!generateExcel(upcs, excelPath)) {
    return { name: activityName, success: false, message: 'Excel生成失败' };
  }
  log('info', `  → Excel已生成`);

  // Step 5: 点击详情页"追加报名"或"立即报名"进入向导
  log('info', `  → 进入向导...`);
  try {
    // 优先找 div.zs-append-button（追加报名的实际按钮）
    let clicked = false;
    const appendBtn = frame.locator('div.zs-append-button.zs-large');
    if (await appendBtn.count() > 0) {
      await appendBtn.first().click({ timeout: 10000 });
      clicked = true;
    }
    if (!clicked) {
      // 再找普通的"立即报名"按钮
      const signupBtn = frame.locator('button.ant-btn-primary.ant-btn-lg:has-text("立即报名")');
      if (await signupBtn.count() > 0) {
        await signupBtn.first().click({ timeout: 10000 });
        clicked = true;
      }
    }
    if (!clicked) {
      // fallback: 找所有zs-append-button
      const anyAppend = frame.locator('div.zs-append-button');
      if (await anyAppend.count() > 0) {
        await anyAppend.first().click({ timeout: 10000 });
      }
    }
  } catch {
    await frame.evaluate(() => {
      // fallback: 点击zs-append-button
      const btn = document.querySelector('div.zs-append-button.zs-large') as HTMLElement
        || document.querySelector('div.zs-append-button') as HTMLElement;
      if (btn) btn.click();
    });
  }
  await page.waitForTimeout(10000);

  // 检查是否进入向导（如果没打开，再试一次点击zs-append-button）
  let wizardText = await frame.evaluate(() => document.body.innerText.substring(0, 800));
  if (!wizardText.includes('选择门店') && !wizardText.includes('添加商品')) {
    log('info', `  → 向导未打开，重试点击...`);
    try {
      // 重新获取frame
      frame = await getTargetFrame(page);
      const retryBtn = frame.locator('div.zs-append-button');
      if (await retryBtn.count() > 0) {
        await retryBtn.first().click({ timeout: 10000 });
        await page.waitForTimeout(10000);
        wizardText = await frame.evaluate(() => document.body.innerText.substring(0, 800));
      }
    } catch {}
  }
  if (!wizardText.includes('选择门店') && !wizardText.includes('添加商品')) {
    log('warn', `  → 向导未打开: ${wizardText.substring(0, 100)}`);
    return { name: activityName, success: false, message: '向导未打开' };
  }
  log('info', `  → 向导已打开`);

  // Step 6: 全选门店（ant-tree checkbox）
  log('info', `  → 全选门店...`);
  const storeResult = await frame.evaluate(() => {
    const treeNodes = Array.from(document.querySelectorAll('.ant-tree-treenode'));
    for (const node of treeNodes) {
      const title = node.querySelector('.ant-tree-title');
      if (title && title.textContent?.trim() === '全选') {
        const cb = node.querySelector('.ant-tree-checkbox') as HTMLElement;
        if (cb) { cb.click(); return 'tree_全选'; }
        const wrapper = node.querySelector('.ant-tree-node-content-wrapper') as HTMLElement;
        if (wrapper) { wrapper.click(); return 'wrapper_全选'; }
      }
    }
    // fallback: 点击所有未选中的tree checkbox
    let count = 0;
    document.querySelectorAll('.ant-tree-checkbox:not(.ant-tree-checkbox-checked)').forEach(cb => {
      (cb as HTMLElement).click(); count++;
    });
    return count > 0 ? `checked_${count}` : 'none';
  });
  log('info', `  → 门店: ${storeResult}`);
  await page.waitForTimeout(2000);

  // 验证门店数
  const storeCount = await frame.evaluate(() => {
    const text = document.body.innerText;
    const m = text.match(/已选门店[（(](\d+)[)）]/);
    return m ? parseInt(m[1]) : 0;
  });
  log('info', `  → 已选门店: ${storeCount}`);

  // 勾选协议
  await frame.evaluate(() => {
    const cb = document.querySelector('.ant-checkbox-wrapper:not(.ant-checkbox-wrapper-checked)') as HTMLElement;
    if (cb) cb.click();
  });
  await page.waitForTimeout(1000);

  // Step 7: 点击"下一步"
  log('info', `  → 下一步...`);
  try {
    const nextBtn = frame.locator('button.ant-btn-primary.ant-btn-lg:has-text("下一步")');
    if (await nextBtn.count() > 0) {
      await nextBtn.first().click({ timeout: 10000 });
    }
  } catch {
    await frame.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const btn = btns.find(b => b.textContent?.trim() === '下一步' && !b.disabled);
      if (btn) btn.click();
    });
  }
  await page.waitForTimeout(8000);

  // Step 8: 上传商品文件
  log('info', `  → 上传商品文件...`);
  const step2Text = await frame.evaluate(() => document.body.innerText.substring(0, 500));
  log('info', `  → 第2步: ${step2Text.substring(0, 120)}`);

  let uploaded = false;
  // 方法1: 在iframe中找file input
  try {
    const fileInput = frame.locator('input[type="file"]');
    if (await fileInput.count() > 0) {
      await fileInput.first().setInputFiles(excelPath);
      uploaded = true;
      log('info', `  → 上传: frame input`);
    }
  } catch (e: any) {
    log('warn', `  → frame input失败: ${e.message?.substring(0, 60)}`);
  }

  // 方法2: 在page中找file input
  if (!uploaded) {
    try {
      const fileInput = page.locator('input[type="file"]');
      if (await fileInput.count() > 0) {
        await fileInput.first().setInputFiles(excelPath);
        uploaded = true;
        log('info', `  → 上传: page input`);
      }
    } catch (e: any) {
      log('warn', `  → page input失败: ${e.message?.substring(0, 60)}`);
    }
  }

  // 方法3: 遍历所有frames找file input
  if (!uploaded) {
    for (const f of page.frames()) {
      try {
        const fi = f.locator('input[type="file"]');
        if (await fi.count() > 0) {
          await fi.first().setInputFiles(excelPath);
          uploaded = true;
          log('info', `  → 上传: other frame input (${f.url().substring(0, 50)})`);
          break;
        }
      } catch {}
    }
  }

  if (!uploaded) {
    log('warn', `  → 未找到文件上传input`);
  }
  await page.waitForTimeout(5000);

  // 检查上传结果
  const uploadStatus = await frame.evaluate(() => {
    const item = document.querySelector('.ant-upload-list-item');
    if (item) {
      const status = item.className;
      return status.includes('done') ? 'done' : status.includes('error') ? 'error' : 'uploading';
    }
    return 'no_item';
  });
  log('info', `  → 上传状态: ${uploadStatus}`);

  // Step 9: 确认提交
  log('info', `  → 确认提交...`);
  try {
    const submitBtn = frame.locator('button.ant-btn-primary.ant-btn-lg:has-text("确认提交")');
    if (await submitBtn.count() > 0) {
      await submitBtn.first().click({ timeout: 10000 });
      log('info', `  → 已点击确认提交`);
    }
  } catch (e: any) {
    log('warn', `  → 确认提交失败: ${e.message?.substring(0, 60)}`);
  }
  await page.waitForTimeout(5000);

  // 检查确认弹窗
  try {
    const modal = frame.locator('.ant-modal-confirm-btns button.ant-btn-primary, .ant-modal-footer button.ant-btn-primary');
    if (await modal.count() > 0) {
      await modal.first().click({ timeout: 5000 });
      log('info', `  → 确认弹窗已点击`);
      await page.waitForTimeout(3000);
    }
  } catch {}

  // Step 10: 检查结果
  const resultText = await frame.evaluate(() => document.body.innerText.substring(0, 500));
  log('info', `  → 结果: ${resultText.substring(0, 120)}`);

  // 清理临时文件
  try { fs.unlinkSync(excelPath); } catch {}

  if (resultText.includes('报名成功') || resultText.includes('提交成功') || resultText.includes('已提交报名') || resultText.includes('信息已提交') || resultText.includes('报名完成')) {
    return { name: activityName, success: true, message: '报名成功' };
  } else if (resultText.includes('已报名')) {
    return { name: activityName, success: true, message: '已报名' };
  }
  return { name: activityName, success: false, message: '待确认' };
}

async function main() {
  log('info', '=== 品类红包报名 v4 启动 ===');

  const userDataDir = path.join(__dirname, '..', 'user_data');
  const activityUrl = 'https://nr.ele.me/app/eleme-nr-bfe-newretail/common-next#/pc/platformActivitiesPc/';

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome', headless: false,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
    acceptDownloads: true,
  });
  const page = context.pages()[0] || await context.newPage();
  const results: Result[] = [];

  try {
    const totalPages = 20; // 追加报名tab可能有更多页，设大一点，遇到空页自动停止

    for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
      log('info', `--- 第 ${pageNum}/${totalPages} 页 ---`);
      let frame = await navigateToList(page, activityUrl, pageNum);

      const processedIds = new Set<string>();

      while (true) {
        // 重新获取frame（每次循环都重新获取）
        frame = await getTargetFrame(page);

        const cards = await frame.evaluate(() => {
          return Array.from(document.querySelectorAll('.zs-act-view-v2')).map((card, i) => {
            const text = (card.textContent || '').replace(/\s+/g, ' ');
            const name = text.substring(0, 80).trim();
            const id = text.substring(0, 120);
            const isCat = text.includes('品类红包') || text.includes('专属券') || text.includes('专享券');
            const hasBtn = Array.from(card.querySelectorAll('span, button')).some(
              (el: Element) => {
                const t = el.textContent?.trim();
                return t === '立即报名' || t === '追加报名';
              }
            );
            return { index: i, name, id, isCat, hasBtn };
          });
        });

        // 如果整页没有卡片，停止翻页
        if (cards.length === 0) {
          log('info', '本页无活动卡片，停止');
          break;
        }

        const target = cards.find(c => c.isCat && c.hasBtn && !processedIds.has(c.id));
        if (!target) {
          log('info', '本页无更多品类红包');
          break;
        }

        processedIds.add(target.id);
        log('info', `[品类红包] ${target.name}`);

        const result = await processOneActivity(context, page, frame, target.index, target.name, '');

        results.push(result);
        const icon = result.success ? '✅' : '❌';
        log('info', `  → ${icon} ${result.message}`);

        // 返回活动列表（每次都完整导航）
        log('info', `  → 返回列表...`);
        frame = await navigateToList(page, activityUrl, pageNum);
      }
    }
  } catch (err: any) {
    log('error', `全局错误: ${err.message}`);
  }

  // 汇总
  const resultFile = path.join(DATA_DIR, `category_v4_${today}.json`);
  fs.writeFileSync(resultFile, JSON.stringify(results, null, 2));

  const success = results.filter(r => r.message === '报名成功').length;
  const skipped = results.filter(r => r.message === '已报名').length;
  const failed = results.filter(r => !r.success).length;

  log('info', '\n=== 报名汇总 ===');
  log('info', `总计: ${results.length} | 成功: ${success} | 已报名: ${skipped} | 失败: ${failed}`);

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`  品类红包报名 v4 | ${today}`);
  console.log(`${'═'.repeat(50)}`);
  results.forEach(r => {
    const icon = r.success ? (r.message === '报名成功' ? '✅' : '⏭️') : '❌';
    console.log(`  ${icon} ${r.name.substring(0, 55)}`);
    console.log(`     ${r.message}`);
  });
  console.log(`${'─'.repeat(50)}`);
  console.log(`  ✅ 成功: ${success}  ⏭️ 已报名: ${skipped}  ❌ 失败: ${failed}`);
  console.log(`${'═'.repeat(50)}`);

  await context.close();
}

main().catch(console.error);
