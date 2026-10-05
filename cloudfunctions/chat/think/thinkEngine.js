// ============================================================
// think/thinkEngine.js
//   Phase Q2-3：问思融合引擎 — 三模式真实行为分流编排器。
//
//   在派发链中的位置（严格保持既有优先级，不抢占任何上游）：
//     Capability(时间/天气/计算/位置)  ← 最高，thinkEngine 之前
//       → Freshness(热点 B/C/D 安全闸)  ← 次高，thinkEngine 之前
//         → **thinkEngine（本模块）**
//           → generateAnswer(RAG 冻结链路)  ← 永远的兜底
//
//   分流矩阵（docs/Phase-Q2-Mode-Spec.md §4 落地）：
//     fast  🌐  = search        → 有可用事实则出「事实摘要+来源」；否则 return null 回退原链路
//     deep  📚  = RAG           → 直接 return null，走原 generateAnswer（逐字节零改动）
//     think 🌅  = search+RAG+reasoning → RAG 只读打底 + 事实层 + 思想层融合
//
//   授权条款对应的硬约束：
//     · Search Context 只活在本次请求内存（ThinkContext），出参只带 toSafeMeta；
//       绝不写 corpus / embedding / metadata / 任何知识库集合。
//     · 复用 freshness 的 detectFabrication 反幻觉闸（不复制第二份正则）；
//       闸不可用时**不增强**（fail-closed on augmentation）。
//     · mock 永不服务真实用户：provider=mock 时搜索被拒，除非显式测试开关。
//     · 旧 mode 字段（plain/deep/classic）原样透传给 RAG，语义不变。
//     · 任何异常一律 fail-soft → 返回 null，调用方落回冻结链路。
//
//   Node 16.13 兼容（无可选链 / 无空值合并）。
// ============================================================
'use strict';

var answerModeMod = require('../answerMode');
var thinkContextMod = require('../thinkContext');
var factExtractor = require('./factExtractor');
var reasoning = require('./reasoning');
var citation = require('./citation');
// Q2-27：复用 freshness 事件分类判定「是否需联网」，供搜索 auto 路由选择 qwen/agnes。
var eventClassifier = require('../freshness/eventClassifier');

// ---------- 惰性依赖（避免在不需要时拉起重模块） ----------
var _gateLoaded = false;
var _gate = null;
// 复用 freshness 的反幻觉硬闸（D-a）。刻意不复制正则：只能有一份真相。
function getFabricationGate() {
  if (_gateLoaded) return _gate;
  _gateLoaded = true;
  try {
    var f = require('../freshness').detectFabrication;
    _gate = (typeof f === 'function') ? f : null;
  } catch (e) {
    _gate = null;
  }
  return _gate;
}

var _searchFn = null;
function getSearchFn(opts) {
  if (opts && typeof opts.searchFn === 'function') return opts.searchFn;
  if (_searchFn) return _searchFn;
  try {
    _searchFn = require('../providers/search').search;
  } catch (e) {
    _searchFn = null;
  }
  return _searchFn;
}

var _ragFn = null;
function getRagFn(opts) {
  if (opts && typeof opts.generateAnswer === 'function') return opts.generateAnswer;
  if (_ragFn) return _ragFn;
  try {
    _ragFn = require('../rag').generateAnswer;
  } catch (e) {
    _ragFn = null;
  }
  return _ragFn;
}

// ---------- 开关 ----------
function envTrue(name, dflt) {
  var v = process.env[name];
  if (v === undefined || v === null || v === '') return dflt;
  return ('' + v).toLowerCase() === 'true';
}

// 思想层开关（默认开；关掉后 think 等价于 deep + 事实层）
function reasoningEnabled(opts) {
  if (opts && typeof opts.reasoningEnabled === 'boolean') return opts.reasoningEnabled;
  return envTrue('THINK_REASONING_ENABLED', true);
}

// 测试专用：允许 mock 事实进入生成（生产恒 false）
function allowMock(opts) {
  if (opts && opts.allowMockFacts === true) return true;
  return envTrue('THINK_ALLOW_MOCK_FACTS', false);
}

