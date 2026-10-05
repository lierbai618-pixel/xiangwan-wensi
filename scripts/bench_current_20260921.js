#!/usr/bin/env node
'use strict';

/**
 * 「现役模型」对照测试（2026-09-21）
 *
 * 目的：与 bench_bailian_20260921.js 使用**完全相同的题与口径**，
 *      测出生产现役的三个模型，以便与百炼候选清单正面对比。
 *
 * 现役三模型（取自 cloudbaserc.json，⚠️ 该文件与线上可能不同步，见报告说明）：
 *   ① agnes-2.0-flash   @ agnes 代理（order -40，GEN_MODEL=agnes 时首选）
 *   ② qwen-plus         @ 百炼官方（order -30，兜底 1）
 *   ③ step-3.5-flash    @ hcnsec 网关（order 10，最终兜底；think/deep 不入主链）
 *
 * 运行：node scripts/bench_current_20260921.js
 */

const fs = require('fs');
const path = require('path');

// 与主基准完全一致的题面
const GEN_PROMPT =
  '我今年30岁，工作稳定但总觉得没什么意义，想改变又怕失去现在的一切。我该怎么办？';
const SYS_PROMPT =
  '你是「向晚问思」，一个以经典哲学、文学与心理学为根基的思辨助手。你不替用户做决定，而是陪他把问题看清、拓展视角，最后把判断留给他自己。请用中文回答。';

const TARGETS = [
  {
    label: 'agnes-2.0-flash',
    role: '现役 · 生成首选（order -40）',
    baseURL: 'https://apihub.agnes-ai.com/v1',
    apiKey: 'sk-YOUR_API_KEY_HERE',
    model: 'agnes-2.0-flash',
  },
  {
    label: 'qwen-plus',
    role: '现役 · 生成兜底（order -30）',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKey: 'sk-YOUR_API_KEY_HERE',
    model: 'qwen-plus',
  },
  {
    label: 'step-3.5-flash @hcnsec',
    role: '现役 · 最终兜底（order 10）',
    baseURL: 'https://api.hcnsec.cn/v1',
    apiKey: 'sk-YOUR_API_KEY_HERE',
    model: 'step-3.5-flash',
  },
];

const TIMEOUT_MS = 120_000;

async function chat(t) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(t.baseURL + '/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + t.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: t.model,
        messages: [{ role: 'system', content: SYS_PROMPT }, { role: 'user', content: GEN_PROMPT }],
        max_tokens: 1200,
      }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    const ms = Date.now() - t0;
    let json = null;
    try { json = JSON.parse(text); } catch (e) {}
    return { ok: res.ok, status: res.status, ms, json, raw: text };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, json: null, raw: String((e && e.message) || e) };
  } finally {
    clearTimeout(timer);
  }
}

function extract(json) {
  if (!json || !json.choices || !json.choices[0]) return null;
  const m = json.choices[0].message || {};
  const content = m.content || '';
  const reasoning = m.reasoning_content || '';
  return {
    content,
    cjk: (content.match(/[\u4e00-\u9fa5]/g) || []).length,
    reasoningLen: reasoning.length,
    hasThinking: reasoning.length > 0,
    tokens: (json.usage && json.usage.completion_tokens) || null,
    finish: json.choices[0].finish_reason,
  };
}

async function main() {
  const results = [];
  console.log('════ 现役模型对照测试（同题同口径）════\n');

  for (const t of TARGETS) {
    const r = await chat(t);
    const e = extract(r.json);
    const err = (!r.ok && r.json && r.json.error && r.json.error.message) || (!r.ok ? r.raw.slice(0, 100) : '');
    const row = {
      label: t.label,
      role: t.role,
      baseURL: t.baseURL,
      model: t.model,
      ok: r.ok,
      status: r.status,
      ms: r.ms,
      cjk: e ? e.cjk : 0,
      hasThinking: e ? e.hasThinking : null,
      reasoningLen: e ? e.reasoningLen : 0,
      tokens: e ? e.tokens : null,
      finish: e ? e.finish : null,
      err,
    };
    results.push(row);

    if (r.ok && e) {
      console.log(
        `  ✓ ${t.label.padEnd(24)} ${String(r.ms + 'ms').padEnd(10)} ${String(e.cjk + '字').padEnd(8)} ` +
        `思考=${e.hasThinking ? '有(' + e.reasoningLen + '字符)' : '无'}  tokens=${e.tokens}`
      );
    } else {
      console.log(`  ✗ ${t.label.padEnd(24)} ${String(r.ms + 'ms').padEnd(10)} 失败 HTTP=${r.status} ${err.slice(0, 90)}`);
    }
  }

  const outPath = path.join(__dirname, 'bench_current_20260921.json');
  fs.writeFileSync(outPath, JSON.stringify({ generatedAt: new Date().toISOString(), genPrompt: GEN_PROMPT, results }, null, 2), 'utf8');
  console.log(`\n原始数据已写入: ${path.relative(path.join(__dirname, '..'), outPath)}`);
}

main().catch((e) => { console.error('异常:', e); process.exit(1); });
