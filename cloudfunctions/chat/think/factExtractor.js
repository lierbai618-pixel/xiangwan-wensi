// ============================================================
// think/factExtractor.js
//   Phase Q2-3：问思融合引擎 — 事实抽取层（请求级）。
//
//   与 freshness/factExtractor.js 的区别（两者并存、互不替代）：
//     · freshness/factExtractor  面向「热点事件」，产出 fact_summary /
//       opinions / unknown_points 五段式素材，服务 Category B 链路。
//     · think/factExtractor（本文件）面向「三模式融合」，把 Search Provider
//       的统一结果规整成**带来源与置信的原子事实 Fact[]**，服务 fast/think。
//
//   硬约束（docs/Phase-Q2-Data-Isolation.md §2 / Q2-3 授权条款）：
//     · 输出对象一律带 _ephemeral=true，仅存在于单次请求内存。
//     · 绝不写 corpus / embedding / metadata / 任何知识库集合。
//     · mock 结果（[MOCK] / mock.local）必须可识别并默认被过滤，
//       mock 永远不服务真实用户 —— 这是「禁止接真实搜索」期的安全底线。
//     · 无 URL 的条目不可核实 → 直接丢弃（Q0 铁律：映射不上即删除）。
//
//   纯函数、零云依赖、零网络、Node 16.13 兼容（无可选链 / 无空值合并）。
// ============================================================
'use strict';

// mock 识别：标题/摘要含 [MOCK] 或来源域名为 mock.local
var MOCK_RE = /\[MOCK\]|mock\.local/i;

// 不确定性标记：命中即降置信，绝不当作确定事实
var UNCERTAINTY_RE = /(疑似|网传|据传|据报道|尚未|未公布|待核实|可能|有消息称|未经证实|传闻)/u;

// 观点标记：命中即标记为 opinion，不参与事实置信度计算
var OPINION_RE = /(网友|认为|质疑|指责|热议|评论|粉丝|舆论|有人觉得|不少人|观点)/u;

var MAX_STATEMENT_LEN = 140;
var DEFAULT_MAX_FACTS = 6;

function isMockResult(r) {
  if (!r) return false;
  var blob = '' + (r.title || '') + (r.snippet || '') + (r.url || '') + (r.source || '');
  return MOCK_RE.test(blob);
}

// 语句规整：压缩空白、截断、去掉首尾标点噪声
function normStatement(s) {
  var t = (s || '').toString().replace(/\s+/g, ' ').trim();
  if (t.length > MAX_STATEMENT_LEN) t = t.slice(0, MAX_STATEMENT_LEN) + '…';
  return t;
}