function resolveProvider(opts) {
  var p = (opts && opts.searchProvider) ? opts.searchProvider : process.env.SEARCH_PROVIDER;
  return (p || 'mock').toString().toLowerCase();
}

function resolveFactualEnabled(opts) {
  if (opts && (opts.factualEnabled === true || opts.factualEnabled === false)) return opts.factualEnabled;
  return envTrue('FRESHNESS_FACTUAL_ENABLED', false);
}

// ============================================================
// 搜索准入闸（三重）
//   ① 事实源总闸 FRESHNESS_FACTUAL_ENABLED 必须为 true
//   ② provider 不能是 none
//   ③ provider=mock 时必须显式开测试开关 —— mock 永不服务真实用户
// ============================================================
function searchGate(opts) {
  var provider = resolveProvider(opts);
  if (!resolveFactualEnabled(opts)) {
    return { allowed: false, provider: provider, reason: 'factual_disabled' };
  }
  if (provider === 'none') {
    return { allowed: false, provider: provider, reason: 'no_provider' };
  }
  if (provider === 'mock' && !allowMock(opts)) {
    return { allowed: false, provider: provider, reason: 'mock_blocked' };
  }
  return { allowed: true, provider: provider, reason: '' };
}

// ============================================================
// 取事实：search → extract → filter（全程 fail-soft）
// ============================================================
async function gatherFacts(query, opts, gate) {
  var out = {
    raw: [], facts: [], usable: [],
    mockFiltered: 0, sourceCount: 0, confidence: 'none',
    ok: false, reason: gate.reason || '',
  };
  if (!gate.allowed) return out;

  var searchFn = getSearchFn(opts);
  if (typeof searchFn !== 'function') {
    out.reason = 'search_layer_unavailable';
    return out;
  }

  var res;
  try {
    res = await searchFn(query, {
      answerMode: opts && opts.answerMode,
      openid: opts && opts.openid,
      __canary: opts && opts.__canary, // 透传灰度注入（生产不使用，无行为变化）
      sage: opts && opts.sage, socratic: opts && opts.socratic, // Phase X：先贤/苏格拉底人格透传
      networkNeeded: opts && opts.networkNeeded, // Q2-27：透传联网需求，供 auto 路由选 qwen/agnes
    });
  } catch (e) {
    out.reason = 'search_exception';
    return out;
  }
  out.audit = (res && res.audit) ? res.audit : null; // 审计元数据上行（仅安全字段）
  if (!res || res.ok !== true || !Array.isArray(res.results) || !res.results.length) {
    out.reason = (res && res.reason) ? res.reason : 'no_results';
    return out;
  }

  out.raw = res.results;
  var mockOk = allowMock(opts);
  var ex = factExtractor.extractFacts(res.results, { allowMock: mockOk });
  out.facts = ex.facts;
  out.sourceCount = ex.sourceCount;
  out.usable = factExtractor.filterUsable(ex.facts, { allowMock: mockOk });
  out.mockFiltered = ex.mockCount - (mockOk ? ex.mockCount : 0);
  out.confidence = factExtractor.aggregateConfidence(out.usable);
  out.ok = out.usable.length > 0;
  if (!out.ok && !out.reason) out.reason = 'no_usable_fact';
  return out;
}

// ============================================================
// 反幻觉闸：只作用于「引擎自己生成、无来源背书」的文本。
//   带 URL + source 归属的检索原文摘要不在此列（那是引用，不是编造），
//   其可核实性由 factExtractor「无 URL 即丢弃」保证。
//   闸不可用 → 视为不通过（宁可不增强，也不放行未经检查的生成文本）。
// ============================================================
function passesFabricationGate(text) {
  var t = (text || '').toString();
  if (!t.trim()) return true; // 空文本无需检查
  var gate = getFabricationGate();
  if (!gate) return false;    // fail-closed
  return gate(t) !== true;
}

