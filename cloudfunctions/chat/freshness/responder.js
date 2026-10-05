// ============================================================
// Freshness Layer — responder.js
//   Phase Q / Q0 Policy 落地：热点思辨回答生成。
//
//   复用策略（冻结资产零改动）：
//     · 只读消费 rag.js 的导出 ROLE_PROMPT / OUTPUT_FORMATS，保持核心人格
//       与五段式契约不变；本模块只在其后追加 Freshness 护栏段落。
//     · 模型调用复用 index.js 传入的 model_config 列表；
//       HTTP 层复用 eventRetriever.nodeFetch（Node 16 兼容）。
//
//   护栏（Q0 §4 / §7）：
//     · 事实只能来自 event_context；status != grounded 不得转述具体事实。
//     · 禁止归因断定（"事情的原因就是…"）；禁止对可识别个人道德定性；
//       禁止站队；禁止未证实指控。
//     · unknown_points 非空时，回答必须显式承认至少一项未知。
//     · 事实篇幅 ≤ 回答 1/3（通过 prompt 约束 + 输出检查双重执行）。
//     · 输出检查违规 → 不交付该回答，回退降级文案（宁降级，不违规）。
// ============================================================
'use strict';

var S = require('./schema');
var EVENT_STATUS = S.EVENT_STATUS;
var USER_INTENT = S.USER_INTENT;
var retriever = require('./eventRetriever');

// 只读引用冻结 rag.js 的导出（不修改 rag.js 本身）
var rag = require('../rag');
var ROLE_PROMPT = rag.ROLE_PROMPT;
var OUTPUT_FORMATS = rag.OUTPUT_FORMATS;

// ---------- 输出硬检：归因断定 / 裁决句式 ----------
var FORBIDDEN_ASSERTION_RES = [
  { key: 'causal-assertion', re: /(事情的?原因(就|都)是|真相就是|根源就是|本质原因就是)/u },
  { key: 'verdict-stance', re: /(谁对谁错已经很|明摆着是|毫无疑问是.{0,8}(的错|责任)|他就是.{0,6}(坏人|人渣|骗子))/u },
  { key: 'unverified-accusation', re: /(肯定(是|有)|一定是|绝对是).{0,12}(贪污|受贿|造假|炒作|预谋)/u },
];

// Q2-15：传记幻觉检测——无来源引用的具体学历/院校/出生日期/履历断言。
//   命中即视为潜在编造（模型极易自信地给出错误学历信息）。
//   注意：只检测「明确断言句式」，不拦截「据说」「据报道」等归属表达。
var BIOGRAPHY_HALLUCINATION_RES = [
  { key: 'unsourced-degree', re: /(毕业(于|自)|本科|硕士|博士|大专|研究生).{0,20}(大学|学院|学校|研究院)/u },
  { key: 'unsourced-birth', re: /(出生于|生于).{0,4}(\d{4}年|\d{3,4}年)/u },
  { key: 'unsourced-career', re: /(曾(任|经|在)|从事).{0,30}(工作|职业|行业|岗位)/u },
];

// 未知承认句式：unknown_points 非空时回答必须含其一
var UNKNOWN_ACK_RE = /(无法确认|尚不清楚|仍不清楚|尚未|有待核实|无法核实|目前公开信息(还|未)|不得而知|还没有可靠)/u;

// Q2-16：合成底座免责声明 —— 模型联网综合、无独立来源时，回答须含其一，
//   否则视为未提示不确定性（guardOutput 据此放行/拦截）。
var SYNTH_DISCLAIMER_RE = /(网络(综合|资料|搜索|来源)|联网(搜索|结果)?|来自(网络|搜索)|公开资料|未经(独立)?(核实|证实)|综合(网络|搜索))/u;

