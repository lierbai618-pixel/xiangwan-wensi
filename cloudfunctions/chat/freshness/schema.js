// ============================================================
// Freshness Layer — schema.js
//   Phase Q / Q0 Policy 落地：热点思辨模式的数据结构单一事实来源。
//
//   政策依据：docs/PhaseQ0-Freshness-Policy.md
//   设计依据：docs/PhaseQ-FreshnessLayer-Design.md
//
//   纯函数、零云依赖、Node 16.13 兼容（无原生 fetch / 无可选链依赖的新语法）。
//   本模块只定义结构与校验，不做任何 I/O。
// ============================================================
'use strict';

// ---------- 问题分类（Q0 Policy 第二部分） ----------
var CATEGORY = {
  A: 'A', // 纯哲学/人生问题 → 原 RAG，Freshness 不介入
  B: 'B', // 现实事件 + 哲学思考 → Freshness 全链路
  C: 'C', // 只求新闻事实 → 事实边界 + 反思邀请
  D: 'D', // 敏感热点 → 不检索，情绪承接 + 普遍人性
};

// ---------- 事件敏感等级（Q0 Policy 第三部分） ----------
var SENSITIVITY = {
  NORMAL: 'normal',         // 允许完整链路
  SENSITIVE: 'sensitive',   // 只确认事件存在，禁止扩展细节
  RESTRICTED: 'restricted', // 禁止检索，禁止生成 event_context
};

// ---------- 用户意图层（Q0 Policy 第五部分） ----------
var USER_INTENT = {
  INFORMATION: 'information',
  REFLECTION: 'reflection',
  EMOTION: 'emotion', // 永远最高优先级
};

// ---------- 事件接地状态 ----------
var EVENT_STATUS = {
  GROUNDED: 'grounded',     // 多源核实，可转述
  AMBIGUOUS: 'ambiguous',   // 部分确认，只做有限表述
  UNVERIFIED: 'unverified', // 无法核实，禁止转述为事实
};

// ---------- 来源置信度 ----------
var SOURCE_CONFIDENCE = {
  HIGH: 'high',     // 多独立权威源一致
  MEDIUM: 'medium', // 多源但含二手转述
  LOW: 'low',       // 单源或来源质量弱 / 用户自述
};

// ---------- 降级触发原因（Q0 Policy 第六部分） ----------
var DOWNGRADE_REASON = {
  NO_PROVIDER: 'no_provider',           // 未配置检索源
  NO_RELIABLE_FACT: 'no_reliable_fact', // 检索无果 / 全部低质
  NO_CLEAR_EVENT: 'no_clear_event',     // 事件指代消解失败
  INSUFFICIENT_SOURCE: 'insufficient_source', // 单一/利益相关/过旧信源
  CONFLICTING_INFO: 'conflicting_info', // 多源关键事实冲突
  RESTRICTED_EVENT: 'restricted_event', // Boundary Check 禁入
};

// 事实上下文默认 TTL：6 小时（事实 ephemeral，过期即失效，绝不沉淀）
var DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

