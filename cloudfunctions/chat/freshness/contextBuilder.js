// ============================================================
// Freshness Layer — contextBuilder.js
//   Phase Q / Q0 Policy 落地：event_context 构建。
//
//   政策依据：docs/PhaseQ0-Freshness-Policy.md §3 / §4
//     · normal 级：完整 event_context（status=grounded，需 high/medium 置信）
//     · sensitive 级：status=ambiguous，最多两句最广泛共识事实
//     · restricted 级：禁止生成 event_context（本模块直接拒绝）
//     · low 置信：status=unverified，禁止携带事实
//   纯函数，依赖 schema.js / factExtractor.js 的输出。
// ============================================================
'use strict';

var S = require('./schema');
var EVENT_STATUS = S.EVENT_STATUS;
var SENSITIVITY = S.SENSITIVITY;
var SOURCE_CONFIDENCE = S.SOURCE_CONFIDENCE;

// ============================================================
// buildEventContext({ eventMention, boundary, extraction, results })
//   boundary   : boundaryCheck.checkEvent 的结论
//   extraction : factExtractor.extractFacts 的结论
//   results    : 原始检索结果（用于 sources 列表）
//   返回 event_context；构建失败（校验不过/政策拒绝）返回 null，
//   调用方据此走降级——宁降级，不出残缺上下文。
// ============================================================
function buildEventContext(input) {
  input = input || {};
  var boundary = input.boundary || {};
  var extraction = input.extraction || {};
  var results = Array.isArray(input.results) ? input.results : [];
  var mention = (input.eventMention || '').toString().trim();

  // restricted：禁止生成 event_context（Q0 §3 硬规则）
  if (boundary.level === SENSITIVITY.RESTRICTED) return null;
  if (!mention) return null;

  var confidence = extraction.sourceConfidence || SOURCE_CONFIDENCE.LOW;
  var factTexts = (extraction.factSummary || []).map(function (f) { return f.text; });
  var hasSynthesized = !!extraction.hasSynthesized;

  // 状态机：sensitive 封顶 ambiguous；low 置信只能 unverified
  var status;
  if (boundary.level === SENSITIVITY.SENSITIVE) {
    status = EVENT_STATUS.AMBIGUOUS;
  } else if (confidence === SOURCE_CONFIDENCE.LOW) {
    status = EVENT_STATUS.UNVERIFIED;
  } else if (factTexts.length > 0) {
    status = EVENT_STATUS.GROUNDED;
  } else {
    status = EVENT_STATUS.UNVERIFIED;
  }

  // 按状态裁剪事实：ambiguous ≤ 2 句；unverified 禁止事实（schema 硬规则）。
  //   Q2-16：合成底座虽为 UNVERIFIED，不破例塞事实进 fact_summary（schema 禁止），
  //   改为在 eventContext 上挂 synthesized_text 字段单独承载（见下方），
  //   既尊重「unverified 不携带可核实事实」铁律，又让联网综合内容能流入回答。
  if (status === EVENT_STATUS.AMBIGUOUS) factTexts = factTexts.slice(0, 2);
  if (status === EVENT_STATUS.UNVERIFIED) factTexts = [];

  // sources：仅保留带来源 URL 的条目
  var sources = [];
  for (var i = 0; i < results.length && sources.length < 5; i++) {
    var r = results[i];
    if (r && r.url) {
      sources.push({ title: r.title || '', url: r.url, source: r.source || '', publishedAt: r.publishedAt || '' });
    }
  }

  try {
    var ec = S.makeEventContext({
      eventName: mention.slice(0, 80),
      status: status,
      factSummary: factTexts,
      unknownPoints: extraction.unknownPoints || [],
      sourceConfidence: confidence,
      interpretationBoundary: {
        opinions: extraction.opinions || [],
        unknowns: extraction.unknownPoints || [],
      },
      sources: sources,
    });
    // Q2-16：合成底座标记 + 单独承载联网综合文本（不破 schema 的 unverified 禁事实铁律）
    if (hasSynthesized) {
      ec.synthesized = true;
      var synthText = '';
      for (var ri = 0; ri < results.length; ri++) {
        var r = results[ri];
        if (r && (r.synthesized || r.source === 'bailian-synthesized')) {
          synthText = (r.content || r.snippet || '').toString().trim();
          if (synthText) break;
        }
      }
      if (synthText) ec.synthesized_text = synthText;
    }
    return ec;
  } catch (e) {
    // 校验失败（如 grounded 但事实为空）→ null，走降级
    return null;
  }
}

module.exports = { buildEventContext: buildEventContext };
