// ============================================================
// ObservabilityLogger — 观测记录构建 + 异步落库（Phase P+）
// ------------------------------------------------------------
// 把每次用户请求的关键运行时事实记录为一条观测记录，供 Dashboard /
// Health Score / Alert 消费。设计原则（对齐用户约束）：
//   · 不影响回答链路：本模块在 generateAnswer 返回后调用，只读 result。
//   · 失败不能阻断回答：store.write 永不抛出；fire-and-forget。
//   · 异步写入优先：不 await 落库，主流程立即返回。
//   · 只读调用知识路由：通过 require('../knowledgeRouter').routeQuestion
//     复算路由决策用于观测（调用冻结纯函数，非修改）。
//
// 数据流：Answer Runtime → Observability Logger → Storage
//
// docs/62 §9 十二字段契约覆盖度（Phase ⑥ 测试锁定，诚实记录）：
//   ✅ 已落库(6)：knowledge_type / fallback_reason / domain / intent /
//                policy_name / router_enabled
//   ◐ 等价覆盖(1)：citation_source ≈ retrieval_result（标题列表，非 display_text）
//   ❌ 未覆盖(5)：retrieval_mode / router_adjustment / rerank_score /
//                chunk_id / vector_score
//   未覆盖项均位于**冻结的 rag.js 检索内部**，取值必须在 rag.js 内部埋点，
//   与 Phase P+「零冻结资产改动」约束冲突 → 明确推迟至 Phase Q 处理。
// ============================================================

'use strict';

// 只读调用冻结的 Knowledge Router，复算路由决策用于观测（非修改）
let _routeQuestion = null;
function getRouteQuestion() {
  if (_routeQuestion) return _routeQuestion;
  try {
    const kr = require('../knowledgeRouter');
    _routeQuestion = kr && kr.routeQuestion;
  } catch (e) {
    _routeQuestion = null;
  }
  return _routeQuestion;
}

/** 选择存储实现：云端显式开启用 Cloud，否则默认 JSON（可测、降级） */
function createDefaultStore() {
  if (process.env.KNOWLEDGE_OBSERVABILITY_STORE === 'cloud') {
    try {
      const { CloudObservabilityStore } = require('./cloudObservabilityStore');
      return new CloudObservabilityStore();
    } catch (e) {
      /* 回退 JSON */
    }
  }
  const { JsonObservabilityStore } = require('./jsonObservabilityStore');
  return new JsonObservabilityStore();
}

/** 构建一条观测记录（纯函数，便于单测） */
function buildObservationRecord(opts) {
  opts = opts || {};
  const result = opts.result || {};
  const citations = Array.isArray(result.citations) ? result.citations : [];
  const intent = opts.intent || {};

  // 只读复算路由决策（knowledgeRouter.routeQuestion 是冻结纯函数）
  let routerDecision = null;
  const rq = getRouteQuestion();
  if (rq) {
    try {
      routerDecision = rq({
        intentInfo: intent,
        domain: intent.domain,
        question: opts.query,
      });
    } catch (e) {
      routerDecision = null;
    }
  }

  const knowledgeTypes = [];
  citations.forEach((c) => {
    const t = (c && c.knowledge_type) || 'classic';
    if (knowledgeTypes.indexOf(t) < 0) knowledgeTypes.push(t);
  });

  return {
    query: opts.query || '',
    answer_id: opts.answerId || '',
    conversation_id: opts.conversationId || '',
    openid: opts.openid || 'unknown',
    // --- docs/62 §9 契约字段（可从入参零成本获取的部分）---
    domain: intent.domain !== undefined ? intent.domain : null,
    intent: intent.type !== undefined ? intent.type : null,
    policy_name: intent.knowledgePolicy !== undefined ? intent.knowledgePolicy : null,
    router_enabled: (process.env.KB_ROUTER_ENABLED || 'true').toLowerCase() !== 'false',
    router_decision: routerDecision
      ? {
          priorityDomains: routerDecision.priorityDomains,
          knowledgePriority: routerDecision.knowledgePriority,
          preferredTypes: routerDecision.preferredTypes,
          reason: routerDecision.reason,
        }
      : null,
    fallback_reason: routerDecision ? routerDecision.reason : null,
    knowledge_type: knowledgeTypes,
    retrieval_result: citations.map((c) => (c && c.title) || ''),
    citation_count: citations.length,
    latency_ms: typeof opts.latencyMs === 'number' ? opts.latencyMs : null,
    // Phase Q：Freshness Layer 观测字段（增量，非热点路径恒为 null，向后兼容）
    freshness: result.freshness
      ? {
          category: result.freshness.category || null,
          user_intent: result.freshness.user_intent || null,
          event_status: result.freshness.event_status || null,
          source_confidence: result.freshness.source_confidence || null,
          downgraded: !!result.freshness.downgraded,
          downgrade_reason: result.freshness.downgrade_reason || null,
          boundary: result.freshness.boundary || null, // Q0 §3.4：event_id/level/signals/timestamp
          guard_violations: result.freshness.guard_violations || [],
        }
      : null,
    // Phase R：Capability Layer 观测字段（增量，非工具路径恒为 null，向后兼容）
    // 隐私：位置类只记录能力名与授权状态，绝不落库坐标/地址明文。
    capability: result.capability
      ? {
          name: result.capability.capability || null,
          sub_type: result.capability.sub_type || null,
          confidence: result.capability.confidence || null,
          signals: result.capability.signals || [],
          emotional: !!result.capability.emotional,
          tool_ok: !!result.capability.tool_ok,
          tool_reason: result.capability.tool_reason || null,
          bypass_rag: !!result.capability.bypass_rag,
          has_invite: !!result.capability.has_invite,
        }
      : null,
    created_at: new Date().toISOString(),
  };
}

/**
 * 记录一次观测。fire-and-forget，绝不阻塞/抛错到主链路。
 * @param {object} opts { query, answerId, conversationId, result, intent, latencyMs, openid, store? }
 * @returns {object} 构建好的记录（即使落库失败也返回，便于测试）
 */
function logObservation(opts) {
  const record = buildObservationRecord(opts);
  const store = (opts && opts.store) || createDefaultStore();
  try {
    // 异步写入优先 + 失败安全：不 await，错误仅记录
    Promise.resolve(store.write(record)).catch((e) => {
      console.error('[ObservabilityLogger] store.write failed:', e && e.message);
    });
  } catch (e) {
    // 极端情况下 store.write 同步抛错也不影响主流程
    console.error('[ObservabilityLogger] unexpected error:', e && e.message);
  }
  return record;
}

module.exports = {
  logObservation,
  buildObservationRecord,
  createDefaultStore,
};
