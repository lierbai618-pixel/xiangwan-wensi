// ============================================================
// Freshness Layer — factExtractor.js
//   Phase Q / Q0 Policy 落地：事实抽取 + Fact/Interpretation 隔离。
//
//   政策依据：docs/PhaseQ0-Freshness-Policy.md §4（核心铁律）
//     · 事实是事实，解释是解释，观点不是事实，猜测不是原因。
//     · fact_summary 每句必须能映射到来源；映射不上即删除。
//     · unknown_points 必填非空——「没有未知项」本身是危险信号。
//     · 公众观点必须带归属标记，不得当作事实。
//   纯函数、零云依赖，可离线单测。
// ============================================================
'use strict';

var S = require('./schema');
var SOURCE_CONFIDENCE = S.SOURCE_CONFIDENCE;

// 观点 / 解读标记：命中即归入 interpretation_boundary.opinions，永不入 fact_summary
var OPINION_MARKER_RE = /(网友|认为|质疑|指责|声讨|怒批|热议|评论|粉丝|舆论|有人觉得|不少人|很多人表示|观点|评论称)/u;

// 不确定性标记：命中即提示 unknown / 降置信
var UNCERTAINTY_MARKER_RE = /(疑似|网传|据传|据报道|尚未|未公布|待核实|或|可能|有消息称|未经证实)/u;

// 冲突标记：多源表述互相矛盾的提示词
var CONFLICT_MARKER_RE = /(否认|辟谣|反转|不实|澄清|各执一词)/u;

// 按中文句读切句
function splitSentences(text) {
  var parts = (text || '').toString().split(/[。！？!?\n]+/);
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    var s = parts[i].trim();
    if (s.length >= 6) out.push(s);
  }
  return out;
}

// 来源签名：用于独立性判断（不同 source 字段视为独立源）
function sourceKeyOf(r) {
  return (r && (r.source || r.url || r.title)) || 'unknown';
}

// ============================================================
// extractFacts(results)
//   results: eventRetriever 的标准化结果数组
//   返回 {
//     factSummary           : [{ text, sourceUrls, sourceKeys }] 带来源映射的事实句
//     opinions              : string[]  公众观点（归属标记保留）
//     unknownPoints         : string[]  显式未知项（保证非空）
//     sourceConfidence      : high | medium | low
//     hasConflict           : boolean
//     sourceCount           : number    独立来源数
//   }
// ============================================================
function extractFacts(results) {
  var list = Array.isArray(results) ? results : [];
  var facts = [];
  var opinions = [];
  var unknowns = [];
  var sourceKeys = [];
  var hasConflict = false;
  var hasUncertainty = false;
  var hasSynthesized = false;

  for (var i = 0; i < list.length; i++) {
    var r = list[i];
    // Q2-16：百炼合成底座(r.synthesized)——模型联网综合文字，无独立来源 URL，
    //   仍作为事实候选入口(置信降级为 LOW)，但放宽「必须带 URL」硬规则。
    var synth = !!(r && (r.synthesized || r.source === 'bailian-synthesized'));
    if (synth) hasSynthesized = true;
    var skey = sourceKeyOf(r);
    if (sourceKeys.indexOf(skey) < 0) sourceKeys.push(skey);

    var text;
    if (synth) {
      // 合成底座：事实文本在 content 字段（非 title/snippet）
      text = ((r.content || r.snippet || '')).toString();
    } else {
      text = ((r.title || '') + '。' + (r.snippet || '')).toString();
    }
    if (CONFLICT_MARKER_RE.test(text)) hasConflict = true;
    if (UNCERTAINTY_MARKER_RE.test(text)) hasUncertainty = true;

    var sentences = splitSentences(text);
    for (var j = 0; j < sentences.length; j++) {
      var sent = sentences[j];
      if (OPINION_MARKER_RE.test(sent)) {
        // 观点归入解释边界，永不进入事实层
        if (opinions.length < 5 && opinions.indexOf(sent) < 0) opinions.push(sent);
        continue;
      }
      if (UNCERTAINTY_MARKER_RE.test(sent)) {
        // 不确定表述：不进事实层，转为未知项提示
        if (unknowns.length < 5 && unknowns.indexOf(sent) < 0) unknowns.push(sent);
        continue;
      }
      // 事实候选：必须带来源映射（Q0：映射不上即删除）
      //   Q2-16 例外：合成底座放宽 URL 要求，但置信度仍为 LOW（不可核实）。
      var url = (r.url || '').toString();
      if (!url && !synth) continue; // 无 URL 来源的句子不可核实 → 删除
      var exists = false;
      for (var k = 0; k < facts.length; k++) {
        if (facts[k].text === sent) { exists = true; break; }
      }
      if (!exists && facts.length < 8) {
        facts.push({
          text: sent,
          sourceUrls: url ? [url] : [],
          sourceKeys: [skey],
          synthesized: synth
        });
      }
    }
  }

  // 置信度：多独立源 → high；单源或含不确定性标记 → 降级
  var sourceCount = sourceKeys.length;
  var confidence;
  if (sourceCount >= 2 && !hasUncertainty && !hasConflict) {
    confidence = SOURCE_CONFIDENCE.HIGH;
  } else if (sourceCount >= 2) {
    confidence = SOURCE_CONFIDENCE.MEDIUM;
  } else {
    confidence = SOURCE_CONFIDENCE.LOW;
  }

  // Q0 铁律：unknown_points 必须非空
  if (hasConflict) unknowns.push('不同来源的表述存在出入，关键细节以官方通报为准');
  if (unknowns.length === 0) {
    unknowns.push('事件的完整细节与当事人动机目前无法从公开信息中完全确认');
  }

  return {
    factSummary: facts,
    opinions: opinions,
    unknownPoints: unknowns.slice(0, 5),
    sourceConfidence: confidence,
    hasConflict: hasConflict,
    hasSynthesized: hasSynthesized,
    sourceCount: sourceCount,
  };
}

module.exports = {
  extractFacts: extractFacts,
  splitSentences: splitSentences,
  OPINION_MARKER_RE: OPINION_MARKER_RE,
  UNCERTAINTY_MARKER_RE: UNCERTAINTY_MARKER_RE,
  CONFLICT_MARKER_RE: CONFLICT_MARKER_RE,
};
