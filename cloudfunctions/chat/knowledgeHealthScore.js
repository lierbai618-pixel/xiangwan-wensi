// ============================================================
// knowledgeHealthScore — 知识对象健康分（Phase P+ / Phase P §4）
// ------------------------------------------------------------
// 实现 docs/66 §4 定义的七维健康分模型：
//   Metadata 15% | Citation 20% | Evidence 10% | Retrieval 20%
//   Feedback 15% | Usage 10% | Regression 10%
//
// 核心约束（来自用户 + docs/66）：
//   · 缺失维度（Feedback / Usage）必须显示 N/A，**不能伪造**。
//   · 缺失维度通过「权重重归一化」处理：score = Σ(可用权重×维度分) / Σ可用权重。
//   · 只读既有指标，不重算检索逻辑。
//
// 用法：
//   const { computeHealthScore, aggregateHealthScore } = require('./knowledgeHealthScore');
//   computeHealthScore(record, ctx) -> { score, dimensions, naDimensions }
// ============================================================

'use strict';

// 19 字段契约（docs/62 §4），用于 Metadata 维度完整性评估
const METADATA_CONTRACT_FIELDS = [
  'knowledge_id', 'knowledge_type', 'domain', 'subcategory', 'authority',
  'evidence_level', 'citation_type', 'source_type', 'version', 'status',
  'priority', 'quality_score', 'copyright', 'created_at', 'updated_at',
  'review_status', 'reviewer', 'embedding_version', 'retrieval_policy',
];

// 权重（与 docs/66 §4 一致）
const WEIGHTS = {
  metadata: 15,
  citation: 20,
  evidence: 10,
  retrieval: 20,
  feedback: 15,
  usage: 10,
  regression: 10,
};

/** 统计 record.metadata 中命中契约字段的比例（0..1） */
function metadataCompleteness(metadata) {
  if (!metadata || typeof metadata !== 'object') return null; // N/A
  let present = 0;
  METADATA_CONTRACT_FIELDS.forEach((f) => {
    if (metadata[f] !== undefined && metadata[f] !== '') present += 1;
  });
  return present / METADATA_CONTRACT_FIELDS.length;
}

/** 证据强度 → 0..1（classic 经典文本视为最高） */
function evidenceScore(record) {
  const md = record.metadata || {};
  const lvl = md.evidence_level;
  if (lvl === 'primary') return 1.0;
  if (lvl === 'supporting') return 0.8;
  if (lvl === 'illustrative') return 0.6;
  // 经典（corpus / classic 类型）视为权威经典文本
  if (record.source === 'corpus' || record.knowledge_type === 'classic') return 1.0;
  return 0.7;
}

/** 引用准确率 → 0..1（classic 恒被引用；概念卡有 citation_type 即视为已规范引用） */
function citationScore(record) {
  if (record.citation_pass !== undefined) return record.citation_pass ? 1.0 : 0.0;
  if (record.source === 'corpus') return 1.0; // 经典文本必然引用
  const md = record.metadata || {};
  if (md.citation_type) return 1.0; // 具备引用结构
  return null; // N/A
}

/**
 * 计算单个知识对象健康分。
 * @param {object} record { knowledge_id, knowledge_type, status, source,
 *                          metadata?(19字段), citation_pass?, quality_score }
 * @param {object} ctx { retrievalHit3 (0..1, 全局代理), regressionAccept (bool),
 *                       feedback?(0..1), usage?(0..1) }
 * @returns {{score:number, dimensions:object, naDimensions:string[]}}
 */
function computeHealthScore(record, ctx) {
  record = record || {};
  ctx = ctx || {};
  const dimensions = {};

  // Metadata
  const md = metadataCompleteness(record.metadata);
  if (md === null) {
    dimensions.metadata = { value: null, weight: WEIGHTS.metadata, na: true };
  } else {
    dimensions.metadata = { value: md, weight: WEIGHTS.metadata, na: false };
  }

  // Citation
  const cit = citationScore(record);
  if (cit === null) {
    dimensions.citation = { value: null, weight: WEIGHTS.citation, na: true };
  } else {
    dimensions.citation = { value: cit, weight: WEIGHTS.citation, na: false };
  }

  // Evidence
  dimensions.evidence = { value: evidenceScore(record), weight: WEIGHTS.evidence, na: false };

  // Retrieval（全局 Classic Hit@3 代理；单对象检索未追踪时诚实使用全局值）
  const retrieval = typeof ctx.retrievalHit3 === 'number' ? ctx.retrievalHit3 : null;
  if (retrieval === null) {
    dimensions.retrieval = { value: null, weight: WEIGHTS.retrieval, na: true };
  } else {
    dimensions.retrieval = { value: retrieval, weight: WEIGHTS.retrieval, na: false };
  }

  // Feedback（缺失 → N/A）
  if (typeof ctx.feedback === 'number') {
    dimensions.feedback = { value: ctx.feedback, weight: WEIGHTS.feedback, na: false };
  } else {
    dimensions.feedback = { value: null, weight: WEIGHTS.feedback, na: true };
  }

  // Usage（缺失 → N/A）
  if (typeof ctx.usage === 'number') {
    dimensions.usage = { value: ctx.usage, weight: WEIGHTS.usage, na: false };
  } else {
    dimensions.usage = { value: null, weight: WEIGHTS.usage, na: true };
  }

  // Regression（门禁全部通过 → 1.0）
  const reg = ctx.regressionAccept === true ? 1.0 : ctx.regressionAccept === false ? 0.0 : null;
  if (reg === null) {
    dimensions.regression = { value: null, weight: WEIGHTS.regression, na: true };
  } else {
    dimensions.regression = { value: reg, weight: WEIGHTS.regression, na: false };
  }

  // 权重重归一化：仅累加可用维度
  let wSum = 0;
  let acc = 0;
  const naDimensions = [];
  Object.keys(dimensions).forEach((k) => {
    const d = dimensions[k];
    if (d.na) {
      naDimensions.push(k);
    } else {
      wSum += d.weight;
      acc += d.weight * d.value;
    }
  });
  const score = wSum > 0 ? acc / wSum : 0;

  return { score: Math.round(score * 1000) / 1000, dimensions, naDimensions };
}

/**
 * 聚合多个对象健康分（供 Dashboard Health Score 指标）。
 * @returns {{averageScore:number, perRecord:Array, naDimensions:string[]}}
 */
function aggregateHealthScore(records, ctx) {
  const perRecord = (records || []).map((r) => ({
    knowledge_id: r.knowledge_id,
    score: computeHealthScore(r, ctx).score,
    naDimensions: computeHealthScore(r, ctx).naDimensions,
  }));
  const avg =
    perRecord.length > 0
      ? perRecord.reduce((s, x) => s + x.score, 0) / perRecord.length
      : 0;
  // 合并所有对象的 N/A 维度（去重）
  const naSet = new Set();
  perRecord.forEach((x) => x.naDimensions.forEach((d) => naSet.add(d)));
  return {
    averageScore: Math.round(avg * 1000) / 1000,
    perRecord,
    naDimensions: Array.from(naSet),
  };
}

module.exports = {
  WEIGHTS,
  METADATA_CONTRACT_FIELDS,
  computeHealthScore,
  aggregateHealthScore,
  metadataCompleteness,
};
