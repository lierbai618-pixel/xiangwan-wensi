#!/usr/bin/env node
'use strict';

/**
 * 百炼全模型扫描 · 阶段 A：可用性 + 首字节
 *
 * 1) 从 /v1/models 拉全部 259 个 id
 * 2) 排除非文本生成类（图像/TTS/ASR/VL/OCR/向量/重排/实时/翻译/数学/代码）
 * 3) 对剩余候选发极简请求（max_tokens=16），并发 6
 * 4) 同时测「项目现役」模型（agnes / hcnsec / dashscope）
 *
 * 输出：JSON（供阶段 B 消费）+ 控制台表格
 */

const fs = require('fs');
const path = require('path');

const DASHSCOPE_KEY = process.env.DASHSCOPE_KEY;
const AGNES_KEY = process.env.AGNES_KEY;
const HCNSEC_KEY = process.env.HCNSEC_KEY;

const BAILIAN = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const AGNES = 'https://apihub.agnes-ai.com/v1';
const HCNSEC = 'https://api.hcnsec.cn/v1';

const EXCLUDE = /image|tts|asr|speech|vl-|vl_|ocr|embedding|rerank|realtime|omni|audio|math|coder|mt-|livetranslate|wan\d|z-image|gui-plus|test-|sre-|qvq|unisound|fun-asr/i;

const EXTRA_EXCLUDE = new Set(['qwen-deep-research-2025-12-15', 'qwen-deep-search-planning']);

async function listBailian() {
  const res = await fetch(BAILIAN + '/models', { headers: { Authorization: 'Bearer ' + DASHSCOPE_KEY } });
  const j = await res.json();
  return (j.data || []).map((m) => m.id).filter(Boolean);
}

async function probe(base, key, model, timeoutMs) {
  const t0 = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs || 30000);
  try {
    const res = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model,
        messages: [{ role: 'user', content: '回复OK' }],
        max_tokens: 16,
        stream: true,
      }),
      signal: ctl.signal,
    });
    const ttfb = Date.now() - t0;
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      clearTimeout(timer);
      let msg = txt.slice(0, 200);
      try { const j = JSON.parse(txt); msg = (j.error && (j.error.message || j.error.code)) || j.message || msg; } catch (e) {}
      return { model, base, ok: false, http: res.status, ttfb, err: String(msg).replace(/\s+/g, ' ').slice(0, 120) };
    }
    // 读掉流，确认能完整返回
    let txt = '';
    for await (const c of res.body) txt += Buffer.from(c).toString('utf8');
    clearTimeout(timer);
    const total = Date.now() - t0;
    const hasReasoning = /"reasoning_content"/.test(txt);
    const hasDone = /\[DONE\]/.test(txt);
    return { model, base, ok: true, http: res.status, ttfb, total, hasReasoning, hasDone };
  } catch (e) {
    clearTimeout(timer);
    return { model, base, ok: false, http: 0, ttfb: Date.now() - t0, err: e.name === 'AbortError' ? 'TIMEOUT' : e.message.slice(0, 120) };
  }
}

async function pool(items, limit, worker) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await worker(items[idx], idx);
      }
    })
  );
  return out;
}

(async () => {
  const all = await listBailian();
  const cands = all.filter((m) => !EXCLUDE.test(m) && !EXTRA_EXCLUDE.has(m)).sort();
  console.log('百炼总模型 ' + all.length + ' → 文本生成候选 ' + cands.length);
  console.log('候选：' + cands.join(', '));
  console.log('\n开始探测（并发 6）...\n');

  let done = 0;
  const rows = await pool(cands, 6, async (m) => {
    const r = await probe(BAILIAN, DASHSCOPE_KEY, m, 45000);
    done++;
    process.stdout.write(
      '[' + String(done).padStart(3) + '/' + cands.length + '] ' +
      (r.ok ? '✓' : '✗') + ' ' + m.padEnd(38) + ' ' +
      (r.ok ? r.ttfb + 'ms' : 'HTTP' + r.http + ' ' + r.err) + '\n'
    );
    return r;
  });

  console.log('\n—— 项目现役模型（非百炼）——');
  const legacy = [];
  const legacyDefs = [
    { base: AGNES, key: AGNES_KEY, model: 'agnes-2.0-flash' },
    { base: AGNES, key: AGNES_KEY, model: 'agnes-2.5-flash' },
    { base: AGNES, key: AGNES_KEY, model: 'agnes-2.5-pro' },
    { base: HCNSEC, key: HCNSEC_KEY, model: 'step-3.5-flash' },
  ];
  for (const d of legacyDefs) {
    const r = await probe(d.base, d.key, d.model, 45000);
    legacy.push(r);
    console.log((r.ok ? '✓' : '✗') + ' ' + (d.model + ' @' + new URL(d.base).host).padEnd(46) + (r.ok ? r.ttfb + 'ms' : 'HTTP' + r.http + ' ' + r.err));
  }

  const okRows = rows.filter((r) => r.ok);
  const failRows = rows.filter((r) => !r.ok);
  console.log('\n百炼候选：可用 ' + okRows.length + ' / 不可用 ' + failRows.length);
  if (failRows.length) {
    console.log('\n不可用明细：');
    failRows.forEach((r) => console.log('  ' + r.model.padEnd(38) + ' HTTP' + r.http + '  ' + r.err));
  }
  const reasoning = okRows.filter((r) => r.hasReasoning).map((r) => r.model);
  console.log('\n极简请求即返回思考链的模型（' + reasoning.length + '）：' + (reasoning.join(', ') || '无'));

  const outPath = path.join(__dirname, '..', '.bench', 'stageA.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), bailian: rows, legacy }, null, 2), 'utf8');
  console.log('\n已写出: ' + outPath);
})();