// event_id：确定性短哈希（非加密用途，仅做标识与日志关联）
function makeEventId(name, dateStr) {
  var seed = (name || '') + '|' + (dateStr || '');
  var hash = 0;
  for (var i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return 'evt_' + hash.toString(36);
}

function isNonEmptyString(s) {
  return typeof s === 'string' && s.trim().length > 0;
}

// ============================================================
// makeEventContext(fields) — 构建 event_context（带强制校验）
//   fields:
//     eventName             规范事件名（必填）
//     status                grounded | ambiguous | unverified（必填）
//     factSummary           string[] 每句必须可映射到 sources（grounded 时必填非空）
//     unknownPoints         string[] 必填且非空（Q0：「没有未知项」是危险信号）
//     sourceConfidence      high | medium | low（必填）
//     interpretationBoundary { opinions: string[], unknowns: string[] }（必填）
//     sources               [{ title, url, source, publishedAt }]（grounded 时必填非空）
//     ttlMs                 缺省 6h
//   校验失败抛 Error——调用方须 catch 并走降级（宁降级，不出残缺上下文）。
// ============================================================
function makeEventContext(fields) {
  fields = fields || {};
  var errors = [];

  if (!isNonEmptyString(fields.eventName)) errors.push('eventName_required');
  if (EVENT_STATUS.GROUNDED !== fields.status &&
      EVENT_STATUS.AMBIGUOUS !== fields.status &&
      EVENT_STATUS.UNVERIFIED !== fields.status) {
    errors.push('status_invalid');
  }

  var factSummary = Array.isArray(fields.factSummary) ? fields.factSummary.filter(isNonEmptyString) : [];
  var unknownPoints = Array.isArray(fields.unknownPoints) ? fields.unknownPoints.filter(isNonEmptyString) : [];
  var sources = Array.isArray(fields.sources) ? fields.sources : [];

  // Q0 铁律：unknown_points 必须存在
  if (unknownPoints.length === 0) errors.push('unknown_points_required');
  // grounded 必须有事实与来源；unverified 禁止携带事实
  if (fields.status === EVENT_STATUS.GROUNDED) {
    if (factSummary.length === 0) errors.push('grounded_requires_facts');
    if (sources.length === 0) errors.push('grounded_requires_sources');
  }
  if (fields.status === EVENT_STATUS.UNVERIFIED && factSummary.length > 0) {
    errors.push('unverified_forbids_facts');
  }
  if (fields.status === EVENT_STATUS.AMBIGUOUS && factSummary.length > 2) {
    // sensitive 级最多两句最广泛共识事实
    errors.push('ambiguous_max_two_facts');
  }

  var conf = fields.sourceConfidence;
  if (conf !== SOURCE_CONFIDENCE.HIGH && conf !== SOURCE_CONFIDENCE.MEDIUM && conf !== SOURCE_CONFIDENCE.LOW) {
    errors.push('source_confidence_invalid');
  }

  var ib = fields.interpretationBoundary || {};
  var interpretationBoundary = {
    opinions: Array.isArray(ib.opinions) ? ib.opinions.filter(isNonEmptyString) : [],
    unknowns: Array.isArray(ib.unknowns) ? ib.unknowns.filter(isNonEmptyString) : [],
  };

  if (errors.length) {
    var err = new Error('event_context invalid: ' + errors.join(','));
    err.validationErrors = errors;
    throw err;
  }

  var now = new Date();
  var ttlMs = typeof fields.ttlMs === 'number' && fields.ttlMs > 0 ? fields.ttlMs : DEFAULT_TTL_MS;

  return {
    event_id: makeEventId(fields.eventName, now.toISOString().slice(0, 10)),
    event_name: fields.eventName.trim(),
    status: fields.status,
    fact_summary: factSummary,
    unknown_points: unknownPoints,
    source_confidence: conf,
    interpretation_boundary: interpretationBoundary,
    sources: sources.map(function (s) {
      return {
        title: (s && s.title) || '',
        url: (s && s.url) || '',
        source: (s && s.source) || '',
        publishedAt: (s && s.publishedAt) || '',
      };
    }),
    detected_at: now.toISOString(),
    ttl_ms: ttlMs,
    expires_at: new Date(now.getTime() + ttlMs).toISOString(),
  };
}

// TTL 检查：过期上下文不得进入任何新回答
function isEventContextFresh(ctx, nowMs) {
  if (!ctx || !ctx.expires_at) return false;
  var now = typeof nowMs === 'number' ? nowMs : Date.now();
  return Date.parse(ctx.expires_at) > now;
}

// ============================================================
// makeBoundaryAudit({ eventId, level, signals }) — Boundary Check 留痕
//   Q0 第三部分：每次 Check 必须记录 event_id / level / signals / timestamp
// ============================================================
function makeBoundaryAudit(fields) {
  fields = fields || {};
  return {
    event_id: fields.eventId || '',
    level: fields.level || SENSITIVITY.RESTRICTED, // 缺省从严
    signals: Array.isArray(fields.signals) ? fields.signals : [],
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  CATEGORY: CATEGORY,
  SENSITIVITY: SENSITIVITY,
  USER_INTENT: USER_INTENT,
  EVENT_STATUS: EVENT_STATUS,
  SOURCE_CONFIDENCE: SOURCE_CONFIDENCE,
  DOWNGRADE_REASON: DOWNGRADE_REASON,
  DEFAULT_TTL_MS: DEFAULT_TTL_MS,
  makeEventId: makeEventId,
  makeEventContext: makeEventContext,
  isEventContextFresh: isEventContextFresh,
  makeBoundaryAudit: makeBoundaryAudit,
};