function hostOf(url) {
  var u = (url || '').toString();
  var m = u.match(/^https?:\/\/([^/?#]+)/i);
  return m ? m[1] : '';
}

// 来源签名：判断「独立来源数」用
function sourceKeyOf(r) {
  if (!r) return 'unknown';
  return (r.source || hostOf(r.url) || r.title || 'unknown').toString().toLowerCase();
}

// ============================================================
// extractFacts(results, opts)
//   results : Search Provider 统一形状的 results[]
//   opts    : { maxFacts, allowMock }
//   返回    : {
//     facts        : Fact[]  见下
//     mockCount    : number  被识别为 mock 的条目数
//     hasMock      : boolean
//     sourceCount  : number  独立来源数（不含 mock，除非 allowMock）
//     droppedNoUrl : number  因无 URL 被丢弃的条目数
//     _ephemeral   : true    禁入 KB 硬标记
//   }
//
//   Fact = {
//     id, statement, title, url, source, time,
//     isMock, isOpinion, uncertain, confidence: high|medium|low
//   }
// ============================================================
function extractFacts(results, opts) {
  opts = opts || {};
  var allowMock = opts.allowMock === true;
  var maxFacts = (typeof opts.maxFacts === 'number' && opts.maxFacts > 0) ? opts.maxFacts : DEFAULT_MAX_FACTS;

  var list = Array.isArray(results) ? results : [];
  var facts = [];
  var seen = {};          // 去重：statement 归一化后
  var sourceKeys = [];
  var mockCount = 0;
  var droppedNoUrl = 0;

  for (var i = 0; i < list.length; i++) {
    var r = list[i];
    if (!r) continue;

    var mock = isMockResult(r);
    if (mock) mockCount++;

    var url = (r.url || '').toString().trim();
    if (!url) { droppedNoUrl++; continue; } // 不可核实 → 删除

    var statement = normStatement(r.snippet || r.title);
    if (!statement) continue;

    var dedupeKey = statement.toLowerCase();
    if (seen[dedupeKey]) continue;
    seen[dedupeKey] = true;

    var blob = '' + (r.title || '') + '。' + (r.snippet || '');
    var uncertain = UNCERTAINTY_RE.test(blob);
    var isOpinion = OPINION_RE.test(blob);

    var skey = sourceKeyOf(r);
    // 仅可用来源参与独立性统计（mock 在不允许时不计入）
    if ((!mock || allowMock) && sourceKeys.indexOf(skey) < 0) sourceKeys.push(skey);

    facts.push({
      id: 'f' + (facts.length + 1),
      statement: statement,
      title: normStatement(r.title),
      url: url,
      source: (r.source || hostOf(url) || '').toString(),
      time: (r.time || '').toString(),
      isMock: mock,
      isOpinion: isOpinion,
      uncertain: uncertain,
      confidence: 'low', // 占位，下方按独立源数统一回填
    });

    if (facts.length >= maxFacts) break;
  }

  // 置信度回填：≥2 独立来源且无不确定标记 → high；≥2 来源 → medium；否则 low
  var sourceCount = sourceKeys.length;
  for (var j = 0; j < facts.length; j++) {
    var f = facts[j];
    if (f.uncertain || f.isOpinion) f.confidence = 'low';
    else if (sourceCount >= 2) f.confidence = 'high';
    else f.confidence = 'medium';
  }

  return {
    facts: facts,
    mockCount: mockCount,
    hasMock: mockCount > 0,
    sourceCount: sourceCount,
    droppedNoUrl: droppedNoUrl,
    _ephemeral: true,
  };
}

// ============================================================
// filterUsable(facts, opts)
//   把「可用于生成」的事实筛出来。默认硬拦 mock —— 这是 mock 永不服务
//   真实用户的最后一道闸（上层 thinkEngine 还有一道 provider 级闸）。
//   opts: { allowMock, allowOpinion }
// ============================================================
function filterUsable(facts, opts) {
  opts = opts || {};
  var allowMock = opts.allowMock === true;
  var allowOpinion = opts.allowOpinion === true;
  var list = Array.isArray(facts) ? facts : [];
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var f = list[i];
    if (!f || !f.statement || !f.url) continue;
    if (f.isMock && !allowMock) continue;
    if (f.isOpinion && !allowOpinion) continue;
    out.push(f);
  }
  return out;
}

// ============================================================
// toEphemeralFacts(facts)
//   转成 ThinkContext.facts 接受的形状（title/snippet），
//   仍是请求级引用，不做任何持久化。
// ============================================================
function toEphemeralFacts(facts) {
  var list = Array.isArray(facts) ? facts : [];
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var f = list[i];
    if (!f) continue;
    out.push({
      title: f.title || '',
      snippet: f.statement || '',
      url: f.url || '',
      source: f.source || '',
      time: f.time || '',
      _ephemeral: true,
    });
  }
  return out;
}

// 汇总置信：用于上层决定是否值得进入事实层叙述
function aggregateConfidence(facts) {
  var list = Array.isArray(facts) ? facts : [];
  if (!list.length) return 'none';
  var hasHigh = false, hasMedium = false;
  for (var i = 0; i < list.length; i++) {
    if (list[i].confidence === 'high') hasHigh = true;
    else if (list[i].confidence === 'medium') hasMedium = true;
  }
  if (hasHigh) return 'high';
  if (hasMedium) return 'medium';
  return 'low';
}

module.exports = {
  extractFacts: extractFacts,
  filterUsable: filterUsable,
  toEphemeralFacts: toEphemeralFacts,
  aggregateConfidence: aggregateConfidence,
  isMockResult: isMockResult,
  normStatement: normStatement,
  MOCK_RE: MOCK_RE,
  UNCERTAINTY_RE: UNCERTAINTY_RE,
  OPINION_RE: OPINION_RE,
};
