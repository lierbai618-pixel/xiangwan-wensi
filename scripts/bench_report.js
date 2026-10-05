#!/usr/bin/env node
'use strict';

/**
 * 汇总分析：读取阶段 B / C 结果，输出按优先级排序的推荐表
 *
 * 评分口径（生成角色）：
 *   稳定性（失败率 + 耗时离散度）权重最高 —— 生产环境的失败要走兜底，代价双倍
 *   速度（关思考后最优耗时，其次默认）
 *   长度合规（400–900 汉字为舒适区，偏离扣分）
 *
 * 运行：node scripts/bench_report.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DIR = path.join(os.tmpdir(), 'wdws-bench');
const f = (n) => path.join(DIR, n);

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

const stageB = readJson(f('stageB.json'));
const stageC = readJson(f('stageC.json'));
const hcnsec = readJson(f('hcnsec.json'));
const stageA = readJson(path.join(__dirname, '..', '.bench', 'stageA.json'));

const median = (a) => { const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

function summarize(runs) {
  const byModel = {};
  for (const r of runs) {
    const m = (byModel[r.model] = byModel[r.model] || { model: r.model, all: [], rounds: {} });
    m.all.push(r);
    (m.rounds[r.round] = m.rounds[r.round] || []).push(r);
  }
  return Object.values(byModel).map((m) => {
    const ok = m.all.filter((r) => r.ok);
    const fail = m.all.length - ok.length;
    const byRound = {};
    for (const k of Object.keys(m.rounds)) {
      const rs = m.rounds[k].filter((r) => r.ok);
      byRound[k] = rs.length ? { total: median(rs.map((r) => r.total)), cjk: median(rs.map((r) => r.cjk)), rcjk: median(rs.map((r) => r.rcjk)), n: rs.length } : null;
    }
    const times = ok.map((r) => r.total);
    const roundTotals = m.rounds[1] && m.rounds[3]
      ? [m.rounds[1].filter((r) => r.ok).map((r) => r.total), m.rounds[3].filter((r) => r.ok).map((r) => r.total)]
      : null;
    let spread = null;
    if (roundTotals && roundTotals[0].length && roundTotals[1].length) {
      const a = median(roundTotals[0]), b = median(roundTotals[1]);
      spread = Math.round((Math.abs(a - b) / Math.max(a, b)) * 100);
    }
    return {
      model: m.model,
      attempts: m.all.length, fails: fail,
      failRate: Math.round((fail / m.all.length) * 100),
      bestMs: times.length ? Math.min(...times) : null,
      medMs: times.length ? median(times) : null,
      spreadPct: spread,
      r1: byRound[1], r2: byRound[2], r3: byRound[3],
      errs: m.all.filter((r) => !r.ok).map((r) => 'HTTP' + r.http + ':' + (r.err || '').slice(0, 45)).slice(0, 2),
    };
  });
}

function score(g) {
  // 稳定性 0-50：失败率直接扣，波动扣
  let s = 50;
  s -= g.failRate * 0.6;                          // 失败率权重 0.6/%
  if (g.spreadPct !== null && g.spreadPct > 20) s -= (g.spreadPct - 20) * 0.4;
  // 速度 0-30：以 6s 为满分，30s 为 0
  const t = g.effMs;
  s += t === null ? 0 : Math.max(0, Math.min(30, 30 * (30 - t) / (30 - 6)));
  // 长度合规 0-20
  const len = g.lenCjk;
  if (len === null) s += 0;
  else if (len >= 400 && len <= 900) s += 20;
  else if (len < 400) s += Math.max(0, 20 * (len / 400) - 8);
  else s += Math.max(0, 20 - (len - 900) / 60);
  // 思考链惩罚：默认参数下输出思考链越多越扣（用户等待不可见内容）
  if (g.thinkCjk && g.thinkCjk > 200) s -= Math.min(15, g.thinkCjk / 120);
  return Math.max(0, Math.round(s));
}

function build(rows) {
  return rows.map((g) => {
    // 取「默认」与「关思考」中更快的那个作为有效耗时（生产可配置）
    const cands = [g.r1, g.r2].filter(Boolean).map((r) => r.total);
    g.effMs = cands.length ? Math.min(...cands) : null;
    const lenSrc = [g.r1, g.r2].filter(Boolean).sort((a, b) => a.total - b.total)[0];
    g.lenCjk = lenSrc ? lenSrc.cjk : null;
    g.thinkCjk = g.r1 ? g.r1.rcjk : null;
    g.thinkOffEffective = !!(g.r1 && g.r2 && g.r2.total < g.r1.total * 0.85 && g.r2.rcjk < g.r1.rcjk * 0.6);
    g.score = score(g);
    return g;
  }).sort((a, b) => b.score - a.score || (a.effMs || 1e9) - (b.effMs || 1e9));
}

function line(g, i) {
  const rd = (r) => r ? String(r.total).padStart(6) + 'ms/' + String(r.cjk).padStart(4) + '字' : '     —      ';
  return [
    String(i + 1).padStart(3),
    String(g.score).padStart(4),
    g.model.slice(0, 38).padEnd(38),
    rd(g.r1), rd(g.r2),
    String(g.failRate + '%').padStart(5),
    g.spreadPct === null ? '   —' : String(g.spreadPct + '%').padStart(4),
    g.thinkOffEffective ? ' 有效' : '   —',
  ].join(' ');
}

if (!stageB) { console.log('缺 stageB.json'); process.exit(1); }
const g = build(summarize(stageB.runs));

console.log('总模型数: ' + g.length);
console.log('');
console.log('   #  分数 模型'.padEnd(48) + '  默认(轮1)         关思考(轮2)       失败率  波动  关思考生效');
console.log('─'.repeat(135));
g.forEach((x, i) => console.log(line(x, i)));

console.log('\n\n===== 失败明细（失败率 > 0）=====');
g.filter((x) => x.fails > 0).forEach((x) => console.log('  ' + x.model.padEnd(38) + ' ' + x.fails + '/' + x.attempts + '  ' + x.errs.join(' | ')));

if (stageC) {
  console.log('\n\n===== 联网能力（阶段 C）=====');
  const cm = {};
  for (const r of stageC.runs) {
    const e = (cm[r.model] = cm[r.model] || { model: r.model, n: 0, ok: 0, net: 0, point: 0, times: [] });
    e.n++; if (r.ok) { e.ok++; if (r.selfSearch) e.net++; if (r.hasPoint) e.point++; e.times.push(r.total); }
  }
  const cl = Object.values(cm).filter((x) => x.ok).sort((a, b) => (a.times.length ? median(a.times) : 1e9) - (b.times.length ? median(b.times) : 1e9));
  console.log('  模型'.padEnd(40) + '  成功  自述搜索  有点位   中位耗时');
  cl.forEach((x) => console.log('  ' + x.model.slice(0, 38).padEnd(38) + ' ' + String(x.ok + '/' + x.n).padStart(6) + String(x.net + '/' + x.ok).padStart(9) + String(x.point + '/' + x.ok).padStart(8) + String(median(x.times) + 'ms').padStart(11)));
}

console.log('\n\n===== 阶段 A 不可用（需开通/已下线）=====');
if (stageA) {
  const bad = stageA.bailian.filter((r) => !r.ok);
  const byErr = {};
  bad.forEach((r) => { const k = r.http + ' ' + (r.err || '').slice(0, 40); (byErr[k] = byErr[k] || []).push(r.model); });
  Object.entries(byErr).forEach(([k, v]) => console.log('  [' + k + ']  共 ' + v.length + ' 个'));
}
