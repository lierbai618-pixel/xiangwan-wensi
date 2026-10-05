#!/usr/bin/env node
'use strict';
// qwen-plus 可用性复核：跑 3 次完整调用，看能否出完整正文
const KEY = process.env.DASHSCOPE_KEY;
const BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const SYS = '你是「向晚问思」，一个以经典哲学、文学与心理学为根基的思辨助手。你不替用户做决定，而是陪他把问题看清、拓展视角，最后把判断留给他自己。请用中文回答。';
const USER = '我今年30岁，工作稳定但总觉得没什么意义，想改变又怕失去现在的一切。我该怎么办？';

async function run(i) {
  const t0 = Date.now();
  let content = '', reasoning = '', usage = null, firstContent = null;
  try {
    const res = await fetch(BASE + '/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen-plus',
        messages: [{ role: 'system', content: SYS }, { role: 'user', content: USER }],
        max_tokens: 1536, stream: true, stream_options: { include_usage: true },
      }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      console.log('run' + i + '  ✗ HTTP ' + res.status + '  ' + t.slice(0, 200));
      return;
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
    const total = Date.now() - t0;
    const cjk = (content.match(/[\u4e00-\u9fa5]/g) || []).length;
    const rcjk = (reasoning.match(/[\u4e00-\u9fa5]/g) || []).length;
    console.log(
      'run' + i +
      '  总 ' + String(total).padStart(6) + 'ms' +
      '  首正文 ' + String(firstContent === null ? '-' : firstContent + 'ms').padStart(7) +
      '  正文 ' + String(cjk).padStart(4) + ' 汉字' +
      '  思考 ' + String(rcjk).padStart(4) + ' 汉字' +
      '  tok=' + (usage ? usage.completion_tokens : '-')
    );
    if (i === 1) console.log('    片段: ' + (content.slice(0, 70) || '(空)'));
  } catch (e) {
    console.log('run' + i + '  ✗ ' + e.message);
  }
}

(async () => {
  console.log('=== qwen-plus 完整调用复核 ===');
  for (let i = 1; i <= 3; i++) await run(i);
})();
