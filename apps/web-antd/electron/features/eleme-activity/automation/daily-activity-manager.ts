/**
 * 饿了么每日活动管理器
 * 
 * 功能：
 * 1. 检查所有可报名活动
 * 2. 自动报名品类红包（完整UPC）
 * 3. 生成活动报告
 * 4. 通过飞书发送报告
 * 
 * 用法：npx ts-node src/daily-activity-manager.ts
 */

import { chromium, BrowserContext, Page, Frame } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

const DATA_DIR = path.join(__dirname, '..', 'data');
const today = new Date().toISOString().split('T')[0];

interface ActivityInfo {
  name: string;
  type: string;
  typeName: string;
  status: string; // 'unsigned' | 'signed' | 'expired'
  beginTime: string;
  endTime: string;
  daysLeft: number;
  isCategoryCoupon: boolean;
  canSignUp: boolean;
}

interface DailyReport {
  date: string;
  totalActivities: number;
  signedUp: number;
  newSignups: number;
  unsigned: ActivityInfo[];
  errors: string[];
}

function log(level: string, msg: string) {
  const ts = new Date().toISOString();
  const prefix = level === 'error' ? '❌' : level === 'warn' ? '⚠️' : 'ℹ️';
  console.log(`[${ts}] ${prefix} ${msg}`);
}

async function getTargetFrame(page: Page): Promise<Frame> {
  let frame = page.mainFrame();
  for (const f of page.frames()) {
    try {
      const url = f.url();
      if (url.includes('ms.ele.me') || url.includes('ebai-zs-webapp')) {
        frame = f;
        break;
      }
    } catch {}
  }
  return frame;
}

async function scanActivities(page: Page, frame: Frame, tab: string): Promise<ActivityInfo[]> {
  // 点击指定tab
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
  await frame.waitForSelector('.zs-act-view-v2', { timeout: 15000 }).catch(() => {});

  const activities: ActivityInfo[] = [];
  const now = Date.now();

  // 扫描所有页
  for (let pageNum = 1; pageNum <= 20; pageNum++) {
    if (pageNum > 1) {
      await frame.evaluate((pn: number) => {
        document.querySelector('.ant-pagination')?.querySelectorAll('li').forEach(li => {
          if (li.textContent?.trim() === String(pn)) (li as HTMLElement).click();
        });
      }, pageNum);
      await page.waitForTimeout(3000);
    }

    const cards = await frame.evaluate(() => {
      return Array.from(document.querySelectorAll('.zs-act-view-v2')).map((card) => {
        const text = (card.textContent || '').replace(/\s+/g, ' ');
        const name = text.substring(0, 80).trim();
        const isCat = text.includes('品类红包') || text.includes('专属券') || text.includes('专享券');
        const hasSignupBtn = Array.from(card.querySelectorAll('span, button')).some(
          (el: Element) => {
            const t = el.textContent?.trim();
            return t === '立即报名' || t === '追加报名';
          }
        );
        // 提取活动类型
        const typeMatch = text.match(/(商品特价|爆单红包|品类红包|全店满减|运费满减|商品折扣)/);
        const typeName = typeMatch ? typeMatch[1] : '其他';
        // 提取日期
        const dateMatch = text.match(/(\d{2}\/\d{2})\s*~\s*(\d{2}\/\d{2})/);
        const endDate = dateMatch ? dateMatch[2] : '';
        return { name, isCat, hasSignupBtn, typeName, endDate };
      });
    });

    if (cards.length === 0) break;

    for (const card of cards) {
      activities.push({
        name: card.name,
        type: card.typeName,
        typeName: card.typeName,
        status: tab === '追加报名' ? 'signed' : 'unsigned',
        beginTime: '',
        endTime: card.endDate,
        daysLeft: 0,
        isCategoryCoupon: card.isCat,
        canSignUp: card.hasSignupBtn,
      });
    }
  }

  return activities;
}