// ============================================================
// buildFreshnessGuardrails(eventContext, userIntent, category)
//   追加在 ROLE_PROMPT 之后的护栏段落（对模型是指令，对系统由 guardOutput 复检）
// ============================================================
function buildFreshnessGuardrails(eventContext, userIntent, category) {
  var lines = [];
  lines.push('【热点思辨护栏（本轮附加，优先级高于常规回答原则）】');

  if (eventContext && eventContext.status === EVENT_STATUS.GROUNDED) {
    lines.push('· 本轮提供了「已核实事实底座」。你陈述的事件事实只能来自该底座，不得凭记忆补充任何事件细节、人名、数字、时间。');
    lines.push('· 事实篇幅不得超过整个回答的三分之一；回答重心必须落在人性、心理、价值与用户成长上。');
  } else if (eventContext && eventContext.status === EVENT_STATUS.AMBIGUOUS) {
    lines.push('· 本轮事件信息仅「部分确认」：只允许转述提供的最广泛共识事实，不得展开任何细节；涉及归因、动机、责任的话题一律以"目前公开信息无法确认"回应。');
  } else {
    lines.push('· 本轮没有可核实的事件信息：不得陈述任何具体事实，只做普遍性原则讨论。');
  }

  if (eventContext && (eventContext.unknown_points || []).length) {
    lines.push('· 必须在回答中显式承认至少一项当前未知（例如"' + eventContext.unknown_points[0].slice(0, 30) + '"所示的层面仍不清楚），不得把猜测说成原因。');
  }
  if (eventContext && eventContext.interpretation_boundary && (eventContext.interpretation_boundary.opinions || []).length) {
    lines.push('· 公众观点只能以"一种观点认为…""有网友认为…"的归属形式呈现，且必须同时给出不同视角；公众观点不是事实。');
  }

  lines.push('· 不对事件中任何可识别个人做道德功过定性；只讨论普遍人性与心理结构。');
  lines.push('· 不站队、不预测事件走向、不输出新闻式时间线、不复读网络极端表达。');
  lines.push('· 所有价值判断须为普遍性原则，而非针对该事件的结论；结尾把判断权留给用户。');
  lines.push('· 立场声明：我们陪你思考，不替你下定论。');

  if (userIntent === USER_INTENT.EMOTION) {
    lines.push('· 用户当前情绪优先：先用 1~2 句承接情绪，再谈事实与思考；经典引用后置或省略，不搬名言开头。');
  }
  if (category === 'C') {
    lines.push('· 用户问的是事实：简短克制地回答事实边界，然后邀请其转向思考；不要强行升华，不要长篇哲学展开。');
  }
  // Q2-15：人物身份查询专用护栏（无事实底座时）
  //   模型对学历/院校/出生日期有极高的"自信错误"率，必须显式禁止。
  if ((!eventContext || eventContext.status === EVENT_STATUS.UNVERIFIED) && category === 'B') {
    lines.push('· 【人物身份查询】本轮没有可核实的传记信息来源。严格禁止断言此人的学历、毕业院校、出生日期、家庭背景、具体履历等细节——即使你"记得"也不要写，模型记忆在这类信息上错误率极高。如无法确认，必须明确说"我不确定"或"我没有可靠来源"。');
  }
  // Q2-16：合成底座（模型联网综合、无独立来源 URL）护栏
  //   事实来自模型自身搜索综合，可能含不准确之处；须提示不确定性且不得把细节当确定事实。
  if (eventContext && eventContext.synthesized) {
    lines.push('· 【联网综合内容】以下事实底座由模型联网综合生成，未经独立来源逐条核实，可能包含不准确信息。你陈述的任一具体细节（年份、院校、履历等）都必须以"网络资料，未经核实"等措辞标注不确定性；不得把不确定信息说成确定事实；若与你所知冲突，优先提示"以权威来源为准"。');
  }
  return lines.join('\n');
}

// ============================================================
// buildFreshnessUserContent(query, eventContext, userIntent, category)
// ============================================================
function buildFreshnessUserContent(query, eventContext, userIntent, category) {
  var parts = ['问题：' + query];

  // Q2-16：合成底座联网综合文本单独呈现（不破 unverified 禁事实铁律）
  if (eventContext && eventContext.synthesized && eventContext.synthesized_text) {
    parts.push('【模型联网综合（未经独立核实，仅供参考）】\n' + eventContext.synthesized_text);
  }

  if (eventContext && eventContext.status !== EVENT_STATUS.UNVERIFIED) {
    var facts = (eventContext.fact_summary || []).map(function (f, i) {
      return (i + 1) + '. ' + f;
    }).join('\n');
    if (facts) {
      parts.push('【事件事实底座（' + (eventContext.status === EVENT_STATUS.GROUNDED ? '已核实' : '部分确认') + '，仅限以下内容）】\n' + facts);
    }
    if ((eventContext.unknown_points || []).length) {
      parts.push('【当前未知项】\n' + eventContext.unknown_points.map(function (u, i) {
        return (i + 1) + '. ' + u;
      }).join('\n'));
    }
  } else if (!eventContext || !eventContext.synthesized) {
    parts.push('【事件信息】本轮没有可核实的事件事实。');
  }

  if (userIntent === USER_INTENT.EMOTION) {
    parts.push('（意图提示：用户带着明显情绪而来，先承接情绪，再谈其他。）');
  } else if (userIntent === USER_INTENT.INFORMATION) {
    parts.push('（意图提示：用户想确认事实。简短给出事实边界后，可轻轻邀请其聊聊背后的思考，不勉强。）');
  } else {
    parts.push('（意图提示：用户想借这件事思考其背后的人性与意义，这是回答重心。）');
  }
  return parts.join('\n\n');
}

