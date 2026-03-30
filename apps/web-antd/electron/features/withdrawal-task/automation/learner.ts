import * as fs from 'node:fs';
import * as path from 'node:path';

import { isCliEntry } from '../../../utils/is-main-module';

import type { MetricEvent } from './logger';

const METRICS_DIR = path.join(process.cwd(), 'logs', 'metrics');
const LEARNING_FILE = path.join(process.cwd(), 'learning_state.json');

interface LearningState {
  lastAnalyzedAt: string;
  totalExecutions: number;
  storeStats: Record<string, {
    successRate: number;
    avgDurationMs: number;
    totalAttempts: number;
    lastAmount: number | null;
    amountHistory: { date: string; amount: number }[];
  }>;
  bestHours: number[];          // 成功率最高的小时
  selectorHealth: Record<string, number>; // 选择器 → 命中率
  riskTrend: { date: string; level: number; count: number }[];
  recommendations: string[];
}

function loadMetrics(days = 7): MetricEvent[] {
  const events: MetricEvent[] = [];
  if (!fs.existsSync(METRICS_DIR)) return events;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  for (const file of fs.readdirSync(METRICS_DIR).sort()) {
    if (!file.endsWith('.jsonl')) continue;
    const filePath = path.join(METRICS_DIR, file);
    const lines = fs.readFileSync(filePath, 'utf8').split('\n').filter(Boolean);
    for (const line of lines) {
      try {
        const evt = JSON.parse(line);
        if (new Date(evt.timestamp) >= cutoff) events.push(evt);
      } catch {}
    }
  }
  return events;
}

function loadState(): LearningState {
  if (fs.existsSync(LEARNING_FILE)) {
    try { return JSON.parse(fs.readFileSync(LEARNING_FILE, 'utf8')); } catch {}
  }
  return {
    lastAnalyzedAt: '',
    totalExecutions: 0,
    storeStats: {},
    bestHours: [],
    selectorHealth: {},
    riskTrend: [],
    recommendations: [],
  };
}

function saveState(state: LearningState) {
  fs.writeFileSync(LEARNING_FILE, JSON.stringify(state, null, 2));
}

