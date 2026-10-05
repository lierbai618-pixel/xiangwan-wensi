#!/usr/bin/env node
'use strict';
// 枚举百炼全部可用模型 id
const KEY = process.env.DASHSCOPE_KEY;
const BASE = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

(async () => {
  const res = await fetch(BASE + '/models', { headers: { Authorization: 'Bearer ' + KEY } });
  console.log('HTTP', res.status);
  const j = await res.json();
  const arr = j.data || j.models || [];
  const ids = arr.map((m) => m.id || m.model || m.name).filter(Boolean).sort();
  console.log('总数:', ids.length);
  console.log(JSON.stringify(ids, null, 0));
})();