// ---------- fast：事实摘要（确定性模板，不调模型） ----------
function composeFastAnswer(query, facts) {
  var topic = reasoning.extractTopic(query);
  var head = topic
    ? '关于「' + topic + '」，我检索到这些公开信息：'
    : '我检索到这些公开信息：';
  var lines = [head, ''];
  for (var i = 0; i < facts.length; i++) {
    var f = facts[i];
    var tail = [];
    if (f.source) tail.push(f.source);
    if (f.time) tail.push(f.time);
    lines.push((i + 1) + '. ' + f.statement);
    if (tail.length) lines.push('   —— ' + tail.join(' · '));
  }
  lines.push('');
  lines.push('以上是来源原文摘要，我没有做二次解读。想聊它背后该怎么判断，切到「🌅 思考」。');
  return lines.join('\n');
}

// ---------- think：是否适合追加思想层 ----------
function augmentationSkipReason(base, opts) {
  if (!base || !base.answer) return 'no_base_answer';
  // 危机链路：绝不追加任何思辨附加物
  if (base.intent && base.intent.crisis) return 'crisis';
  // 意图层判定「无需知识库」（寒暄/闲聊/工具类）：追加思想层只会显得聒噪
  if (base.retrieval && base.retrieval.skipped === true) return 'knowledge_skipped';
  // 过短回答通常是错误/降级出口，不做增强
  if (('' + base.answer).trim().length < 40) return 'short_answer';
  if (!reasoningEnabled(opts)) return 'reasoning_disabled';
  return '';
}

