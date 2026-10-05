#!/usr/bin/env node
'use strict';

/**
 * 阿里云百炼模型选型基准测试（2026-09-21）
 *
 * 目的：从百炼当前目录中，为「向晚问思」两个角色各选出最佳模型
 *   角色 A｜生成模型（gen）：负责最终回答生成
 *     → 首要指标：**延迟**（云函数 GBs 是本项目真实瓶颈，见 CR 报告）
 *     → 次要指标：输出长度是否落在 400–900 字的舒适区
 *     → 关键风险：是否为**思考模型**（会吐 reasoning_content，延迟翻数倍）
 *   角色 B｜联网模型（search）：负责联网检索事实
 *     → 首要指标：是否支持 enable_search / forced_search 真联网
 *
 * 运行：
 *   DASHSCOPE_KEY=sk-xxx node scripts/bench_bailian_20260921.js
 *
 * 说明：Node 22 自带 fetch，无需依赖。密钥经环境变量传入，不落盘。
 */

const fs = require('fs');
const path = require('path');

const BASE = process.env.DASHSCOPE_BASE || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const KEY = process.env.DASHSCOPE_KEY;

// 来自控制台截图的候选清单（12 个）
const CANDIDATES = [
  'qwen3.8-27b',
  'qwen3.7-flash-2026-07-15',
  'qwen3.8-flash',
  'kimi-k3',
  'deepseek-v4-flash-0731',
  'qwen3.8-max-0902',
  'deepseek-v4.1-flash',
  'glm-5.3',
  'deepseek-v4-pro-0813',
  'qwen3.8-2.4t-a95b',
  'qwen3.8-max',
  'qwen3.7-flash',
];

// 产品真实场景题（生活/人生类，契合「先做人再引经」的思辨回答）
const GEN_PROMPT =
  '我今年30岁，工作稳定但总觉得没什么意义，想改变又怕失去现在的一切。我该怎么办？';

const SYS_PROMPT =
  '你是「向晚问思」，一个以经典哲学、文学与心理学为根基的思辨助手。你不替用户做决定，而是陪他把问题看清、拓展视角，最后把判断留给他自己。请用中文回答。';

const PROBE_TIMEOUT_MS = 90_000;
const FULL_TIMEOUT_MS = 150_000;

async function callModel(model, { messages, maxTokens = 1200, extra = {}, timeout = FULL_TIMEOUT_MS }) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(BASE + '/chat/completions', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, ...extra }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    const ms = Date.now() - t0;
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* 非 JSON */ }
    return { ok: res.ok, status: res.status, ms, json, raw: text };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - t0, json: null, raw: String(e && e.message || e) };
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
    contentLen: content.length,
    reasoningLen: reasoning.length,
    hasThinking: reasoning.length > 0,
    usage: json.usage || {},
    finish: json.choices[0].finish_reason,
  };
}

function cjkCount(s) {
  return (s.match(/[\u4e00-\u9fa5]/g) || []).length;
}

