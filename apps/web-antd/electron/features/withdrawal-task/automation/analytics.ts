import * as fs from 'node:fs';
import * as path from 'node:path';

import { isCliEntry } from '../../../utils/is-main-module';

import type { MetricEvent } from './logger';

const METRICS_DIR = path.join(process.cwd(), 'logs', 'metrics');
const LEARNING_DIR = path.join(process.cwd(), 'learning_reports');

if (!fs.existsSync(LEARNING_DIR)) {
  fs.mkdirSync(LEARNING_DIR, { recursive: true });
}

/**
 * 读取指定天数内的所有埋点数据
 */
function loadMetrics(days: number): MetricEvent[] {
  const events: MetricEvent[] = [];
  if (!fs.existsSync(METRICS_DIR)) return events;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const files = fs.readdirSync(METRICS_DIR).filter(f => f.endsWith('.jsonl')).sort();
  for (const file of files) {
    // 从文件名提取日期 metrics_YYYYMMDD.jsonl
    const dateMatch = file.match(/metrics_(\d{8})/);
    if (dateMatch) {
      const fileDate = new Date(
        `${dateMatch[1].slice(0, 4)}-${dateMatch[1].slice(4, 6)}-${dateMatch[1].slice(6, 8)}`
      );
      if (fileDate < cutoff) continue;
    }

    const lines = fs.readFileSync(path.join(METRICS_DIR, file), 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        events.push(JSON.parse(line));
      } catch {}
    }
  }
  return events;
}

/**
 * 分析成功率（按门店、按时段）
 */
function analyzeSuccessRate(events: MetricEvent[]) {
  const withdrawals = events.filter(e => e.event === 'withdrawal_attempt');

  // 按门店
  const byStore: Record<string, { total: number; success: number; fail: number; blocked: number; skipped: number }> = {};
  for (const e of withdrawals) {
    const store = e.store || 'unknown';
    if (!byStore[store]) byStore[store] = { total: 0, success: 0, fail: 0, blocked: 0, skipped: 0 };
    byStore[store].total++;
    byStore[store][e.result as keyof typeof byStore[string]]++;
  }

  // 按小时
  const byHour: Record<number, { total: number; success: number }> = {};
  for (const e of withdrawals) {
    const hour = new Date(e.timestamp).getHours();
    if (!byHour[hour]) byHour[hour] = { total: 0, success: 0 };
    byHour[hour].total++;
    if (e.result === 'success' || e.result === 'skipped') byHour[hour].success++;
  }

  return { byStore, byHour };
}

/**
 * 分析门店切换耗时
 */
function analyzeSwitchPerformance(events: MetricEvent[]) {
  const switches = events.filter(e => e.event === 'store_switch');
  const byStore: Record<string, { count: number; totalMs: number; failures: number }> = {};

  for (const e of switches) {
    const store = e.store || 'unknown';
    if (!byStore[store]) byStore[store] = { count: 0, totalMs: 0, failures: 0 };
    byStore[store].count++;
    byStore[store].totalMs += e.durationMs || 0;
    if (!e.success) byStore[store].failures++;
  }

  return byStore;
}

/**
 * 分析余额趋势
 */
function analyzeBalanceTrend(events: MetricEvent[]) {
  const balances = events.filter(e => e.event === 'balance_check' && e.amount !== null);
  const byStore: Record<string, { date: string; amount: number }[]> = {};

  for (const e of balances) {
    const store = e.store || 'unknown';
    if (!byStore[store]) byStore[store] = [];
    byStore[store].push({
      date: e.timestamp.slice(0, 10),
      amount: e.amount,
    });
  }

  return byStore;
}

/**
 * 分析风控情况
 */
function analyzeRiskEvents(events: MetricEvent[]) {
  const risks = events.filter(e => e.event === 'risk_control');
  return {
    total: risks.length,
    byTrigger: risks.reduce((acc, e) => {
      acc[e.trigger] = (acc[e.trigger] || 0) + 1;
      return acc;
    }, {} as Record<string, number>),
  };
}

/**
 * 生成周报 Markdown
 */
