// ============================================================
// Freshness Layer — index.js（模块入口 / 编排器）
//   Phase Q / Q0 Policy 落地：热点思辨模式总控。
//
//   链路（Category B）：
//     分类(eventClassifier) → Boundary Check(boundaryCheck) →
//     事实检索(eventRetriever) → 事实抽取(factExtractor) →
//     event_context 构建(contextBuilder) → 五段式生成(responder)
//   任何一环不满足政策 → 降级(downgrade)，绝不编造。
//
//   与冻结资产的关系：
//     · 只读调用 intent.js classifyIntent（辅助分类证据）。
//     · Category A 返回 null → 调用方直落原 generateAnswer，原链路 100% 不变。
//     · 危机信号直接返回 null（既有危机链路优先级最高，Freshness 不拦截）。
// ============================================================
'use strict';

var S = require('./schema');
var classifier = require('./eventClassifier');
var boundary = require('./boundaryCheck');
var retriever = require('./eventRetriever');
var extractor = require('./factExtractor');
var contextBuilder = require('./contextBuilder');
var downgrade = require('./downgrade');
var responder = require('./responder');
// Phase Q2-1：统一 Search Provider 抽象层（默认 mock，真实源仅在 factualEnabled+密钥时激活）
var searchLayer = require('../providers/search');

// 只读引用冻结 intent.js（不修改，仅消费其分类结论）
var classifyIntent = require('../intent').classifyIntent;

var CATEGORY = S.CATEGORY;
var SENSITIVITY = S.SENSITIVITY;
var USER_INTENT = S.USER_INTENT;
var DOWNGRADE_REASON = S.DOWNGRADE_REASON;

// ============================================================
// Q1-B 反幻觉硬闸（D-a）：无事实源（eventContext=null）时，模型仍可能输出
//   明确虚构事实签名（如「2026年出演某作品」）。命中即视为 guard 违规，
//   上层降级不交付（宁降级，不编造）。产品最高原则：宁可承认不知道，不允许编造。
// ============================================================
var FABRICATION_RES = [
  // 年份 + 具体动作（虚构事实签名，最强信号）
  /(19|20)\d{2}年.{0,14}(参加|出演|发布|推出|官宣|宣布|获奖|获得|结婚|离婚|去世|上映|开播|开售|签约|代言|复出|夺冠)/u,
  // 无年份但明确的「权威事实声明」句式（具体新作/新专辑等）
  /(出演|推出了?|发布了?).{0,10}(新作|新专辑|新剧|新歌|新电影|新节目)/u,
];
function detectFabrication(text) {
  var t = (text || "").toString();
  for (var i = 0; i < FABRICATION_RES.length; i++) {
    if (FABRICATION_RES[i].test(t)) return true;
  }
  return false;
}

// 降级结果统一包装：与 chat result 形状兼容
function wrapDowngrade(dg, meta) {
  return {
    mode: 'freshness-downgrade',
    answer: dg.answer,
    citations: [],
    route: { dimensions: [], books: [], core: '' },
    retrieval: { queryTerms: [], totalDocuments: 0, minScore: 0, freshness: true },
    freshness: meta,
    _modelUsed: '',
    _modelStatus: 'downgrade',
    _modelError: '',
  };
}