function generateFeishuReport(report: DailyReport): string {
  const lines: string[] = [];
  lines.push(`📊 饿了么活动日报 | ${report.date}`);
  lines.push('');
  lines.push(`总活动: ${report.totalActivities} | 已报名: ${report.signedUp} | 今日新报名: ${report.newSignups}`);
  
  if (report.unsigned.length > 0) {
    lines.push('');
    lines.push('📋 未报名活动:');
    const byType: Record<string, ActivityInfo[]> = {};
    for (const a of report.unsigned) {
      if (!byType[a.typeName]) byType[a.typeName] = [];
      byType[a.typeName].push(a);
    }
    for (const [type, acts] of Object.entries(byType)) {
      lines.push(`  【${type}】${acts.length}个`);
      for (const a of acts.slice(0, 3)) {
        const name = a.name.substring(0, 35);
        lines.push(`    • ${name}`);
      }
      if (acts.length > 3) lines.push(`    ...还有${acts.length - 3}个`);
    }
  }

  if (report.errors.length > 0) {
    lines.push('');
    lines.push('⚠️ 异常:');
    for (const e of report.errors) {
      lines.push(`  • ${e}`);
    }
  }

  return lines.join('\n');
}

async function main() {
  log('info', '=== 每日活动管理器启动 ===');
  
  const userDataDir = path.join(__dirname, '..', 'user_data');
  const activityUrl = 'https://nr.ele.me/app/eleme-nr-bfe-newretail/common-next#/pc/platformActivitiesPc/';

  const report: DailyReport = {
    date: today,
    totalActivities: 0,
    signedUp: 0,
    newSignups: 0,
    unsigned: [],
    errors: [],
  };

  let context: BrowserContext | null = null;

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chrome',
      headless: false,
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
    });
    const page = context.pages()[0] || await context.newPage();

    // 导航到活动页面
    await page.goto(activityUrl, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(5000);
    const frame = await getTargetFrame(page);

    // 1. 扫描已报名活动（追加报名tab）
    log('info', '扫描已报名活动...');
    const signedActivities = await scanActivities(page, frame, '追加报名');
    report.signedUp = signedActivities.length;
    log('info', `已报名: ${signedActivities.length}个`);

    // 2. 重新导航，扫描未报名活动
    await page.goto(activityUrl, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(5000);
    const frame2 = await getTargetFrame(page);
    
    log('info', '扫描未报名活动...');
    const unsignedActivities = await scanActivities(page, frame2, '未报名活动');
    report.unsigned = unsignedActivities;
    log('info', `未报名: ${unsignedActivities.length}个`);

    report.totalActivities = signedActivities.length + unsignedActivities.length;

    // 3. 自动报名品类红包（如果有新的）
    const newCategoryCoupons = unsignedActivities.filter(a => a.isCategoryCoupon && a.canSignUp);
    if (newCategoryCoupons.length > 0) {
      log('info', `发现${newCategoryCoupons.length}个新品类红包，启动自动报名...`);
      // 调用v4脚本
      const { execSync } = require('child_process');
      try {
        execSync('npx ts-node src/signup-category-v4.ts', {
          cwd: path.join(__dirname, '..'),
          timeout: 600000,
          stdio: 'inherit',
        });
        report.newSignups = newCategoryCoupons.length;
      } catch (err: any) {
        report.errors.push(`品类红包自动报名失败: ${err.message?.substring(0, 100)}`);
      }
    } else {
      log('info', '无新品类红包需要报名');
    }

  } catch (err: any) {
    log('error', `管理器错误: ${err.message}`);
    report.errors.push(err.message?.substring(0, 100));
  } finally {
    if (context) await context.close().catch(() => {});
  }

  // 4. 生成报告
  const reportText = generateFeishuReport(report);
  log('info', '\n' + reportText);

  // 保存报告
  const reportFile = path.join(DATA_DIR, `daily_report_${today}.json`);
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  log('info', `报告已保存: ${reportFile}`);

  // 输出飞书消息格式（供cron job使用）
  console.log('\n=== FEISHU_MESSAGE ===');
  console.log(reportText);
  console.log('=== END_MESSAGE ===');
}

main().catch(console.error);