export function generateWeeklyReport(): string {
  const events = loadMetrics(7);
  if (events.length === 0) {
    return '# 饿了么自动提现周报\n\n本周无执行数据。';
  }

  const successRate = analyzeSuccessRate(events);
  const switchPerf = analyzeSwitchPerformance(events);
  const balanceTrend = analyzeBalanceTrend(events);
  const riskAnalysis = analyzeRiskEvents(events);
  const sessions = events.filter(e => e.event === 'session_summary');

  let report = `# 饿了么自动提现周报\n\n`;
  report += `生成时间: ${new Date().toISOString().slice(0, 16)}\n`;
  report += `数据范围: 最近 7 天 | 总埋点数: ${events.length}\n\n`;

  // 执行概览
  report += `## 执行概览\n\n`;
  report += `总执行次数: ${sessions.length}\n`;
  if (sessions.length > 0) {
    const totalDuration = sessions.reduce((s, e) => s + (e.durationMs || 0), 0);
    const avgDuration = Math.round(totalDuration / sessions.length / 1000);
    const totalSuccess = sessions.reduce((s, e) => s + (e.success || 0), 0);
    const totalFail = sessions.reduce((s, e) => s + (e.fail || 0), 0);
    report += `平均耗时: ${avgDuration}秒\n`;
    report += `门店成功: ${totalSuccess} | 失败: ${totalFail}\n`;
  }

  // 门店成功率
  report += `\n## 门店成功率\n\n`;
  for (const [store, data] of Object.entries(successRate.byStore)) {
    const rate = data.total > 0 ? Math.round(((data.success + data.skipped) / data.total) * 100) : 0;
    report += `- ${store}: ${rate}% (${data.success}成功 ${data.skipped}跳过 ${data.fail}失败 ${data.blocked}拦截 / ${data.total}总计)\n`;
  }

  // 最佳执行时段
  report += `\n## 时段分析\n\n`;
  const hours = Object.entries(successRate.byHour).sort((a, b) => {
    const rateA = a[1].total > 0 ? a[1].success / a[1].total : 0;
    const rateB = b[1].total > 0 ? b[1].success / b[1].total : 0;
    return rateB - rateA;
  });
  for (const [hour, data] of hours) {
    const rate = data.total > 0 ? Math.round((data.success / data.total) * 100) : 0;
    report += `- ${hour}:00 成功率 ${rate}% (${data.total}次)\n`;
  }

  // 门店切换性能
  report += `\n## 门店切换性能\n\n`;
  for (const [store, data] of Object.entries(switchPerf)) {
    const avgMs = data.count > 0 ? Math.round(data.totalMs / data.count) : 0;
    report += `- ${store}: 平均 ${avgMs}ms, 失败 ${data.failures}/${data.count}\n`;
  }

  // 余额趋势
  report += `\n## 余额趋势\n\n`;
  for (const [store, records] of Object.entries(balanceTrend)) {
    const latest = records[records.length - 1];
    report += `- ${store}: 最新余额 ¥${latest.amount} (${latest.date})\n`;
  }

  // 风控分析
  report += `\n## 风控分析\n\n`;
  report += `风控触发总次数: ${riskAnalysis.total}\n`;
  for (const [trigger, count] of Object.entries(riskAnalysis.byTrigger)) {
    report += `- ${trigger}: ${count}次\n`;
  }

  // 优化建议
  report += `\n## 自动优化建议\n\n`;
  if (hours.length > 0) {
    const bestHour = hours[0][0];
    report += `- 建议最佳执行时段: ${bestHour}:00\n`;
  }
  if (riskAnalysis.total > 3) {
    report += `- ⚠️ 风控触发频繁，建议增加操作间隔或更换执行时段\n`;
  }
  for (const [store, data] of Object.entries(switchPerf)) {
    if (data.failures > 2) {
      report += `- ⚠️ ${store} 切换失败率偏高，建议检查选择器\n`;
    }
  }

  return report;
}

/**
 * 保存周报到文件
 */
export function saveWeeklyReport(): string {
  const report = generateWeeklyReport();
  const filename = `weekly_${new Date().toISOString().slice(0, 10)}.md`;
  const filepath = path.join(LEARNING_DIR, filename);
  fs.writeFileSync(filepath, report);
  return filepath;
}

// 直接运行时生成报告
if (isCliEntry('analytics.ts', 'analytics.js', 'analytics.mjs', 'analytics.cjs')) {
  const filepath = saveWeeklyReport();
  console.log(`周报已生成: ${filepath}`);
  console.log(generateWeeklyReport());
}