// ============================================================
// guardOutput(answer, eventContext) — 输出硬检
//   返回 { ok, violations: string[] }
//   违规即不交付（由上层回退降级文案）。
// ============================================================
function guardOutput(answer, eventContext) {
  var violations = [];
  var text = (answer || '').toString();
  if (!text.trim()) violations.push('empty-answer');

  for (var i = 0; i < FORBIDDEN_ASSERTION_RES.length; i++) {
    if (FORBIDDEN_ASSERTION_RES[i].re.test(text)) violations.push(FORBIDDEN_ASSERTION_RES[i].key);
  }

  // Q2-15：传记幻觉硬检（无来源的学历/出生/履历断言）
  //   仅在无事实底座或底座为 ambiguous 时启用（有 grounded 底座时假定事实来自底座）。
  //   Q2-16：合成底座(synthesized)放宽 —— 不硬拒具体细节，但要求回答含「联网综合免责」声明，
  //   由下方 missing-synth-disclaimer 把关；若连免责声明都没有则仍判违规。
  var synthesized = !!(eventContext && eventContext.synthesized);
  if (!eventContext || eventContext.status === EVENT_STATUS.UNVERIFIED || eventContext.status === EVENT_STATUS.AMBIGUOUS) {
    if (!synthesized) {
      for (var j = 0; j < BIOGRAPHY_HALLUCINATION_RES.length; j++) {
        if (BIOGRAPHY_HALLUCINATION_RES[j].re.test(text)) violations.push('biography-' + BIOGRAPHY_HALLUCINATION_RES[j].key);
      }
    }
  }
  // Q2-16：合成底座必须含「联网综合免责」声明，否则视为未提示不确定性
  if (synthesized && !SYNTH_DISCLAIMER_RE.test(text)) {
    violations.push('missing-synth-disclaimer');
  }

  // 未知承认强制条款（合成底座由 SYNTH_DISCLAIMER 已覆盖不确定性，免此硬检，
  // 否则联网综合回答必然被 missing-unknown-acknowledgement 误杀 → Q2-18 修复）
  if (!synthesized && eventContext && (eventContext.unknown_points || []).length && !UNKNOWN_ACK_RE.test(text)) {
    violations.push('missing-unknown-acknowledgement');
  }

  // unverified / ambiguous 级：回答中不得出现"据底座外"的长段事实叙述难以自动判定，
  // 保守检：ambiguous 时若出现超过 2 处具体数字/日期，视为细节超标
  if (eventContext && eventContext.status === EVENT_STATUS.AMBIGUOUS) {
    var numberish = text.match(/\d{4}年|\d+月\d+日|\d+人|\d+万/g) || [];
    if (numberish.length > 2) violations.push('ambiguous-detail-overflow');
  }

  return { ok: violations.length === 0, violations: violations };
}

