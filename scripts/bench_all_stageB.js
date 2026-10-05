#!/usr/bin/env node
'use strict';

/**
 * 百炼全模型扫描 · 阶段 B：多轮完整题测试
 *
 * 对阶段 A 筛出的全部可用模型，每个跑 3 轮：
 *   run1 默认参数
 *   run2 enable_thinking=false   ← 测「关思考」能否提速
 *   run3 默认参数                ← 与 run1 对比测稳定性
 *
 * 记录：TTFB / 首正文 / 总耗时 / 正文汉字 / 思考汉字 / 输出 token / 失败原因
 * 每轮结束即落盘，中断不丢数据。
 *
 * 运行：DASHSCOPE_KEY=... node scripts/bench_all_stageB.js
 * 可选环境变量：CONC（并发，默认 5）、TMO（超时 ms，默认 75000）
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const KEY = process.env.DASHSCOPE_KEY;
const BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const CONCURRENCY = Number(process.env.CONC || 5);
const TIMEOUT_MS = Number(process.env.TMO || 75000);

const STAGE_A = path.join(__dirname, '..', '.bench', 'stageA.json');
const OUT = path.join(os.tmpdir(), 'wdws-bench', 'stageB.json');

const SYS = '你是「向晚问思」，一个以经典哲学、文学与心理学为根基的思辨助手。你不替用户做决定，而是陪他把问题看清、拓展视角，最后把判断留给他自己。请用中文回答。';
const USER = '我今年30岁，工作稳定但总觉得没什么意义，想改变又怕失去现在的一切。我该怎么办？';

const cjk = (s) => (s.match(/[\u4e00-\u9fa5]/g) || []).length;

async function one(model, round, noThink) {
  const body = {
    model,
    messages: [{ role: 'system', content: SYS }, { role: 'user', content: USER }],
    max_tokens: 1200,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (noThink) body.enable_thinking = false;

  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  let content = '', reasoning = '', usage = null, ttfb = null, firstContent = null;
  try {
    const res = await fetch(BASE + '/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      clearTimeout(timer);
      let msg = txt.slice(0, 150);
      try { const j = JSON.parse(txt); msg = (j.error && (j.error.message || j.error.code)) || msg; } catch (e) {}
      return { model, round, noThink, ok: false, http: res.status, err: String(msg).replace(/\s+/g, ' ').slice(0, 105), total: Date.now() - t0 };
    }
    let buf = '';
    for await (const raw of res.body) {
      if (ttfb === null) ttfb = Date.now() - t0;
      buf += Buffer.from(raw).toString('utf8');
      const lines = buf.split('\n'); buf = lines.pop();
      for (const l of lines) {
        const d = l.trim();
        if (!d.startsWith('data:')) continue;
        const p = d.slice(5).trim();
        if (p === '[DONE]' || !p) continue;
        let j; try { j = JSON.parse(p); } catch (e) { continue; }
        if (j.usage) usage = j.usage;
        const ch = j.choices && j.choices[0];
        if (!ch) continue;
        const dl = ch.delta || {};
        if (dl.content) { if (firstContent === null) firstContent = Date.now() - t0; content += dl.content; }
        if (dl.reasoning_content) reasoning += dl.reasoning_content;
      }
    }
    clearTimeout(timer);
    return {
      model, round, noThink, ok: true, http: 200, ttfb, firstContent, total: Date.now() - t0,
      cjk: cjk(content), rcjk: cjk(reasoning), outTok: usage ? usage.completion_tokens : null,
      empty: content.trim().length === 0,
    };
  } catch (e) {
    clearTimeout(timer);
    return { model, round, noThink, ok: false, http: 0, err: e.name === 'AbortError' ? 'TIMEOUT' : e.message.slice(0, 105), total: Date.now() - t0 };
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
      out[idx] = r;
      done++;
      process.stdout.write('  [' + String(done).padStart(3) + '/' + items.length + '] ' +
        (r.ok ? '✓' : '✗') + ' ' + r.model.slice(0, 33).padEnd(33) + ' ' +
        (r.ok ? String(r.total).padStart(6) + 'ms ' + String(r.cjk).padStart(4) + '字 思考' + String(r.rcjk).padStart(4) : 'HTTP' + r.http + ' ' + r.err) + '\n');
    }
  }));
  return out;
}

function save(models, all) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify({
    generatedAt: new Date().toISOString(),
    concurrency: CONCURRENCY, timeoutMs: TIMEOUT_MS,
    models, runs: all,
  }, null, 2), 'utf8');
}

(async () => {
  const stageA = JSON.parse(fs.readFileSync(STAGE_A, 'utf8'));
  const models = stageA.bailian.filter((r) => r.ok).map((r) => r.model);

  console.log('阶段 B：' + models.length + ' 模型 × 3 轮 = ' + models.length * 3 + ' 次，并发 ' + CONCURRENCY + '，超时 ' + TIMEOUT_MS + 'ms');
  console.log('输出：' + OUT + '\n');

  const all = [];
  const rounds = [
    { round: 1, noThink: false, desc: '默认参数' },
    { round: 2, noThink: true, desc: 'enable_thinking=false' },
    { round: 3, noThink: false, desc: '默认参数（复测，用于稳定性）' },
  ];

  for (const r of rounds) {
    console.log('=== round ' + r.round + ' · ' + r.desc + ' ===');
    const t0 = Date.now();
    const res = await pool(models.map((m) => ({ model: m, round: r.round })), CONCURRENCY, (x) => one(x.model, x.round, r.noThink));
    all.push(...res);
    save(models, all);
    console.log('  → 用时 ' + Math.round((Date.now() - t0) / 1000) + 's，已落盘\n');
  }
  console.log('全部完成。结果：' + OUT);
})();