async function main() {
  if (!KEY) {
    console.error('缺少 DASHSCOPE_KEY 环境变量');
    process.exit(1);
  }
  console.log(`Base: ${BASE}\n候选模型 ${CANDIDATES.length} 个\n`);

  // ── 阶段 1：可用性探测（极小请求）──────────────────────────
  console.log('════ 阶段 1：可用性探测 ════');
  const available = [];
  for (const model of CANDIDATES) {
    const r = await callModel(model, {
      messages: [{ role: 'user', content: '回复OK' }],
      maxTokens: 64,
      timeout: PROBE_TIMEOUT_MS,
    });
    const e = extract(r.json);
    let verdict;
    if (r.ok) verdict = '可用';
    else {
      const msg = (r.json && r.json.error && r.json.error.message) || r.raw.slice(0, 90);
      verdict = `不可用 (${r.status}) ${msg}`;
    }
    console.log(`  ${r.ok ? '✓' : '✗'} ${model.padEnd(28)} ${String(r.ms + 'ms').padEnd(9)} ${verdict}`);
    if (r.ok) available.push({ model, probeMs: r.ms, probeThinking: e ? e.hasThinking : null });
  }
  console.log(`\n可用 ${available.length} / ${CANDIDATES.length}\n`);

  // ── 阶段 2：生成角色基准（真实场景题）──────────────────────
  console.log('════ 阶段 2：生成角色基准（真实场景题）════');
  console.log('（先测「默认参数」，再测「关思考」，以量化思考链的延迟代价）\n');
  const genResults = [];

  for (const item of available) {
    const model = item.model;

    // 2a 默认参数
    const r1 = await callModel(model, {
      messages: [{ role: 'system', content: SYS_PROMPT }, { role: 'user', content: GEN_PROMPT }],
    });
    const e1 = extract(r1.json);
    const row = {
      model,
      defaultMs: r1.ms,
      defaultOk: r1.ok,
      defaultCjk: e1 ? cjkCount(e1.content) : 0,
      defaultHasThinking: e1 ? e1.hasThinking : null,
      defaultReasoningChars: e1 ? e1.reasoningLen : 0,
      defaultTokens: e1 ? e1.usage.completion_tokens || null : null,
      noThinkMs: null,
      noThinkCjk: 0,
      noThinkOk: null,
      noThinkNote: '',
    };

    // 2b 尝试关闭思考（仅当默认确实产生了思考）
    if (row.defaultHasThinking) {
      const r2 = await callModel(model, {
        messages: [{ role: 'system', content: SYS_PROMPT }, { role: 'user', content: GEN_PROMPT }],
        extra: { enable_thinking: false },
      });
      const e2 = extract(r2.json);
      row.noThinkOk = r2.ok;
      row.noThinkMs = r2.ms;
      row.noThinkCjk = e2 ? cjkCount(e2.content) : 0;
      row.noThinkStillThinking = e2 ? e2.hasThinking : null;
      if (!r2.ok) row.noThinkNote = '参数被拒: ' + ((r2.json && r2.json.error && r2.json.error.message) || r2.raw).slice(0, 80);
    }

    genResults.push(row);
    console.log(
      `  ${model.padEnd(28)} 默认 ${String(row.defaultMs + 'ms').padEnd(9)} ${String(row.defaultCjk + '字').padEnd(7)}` +
      `思考=${row.defaultHasThinking ? '有(' + row.defaultReasoningChars + '字符)' : '无'}` +
      (row.noThinkMs !== null ? `  | 关思考 ${row.noThinkMs}ms ${row.noThinkCjk}字` : '')
    );
  }

  // ── 阶段 3：联网能力探测 ──────────────────────────────────
  console.log('\n════ 阶段 3：联网能力探测（enable_search + forced_search）════');
  const searchResults = [];
  for (const item of available) {
    const model = item.model;
    const r = await callModel(model, {
      messages: [{ role: 'user', content: '2026年9月21日有什么值得关注的科技新闻？只列事实。' }],
      maxTokens: 600,
      extra: { enable_search: true, search_options: { forced_search: true } },
      timeout: 120_000,
    });
    const e = extract(r.json);
    const body = e ? e.content : '';
    // 判定：是否出现具体时效信息（年份/日期/具体事件名），而非泛泛而谈
    const hasDate = /2026|9月|今日|本周/.test(body);
    const looksGrounded = hasDate && body.length > 80;
    const err = (!r.ok && r.json && r.json.error && r.json.error.message) || '';
    searchResults.push({ model, ok: r.ok, ms: r.ms, grounded: looksGrounded, len: body.length, err: err.slice(0, 70) });
    console.log(
      `  ${r.ok ? '✓' : '✗'} ${model.padEnd(28)} ${String(r.ms + 'ms').padEnd(9)} ` +
      `${looksGrounded ? '疑似真联网' : '未检出时效信息'} ${err ? '(' + err + ')' : ''}`
    );
  }

  // ── 输出 ─────────────────────────────────────────────────
  const out = {
    generatedAt: new Date().toISOString(),
    base: BASE,
    genPrompt: GEN_PROMPT,
    available: available.map((a) => a.model),
    genResults,
    searchResults,
  };
  const outPath = path.join(__dirname, 'bench_bailian_20260921.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(`\n原始数据已写入: ${path.relative(path.join(__dirname, '..'), outPath)}`);
}

main().catch((e) => {
  console.error('基准测试异常:', e);
  process.exit(1);
});
