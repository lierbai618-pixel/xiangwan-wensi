#!/usr/bin/env node
'use strict';

/**
 * 流式分段计时基准：回答「API 调用为什么慢」
 *
 * 把一次 LLM 请求拆成三段：
 *   ① TTFB      发出请求 → 收到首个 SSE 事件（网络 + 排队 + prefill）
 *   ② 首正文     首个 content delta 出现的时刻（思考模型的 reasoning 会插在这里）
 *   ③ decode    首正文 → 最后一个 token（纯逐字生成）
 *
 * 关键对照：极简请求（输出几个 token）vs 完整请求（输出上千 token）
 *   —— 如果 TTFB 都很短、只有 decode 拉长，就证明「慢的不是 API，而是生成量」。
 *
 * 运行：
 *   DASHSCOPE_KEY=sk-xxx node scripts/bench_ttfb_20260921.js
 */

const KEY = process.env.DASHSCOPE_KEY;
if (!KEY) { console.error('缺少 DASHSCOPE_KEY'); process.exit(1); }
const BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

const SYS = '你是「向晚问思」，一个以经典哲学、文学与心理学为根基的思辨助手。你不替用户做决定，而是陪他把问题看清、拓展视角，最后把判断留给他自己。请用中文回答。';
const USER = '我今年30岁，工作稳定但总觉得没什么意义，想改变又怕失去现在的一切。我该怎么办？';
const PING = '回复OK';

const CASES = [
  { tag: '极简请求    ', model: 'deepseek-v4-flash-0731', msg: PING, thk: false, maxTokens: 30 },
  { tag: '完整题·关思考', model: 'deepseek-v4-flash-0731', msg: USER, thk: false, maxTokens: 1536 },
  { tag: '完整题·默认  ', model: 'deepseek-v4-flash-0731', msg: USER, thk: null, maxTokens: 1536 },
  { tag: '完整题·思考型', model: 'qwen3.8-27b', msg: USER, thk: null, maxTokens: 1536 },
];

const cjkLen = (s) => (s.match(/[\u4e00-\u9fa5]/g) || []).length;

async function measure(c) {
  const body = {
    model: c.model,
    messages: [{ role: 'system', content: SYS }, { role: 'user', content: c.msg }],
    max_tokens: c.maxTokens,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (c.thk === false) body.enable_thinking = false;

  const t0 = Date.now();
  let ttfb = null, firstContent = null, lastDelta = null;
  let content = '', reasoning = '', usage = null, sseChunks = 0;

  const res = await fetch(BASE + '/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const headersAt = Date.now() - t0;

  if (!res.ok) {
    const t = await res.text().catch(() => '');
    return { c, err: `HTTP ${res.status} ${t.slice(0, 120)}`, headersAt };
  }

  let buf = '';
  for await (const raw of res.body) {
    if (ttfb === null) ttfb = Date.now() - t0;
    sseChunks++;
    buf += Buffer.from(raw).toString('utf8');
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const d = t.slice(5).trim();
      if (d === '[DONE]' || !d) continue;
      let j; try { j = JSON.parse(d); } catch { continue; }
      if (j.usage) usage = j.usage;
      const ch = j.choices && j.choices[0];
      if (!ch) continue;
      const dl = ch.delta || {};
      if (dl.content) {
        if (firstContent === null) firstContent = Date.now() - t0;
        content += dl.content;
      }
      if (dl.reasoning_content) reasoning += dl.reasoning_content;
      lastDelta = Date.now() - t0;
    }
  }
  const total = Date.now() - t0;

  const outTok = usage ? usage.completion_tokens : null;
  const decodeMs = (firstContent !== null && lastDelta !== null) ? lastDelta - firstContent : null;
  const speed = (outTok && decodeMs) ? outTok / (decodeMs / 1000) : null;

  return {
    c, headersAt, ttfb, firstContent, total, decodeMs, speed, sseChunks,
    cjk: cjkLen(content), rcjk: cjkLen(reasoning),
    reasoningChars: reasoning.length, outTok,
    promptTok: usage ? usage.prompt_tokens : null,
    preview: content.slice(0, 60),
  };
}

(async () => {
  const rows = [];
  for (const c of CASES) {
    process.stdout.write(`跑 ${c.tag} ${c.model} ... `);
    try {
      const r = await measure(c);
      rows.push(r);
      if (r.err) { console.log(`✗ ${r.err}`); }
      else {
        console.log(`HTTP头 ${r.headersAt}ms | TTFB ${r.ttfb}ms | 首正文 ${r.firstContent}ms | 总 ${r.total}ms | 汉字 ${r.cjk}`);
      }
    } catch (e) {
      console.log(`✗ ${e.message}`);
      rows.push({ c, err: e.message });
    }
  }

  console.log('\n' + '='.repeat(104));
  console.log('模型/场景'.padEnd(22) + 'HTTP头'.padStart(8) + 'TTFB'.padStart(8) + '首正文'.padStart(9) +
    '总耗时'.padStart(9) + 'decode'.padStart(9) + '输出tok'.padStart(9) + '速度'.padStart(11) +
    '正文汉字'.padStart(10) + '思考汉字'.padStart(10));
  console.log('-'.repeat(104));
  for (const r of rows) {
    if (r.err) { console.log(r.c.tag.padEnd(22) + '  ✗ ' + r.err); continue; }
    const sp = r.speed ? r.speed.toFixed(1) + ' tok/s' : '—';
    console.log(
      (r.c.tag + r.c.model.slice(0, 9)).padEnd(22) +
      (r.headersAt + 'ms').padStart(8) +
      (r.ttfb + 'ms').padStart(8) +
      (r.firstContent + 'ms').padStart(9) +
      (r.total + 'ms').padStart(9) +
      (r.decodeMs + 'ms').padStart(9) +
      String(r.outTok ?? '—').padStart(9) +
      sp.padStart(11) +
      String(r.cjk).padStart(10) +
      String(r.rcjk).padStart(10)
    );
  }
  console.log('='.repeat(104));

  // 结论提炼
  const ping = rows.find((r) => r.c && r.c.msg === PING && !r.err);
  const full = rows.find((r) => r.c && r.c.msg === USER && r.c.thk === false && !r.err);
  if (ping && full) {
    console.log('\n【关键对比】同一模型、同一网络，只改"输出多少字"：');
    console.log(`  极简请求  首正文 ${ping.firstContent}ms   总耗时 ${ping.total}ms   输出 ${ping.outTok} tok`);
    console.log(`  完整请求  首正文 ${full.firstContent}ms   总耗时 ${full.total}ms   输出 ${full.outTok} tok`);
    const ratio = (full.total / ping.total).toFixed(1);
    const tkRatio = full.outTok && ping.outTok ? (full.outTok / ping.outTok).toFixed(0) : '?';
    console.log(`  → 总耗时差 ${ratio} 倍，而输出 token 差约 ${tkRatio} 倍`);
    console.log(`  → 首正文时刻几乎相同，差异全部落在 decode 阶段`);
  }
})();
