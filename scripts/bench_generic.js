#!/usr/bin/env node
'use strict';

/**
 * 通用模型可用性探测（任意 OpenAI 兼容端点）
 * 用途：确认"无免费额度"的模型到底还能不能调用
 *
 *   BASE=https://dashscope.aliyuncs.com/compatible-mode/v1 KEY_ENV=DASHSCOPE_KEY \
 *   MODELS=qwen-flash,qwen-plus ROUNDS=2 node scripts/bench_generic.js
 */

const BASE = process.env.BASE || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const KEY = process.env[process.env.KEY_ENV || 'DASHSCOPE_KEY'];
if (!KEY) { console.error('缺少 key'); process.exit(1); }
const MODELS = (process.env.MODELS || '').split(',').map((s) => s.trim()).filter(Boolean);
const ROUNDS = Number(process.env.ROUNDS || 2);
const TMO = Number(process.env.TMO || 60000);

const SYS = '你是「向晚问思」，一个以经典哲学、文学与心理学为根基的思辨助手。你不替用户做决定，而是陪他把问题看清、拓展视角，最后把判断留给他自己。请用中文回答。';
const USER = '我今年30岁，工作稳定但总觉得没什么意义，想改变又怕失去现在的一切。我该怎么办？';
const cjk = (s) => (s.match(/[\u4e00-\u9fa5]/g) || []).length;
const med = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

async function one(model, round) {
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TMO);
  let content = '', reasoning = '', usage = null, firstContent = null;
  const body = {
    model, messages: [{ role: 'system', content: SYS }, { role: 'user', content: USER }],
    max_tokens: Number(process.env.MAXTOK || 1200), stream: true, stream_options: { include_usage: true },
  };
  if (process.env.NOTHINK === '1') body.enable_thinking = false;
  try {
    const res = await fetch(BASE + '/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      clearTimeout(timer);
      let msg = t.slice(0, 130);
      try { const j = JSON.parse(t); msg = (j.error && (j.error.message || j.error.code)) || msg; } catch (e) {}
      return { model, round, ok: false, http: res.status, err: String(msg).replace(/\s+/g, ' ').slice(0, 95), total: Date.now() - t0 };
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
    return { model, round, ok: true, firstContent, total: Date.now() - t0, cjk: cjk(content), rcjk: cjk(reasoning), outTok: usage ? usage.completion_tokens : null, empty: content.trim().length === 0 };
  } catch (e) {
    clearTimeout(timer);
    return { model, round, ok: false, http: 0, err: e.name === 'AbortError' ? 'TIMEOUT' : e.message.slice(0, 95), total: Date.now() - t0 };
  }
}

(async () => {
  console.log('探测 ' + MODELS.length + ' 个模型 @ ' + BASE + '（每模型 ' + ROUNDS + ' 轮）\n');
  const all = [];
  for (const m of MODELS) {
    const rs = [];
    for (let r = 1; r <= ROUNDS; r++) {
      const res = await one(m, r);
      rs.push(res); all.push(res);
      if (r === 1 || !res.ok) console.log('  ' + m.padEnd(34) + ' r' + r + '  ' + (res.ok
        ? String(res.total).padStart(6) + 'ms  ' + String(res.cjk).padStart(4) + '字' + (res.empty ? ' ⚠空回答' : '')
        : 'HTTP' + res.http + '  ' + res.err));
    }
    const ok = rs.filter((x) => x.ok);
    console.log('  └─ ' + m.padEnd(32) + (ok.length ? '✅ ' + ok.length + '/' + rs.length + ' 成功，中位 ' + med(ok.map((x) => x.total)) + 'ms' : '❌ 全部失败') + '\n');
  }

  const okAll = all.filter((x) => x.ok);
  console.log('════ 汇总 ════');
  console.log('可用 ' + new Set(okAll.map((x) => x.model)).size + ' / ' + MODELS.length + ' 个模型');
  const bad = [...new Set(all.filter((x) => !x.ok).map((x) => x.model + ' (HTTP' + all.find((y) => y.model === x.model && !y.ok).http + ')'))];
  if (bad.length) console.log('不可用：' + bad.join(', '));
})();
