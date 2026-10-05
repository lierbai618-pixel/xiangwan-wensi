#!/usr/bin/env node
'use strict';

/**
 * 汇总报告 v2：按「梯队」输出，不做模糊打分
 *
 * 梯队规则（生成角色）：
 *   先剔除：任一轮失败 / 任一轮输出 0 字 / 输出 < 150 字（不足用）
 *   有效耗时 = min(默认, 关思考)   ← 生产可配置到最优
 *   A 档 ≤ 6s ｜ B 档 6–12s ｜ C 档 > 12s
 *   长度合规 = 有效轮输出落在 400–900 汉字（本项目舒适区）
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const DIR = path.join(os.tmpdir(), 'wdws-bench');
const read = (n) => { try { return JSON.parse(fs.readFileSync(path.join(DIR, n), 'utf8')); } catch (e) { return null; } };

// 明显是专用而非通用对话的模型，单独标注
const SPECIAL = {
  'codeqwen1.5-7b-chat': '代码专用',
  'qwen-flash-character': '角色扮演',
  'qwen-flash-character-2026-02-26': '角色扮演',
  'tongyi-xiaomi-analysis-flash': '小米分析专用?',
  'tongyi-xiaomi-analysis-pro': '小米分析专用?',
  'qwen-long': '长文档',
  'qwen-max-longcontext': '长文档',
  'qwq-plus': '推理（视觉系）',
};

function analyze(runs, label) {
  const bym = {};
  for (const r of runs) {
    const e = (bym[r.model] = bym[r.model] || { model: r.model, rounds: {} });
    e.rounds[r.round] = r;
  }
  const rows = [];
  for (const e of Object.values(bym)) {
    const rs = Object.values(e.rounds);
    const fails = rs.filter((r) => !r.ok).length;
    const okR = rs.filter((r) => r.ok);
    const zeros = okR.filter((r) => (r.cjk || 0) === 0).length;
    const usable = okR.filter((r) => (r.cjk || 0) >= 150);
    const r1 = e.rounds[1], r2 = e.rounds[2], r3 = e.rounds[3];
    const eff = [r1, r2].filter((r) => r && r.ok && (r.cjk || 0) >= 150);
    const effMs = eff.length ? Math.min(...eff.map((r) => r.total)) : null;
    const len = eff.length ? eff.sort((a, b) => a.total - b.total)[0].cjk : null;
    // 波动：轮1 与轮3（同为默认参数）的耗时差
    let spread = null;
    if (r1 && r1.ok && r3 && r3.ok && r1.total && r3.total) {
      spread = Math.round((Math.abs(r1.total - r3.total) / Math.max(r1.total, r3.total)) * 100);
    }
    const think = r1 && r1.ok ? r1.rcjk : null;
    const thinkOff = !!(r1 && r1.ok && r2 && r2.ok && r2.total < r1.total * 0.85 && (r2.rcjk || 0) < (r1.rcjk || 0) * 0.6);
    rows.push({
      model: e.model, label,
      attempts: rs.length, fails, zeros,
      effMs, len, spread, think, thinkOff,
      lenOk: len !== null && len >= 400 && len <= 900,
      r1, r2, r3,
    });
  }
  return rows;
}

const fmt = (r) => r ? `${(r.total / 1000).toFixed(2)}s/${r.cjk}字` : '—';

function tier(rows) {
  const clean = rows.filter((r) => r.fails === 0 && r.zeros === 0 && r.effMs !== null && r.len !== null && r.len >= 150);
  const a = clean.filter((r) => r.effMs <= 6000).sort((x, y) => x.effMs - y.effMs);
  const b = clean.filter((r) => r.effMs > 6000 && r.effMs <= 12000).sort((x, y) => x.effMs - y.effMs);
  const c = clean.filter((r) => r.effMs > 12000).sort((x, y) => x.effMs - y.effMs);
  return { a, b, c, rejected: rows.filter((r) => !clean.includes(r)) };
}

function printTier(name, list, note) {
  console.log('\n【' + name + '】' + note + '  （' + list.length + ' 个）');
  if (!list.length) { console.log('  （无）'); return; }
  console.log('  ' + '模型'.padEnd(34) + '有效耗时  输出    思考链  波动  默认/关思考            备注');
  console.log('  ' + '-'.repeat(112));
  list.forEach((r) => {
    console.log('  ' + r.model.slice(0, 33).padEnd(33) + ' ' +
      (r.effMs / 1000).toFixed(2).padStart(6) + 's ' +
      String(r.len).padStart(4) + '字 ' +
      (r.think === null ? '   —' : String(r.think).padStart(4)) + '   ' +
      (r.spread === null ? '  —' : String(r.spread + '%').padStart(3)) + '   ' +
      (fmt(r.r1) + ' / ' + fmt(r.r2)).padEnd(22) + ' ' +
      (r.thinkOff ? '[关思考有效]' : '') + (r.lenOk ? '' : ' ⚠超区') + (SPECIAL[r.model] ? ' ★' + SPECIAL[r.model] : ''));
  });
}

const b = read('stageB.json');
const h = read('hcnsec.json');
if (!b) { console.log('缺 stageB.json'); process.exit(1); }

const rowsB = analyze(b.runs, 'bailian');
const t = tier(rowsB);

console.log('═'.repeat(118));
console.log('百炼全模型实测 · 生成角色排序    样本：' + rowsB.length + ' 个可用模型 × 3 轮（默认/关思考/默认复测）');
console.log('  剔除规则：任一轮失败、任一轮返回空内容、有效输出 < 150 字');
console.log('  有效耗时 = min(默认, 关思考)　长度合规 = 400–900 汉字　★ = 疑似专用模型');
console.log('═'.repeat(118));

printTier('A 档 · 生产首选', t.a, '有效耗时 ≤ 6s 且零失败');
printTier('B 档 · 可用', t.b, '6–12s 且零失败');
printTier('C 档 · 慢', t.c, '> 12s（虽零失败但不适合做首选）');

console.log('\n\n【落选模型】有失败 / 返回空内容 / 输出过短  （' + t.rejected.length + ' 个）');
console.log('  ' + '模型'.padEnd(34) + '失败  零输出  有效耗时   原因');
console.log('  ' + '-'.repeat(100));
t.rejected.sort((x, y) => x.fails - y.fails || (x.effMs || 1e9) - (y.effMs || 1e9)).forEach((r) => {
  const errs = Object.values(r.rounds || {}).length ? '' : '';
  const es = [r.r1, r.r2, r.r3].filter((x) => x && !x.ok).map((x) => 'HTTP' + x.http).join(',');
  console.log('  ' + r.model.slice(0, 33).padEnd(33) + ' ' +
    String(r.fails + '/3').padStart(4) + ' ' + String(r.zeros).padStart(6) + '  ' +
    (r.effMs === null ? '   —   ' : (r.effMs / 1000).toFixed(2).padStart(6) + 's') + '  ' +
    (r.zeros ? '返回空内容' : '') + (es ? ' ' + es : '') + (r.len !== null && r.len < 150 ? ' 输出仅' + r.len + '字' : ''));
});

if (h) {
  const rowsH = analyze(h.runs, 'hcnsec');
  const th = tier(rowsH);
  console.log('\n\n' + '═'.repeat(118));
  console.log('hcnsec 网关 · 结果');
  console.log('═'.repeat(118));
  printTier('hcnsec 可用', th.a.concat(th.b).concat(th.c), '');
  console.log('\n  hcnsec 落选（' + th.rejected.length + ' 个）：');
  th.rejected.sort((x, y) => y.fails - x.fails).forEach((r) => {
    const es = [r.r1, r.r2, r.r3].filter((x) => x && !x.ok).map((x) => 'HTTP' + x.http).filter((v, i, a) => a.indexOf(v) === i).join(',');
    console.log('    ' + r.model.slice(0, 30).padEnd(30) + ' ' + r.fails + '/3 失败  ' + (r.zeros ? '有零输出  ' : '') + es);
  });
}
