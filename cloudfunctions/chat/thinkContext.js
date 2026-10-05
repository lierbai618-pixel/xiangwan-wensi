// ============================================================
// thinkContext.js
//   Phase Q2-1：ThinkContext 数据结构（问思模式「事实+知识+思想」融合上下文）。
//
//   设计依据：docs/Phase-Q2-Data-Isolation.md §2（search_context 请求级生命周期）
//   核心约束（数据隔离硬规则）：
//     · 仅存在于「一次请求处理」的内存中，随函数返回被 GC，
//       绝不写入 corpus / embedding / metadata / history / 任何持久化 KB。
//     · _ephemeral=true 是硬编码标记：任何序列化/落库逻辑都应拒绝它。
//     · 不得被 JSON.stringify 后作为知识沉淀（测试断言 corpus SHA 不变）。
//
//   结构：
//     mode         fast / deep / think（默认 think）
//     query        原始问题
//     facts[]      来自 Search Provider 的检索结果（请求级，外部事实）
//     knowledge[]  来自 RAG 检索的引用（只读调用，不修改 KB）
//     reasoning    思想层占位（假设/开放问题），由融合引擎填充（Q2-3）
//   纯函数、零云依赖、Node16.13 兼容。
// ============================================================
'use strict';

var DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 分钟（思考上下文比事实更长，但仍 ephemeral）

function isNonEmptyString(s) {
  return typeof s === 'string' && s.trim().length > 0;
}

// makeThinkContext(fields) → 请求级融合上下文
//   fields: { mode, query, facts[], knowledge[], ttlMs }
function makeThinkContext(fields) {
  fields = fields || {};
  var now = new Date();
  var ttlMs = (typeof fields.ttlMs === 'number' && fields.ttlMs > 0) ? fields.ttlMs : DEFAULT_TTL_MS;
  return {
    mode: fields.mode === 'fast' ? 'fast' : (fields.mode === 'deep' ? 'deep' : 'think'),
    query: (fields.query || '').toString(),
    // 外部事实（搜索结果）：仅引用，不沉淀
    facts: Array.isArray(fields.facts)
      ? fields.facts.filter(function (f) { return f && (f.title || f.snippet); })
      : [],
    // 经典知识（RAG 检索）：只读，不修改
    knowledge: Array.isArray(fields.knowledge)
      ? fields.knowledge.filter(function (k) { return k && (k.title || k.text); })
      : [],
    // 思想层占位（Q2-3 融合引擎填充）
    reasoning: { hypotheses: [], openQuestions: [] },
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + ttlMs).toISOString(),
    _ephemeral: true, // 禁止序列化入 KB 的硬标记
  };
}

// isFresh(ctx, nowMs) → 是否仍在生命周期内
function isFresh(ctx, nowMs) {
  if (!ctx || !ctx.expires_at) return false;
  var now = (typeof nowMs === 'number') ? nowMs : Date.now();
  return Date.parse(ctx.expires_at) > now;
}

// toSafeMeta(ctx) → 仅用于观测日志的脱敏元信息（不含事实内容），绝不进 corpus
function toSafeMeta(ctx) {
  if (!ctx) return null;
  return {
    mode: ctx.mode,
    query_len: (ctx.query || '').length,
    facts_count: (ctx.facts || []).length,
    knowledge_count: (ctx.knowledge || []).length,
    _ephemeral: true,
  };
}

module.exports = {
  makeThinkContext: makeThinkContext,
  isFresh: isFresh,
  toSafeMeta: toSafeMeta,
  DEFAULT_TTL_MS: DEFAULT_TTL_MS,
};
