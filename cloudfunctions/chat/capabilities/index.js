// ============================================================
// Capability Layer — index.js（模块入口 / 编排器）
//   Phase R：实时工具能力总控。
//
//   调用链：
//     用户输入 → intent router（只读消费冻结 intent.js）
//              → Capability Router（router.js）
//              → Tool（time / weather / calculator / location）
//              → Response Formatter（formatter.js）
//
//   三层边界（必须保持互不侵染）：
//     Capability Layer  实时事实   ← 本模块，绕过 RAG
//     Freshness Layer   现实事件背景 → 供给五段式思辨
//     Knowledge Layer   经典知识     → corpus.json / RAG
//   本模块与后两者零耦合：不读 corpus.json，不做 embedding，
//   不修改任何冻结资产，不向知识库写入任何"时间知识"。
//
//   失败姿态：任何异常一律返回 null → 调用方直落原 generateAnswer。
//   能力层永远是**增量旁路**，不是链路依赖。
// ============================================================
'use strict';

var router = require('./router');
var timeCap = require('./time');
var weatherCap = require('./weather');
var calcCap = require('./calculator');
var locationCap = require('./location');
var formatter = require('./formatter');

var CAPABILITY = router.CAPABILITY;

// 只读引用冻结 intent.js（仅消费结论，不修改、不复制其逻辑）
var classifyIntent = null;
try {
  classifyIntent = require('../intent').classifyIntent;
} catch (e) {
  classifyIntent = null;
}

/** 统一包装为 chat result 形状（与既有链路兼容） */
function wrap(answer, meta) {
  return {
    mode: 'capability',
    answer: answer,
    citations: [],
    route: { dimensions: [], books: [], core: '' },
    retrieval: { queryTerms: [], totalDocuments: 0, minScore: 0, capability: true },
    capability: meta,
    _modelUsed: '',
    _modelStatus: 'tool',
    _modelError: '',
  };
}

// ------------------------------------------------------------
// maybeHandle(message, opts)
//   opts: { history, location }
//   返回：
//     null   → 非能力范畴，调用方继续原链路（零行为变化）
//     result → 能力层已接管（绕过 RAG）
// ------------------------------------------------------------
async function maybeHandle(message, opts) {
  opts = opts || {};
  var query = (message || '').toString().trim();
  if (!query) return null;

  // ① intent router：只读取既有意图层结论（主要用于危机让位）
  var intentInfo = null;
  if (classifyIntent) {
    try {
      intentInfo = classifyIntent(query, opts.history || []);
    } catch (e) {
      intentInfo = null;
    }
  }

  // ② Capability Router
  var decision;
  try {
    decision = router.route(query, { intentInfo: intentInfo });
  } catch (e) {
    return null;
  }
  if (!decision || !decision.hit) return null;

  var meta = {
    capability: decision.capability,
    sub_type: decision.subType,
    confidence: decision.confidence,
    signals: decision.signals || [],
    emotional: !!decision.emotional,
    tool_ok: false,
    tool_reason: '',
    bypass_rag: true,
    timestamp: new Date().toISOString(),
  };

  // ③ Tool 执行
  var toolResult = null;
  try {
    if (decision.capability === CAPABILITY.TIME) {
      toolResult = timeCap.resolve({ subType: decision.subType, query: query, now: opts.now });
    } else if (decision.capability === CAPABILITY.WEATHER) {
      toolResult = await weatherCap.resolve({ subType: decision.subType, query: query });
    } else if (decision.capability === CAPABILITY.CALCULATION) {
      toolResult = calcCap.resolve({ query: query });
    } else if (decision.capability === CAPABILITY.LOCATION) {
      toolResult = locationCap.resolve({
        subType: decision.subType,
        query: query,
        location: opts.location,
      });
    }
  } catch (e) {
    console.error('[capability] 工具执行异常，回退原链路:', e && e.message);
    return null;
  }

  if (!toolResult || !toolResult.fact) return null; // 无可用输出 → 不劫持，交回 RAG

  meta.tool_ok = !!toolResult.ok;
  meta.tool_reason = toolResult.reason || '';

  // ④ Response Formatter
  var formatted = formatter.buildAnswer({
    capability: decision.capability,
    subType: toolResult.subType || decision.subType,
    ok: toolResult.ok,
    fact: toolResult.fact,
    data: toolResult.data,
    query: query,
    emotional: !!decision.emotional,
  });
  if (!formatted.answer) return null;

  meta.has_invite = formatted.hasInvite;
  return wrap(formatted.answer, meta);
}

module.exports = {
  maybeHandle: maybeHandle,
  CAPABILITY: CAPABILITY,
};
