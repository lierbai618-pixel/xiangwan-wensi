#!/usr/bin/env node
'use strict';
// 检查 DashScope 响应头是否携带额度 / 限流信息
const KEY = process.env.DASHSCOPE_KEY;
const BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const MODELS = (process.env.MODELS || 'qwen-turbo,qwen-flash,qwen-plus,qwen3-30b-a3b-instruct-2507').split(',');

(async () => {
  for (const m of MODELS) {
    try {
      const res = await fetch(BASE + '/chat/completions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: m, messages: [{ role: 'user', content: 'hi' }], max_tokens: 4, stream: false }),
      });
      console.log('════ ' + m + '  HTTP ' + res.status + ' ════');
      const h = {};
      res.headers.forEach((v, k) => { h[k] = v; });
      Object.entries(h).sort().forEach(([k, v]) => console.log('   ' + k + ': ' + v));
      const j = await res.json().catch(() => null);
      if (j && j.usage) console.log('   usage: ' + JSON.stringify(j.usage));
      if (j && j.error) console.log('   error: ' + JSON.stringify(j.error).slice(0, 200));
      console.log('');
    } catch (e) { console.log('════ ' + m + '  ✗ ' + e.message + '\n'); }
  }
})();
