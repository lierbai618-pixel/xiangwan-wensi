#!/usr/bin/env node
'use strict';

/**
 * Agnes 中国站 · 全部文本模型对比
 * 用户限定可用池 = 百炼 12 个免费额度模型 + agnes → 需在 agnes 内部选出最优
 *   AGNES_CN_KEY=sk-xxx ROUNDS=3 node scripts/bench_agnes_models.js
 */

const KEY = process.env.AGNES_CN_KEY;
if (!KEY) { console.error('缺少 AGNES_CN_KEY'); process.exit(1); }
const BASE = 'https://api.agnes-ai.cn/v1';
const ROUNDS = Number(process.env.ROUNDS || 3);
const TMO = 90000;

const MODELS = (process.env.MODELS ||
  'agnes-2.5-flash,agnes-2.5-pro,agnes-2.5-pro-alpha,agnes-2.5-pro-beta,agnes-3.0-flash'
).split(',').map((s) => s.trim()).filter(Boolean);

const SYS = '你是「向晚问思」，一个以经典哲学、文学与心理学为根基的思辨助手。你不替用户做决定，而是陪他把问题看清、拓展视角，最后把判断留给他自己。请用中文回答。';
const USER = '我今年30岁，工作稳定但总觉得没什么意义，想改变又怕失去现在的一切。我该怎么办？';
const cjk = (s) => (s.match(/[\u4e00-\u9fa5]/g) || []).length;

async function one(model, round, noThink) {
  const body = {
    model,
    messages: [{ role: 'system', content: SYS }, { role: 'user', content: USER }],
    max_tokens: 1200, stream: true, stream_options: { include_usage: true },
  };
  if (noThink) body.chat_template_kwargs = { enable_thinking: false };

  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TMO);
  let content = '', reasoning = '', usage = null, firstContent = null;
  try {
    const res = await fetch(BASE + '/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: ctl.signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      clearTimeout(timer);
      let msg = t.slice(0, 100);
      try { const j = JSON.parse(t); msg = (j.error && (j.error.message || j.error.code)) || msg; } catch (e) {}
      return { model, round, noThink, ok: false, http: res.status, err: String(msg).replace(/\s+/g, ' ').slice(0, 80), total: Date.now() - t0 };
    }
    let buf = '';
    for await (const raw of res.body) {
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
      model, round, noThink, ok: true, firstContent, total: Date.now() - t0,
      cjk: cjk(content), rcjk: cjk(reasoning), outTok: usage ? usage.completion_tokens : null,
      empty: content.trim().length === 0, preview: content.replace(/\s+/g, ' ').slice(0, 60),
    };
  } catch (e) {
    clearTimeout(timer);
    return { model, round, noThink, ok: false, http: 0, err: e.name === 'AbortError' ? 'TIMEOUT' : e.message.slice(0, 80), total: Date.now() - t0 };
  }
}

const med = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

(async () => {
  console.log('Agnes 中国站 · 全文本模型对比（每模型 ' + ROUNDS + ' 轮）\n');
  const all = [];
  for (const m of MODELS) {
    process.stdout.write('── ' + m + '\n');
    const rs = [];
    for (let r = 1; r <= ROUNDS; r++) {
      const res = await one(m, r, false);
      rs.push(res); all.push(res);
      process.stdout.write('   r' + r + '  ' + (res.ok
        ? String(res.total).padStart(6) + 'ms  首字' + String(res.firstContent).padStart(6) + 'ms  ' + String(res.cjk).padStart(4) + '字' + (res.rcjk ? ' 思考' + res.rcjk : '') + (res.empty ? ' ⚠空' : '')
        : 'HTTP' + res.http + '  ' + res.err) + '\n');
    }
    const ok = rs.filter((x) => x.ok);
    if (ok.length) {
      console.log('   → 中位 ' + med(ok.map((x) => x.total)) + 'ms  长度中位 ' + med(ok.map((x) => x.cjk)) + '字  失败 ' + (rs.length - ok.length) + '/' + rs.length);
      console.log('   样本: ' + (ok[0].preview || '') + '…\n');
    } else console.log('   → 全部失败\n');
  }

  console.log('\n════ 汇总排序（按中位耗时）════');
  const bym = {};
  all.forEach((r) => { (bym[r.model] = bym[r.model] || []).push(r); });
  const rows = Object.entries(bym).map(([m, rs]) => {
    const ok = rs.filter((x) => x.ok);
    return { m, n: rs.length, fail: rs.length - ok.length, med: med(ok.map((x) => x.total)), len: med(ok.map((x) => x.cjk)), think: ok.filter((x) => x.rcjk > 0).length, first: med(ok.map((x) => x.firstContent)) };
  }).sort((a, b) => (a.med || 1e9) - (b.med || 1e9));
  console.log('%-26s %8s %8s %8s %8s %s' % ('模型', '中位耗时', '首字中位', '长度中位', '失败', '带思考'));
  console.log('-'.repeat(78));
  rows.forEach((r) => console.log(
    r.m.padEnd(26) + ' ' + (r.med === null ? '   —' : String(r.med + 'ms').padStart(8)) + ' ' +
    (r.first === null ? '   —' : String(r.first + 'ms').padStart(8)) + ' ' +
    (r.len === null ? '   —' : String(r.len + '字').padStart(8)) + ' ' +
    String(r.fail + '/' + r.n).padStart(8) + '  ' + r.think + '/' + (r.n - r.fail)));
})();
