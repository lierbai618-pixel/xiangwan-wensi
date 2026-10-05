#!/usr/bin/env node
'use strict';

/**
 * 百炼全模型扫描 · 阶段 C：联网能力测试
 *
 * 对阶段 A 筛出的可用模型，各测 2 轮「强制联网」：
 *   enable_search: true + search_options.forced_search: true
 *
 * 题目是必须联网才能答对的事实题（实时指数点位），并自动初判：
 *   ① 是否出现合理的指数点位数字（3 位整数 + 小数）
 *   ② 是否自述来自搜索
 *   ③ 是否明确表示无法获取实时数据（= 未联网）
 *
 * 运行：DASHSCOPE_KEY=... CONC=5 node scripts/bench_all_stageC.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const KEY = process.env.DASHSCOPE_KEY;
const BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const CONCURRENCY = Number(process.env.CONC || 5);
const TIMEOUT_MS = Number(process.env.TMO || 75000);
const OUT = path.join(os.tmpdir(), 'wdws-bench', 'stageC.json');

const Q = '请联网查询后回答：2026年9月21日 A股上证指数的收盘点位是多少？请给出具体数字，并说明数据来源。';
const cjk = (s) => (s.match(/[\u4e00-\u9fa5]/g) || []).length;

function judge(text) {
  const hasPoint = /\b[23]\d{3}(\.\d{1,2})?\b/.test(text);
  const selfSearch = /联网|搜索|查询到|检索|据.{0,6}(报道|数据|显示)|来源[:：]/.test(text);
  const refuse = /无法(获取|访问|查询|确定)|不能(获取|访问|联网)|没有(实时|联网)|知识截止|不具备联网|无法实时/.test(text);
  return { hasPoint, selfSearch, refuse };
}

async function one(model, round) {
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let content = '', usage = null;
  try {
    const res = await fetch(BASE + '/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: Q }],
        max_tokens: 700,
        stream: false,
        enable_search: true,
        search_options: { forced_search: true, enable_source: true },
      }),
      signal: ctl.signal,
    });
    const total = Date.now() - t0;
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      clearTimeout(timer);
      let msg = txt.slice(0, 140);
      try { const j = JSON.parse(txt); msg = (j.error && (j.error.message || j.error.code)) || msg; } catch (e) {}
      return { model, round, ok: false, http: res.status, err: String(msg).replace(/\s+/g, ' ').slice(0, 95), total };
    }
    const j = await res.json();
    clearTimeout(timer);
    content = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    usage = j.usage || null;
    return Object.assign({ model, round, ok: true, total, cjk: cjk(content), outTok: usage ? usage.completion_tokens : null, preview: content.replace(/\s+/g, ' ').slice(0, 110) }, judge(content));
  } catch (e) {
    clearTimeout(timer);
    return { model, round, ok: false, http: 0, err: e.name === 'AbortError' ? 'TIMEOUT' : e.message.slice(0, 95), total: Date.now() - t0 };
  }
}

async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let i = 0, done = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const idx = i++;
      if (idx >= items.length) break;
      const r = await worker(items[idx]);
      out[idx] = r; done++;
      process.stdout.write('  [' + String(done).padStart(3) + '/' + items.length + '] ' + (r.ok ? '✓' : '✗') + ' ' +
        r.model.slice(0, 33).padEnd(33) + ' ' +
        (r.ok ? String(r.total).padStart(6) + 'ms ' + String(r.cjk).padStart(4) + '字 ' + (r.hasPoint ? '有点位' : '无点位 ') + (r.selfSearch ? '自述搜索' : '未提搜索') + (r.refuse ? ' 称无法联网' : '')
              : 'HTTP' + r.http + ' ' + r.err) + '\n');
    }
  }));
  return out;
}

(async () => {
  const stageA = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.bench', 'stageA.json'), 'utf8'));
  const models = stageA.bailian.filter((r) => r.ok).map((r) => r.model);
  console.log('阶段 C：' + models.length + ' 模型 × 2 轮联网，并发 ' + CONCURRENCY + '\n');

  const all = [];
  for (const round of [1, 2]) {
    console.log('=== round ' + round + ' ===');
    const t0 = Date.now();
    const res = await pool(models.map((m) => ({ model: m, round })), CONCURRENCY, (x) => one(x.model, x.round));
    all.push(...res);
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), runs: all }, null, 2), 'utf8');
    console.log('  → ' + Math.round((Date.now() - t0) / 1000) + 's\n');
  }
  console.log('完成: ' + OUT);
})();