// ============================================================
// callModels(models, systemContent, userContent, priorMsgs)
//   多模型自动切换（与 rag.js tryModelAnswer 同策略，独立实现避免改冻结文件）
//   返回 { answer, modelUsed, error }
// ============================================================
async function callModels(models, systemContent, userContent, priorMsgs) {
  if (!models || !models.length) {
    return { answer: null, modelUsed: '', error: 'no_enabled_model' };
  }
  var lastError = '';
  for (var i = 0; i < models.length; i++) {
    var cfg = models[i];
    var url = ((cfg.baseURL || '').toString().trim().replace(/\/+$/, '').replace(/\/chat\/completions$/i, '')) + '/chat/completions';
    var messages = [{ role: 'system', content: systemContent }];
    if (Array.isArray(priorMsgs)) priorMsgs.forEach(function (m) { messages.push(m); });
    messages.push({ role: 'user', content: userContent });
    try {
      var res = await retriever.nodeFetch(url, {
        method: 'POST',
        timeout: cfg.timeout || 25000,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + cfg.apiKey },
        body: JSON.stringify({ model: cfg.model, temperature: 0.35, max_tokens: 2000, messages: messages }),
      });
      if (!res.ok) throw new Error('HTTP_' + res.status);
      var data = await res.json();
      var answer = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
      if (!answer || !answer.trim()) throw new Error('empty_answer');
      return { answer: answer.trim(), modelUsed: cfg.name || cfg.model, error: '' };
    } catch (e) {
      lastError = e && e.message ? e.message : '' + e;
      // 继续尝试下一个模型
    }
  }
  return { answer: null, modelUsed: '', error: lastError || 'all_failed' };
}

// ============================================================
// generateFreshnessAnswer({ query, category, userIntent, eventContext, models, history })
//   返回 { answer, modelUsed, guardViolations, mode } 或 null（模型全失败时上层回退）
// ============================================================
async function generateFreshnessAnswer(input) {
  input = input || {};
  var query = input.query || '';
  var category = input.category || 'B';
  var userIntent = input.userIntent || USER_INTENT.REFLECTION;
  var eventContext = input.eventContext || null;

  // 五段式契约：emotion 意图用共情式，其余用思辨式（只读复用冻结 OUTPUT_FORMATS）
  var fmtKey = userIntent === USER_INTENT.EMOTION ? 'emotion' : 'philosophy';
  var fmt = OUTPUT_FORMATS[fmtKey] || OUTPUT_FORMATS.philosophy;

  var system = [
    ROLE_PROMPT.system,
    ROLE_PROMPT.identity,
    ROLE_PROMPT.mission,
    ROLE_PROMPT.safety,
    fmt.contract,
    fmt.lengthHint,
    buildFreshnessGuardrails(eventContext, userIntent, category),
  ].join('\n\n');

  var userContent = buildFreshnessUserContent(query, eventContext, userIntent, category);

  // 合成底座标记（控制免责声明确定性追加，不依赖模型随机输出）
  var synthesized = !!(eventContext && eventContext.synthesized);

  // 多轮上下文（沿用既有惯例：最近 10 轮、每条 ≤800 字）
  var prior = [];
  if (Array.isArray(input.history)) {
    input.history.slice(-20).forEach(function (m) {
      if (m && (m.role === 'user' || m.role === 'assistant') && (m.content || '').trim()) {
        prior.push({ role: m.role, content: m.content.slice(0, 800) });
      }
    });
  }

  var res = await callModels(input.models, system, userContent, prior);
  if (!res.answer) return null;

  var guard = guardOutput(res.answer, eventContext);
  if (!guard.ok) {
    // 合成底座(UNVERIFIED/单源)：若仅缺「联网综合免责声明」，程序化补一句，
    // 不丢内容、不降级（避免把诚实要求寄托于模型随机输出导致时灵时不灵，Q2-18 修复）。
    var onlyMissingDisclaimer = synthesized &&
      guard.violations.length === 1 &&
      guard.violations[0] === 'missing-synth-disclaimer';
    if (onlyMissingDisclaimer) {
      return {
        answer: res.answer + '\n\n（以上为网络综合内容，未经独立核实，仅供参考）',
        modelUsed: res.modelUsed,
        guardViolations: [],
        mode: 'freshness',
      };
    }
    // 其他违规（空答/归因断定/传记幻觉/冲突等）→ 不交付，上层回退降级文案
    return { answer: null, modelUsed: res.modelUsed, guardViolations: guard.violations, mode: 'guard_rejected' };
  }
  return { answer: res.answer, modelUsed: res.modelUsed, guardViolations: [], mode: 'freshness' };
}

module.exports = {
  buildFreshnessGuardrails: buildFreshnessGuardrails,
  buildFreshnessUserContent: buildFreshnessUserContent,
  guardOutput: guardOutput,
  generateFreshnessAnswer: generateFreshnessAnswer,
  FORBIDDEN_ASSERTION_RES: FORBIDDEN_ASSERTION_RES,
  BIOGRAPHY_HALLUCINATION_RES: BIOGRAPHY_HALLUCINATION_RES,
  UNKNOWN_ACK_RE: UNKNOWN_ACK_RE,
};