// ============================================================
// maybeHandle(message, opts)
//   opts: { turn, models, modelCfgError, mode, history }
//   返回：
//     null   → 非 Freshness 范畴（Category A / 危机 / 分类失败），
//              调用方继续走原 generateAnswer（零行为变化）。
//     result → Freshness 已接管（B/C/D 的回答或降级）。
// ============================================================
async function maybeHandle(message, opts) {
  opts = opts || {};
  var query = (message || '').toString().trim();
  if (!query) return null;

  // Q1-B：事实检索源开关（opts 优先，回退环境变量，再回退 false）。
  // 默认 false → B 类不进真实检索，只走「无事实源思辨增强」。
  var factualEnabled = opts.factualEnabled;
  if (factualEnabled === undefined || factualEnabled === null) {
    factualEnabled = (process.env.FRESHNESS_FACTUAL_ENABLED || "").toLowerCase() === "true";
  }
  // Phase Q2-1：三模式 + 检索源（opts 优先，回退环境变量）。answerMode 默认 think。
  var searchProvider = opts.searchProvider;
  if (!searchProvider) searchProvider = (process.env.SEARCH_PROVIDER || "mock").toLowerCase();
  var answerMode = opts.answerMode || "think";

  // 既有意图层结论（只读证据，不复制其逻辑）
  var intentInfo;
  try {
    intentInfo = classifyIntent(query, opts.history || []);
  } catch (e) {
    intentInfo = null;
  }

  // 危机信号：Freshness 不拦截，交给既有最高优先级危机链路
  if (intentInfo && intentInfo.crisis) return null;

  // ① 四分类
  var cls = classifier.classifyCategory(query, intentInfo);
  if (cls.category === CATEGORY.A) return null; // 原 RAG，完全不介入

  // ② 用户意图层（emotion 永远最高）
  var ui = classifier.detectUserIntent(query, intentInfo);

  var meta = {
    category: cls.category,
    category_reason: cls.reason,
    user_intent: ui.intent,
    user_intent_signals: ui.signals,
    event_mention: cls.eventMention,
    boundary: null,
    event_status: '',
    source_confidence: '',
    downgraded: false,
    downgrade_reason: '',
    guard_violations: [],
  };

  // ③ Event Boundary Check（独立于 Prompt 的代码闸门）
  var bc = boundary.checkEvent(cls.eventMention, { extraText: query });
  meta.boundary = bc.audit;

  // Category D 或 restricted：禁止检索、禁止 event_context → 直接安全降级
  if (cls.category === CATEGORY.D || bc.level === SENSITIVITY.RESTRICTED) {
    var dgD = downgrade.buildDowngrade({
      reason: DOWNGRADE_REASON.RESTRICTED_EVENT,
      userIntent: ui.intent,
      query: query,
    });
    meta.downgraded = true;
    meta.downgrade_reason = DOWNGRADE_REASON.RESTRICTED_EVENT;
    return wrapDowngrade(dgD, meta);
  }

  // Category C：事实查询 → 事实边界 + 反思邀请
  if (cls.category === CATEGORY.C) {
    var dgC = downgrade.buildDowngrade({
      reason: cls.confidence === 'low' ? DOWNGRADE_REASON.NO_CLEAR_EVENT : DOWNGRADE_REASON.NO_RELIABLE_FACT,
      userIntent: ui.intent === USER_INTENT.REFLECTION ? USER_INTENT.INFORMATION : ui.intent,
      query: query,
    });
    meta.downgraded = true;
    meta.downgrade_reason = 'category-C-guidance';
    return wrapDowngrade(dgC, meta);
  }

  // ---------- Category B：完整 Freshness 链路 ----------

  // 模糊指代（"那件事你怎么看？"）：绝不臆测具体事件，先澄清（防编造第一道闸）
  if (cls.confidence === 'low') {
    var dgV = downgrade.buildDowngrade({
      reason: DOWNGRADE_REASON.NO_CLEAR_EVENT,
      userIntent: ui.intent,
      query: query,
    });
    meta.downgraded = true;
    meta.downgrade_reason = DOWNGRADE_REASON.NO_CLEAR_EVENT;
    return wrapDowngrade(dgV, meta);
  }

  // ---------- Q1-B：无事实源思辨增强（D1 升级路径） ----------
  // 当事实检索未开启（FRESHNESS_FACTUAL_ENABLED=false）或检索源为 none 时，
  // 跳过检索直接走 WenDao 反思：eventContext=null → responder 产出
  // 「无核实事实 → 普遍性原则讨论」回答。把 B 类从「冷降级」升级为
  // 「诚实边界 + 思辨增强」。不编造、不虚构、不冒充实时新闻。
  // 未来 FRESHNESS_FACTUAL_ENABLED=true 且 provider=http 时，本分支不触发，
  // 走下方原始检索链路（Phase Q2）。
  // ⚠️ 必须用 searchLayer.getProviderName()（读 SEARCH_PROVIDER），而非
  //   retriever.getProviderName()（读旧变量 FRESHNESS_SEARCH_PROVIDER，只认 http/none）。
  //   否则 SEARCH_PROVIDER=qwen 时这里仍读到 none → 永远走无事实源路径（Q2-14 修复）。
  var providerName = searchLayer.getProviderName();
  if (!factualEnabled || providerName === 'none') {
    var gen = await responder.generateFreshnessAnswer({
      query: query,
      category: cls.category,
      userIntent: ui.intent,
      eventContext: null, // 关键：无事实底座，严禁转述任何具体事实
      models: opts.models || [],
      history: opts.history || [],
    });
    if (gen && gen.answer) {
      // D-a 反幻觉硬闸：模型仍输出明确虚构事实签名 → 视为违规，降级不交付
      if (detectFabrication(gen.answer)) {
        var dgFab = downgrade.buildDowngrade({
          reason: DOWNGRADE_REASON.NO_RELIABLE_FACT,
          userIntent: ui.intent,
          query: query,
        });
        meta.downgraded = true;
        meta.downgrade_reason = 'fabrication-gate-rejected';
        meta.guard_violations = (meta.guard_violations || []).concat(['fabrication-detected']);
        return wrapDowngrade(dgFab, meta);
      }
      return {
        mode: 'freshness',
        answer: gen.answer,
        citations: [],
        route: { dimensions: [], books: [], core: '' },
        retrieval: { queryTerms: [], totalDocuments: 0, minScore: 0, freshness: true, noFactSource: true },
        freshness: meta,
        intent: intentInfo || undefined,
        _modelUsed: gen.modelUsed,
        _modelStatus: 'ok',
        _modelError: '',
      };
    }
    // 模型不可用 / 输出违规 → 诚实降级（宁降级不编造）
    var dgB = downgrade.buildDowngrade({
      reason: DOWNGRADE_REASON.NO_PROVIDER,
      userIntent: ui.intent,
      query: query,
    });
    meta.downgraded = true;
    meta.downgrade_reason = gen && gen.guardViolations && gen.guardViolations.length
      ? 'guard_rejected:' + gen.guardViolations.join('+')
      : 'model_unavailable';
    if (gen && gen.guardViolations) meta.guard_violations = gen.guardViolations;
    return wrapDowngrade(dgB, meta);
  }

  // ④ 事实检索（Phase Q2-1：统一走 providers/search 抽象层；
  //    SEARCH_PROVIDER=none/mock 或无密钥 → ok:false → 诚实降级）
  //   透传 openid 供灰度闸门判定；审计元数据仅安全字段。
  // Q2-27：freshness 仅接管 Category B（事件/热点），恒需联网 → networkNeeded=true（auto 路由选 qwen）。
  var retrieval = await searchLayer.search(cls.eventMention, { answerMode: answerMode, openid: opts && opts.openid, sage: opts && opts.sage, socratic: opts && opts.socratic, networkNeeded: true });
  meta.search_audit = (retrieval && retrieval.audit) ? retrieval.audit : null;
  meta.search_provider = retrieval.provider;
  if (!retrieval.ok || !retrieval.results || !retrieval.results.length) {
    var dgR = downgrade.buildDowngrade({
      reason: retrieval.reason === 'no_provider' ? DOWNGRADE_REASON.NO_PROVIDER : DOWNGRADE_REASON.NO_RELIABLE_FACT,
      userIntent: ui.intent,
      query: query,
    });
    meta.downgraded = true;
    meta.downgrade_reason = retrieval.reason || DOWNGRADE_REASON.NO_RELIABLE_FACT;
    return wrapDowngrade(dgR, meta);
  }

  // ⑤ 事实抽取 + Fact/Interpretation 隔离
  var extraction = extractor.extractFacts(retrieval.results);

  // 信息冲突 → 降级（Q0 §6 触发条件之一）
  // ⚠️ 合成底座(UNVERIFIED/单源)的百炼综合文字常含"澄清/反转"等叙述措辞，
  //   属模型单源综合内部的事件背景描述，并非多源事实冲突，不得误杀（Q2-18 修复）。
  if (!extraction.hasSynthesized && extraction.hasConflict && extraction.sourceConfidence === S.SOURCE_CONFIDENCE.LOW) {
    var dgF = downgrade.buildDowngrade({
      reason: DOWNGRADE_REASON.CONFLICTING_INFO,
      userIntent: ui.intent,
      query: query,
    });
    meta.downgraded = true;
    meta.downgrade_reason = DOWNGRADE_REASON.CONFLICTING_INFO;
    return wrapDowngrade(dgF, meta);
  }

  // ⑥ event_context 构建（sensitive 封顶 ambiguous；构建失败即降级）
  var eventContext = contextBuilder.buildEventContext({
    eventMention: cls.eventMention,
    boundary: bc,
    extraction: extraction,
    results: retrieval.results,
  });
  if (!eventContext) {
    var dgX = downgrade.buildDowngrade({
      reason: DOWNGRADE_REASON.INSUFFICIENT_SOURCE,
      userIntent: ui.intent,
      query: query,
    });
    meta.downgraded = true;
    meta.downgrade_reason = DOWNGRADE_REASON.INSUFFICIENT_SOURCE;
    return wrapDowngrade(dgX, meta);
  }
  meta.event_status = eventContext.status;
  meta.source_confidence = eventContext.source_confidence;

  // ⑦-fast（Q2-26）：fast 模式恒走直答通道（产品定义：普通 = 通用助手，对标豆包/通义）
  //   不依赖 eventContext.synthesized —— 只要检索拿到真实结果，就直接把检索内容
  //   加工返回，跳过五段式二次生成。回答来源优先级：
  //     ① eventContext.synthesized_text（百炼综合文本，已是「直接事实」如「上证收盘3940.04」）
  //     ② 否则直接抽取 retrieval.results[].content/snippet
  //        （百炼 OpenAI 兼容模式只回 message.content，归一后是 results[].content；
  //          grounded 事实也承载于此，故必须覆盖，否则真实事实会被埋进引庄子的五段式散文）
  //   触发条件：answerMode === 'fast' 且检索有可用内容(>20字)。
  //   背景：原五段式路径把真实事实埋进散文，用户主观感受即「小程序不能联网」，
  //        而实际已联网 —— 这是 fast 人格在 freshness 路径失效导致的体验 bug。
  //   deep/think 保持五段式思辨（冻结 rag.js 思辨内核零改动）；非 fast 仍保留
  //   原 cls.directFactual + synthesized 直答（只读 eventContext.synthesized，行为不变）。
  var _fastDirect = (answerMode === 'fast');
  var _directEnabled = _fastDirect || (cls.directFactual && eventContext && eventContext.synthesized);
  if (_directEnabled) {
    var _directText = '';
    if (eventContext && eventContext.synthesized_text) {
      _directText = eventContext.synthesized_text;
    } else if (_fastDirect) {
      // fast 模式：即使非 synth，也从检索结果直接取内容直答（覆盖 grounded-fact 情形）
      var _parts = [];
      for (var _ri = 0; _ri < retrieval.results.length && _parts.length < 3; _ri++) {
        var _r = retrieval.results[_ri];
        var _t = (_r && (_r.content || _r.snippet || '')) || '';
        _t = _t.toString().trim();
        if (_t) _parts.push(_t);
      }
      _directText = _parts.join('\n\n');
    }
    // fast 模式：只要检索内容非空即直答（短事实如「今天是8月9日星期日」也是有效直答，
    //   不应因 >20 长度门槛被误判为「过短」而落五段式；内容质量已由 qwenSearch 拒答过滤 + 下方反幻觉闸保障）
    if (_directText) {
      // D-a 反幻觉硬闸（与无事实源路径同标准）：命中虚构事实签名 → 不交付，诚实降级
      if (detectFabrication(_directText)) {
        var dgFabFast = downgrade.buildDowngrade({
          reason: DOWNGRADE_REASON.NO_RELIABLE_FACT,
          userIntent: ui.intent,
          query: query,
        });
        meta.downgraded = true;
        meta.downgrade_reason = 'fabrication-gate-rejected';
        meta.guard_violations = (meta.guard_violations || []).concat(['fabrication-detected']);
        return wrapDowngrade(dgFabFast, meta);
      }
      var _directAnswer = _directText + '\n\n（以上为网络综合内容，未经独立核实，仅供参考）';
      return {
        mode: 'freshness',
        answer: _directAnswer,
        citations: [],
        route: { dimensions: [], books: [], core: '' },
        retrieval: { queryTerms: [], totalDocuments: retrieval.results.length, minScore: 0, freshness: true },
        event_context: eventContext ? {
          event_id: eventContext.event_id,
          status: eventContext.status,
          source_confidence: eventContext.source_confidence,
          synthesized: !!eventContext.synthesized,
        } : undefined,
        freshness: {
          downgraded: false,
          category: cls.category,
          search_provider: meta.search_provider,
          source_confidence: eventContext ? eventContext.source_confidence : '',
          event_status: eventContext ? eventContext.status : '',
          direct_factual: true,
          direct_factual_reason: (eventContext && eventContext.synthesized) ? 'synth' : 'search-results',
        },
      };
    }
    // 检索有结果但内容过短/为空 → 落下方五段式兜底（不应发生）
  }

  // ⑦ 五段式生成（事实仅作入口，护栏由 responder 双重执行）
  var gen = await responder.generateFreshnessAnswer({
    query: query,
    category: cls.category,
    userIntent: ui.intent,
    eventContext: eventContext,
    models: opts.models || [],
    history: opts.history || [],
  });

  if (!gen || !gen.answer) {
    // 模型全失败或输出硬检违规 → 降级文案（违规记录留痕）
    var dgG = downgrade.buildDowngrade({
      reason: DOWNGRADE_REASON.NO_RELIABLE_FACT,
      userIntent: ui.intent,
      query: query,
    });
    meta.downgraded = true;
    meta.downgrade_reason = gen && gen.guardViolations && gen.guardViolations.length
      ? 'guard_rejected:' + gen.guardViolations.join('+')
      : 'model_unavailable';
    if (gen && gen.guardViolations) meta.guard_violations = gen.guardViolations;
    return wrapDowngrade(dgG, meta);
  }

  return {
    mode: 'freshness',
    answer: gen.answer,
    citations: [],
    route: { dimensions: [], books: [], core: '' },
    retrieval: { queryTerms: [], totalDocuments: 0, minScore: 0, freshness: true },
    event_context: {
      event_id: eventContext.event_id,
      status: eventContext.status,
      source_confidence: eventContext.source_confidence,
      expires_at: eventContext.expires_at,
    },
    freshness: meta,
    intent: intentInfo || undefined,
    _modelUsed: gen.modelUsed,
    _modelStatus: 'ok',
    _modelError: '',
  };
}

module.exports = { maybeHandle: maybeHandle, detectFabrication: detectFabrication };
