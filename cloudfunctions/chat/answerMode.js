// ============================================================
// answerMode.js
//   Phase Q2-1：三模式路由解析器（快答/深思/问思）。
//
//   设计依据：docs/Phase-Q2-Mode-Spec.md §4
//   职责：把前端传来的 answerMode（fast/deep/think）解析为「管线指令」。
//   与现有自动路由的关系：
//     · answerMode 显式指定时，覆盖 Freshness 自动 B/C 分类的联网决策。
//     · Capability（时间/天气/计算/位置）优先级最高：由 index.js 派发顺序
//       保证在任何模式之前拦截，本模块不处置 Capability（保持正交）。
//     · 未指定 answerMode → 默认 think（计划书 §风险2：默认问思，守住产品差异化）。
//
//   纯函数、零云依赖、Node16.13 兼容。
// ============================================================
'use strict';

var VALID = { fast: 'fast', deep: 'deep', think: 'think', socratic: 'socratic' };

// 规范化：未知值（含 null/undefined/拼写错误）→ null（调用方据此回退默认）
function normalize(mode) {
  if (!mode) return null;
  var m = ('' + mode).toLowerCase().trim();
  return VALID[m] ? m : null;
}

// resolve(answerMode, ctx) → 管线指令
//   ctx: { query, intent } 可选（intent 预留未来精细化，本阶段不影响路由）
function resolve(answerMode, ctx) {
  ctx = ctx || {};
  var mode = normalize(answerMode) || 'think'; // 默认 think
  var useSearch, useRAG;
  if (mode === 'fast') { useSearch = true; useRAG = false; }
  else if (mode === 'deep') { useSearch = false; useRAG = true; }
  else if (mode === 'socratic') { useSearch = false; useRAG = true; } // 苏格拉底：以经典为依托的追问，不联网
  else { useSearch = true; useRAG = true; } // think

  return {
    effectiveMode: mode,
    pipeline: (useSearch && useRAG) ? 'search+rag' : (useSearch ? 'search' : 'rag'),
    useSearch: useSearch,
    useRAG: useRAG,
    isDefault: !normalize(answerMode),
  };
}

module.exports = { resolve: resolve, normalize: normalize, VALID: VALID };
