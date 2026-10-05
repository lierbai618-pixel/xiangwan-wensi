#!/usr/bin/env node
'use strict';

/**
 * Agnes 中国站 · 压力测试（验证限流阈值与速度衰减）
 * 连续 N 次同题请求，记录每次结果、间隔、是否 429
 *   AGNES_CN_KEY=sk-xxx N=20 node scripts/bench_agnes_stress.js
 */

const KEY = process.env.AGNES_CN_KEY;
if (!KEY) { console.error('缺少 AGNES_CN_KEY'); process.exit(1); }
const BASE = 'https://api.agnes-ai.cn/v1';
const N = Number(process.env.N || 20);
const MODEL = process.env.MODEL || 'agnes-2.5-flash';
const GAP = Number(process.env.GAP || 0);   // 每次间隔 ms

const SYS = '你是「向晚问思」，一个以经典哲学、文学与心理学为根基的思辨助手。你不替用户做决定，而是陪他把问题看清、拓展视角，最后把判断留给他自己。请用中文回答。';
const USER = '我今年30岁，工作稳定但总觉得没什么意义，想改变又怕失去现在的一切。我该怎么办？';
const cjk = (s) => (s.match(/[\u4e00-\u9fa5]/g) || []).length;

async function once(i) {
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 90000);
  let content = '', reasoning = '', usage = null, firstContent = null;
  try {
    const res = await fetch(BASE + '/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'system', content: SYS }, { role: 'user', content: USER }],
        max_tokens: 1200, stream: true, stream_options: { include_usage: true },
      }),
      signal: ctl.signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      clearTimeout(timer);
      let msg = t.slice(0, 90);
      try { const j = JSON.parse(t); msg = (j.error && (j.error.message || j.error.code)) || msg; } catch (e) {}
      return { i, ok: false, http: res.status, err: String(msg).replace(/\s+/g, ' ').slice(0, 80), total: Date.now() - t0 };
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
        if (ch && ch.delta && ch.delta.content) { if (firstContent === null) firstContent = Date.now() - t0; content += ch.delta.content; }
        if (ch && ch.delta && ch.delta.reasoning_content) reasoning += ch.delta.reasoning_content;
      }
    }
    clearTimeout(timer);
    return { i, ok: true, firstContent, total: Date.now() - t0, cjk: cjk(content), rcjk: cjk(reasoning), outTok: usage ? usage.completion_tokens : null };
  } catch (e) {
    clearTimeout(timer);
    return { i, ok: false, http: 0, err: e.name === 'AbortError' ? 'TIMEOUT' : e.message.slice(0, 80), total: Date.now() - t0 };
  }
}

(async () => {
  console.log('压力测试：' + MODEL + ' @ ' + BASE + '  共 ' + N + ' 次，间隔 ' + GAP + 'ms\n');
  const rows = [];
  const t0 = Date.now();
  for (let i = 1; i <= N; i++) {
    const r = await once(i);
    rows.push(r);
    const bar = r.ok ? String(r.total).padStart(6) + 'ms  首字' + String(r.firstContent).padStart(6) + 'ms  ' + String(r.cjk).padStart(4) + '字' + (r.rcjk ? ' 思考' + r.rcjk : '')
                     : 'HTTP' + r.http + '  ' + r.err;
    console.log('  #' + String(i).padStart(2) + '  ' + bar);
    if (GAP) await new Promise((r) => setTimeout(r, GAP));
  }
  const ok = rows.filter((r) => r.ok);
  const bad = rows.filter((r) => !r.ok);
  const times = ok.map((r) => r.total).sort((a, b) => a - b);
  console.log('\n── 汇总（总耗时 ' + Math.round((Date.now() - t0) / 1000) + 's）──');
  console.log('成功 ' + ok.length + ' / ' + rows.length + (bad.length ? '   失败 ' + bad.length + ' 次' : '   ✅ 零失败'));
  if (bad.length) {
    const byCode = {};
    bad.forEach((b) => { byCode['HTTP' + b.http] = (byCode['HTTP' + b.http] || 0) + 1; });
    console.log('失败分布：' + JSON.stringify(byCode));
    console.log('首次失败在第 ' + bad[0].i + ' 次');
  }
  if (ok.length) {
    console.log('耗时  最快 ' + times[0] + 'ms  中位 ' + times[times.length >> 1] + 'ms  最慢 ' + times[times.length - 1] + 'ms');
    console.log('首字  最快 ' + Math.min(...ok.map((r) => r.firstContent)) + 'ms  最慢 ' + Math.max(...ok.map((r) => r.firstContent)) + 'ms');
    const lens = ok.map((r) => r.cjk).sort((a, b) => a - b);
    console.log('长度  最短 ' + lens[0] + ' 字  中位 ' + lens[lens.length >> 1] + ' 字  最长 ' + lens[lens.length - 1] + ' 字');
    console.log('带思考链 ' + ok.filter((r) => r.rcjk > 0).length + ' / ' + ok.length + ' 轮');
  }
})();