// ============================================================
// run(message, opts) → Promise<result | null>
//   返回 null  = 本引擎不接管，调用方继续走原 generateAnswer（零行为变化）
//   返回 result = 已接管，形状与 chat result 兼容
//
//   opts: {
//     answerMode, mode, models, modelCfgError, history, turn,
//     factualEnabled, searchProvider,
//     generateAnswer,   // 注入（index.js 传入 rag.generateAnswer；测试传 fake）
//     searchFn,         // 注入（测试用）
//     allowMockFacts, reasoningEnabled
//   }
// ============================================================
async function run(message, opts) {
  opts = opts || {};
  var query = (message || '').toString().trim();
  if (!query) return null;

  var plan = answerModeMod.resolve(opts.answerMode, { query: query });
  var gate = searchGate(opts);

  // 公共元信息（旧 mode 字段留痕，证明兼容未破）
  var baseMeta = {
    engine: 'q2-3',
    answerMode: plan.effectiveMode,
    pipeline: plan.pipeline,
    isDefaultMode: plan.isDefault,
    legacyMode: (opts.mode || 'plain'),
    searchAllowed: gate.allowed,
    searchProvider: gate.provider,
    searchReason: gate.reason,
    _ephemeral: true,
  };

  // ---------------- deep 📚：纯 RAG ----------------
  // 直接交回原链路，连一次多余的函数调用都不做 —— 逐字节零改动保证。
  if (plan.effectiveMode === 'deep') return null;

  // ---------------- fast 🌐：search（普通模式 = 通用助手）----------------
  //   Phase Q2-25：普通模式应呈现「自然通用助手」人格，而非僵硬的事实列表。
  //   优先采用搜索 Provider 的模型合成回答（agnesSearch 已按 fast 注入通用助手
  //   system prompt）；仅当无合成文本、但有可核实结构化事实时，才回退到模板式
  //   事实摘要。任一路径都过反幻觉闸（fail-closed：不通过则回退冻结 RAG）。
  if (plan.effectiveMode === 'fast') {
    var searchFn = getSearchFn(opts);
    if (typeof searchFn !== 'function') return null;
    var raw = null;
    try {
      raw = await searchFn(query, {
        answerMode: 'fast',
        openid: opts && opts.openid,
        __canary: opts && opts.__canary,
        sage: opts && opts.sage, socratic: opts && opts.socratic, // Phase X：先贤/苏格拉底人格透传
        // Q2-27：fast 模式到达本引擎时 freshness 已 return null（非 B），按分类兜底判定联网需求；
        //   B 类（极少见，如 freshness 关闭）走 qwen，其余走 agnes 省 qwen 额度。
        networkNeeded: !!(eventClassifier.classifyCategory(query, null).category === 'B'),
      });
    } catch (e) {
      raw = null;
    }
    if (!raw || raw.ok !== true || !Array.isArray(raw.results) || !raw.results.length) {
      return null; // 无可用检索 → 回退原链路（冻结 RAG）
    }

    // 探测模型合成的自然回答（agnes 走 synth 路径时 synthesized=true, content=回答正文）
    var synthItem = null;
    for (var ri = 0; ri < raw.results.length; ri++) {
      if (raw.results[ri] && raw.results[ri].synthesized && raw.results[ri].content) {
        synthItem = raw.results[ri];
        break;
      }
    }

    var fastFacts = factExtractor.filterUsable(
      factExtractor.extractFacts(raw.results, { allowMock: allowMock(opts) }).facts,
      { allowMock: allowMock(opts) }
    );

    var fastText;
    if (synthItem) {
      fastText = synthItem.content; // 通用助手直接回答
    } else {
      if (!fastFacts.length) return null; // 无合成且无可用事实 → 回退原链路
      fastText = composeFastAnswer(query, fastFacts);
    }

    // 反幻觉闸：合成文本与模板框架句都要过（闸不可用/不通过 → fail-closed 回退 RAG）
    if (!passesFabricationGate(fastText)) return null;
    if (!synthItem && !passesFabricationGate(composeFastAnswer(query, []))) return null;

    var fastCites = citation.buildUnified({
      facts: fastFacts, ragCitations: [], allowMock: allowMock(opts),
    });
    var fastCtx = thinkContextMod.makeThinkContext({
      mode: 'fast', query: query,
      facts: factExtractor.toEphemeralFacts(fastFacts), knowledge: [],
    });

    return {
      mode: 'think-fast',
      answer: fastText,
      citations: [], // 未走 RAG，经典引用为空（保持既有下游语义）
      route: { dimensions: [], books: [], core: '' },
      retrieval: { queryTerms: [], totalDocuments: 0, minScore: 0, search: true, think: true },
      think: Object.assign({}, baseMeta, {
        factCount: raw.results.length,
        usableFactCount: fastFacts.length,
        mockFiltered: 0,
        factConfidence: factExtractor.aggregateConfidence(fastFacts),
        reasoningApplied: false,
        augmented: true,
        skipReason: '',
        synthesized: !!synthItem,
        citations: fastCites,
        citationMeta: citation.toSafeMeta(fastCites),
        searchAudit: raw.audit || null,
        context: thinkContextMod.toSafeMeta(fastCtx),
      }),
      _modelUsed: synthItem ? (raw.provider || 'agnes') : '',
      _modelStatus: 'search',
      _modelError: '',
    };
  }

  // ---------------- think 🌅：search + RAG + reasoning ----------------
  var ragFn = getRagFn(opts);
  if (typeof ragFn !== 'function') return null; // 拿不到 RAG → 交回原链路

  // ① 知识层 + ② 事实层 并发执行：两者互相独立（RAG 只读语料，事实层只调 qwen 搜索），
  //   串行会叠加耗时（实测 think ~30s），并发后 ≈ max(RAG, qwen) 量级，显著提速。
  var baseP = ragFn(query, {
    turn: opts.turn,
    models: opts.models || [],
    modelCfgError: opts.modelCfgError,
    mode: opts.mode || 'plain',
    history: opts.history || [],
  });
  // Q2-27：think 模式事实增强保真实数据质量 → networkNeeded=true（auto 路由选 qwen），
  //   agnes 无联网会产出伪造事实，故事实层恒用 qwen。
  var factsP = gatherFacts(query, Object.assign({}, opts, { networkNeeded: true }), gate);

  var base = await baseP;
  if (!base || !base.answer) {
    try { await factsP; } catch (e) {} // 消费 pending promise，避免 unhandled rejection
    return base || null;
  }
  var facts = await factsP;

  // ③ 思想层：判断是否适合增强
  var skip = augmentationSkipReason(base, opts);
  var thinkMeta = Object.assign({}, baseMeta, {
    factCount: facts.facts.length,
    usableFactCount: facts.usable.length,
    mockFiltered: facts.mockFiltered,
    factConfidence: facts.confidence,
    reasoningApplied: false,
    augmented: false,
    skipReason: skip,
    searchAudit: facts.audit,
  });

  if (skip) {
    base.think = thinkMeta;
    return base;
  }

  var reason = reasoning.buildReasoning({
    query: query,
    facts: facts.usable,
    knowledge: base.citations || [],
    baseAnswer: base.answer,
  });
  // 2026-09-21 CR-删除答案段落（产品决定）：不再在答案末尾追加「🌅 再想一层」推理块。
  //   理由：该块与 general 格式的【延伸思考】功能重复（两者都是「留一个开放问题」），保留其一即可。
  //   回滚：将 APPEND_REASONING_BLOCK 置 true 即完整恢复原行为（renderReasoning 未做任何改动；
  //         buildReasoning 为纯模板派生、不调模型，故保留以支持一行回滚）。
  //   ⚠️ 置空安全性已核：passesFabricationGate 对空文本恒返回 true
  //      （见本文件 `if (!t.trim()) return true;`），因此不会触发 fabrication_gate_rejected，
  //      factBlock（事实引用块）仍会正常追加输出 —— 本条是本改动唯一需要留意耦合的地方。
  var APPEND_REASONING_BLOCK = false;
  var reasonBlock = APPEND_REASONING_BLOCK ? reasoning.renderReasoning(reason, {}) : '';

  var unified = citation.buildUnified({
    facts: facts.usable,
    ragCitations: base.citations || [],
    allowMock: allowMock(opts),
  });
  var factBlock = citation.renderFactCitations(unified, {});

  var addition = '' + reasonBlock + factBlock;
  if (!addition.trim()) {
    // 没有任何可追加内容 → 原样返回 RAG 结果（与 deep 完全一致）
    thinkMeta.skipReason = 'no_material';
    base.think = thinkMeta;
    return base;
  }

  // ④ 反幻觉闸：只检查引擎新增文本（思想层为模板派生，理论上恒过；
  //    但闸必须真跑，且闸不可用时拒绝增强）
  if (!passesFabricationGate(reasonBlock)) {
    thinkMeta.skipReason = 'fabrication_gate_rejected';
    thinkMeta.guardViolations = ['fabrication-detected'];
    base.think = thinkMeta;
    return base; // 降级为纯 RAG 回答，绝不交付可疑增强
  }

  // ⑤ 融合（ThinkContext 仅用于观测脱敏元信息，正文不落任何 ephemeral 结构）
  var ctx = thinkContextMod.makeThinkContext({
    mode: 'think',
    query: query,
    facts: factExtractor.toEphemeralFacts(facts.usable),
    knowledge: (base.citations || []).map(function (c) {
      return { title: (c && c.title) || '', text: (c && c.summary) || '' };
    }),
  });

  base.answer = base.answer + addition;
  thinkMeta.reasoningApplied = reasoning.hasContent(reason);
  thinkMeta.augmented = true;
  thinkMeta.citations = unified;
  thinkMeta.citationMeta = citation.toSafeMeta(unified);
  thinkMeta.context = thinkContextMod.toSafeMeta(ctx);
  base.think = thinkMeta;
  if (base.retrieval) base.retrieval.think = true;
  return base;
}

module.exports = {
  run: run,
  // 导出内部件供离线测试与观测（不改变运行时行为）
  searchGate: searchGate,
  gatherFacts: gatherFacts,
  composeFastAnswer: composeFastAnswer,
  augmentationSkipReason: augmentationSkipReason,
  passesFabricationGate: passesFabricationGate,
};
