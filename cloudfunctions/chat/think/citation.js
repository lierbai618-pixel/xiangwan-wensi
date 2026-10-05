// ============================================================
// think/citation.js
//   Phase Q2-3：问思融合引擎 — 引用层。
//
//   职责：把两类来源统一成可展示、可追溯的引用条目：
//     type='fact'    请求级检索事实（外部来源，带 URL）
//     type='classic' RAG 经典引用（内部知识库，只读，无 URL）
//
//   关键边界：
//     · 本模块**不修改** result.citations（那是 RAG 经典引用的既有出口，
//       logQuestion / 前端都在消费它）。融合引用只走 result.think.citations，
//       避免污染既有下游统计。
//     · mock 引用在 allowMock=false 时一律不输出 —— 用户永远看不到 [MOCK]。
//     · 所有产物带 _ephemeral 语义：属于本次响应载荷，不入知识库。
//
//   纯函数、零云依赖、Node 16.13 兼容。
// ============================================================
'use strict';

var MAX_CITATIONS = 8;
var MAX_TITLE_LEN = 60;

function clip(s, n) {
  var t = (s || '').toString().replace(/\s+/g, ' ').trim();
  if (t.length > n) t = t.slice(0, n) + '…';
  return t;
}

function dedupeKeyOf(c) {
  if (!c) return '';
  return ((c.url || '') + '|' + (c.title || '')).toLowerCase();
}

// ============================================================
// buildFactCitations(facts, opts) → Citation[]
//   facts: think/factExtractor 产出的 Fact[]（建议已 filterUsable）
//   opts : { allowMock, max }
// ============================================================
function buildFactCitations(facts, opts) {
  opts = opts || {};
  var allowMock = opts.allowMock === true;
  var max = (typeof opts.max === 'number' && opts.max > 0) ? opts.max : MAX_CITATIONS;
  var list = Array.isArray(facts) ? facts : [];
  var out = [];
  var seen = {};

  for (var i = 0; i < list.length && out.length < max; i++) {
    var f = list[i];
    if (!f || !f.url) continue;
    if (f.isMock && !allowMock) continue; // mock 永不出现在用户可见引用中

    var c = {
      type: 'fact',
      title: clip(f.title || f.statement, MAX_TITLE_LEN),
      url: (f.url || '').toString(),
      source: (f.source || '').toString(),
      time: (f.time || '').toString(),
      confidence: f.confidence || 'low',
    };
    var k = dedupeKeyOf(c);
    if (seen[k]) continue;
    seen[k] = true;
    out.push(c);
  }
  return out;
}

// ============================================================
// buildClassicCitations(ragCitations, opts) → Citation[]
//   ragCitations: rag.js enrichCitations 产出（{ title, tags, ... }）
//   只做只读映射，不修改原数组、不回写知识库。
// ============================================================
function buildClassicCitations(ragCitations, opts) {
  opts = opts || {};
  var max = (typeof opts.max === 'number' && opts.max > 0) ? opts.max : MAX_CITATIONS;
  var list = Array.isArray(ragCitations) ? ragCitations : [];
  var out = [];
  var seen = {};

  for (var i = 0; i < list.length && out.length < max; i++) {
    var r = list[i];
    if (!r) continue;
    var title = clip(r.title || r.book, MAX_TITLE_LEN);
    if (!title) continue;
    var c = { type: 'classic', title: title, url: '', source: '知识库', time: '', confidence: 'high' };
    var k = dedupeKeyOf(c);
    if (seen[k]) continue;
    seen[k] = true;
    out.push(c);
  }
  return out;
}

// ============================================================
// buildUnified({ facts, ragCitations, allowMock }) → Citation[]
//   融合引用：事实在前（时效性），经典在后（解释性），整体去重并截断。
// ============================================================
function buildUnified(input) {
  input = input || {};
  var factCites = buildFactCitations(input.facts, { allowMock: input.allowMock === true });
  var classicCites = buildClassicCitations(input.ragCitations, {});
  var merged = factCites.concat(classicCites);

  var out = [];
  var seen = {};
  for (var i = 0; i < merged.length && out.length < MAX_CITATIONS; i++) {
    var k = dedupeKeyOf(merged[i]);
    if (seen[k]) continue;
    seen[k] = true;
    out.push(merged[i]);
  }
  return out;
}

// ============================================================
// renderFactCitations(citations, opts) → string
//   仅渲染 type='fact' 的外部来源（经典引用已在 RAG 正文中呈现，不重复）。
//   空列表返回空串 → 调用方不追加任何文本。
// ============================================================
function renderFactCitations(citations, opts) {
  opts = opts || {};
  var list = Array.isArray(citations) ? citations : [];
  var facts = [];
  for (var i = 0; i < list.length; i++) {
    if (list[i] && list[i].type === 'fact') facts.push(list[i]);
  }
  if (!facts.length) return '';

  var title = opts.title || '参考来源';
  var lines = ['', '', title + '：'];
  for (var j = 0; j < facts.length; j++) {
    var c = facts[j];
    var tail = [];
    if (c.source) tail.push(c.source);
    if (c.time) tail.push(c.time);
    lines.push((j + 1) + '. ' + c.title + (tail.length ? '（' + tail.join(' · ') + '）' : ''));
  }
  return lines.join('\n');
}

// 供观测用的脱敏摘要（只有计数与类型，不含内容）
function toSafeMeta(citations) {
  var list = Array.isArray(citations) ? citations : [];
  var factCount = 0, classicCount = 0;
  for (var i = 0; i < list.length; i++) {
    if (list[i] && list[i].type === 'fact') factCount++;
    else if (list[i] && list[i].type === 'classic') classicCount++;
  }
  return { total: list.length, fact: factCount, classic: classicCount };
}

module.exports = {
  buildFactCitations: buildFactCitations,
  buildClassicCitations: buildClassicCitations,
  buildUnified: buildUnified,
  renderFactCitations: renderFactCitations,
  toSafeMeta: toSafeMeta,
  MAX_CITATIONS: MAX_CITATIONS,
};
