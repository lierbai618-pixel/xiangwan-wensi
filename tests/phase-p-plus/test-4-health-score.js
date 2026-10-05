// ============================================================
// 测试 4：Health Score 计算（七维权重 / 缺失维 N/A / 权重重归一化）
// ------------------------------------------------------------
// 守护约束（docs/66 §4）：
//   · 七维权重 15/20/10/20/15/10/10 = 100
//   · 缺失维度必须 N/A，**绝不以默认值填充**
//   · 缺失维度按「权重重归一化」计算：Σ(w·v)/Σw（仅可用维）
//   · 只读既有指标，不重算检索
// ============================================================

'use strict';

const path = require('path');
const CHAT = path.resolve(__dirname, '..', '..', 'cloudfunctions', 'chat');
const {
  WEIGHTS,
  METADATA_CONTRACT_FIELDS,
  computeHealthScore,
  aggregateHealthScore,
  metadataCompleteness,
} = require(path.join(CHAT, 'knowledgeHealthScore'));

/** 构造完整 19 字段 metadata */
function fullMetadata() {
  const md = {};
  METADATA_CONTRACT_FIELDS.forEach((f) => {
    md[f] = 'x';
  });
  md.evidence_level = 'primary';
  md.citation_type = 'direct';
  return md;
}

