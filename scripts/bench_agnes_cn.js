#!/usr/bin/env node
'use strict';

/**
 * Agnes 中国站实测
 *   Base URL: https://api.agnes-ai.cn/v1 （中国站，与国际站 apihub.agnes-ai.com 不同）
 *
 * 关键验证点：
 *   ① 连通性与鉴权
 *   ② agnes-2.5-flash 真实速度 / 输出长度 / 是否带思考链
 *   ③ 多轮稳定性 + 是否触发 429 限流（国际站的最大问题）
 *   ④ agnes-2.0-flash 是否仍可调用（文档称已废弃）
 *   ⑤ 中国站 /models 列表
 *
 * Key 从环境变量读取，不落盘：
 *   AGNES_CN_KEY=sk-xxx node scripts/bench_agnes_cn.js
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const KEY = process.env.AGNES_CN_KEY;
if (!KEY) { console.error('缺少 AGNES_CN_KEY'); process.exit(1); }

const BASE = 'https://api.agnes-ai.cn/v1';
const ROUNDS = Number(process.env.ROUNDS || 5);
const TMO = Number(process.env.TMO || 90000);

const SYS = '你是「向晚问思」，一个以经典哲学、文学与心理学为根基的思辨助手。你不替用户做决定，而是陪他把问题看清、拓展视角，最后把判断留给他自己。请用中文回答。';
const USER = '我今年30岁，工作稳定但总觉得没什么意义，想改变又怕失去现在的一切。我该怎么办？';
const cjk = (s) => (s.match(/[\u4e00-\u9fa5]/g) || []).length;

async function listModels() {
  try {
    const r = await fetch(BASE + '/models', { headers: { Authorization: 'Bearer ' + KEY } });
    const j = await r.json().catch(() => null);
    const ids = j && (j.data || j.models) ? (j.data || j.models).map((m) => m.id || m.model || m.name) : [];
    return { http: r.status, ids, raw: JSON.stringify(j).slice(0, 200) };
  } catch (e) { return { http: 0, ids: [], raw: e.message }; }
}

async function one(model, round, noThink) {
  const body = {
    model,
    messages: [{ role: 'system', content: SYS }, { role: 'user', content: USER }],
    max_tokens: 1200,
    stream: true,
    stream_options: { include_usage: true },
  };
  // 文档：Thinking 是 opt-in，通过 chat_template_kwargs 开启；此处显式关闭
  if (noThink) body.chat_template_kwargs = { enable_thinking: false };

  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TMO);
  let content = '', reasoning = '', usage = null, ttfb = null, firstContent = null;
  try {
    const res = await fetch(BASE + '/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body), signal: ctl.signal,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      clearTimeout(timer);
      let msg = t.slice(0, 140);
      try { const j = JSON.parse(t); msg = (j.error && (j.error.message || j.error.code)) || j.message || msg; } catch (e) {}
      return { model, round, noThink, ok: false, http: res.status, err: String(msg).replace(/\s+/g, ' ').slice(0, 100), total: Date.now() - t0 };
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
      empty: content.trim().length === 0, preview: content.replace(/\s+/g, ' ').slice(0, 70),
    };
  } catch (e) {
    clearTimeout(timer);
    return { model, round, noThink, ok: false, http: 0, err: e.name === 'AbortError' ? 'TIMEOUT' : e.message.slice(0, 100), total: Date.now() - t0 };
  }
}

(async () => {
  console.log('══ Agnes 中国站 ' + BASE + ' ══\n');

  const lm = await listModels();
  console.log('【/models】HTTP ' + lm.http + '，共 ' + lm.ids.length + ' 个');
  console.log('  ' + (lm.ids.join(', ') || lm.raw) + '\n');

  const all = [];
  for (const [model, label] of [['agnes-2.5-flash', '2.5-flash'], ['agnes-2.0-flash', '2.0-flash(已废弃?)']]) {
    console.log('════ ' + model + ' ════');
    for (const [r, noThink] of [[1, false], [2, false], [3, true], [4, false], [5, false]]) {
      if (r > ROUNDS) break;
      const res = await one(model, r, noThink);
      all.push(res);
      console.log(
        '  r' + r + (noThink ? ' 关思考' : '       ') + ' ' +
        (res.ok
          ? String(res.total).padStart(6) + 'ms  首正文' + String(res.firstContent).padStart(6) + 'ms  ' +
            String(res.cjk).padStart(4) + '字 思考' + String(res.rcjk).padStart(4) + (res.empty ? '  ⚠空回答' : '')
          : 'HTTP' + res.http + '  ' + res.err)
      );
    }
    console.log('');
  }

  const ok = all.filter((x) => x.ok);
  console.log('── 汇总 ──');
  console.log('成功 ' + ok.length + ' / ' + all.length);
  if (ok.length) {
    const times = ok.map((x) => x.total).sort((a, b) => a - b);
    const med = times[times.length >> 1];
    const lens = ok.map((x) => x.cjk).sort((a, b) => a - b);
    const think = ok.filter((x) => x.rcjk > 0).length;
    console.log('耗时  最快 ' + times[0] + 'ms  中位 ' + med + 'ms  最慢 ' + times[times.length - 1] + 'ms');
    console.log('长度  最短 ' + lens[0] + ' 字  中位 ' + lens[lens.length >> 1] + ' 字  最长 ' + lens[lens.length - 1] + ' 字');
    console.log('带思考链的轮次 ' + think + ' / ' + ok.length);
    console.log('\n样本回答：' + (ok[0].preview || '') + '...');
  }
  const fails = all.filter((x) => !x.ok);
  if (fails.length) {
    console.log('\n失败明细：');
    fails.forEach((f) => console.log('  r' + f.round + ' ' + f.model + '  HTTP' + f.http + '  ' + f.err));
  }

  const out = path.join(os.tmpdir(), 'wdws-bench', 'agnes_cn.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), base: BASE, models: lm.ids, runs: all }, null, 2), 'utf8');
  console.log('\n已写出: ' + out);
})();