export function analyze(days = 7): LearningState {
  const events = loadMetrics(days);
  const state = loadState();

  if (events.length === 0) {
    state.recommendations = ['暂无数据，等待首次执行后再分析'];
    saveState(state);
    return state;
  }

  // 1. 门店统计
  const storeMap: Record<string, { success: number; total: number; durations: number[]; lastAmount: number | null }> = {};
  for (const evt of events) {
    if (evt.event === 'withdrawal_attempt' && evt.store) {
      const s = storeMap[evt.store] ??= { success: 0, total: 0, durations: [], lastAmount: null };
      s.total++;
      if (evt.result === 'success' || evt.result === 'skipped') s.success++;
      if (evt.amount != null) s.lastAmount = evt.amount;
    }
    if (evt.event === 'store_switch' && evt.store) {
      const s = storeMap[evt.store] ??= { success: 0, total: 0, durations: [], lastAmount: null };
      if (evt.durationMs) s.durations.push(evt.durationMs);
    }
  }

  state.storeStats = {};
  for (const [store, data] of Object.entries(storeMap)) {
    const avgDur = data.durations.length > 0
      ? data.durations.reduce((a, b) => a + b, 0) / data.durations.length
      : 0;
    state.storeStats[store] = {
      successRate: data.total > 0 ? data.success / data.total : 0,
      avgDurationMs: Math.round(avgDur),
      totalAttempts: data.total,
      lastAmount: data.lastAmount,
      amountHistory: state.storeStats[store]?.amountHistory ?? [],
    };
    // 追加余额历史
    if (data.lastAmount != null) {
      const today = new Date().toISOString().slice(0, 10);
      const hist = state.storeStats[store].amountHistory;
      if (!hist.find(h => h.date === today)) {
        hist.push({ date: today, amount: data.lastAmount });
        if (hist.length > 30) hist.shift(); // 保留30天
      }
    }
  }

  // 2. 最佳执行时段
  const hourSuccess: Record<number, { success: number; total: number }> = {};
  for (const evt of events) {
    if (evt.event === 'session_summary') {
      const hour = new Date(evt.timestamp).getHours();
      const h = hourSuccess[hour] ??= { success: 0, total: 0 };
      h.total += evt.total ?? 0;
      h.success += evt.success ?? 0;
    }
  }
  state.bestHours = Object.entries(hourSuccess)
    .filter(([, v]) => v.total > 0)
    .sort((a, b) => (b[1].success / b[1].total) - (a[1].success / a[1].total))
    .slice(0, 3)
    .map(([h]) => Number(h));

  // 3. 选择器健康度
  const selectorMap: Record<string, { hit: number; total: number }> = {};
  for (const evt of events) {
    if (evt.event === 'selector_hit') {
      const s = selectorMap[evt.selector] ??= { hit: 0, total: 0 };
      s.total++;
      if (evt.hit) s.hit++;
    }
  }
  state.selectorHealth = {};
  for (const [sel, data] of Object.entries(selectorMap)) {
    state.selectorHealth[sel] = data.total > 0 ? Math.round(data.hit / data.total * 100) : 0;
  }

  // 4. 风控趋势
  const riskByDate: Record<string, number> = {};
  let maxLevel = 0;
  for (const evt of events) {
    if (evt.event === 'risk_control') {
      const date = evt.timestamp.slice(0, 10);
      riskByDate[date] = (riskByDate[date] ?? 0) + 1;
      if (evt.level > maxLevel) maxLevel = evt.level;
    }
  }
  state.riskTrend = Object.entries(riskByDate).map(([date, count]) => ({ date, level: maxLevel, count }));

  // 5. 生成建议
  state.recommendations = [];
  for (const [store, stats] of Object.entries(state.storeStats)) {
    if (stats.successRate < 0.8 && stats.totalAttempts >= 3) {
      state.recommendations.push(`⚠️ ${store} 成功率仅 ${(stats.successRate * 100).toFixed(0)}%，建议检查`);
    }
  }
  for (const [sel, rate] of Object.entries(state.selectorHealth)) {
    if (rate < 50) {
      state.recommendations.push(`🔧 选择器 "${sel}" 命中率 ${rate}%，可能页面已改版`);
    }
  }
  if (state.riskTrend.some(r => r.count >= 3)) {
    state.recommendations.push(`🛡️ 近期风控触发频繁，建议增加执行间隔或更换时段`);
  }
  if (state.bestHours.length > 0) {
    state.recommendations.push(`⏰ 最佳执行时段: ${state.bestHours.map(h => `${h}:00`).join(', ')}`);
  }
  if (state.recommendations.length === 0) {
    state.recommendations.push('✅ 一切正常，无需调整');
  }

  state.lastAnalyzedAt = new Date().toISOString();
  state.totalExecutions = events.filter(e => e.event === 'session_summary').length;
  saveState(state);
  return state;
}

// 直接运行时输出分析结果
if (isCliEntry('learner.ts', 'learner.js', 'learner.mjs', 'learner.cjs')) {
  const state = analyze();
  console.log('\n📊 饿了么提现自我学习分析报告');
  console.log('='.repeat(40));
  console.log(`分析时间: ${state.lastAnalyzedAt}`);
  console.log(`总执行次数: ${state.totalExecutions}`);
  console.log('\n门店统计:');
  for (const [store, stats] of Object.entries(state.storeStats)) {
    console.log(`  ${store}: 成功率 ${(stats.successRate * 100).toFixed(0)}%, 平均耗时 ${stats.avgDurationMs}ms, 最近余额 ${stats.lastAmount ?? '未知'}`);
  }
  console.log('\n建议:');
  for (const r of state.recommendations) console.log(`  ${r}`);
}