module.exports = {
  name: 'Health Score 七维计算与 N/A 重归一化',
  run(t) {
    // --- 1. 权重契约 ---
    const sum = Object.keys(WEIGHTS).reduce((s, k) => s + WEIGHTS[k], 0);
    t.equal(sum, 100, '七维权重合计 = 100');
    t.equal(WEIGHTS.metadata, 15, 'Metadata 权重 15%');
    t.equal(WEIGHTS.citation, 20, 'Citation 权重 20%');
    t.equal(WEIGHTS.evidence, 10, 'Evidence 权重 10%');
    t.equal(WEIGHTS.retrieval, 20, 'Retrieval 权重 20%');
    t.equal(WEIGHTS.feedback, 15, 'Feedback 权重 15%');
    t.equal(WEIGHTS.usage, 10, 'Usage 权重 10%');
    t.equal(WEIGHTS.regression, 10, 'Regression 权重 10%');
    t.equal(METADATA_CONTRACT_FIELDS.length, 19, 'Metadata 契约为 19 字段');

    // --- 2. metadataCompleteness ---
    t.equal(metadataCompleteness(null), null, '无 metadata → 返回 null（N/A 信号，非 0 分）');
    t.equal(metadataCompleteness(undefined), null, 'undefined metadata → null');
    t.equal(metadataCompleteness(fullMetadata()), 1, '19 字段齐全 → 完整度 1.0');
    const partial = fullMetadata();
    delete partial.reviewer;
    partial.version = '';
    t.close(metadataCompleteness(partial), 17 / 19, 1e-9, '缺 1 项 + 空串 1 项 → 完整度 17/19（空串不算数）');

    // --- 3. 七维全可用：分数 = 标准加权平均 ---
    const full = computeHealthScore(
      { knowledge_id: 'K1', metadata: fullMetadata(), citation_pass: true, source: 'registry' },
      { retrievalHit3: 0.8, regressionAccept: true, feedback: 0.6, usage: 0.5 }
    );
    t.deepEqual(full.naDimensions, [], '全维可用时 naDimensions 为空');
    const expectFull =
      (15 * 1 + 20 * 1 + 10 * 1 + 20 * 0.8 + 15 * 0.6 + 10 * 0.5 + 10 * 1) / 100;
    t.close(full.score, Math.round(expectFull * 1000) / 1000, 1e-9,
      '全维分数 = Σ(w·v)/100 = ' + Math.round(expectFull * 1000) / 1000);

    // --- 4. 缺失 Feedback / Usage → N/A + 重归一化 ---
    const partialCtx = computeHealthScore(
      { knowledge_id: 'K1', metadata: fullMetadata(), citation_pass: true, source: 'registry' },
      { retrievalHit3: 0.8, regressionAccept: true }
    );
    t.ok(partialCtx.naDimensions.indexOf('feedback') >= 0, '缺 feedback → 标记 N/A');
    t.ok(partialCtx.naDimensions.indexOf('usage') >= 0, '缺 usage → 标记 N/A');
    t.equal(partialCtx.dimensions.feedback.value, null, 'N/A 维 value=null（未填 0）');
    t.equal(partialCtx.dimensions.feedback.na, true, 'N/A 维带 na=true 标记');
    const availW = 15 + 20 + 10 + 20 + 10; // metadata+citation+evidence+retrieval+regression
    const expectRenorm = (15 * 1 + 20 * 1 + 10 * 1 + 20 * 0.8 + 10 * 1) / availW;
    t.close(partialCtx.score, Math.round(expectRenorm * 1000) / 1000, 1e-9,
      '缺 2 维后按可用权重 ' + availW + ' 重归一化 = ' + Math.round(expectRenorm * 1000) / 1000);

    // --- 5. 关键防伪造断言：N/A 不等于填 0，也不等于填 1 ---
    const fillZero = (15 * 1 + 20 * 1 + 10 * 1 + 20 * 0.8 + 15 * 0 + 10 * 0 + 10 * 1) / 100;
    const fillOne = (15 * 1 + 20 * 1 + 10 * 1 + 20 * 0.8 + 15 * 1 + 10 * 1 + 10 * 1) / 100;
    t.ok(Math.abs(partialCtx.score - fillZero) > 1e-6, 'N/A 未被当作 0 分（否则会低估为 ' + fillZero.toFixed(3) + '）');
    t.ok(Math.abs(partialCtx.score - fillOne) > 1e-6, 'N/A 未被当作满分（否则会高估为 ' + fillOne.toFixed(3) + '）');

    // --- 6. 全维缺失兜底 ---
    const allNa = computeHealthScore({ knowledge_id: 'K0', knowledge_type: 'unknown' }, {});
    t.ok(allNa.naDimensions.indexOf('metadata') >= 0, '无 metadata → metadata N/A');
    t.ok(allNa.naDimensions.indexOf('retrieval') >= 0, '无检索上下文 → retrieval N/A');
    t.ok(allNa.naDimensions.indexOf('regression') >= 0, '无回归上下文 → regression N/A');
    t.ok(typeof allNa.score === 'number' && !isNaN(allNa.score), '极端缺失下 score 仍为合法数字（不 NaN）');

    // --- 7. Evidence 分级 ---
    const ev = (record) => computeHealthScore(record, {}).dimensions.evidence.value;
    t.equal(ev({ metadata: { evidence_level: 'primary' } }), 1.0, 'evidence_level=primary → 1.0');
    t.equal(ev({ metadata: { evidence_level: 'supporting' } }), 0.8, 'supporting → 0.8');
    t.equal(ev({ metadata: { evidence_level: 'illustrative' } }), 0.6, 'illustrative → 0.6');
    t.equal(ev({ source: 'corpus' }), 1.0, '经典（corpus）→ 1.0');
    t.equal(ev({ knowledge_type: 'psychology' }), 0.7, '未标注证据等级的非经典 → 0.7 保守值');

    // --- 8. Citation 判定优先级 ---
    const cit = (record) => computeHealthScore(record, {}).dimensions.citation;
    t.equal(cit({ citation_pass: true }).value, 1.0, 'citation_pass=true → 1.0');
    t.equal(cit({ citation_pass: false }).value, 0.0, 'citation_pass=false → 0.0（门禁失败如实计 0）');
    t.equal(cit({ source: 'corpus' }).value, 1.0, '经典必然带引用 → 1.0');
    t.equal(cit({ metadata: { citation_type: 'direct' } }).value, 1.0, '具备 citation_type → 1.0');
    t.equal(cit({ knowledge_type: 'psychology' }).na, true, '无任何引用信息 → N/A（不默认给分）');

    // --- 9. Regression 三态 ---
    const regDim = (ctx) => computeHealthScore({ source: 'corpus' }, ctx).dimensions.regression;
    t.equal(regDim({ regressionAccept: true }).value, 1.0, 'regressionAccept=true → 1.0');
    t.equal(regDim({ regressionAccept: false }).value, 0.0, 'regressionAccept=false → 0.0');
    t.equal(regDim({}).na, true, 'regressionAccept 未提供 → N/A（三态区分，不塌缩为 false）');

    // --- 10. 聚合 ---
    const recs = [
      { knowledge_id: 'A', source: 'corpus' },
      { knowledge_id: 'B', metadata: fullMetadata(), citation_pass: true, source: 'registry' },
    ];
    const ctx = { retrievalHit3: 0.82, regressionAccept: true };
    const agg = aggregateHealthScore(recs, ctx);
    t.equal(agg.perRecord.length, 2, '聚合覆盖全部记录');
    const sA = computeHealthScore(recs[0], ctx).score;
    const sB = computeHealthScore(recs[1], ctx).score;
    t.close(agg.averageScore, Math.round(((sA + sB) / 2) * 1000) / 1000, 1e-9, '平均分等于逐对象分数均值');
    t.ok(agg.naDimensions.indexOf('metadata') >= 0, '聚合合并了经典的 metadata N/A');
    t.ok(agg.naDimensions.indexOf('feedback') >= 0, '聚合合并了 feedback N/A');
    t.ok(agg.naDimensions.indexOf('citation') < 0, '两者引用维均可用 → 不出现在聚合 N/A 列表');
    t.equal(aggregateHealthScore([], ctx).averageScore, 0, '空集合聚合返回 0（不 NaN）');

    t.info('示例：经典 ' + sA + ' / 认证对象 ' + sB + '（差异来自 Metadata 维是否可用，非人为调分）');
  },
};
