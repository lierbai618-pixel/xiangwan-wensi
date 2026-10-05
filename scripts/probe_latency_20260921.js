#!/usr/bin/env node
'use strict';
// 补充探针：qwen-plus 状态 + RAG 上下文长度对首字节的影响
const KEY = process.env.DASHSCOPE_KEY;
const BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const SYS = '你是「向晚问思」，一个以经典哲学、文学与心理学为根基的思辨助手。请用中文回答。';
const USER = '我今年30岁，工作稳定但总觉得没什么意义，我该怎么办？';

async function probe(label, model, extraMsgs, opts) {
  opts = opts || {};
  const body = {
    model: model,
    messages: [{ role: 'system', content: SYS }].concat(extraMsgs).concat([{ role: 'user', content: USER }]),
    max_tokens: opts.maxTokens || 40,
    stream: true,
    stream_options: { include_usage: true },
  };
  if (opts.thk === false) body.enable_thinking = false;
  const t0 = Date.now();
  try {
    const res = await fetch(BASE + '/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const ttfb = Date.now() - t0;
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      console.log(label + '  HTTP ' + res.status + '  ' + t.slice(0, 160));
      return;
    }
    let buf = '', usage = null, firstContent = null;
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
        if (ch && ch.delta && ch.delta.content && firstContent === null) firstContent = Date.now() - t0;
      }
    }
    console.log(
      label.padEnd(28) +
      ' TTFB ' + String(ttfb).padStart(5) + 'ms' +
      '  首正文 ' + String(firstContent === null ? '-' : firstContent + 'ms').padStart(7) +
      '  prompt_tok=' + (usage ? usage.prompt_tokens : '-')
    );
  } catch (e) { console.log(label.padEnd(28) + ' ✗ ' + e.message); }
}

const RAG_A = '《论语·为政》：三十而立。'.repeat(9);
const RAG_B = '【参考资料】' + '《论语·为政》原文：子曰，吾十有五而志于学，三十而立，四十而不惑，五十而知天命。解读：此章言进德之序，非言年岁之限。'.repeat(20);
const mk = (ctx) => [{ role: 'system', content: ctx }];

(async () => {
  console.log('=== ① qwen-plus 当前状态（额度 / 限流） ===');
  await probe('qwen-plus', 'qwen-plus', [], { maxTokens: 20 });

  console.log('\n=== ② RAG 上下文长度对首字节的影响（deepseek, 关思考） ===');
  console.log('   上下文长度: 无 / ' + RAG_A.length + ' 字 / ' + RAG_B.length + ' 字');
  await probe('无 RAG 上下文', 'deepseek-v4-flash-0731', [], { thk: false });
  await probe('RAG 短上下文', 'deepseek-v4-flash-0731', mk(RAG_A), { thk: false });
  await probe('RAG 长上下文', 'deepseek-v4-flash-0731', mk(RAG_B), { thk: false });

  console.log('\n=== ③ 思考开关重复验证（同一题） ===');
  await probe('关思考 run1', 'deepseek-v4-flash-0731', [], { thk: false });
  await probe('关思考 run2', 'deepseek-v4-flash-0731', [], { thk: false });
  await probe('默认   run1', 'deepseek-v4-flash-0731', [], {});
})();
