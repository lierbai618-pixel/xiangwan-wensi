// ============================================================
// Knowledge Platform Dashboard MVP（Phase P+ / Phase P §2）
// ------------------------------------------------------------
// 只读指标聚合。严格约束（来自用户 + docs/66 §2）：
//   · 数据来源 **只能是**：Registry / Observability / Regression 产物。
//   · **禁止重新计算检索逻辑** —— 本模块不 require rag.js、不做向量检索、
//     不调用 embedding，只读取既有产物中的既成事实。
//   · 缺失指标必须显示 N/A（available:false），**不得伪造**。
//   · 只读：不写任何文件、不修改任何资产。
//
// 八项指标（对齐 Phase P+ 第四阶段要求）：
//   1. Knowledge Count     ← Registry（统一视图：corpus 经典 + 认证对象）
//   2. Registry Status     ← Registry（schema / namespace / 状态分布）
//   3. Citation Accuracy   ← Registry(O-1 C5 门禁) + Observability(运行时引用率)
//   4. Regression Status   ← Regression（regression-report.json acceptance）
//   5. KQS                 ← Registry（quality_score）
//   6. Health Score        ← knowledgeHealthScore（七维，缺失维 N/A）
//   7. Query Count         ← Observability（观测记录条数）
//   8. Knowledge Usage     ← Observability（knowledge_type 使用频次）
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const { createRegistryProvider } = require('../registry/registryProvider');
const { JsonObservabilityStore } = require('../observability/jsonObservabilityStore');
const { aggregateHealthScore } = require('../knowledgeHealthScore');

// ------------------------------------------------------------
// 默认数据源路径（全部为既有只读产物）
// ------------------------------------------------------------
const WEAPP_ROOT = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_PATHS = {
  registryPath: path.join(WEAPP_ROOT, 'tests', 'pilot-o1', 'o1-registry.json'),
  certificatePath: path.join(WEAPP_ROOT, 'tests', 'pilot-o1', 'o1-certificate.json'),
  corpusPath: path.resolve(__dirname, '..', 'corpus.json'),
  regressionPath: path.join(WEAPP_ROOT, 'tests', 'pilot-n5', 'artifacts', 'regression-report.json'),
  readinessPath: path.join(WEAPP_ROOT, 'tests', 'pilot-n5', 'artifacts', 'o0-readiness-report.json'),
  observabilityPath: null, // null → 使用 JsonObservabilityStore 默认路径
};

/** 只读 JSON；失败返回 null（缺失即 N/A，不伪造） */
function safeReadJson(filePath) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch (e) {
    return null;
  }
}

/** 统一的「不可用指标」表示：显式 N/A + 原因 */
function na(reason) {
  return { available: false, value: null, reason: reason || 'data source missing' };
}

// ------------------------------------------------------------
// 指标 1 & 2：Knowledge Count / Registry Status
// ------------------------------------------------------------
function buildRegistryMetrics(provider, corpusPath) {
  let raw = null;
  let unified = [];
  let stats = null;
  try {
    raw = provider.getRaw();
    stats = provider.getStats();
    unified = provider.getUnifiedRecords(corpusPath);
  } catch (e) {
    return {
      knowledgeCount: na('registry unreadable: ' + (e && e.message)),
      registryStatus: na('registry unreadable: ' + (e && e.message)),
      unified: [],
    };
  }

  const byType = {};
  const bySource = { corpus: 0, registry: 0 };
  unified.forEach((r) => {
    const t = r.knowledge_type || 'classic';
    byType[t] = (byType[t] || 0) + 1;
    bySource[r.source] = (bySource[r.source] || 0) + 1;
  });

  return {
    knowledgeCount: {
      available: true,
      value: unified.length,
      breakdown: {
        classic_grandfathered: bySource.corpus || 0,
        certified_objects: bySource.registry || 0,
        byType,
      },
      source: 'Registry(getUnifiedRecords) = corpus.json[只读] + o1-registry.json',
    },
    registryStatus: {
      available: true,
      value: (stats && stats.total) || 0,
      schema: (raw && raw.schema) || null,
      namespace: (raw && raw.namespace) || null,
      storage: (raw && raw.storage) || null,
      byStatus: (stats && stats.byStatus) || {},
      byType: (stats && stats.byType) || {},
      source: 'Registry(getRaw/getStats)',
    },
    unified,
  };
}

// ------------------------------------------------------------
// 指标 4：Regression Status
// ------------------------------------------------------------
function buildRegressionMetrics(regression, readiness) {
  if (!regression) return { regressionStatus: na('regression-report.json not found') };

  const acc = regression.acceptance || {};
  const accKeys = Object.keys(acc);
  const allPass = accKeys.length > 0 && accKeys.every((k) => acc[k] === true);

  const out = {
    available: true,
    value: allPass ? 'PASS' : 'FAIL',
    acceptance: acc,
    baseline: {
      classic_hit3_routed:
        regression.baseline && typeof regression.baseline.routed_hit3 === 'number'
          ? regression.baseline.routed_hit3
          : null,
      classic_hit3_before:
        regression.baseline && typeof regression.baseline.before_hit3 === 'number'
          ? regression.baseline.before_hit3
          : null,
      intrusion_rate_routed:
        regression.baseline && typeof regression.baseline.routed_intrusion_rate === 'number'
          ? regression.baseline.routed_intrusion_rate
          : null,
    },
    benchmark:
      regression.benchmark && typeof regression.benchmark.routed_hit_at_3 === 'number'
        ? regression.benchmark.routed_hit_at_3
        : null,
    production_tf_check: regression.production_tf_check || null,
    source: 'Regression(tests/pilot-n5/artifacts/regression-report.json)',
  };

  if (readiness && typeof readiness.go_no_go === 'boolean') {
    out.o0_go_no_go = readiness.go_no_go;
  }
  return { regressionStatus: out };
}

// ------------------------------------------------------------
// 指标 3：Citation Accuracy
//   静态面：O-1 Release Gate C5-citation 门禁结论（既成事实，只读）
//   运行时面：Observability 中 citation_count>0 的比例（无观测数据 → N/A）
// ------------------------------------------------------------
function buildCitationMetrics(certificate, observations) {
  const gate =
    certificate && certificate.release_gate && Array.isArray(certificate.release_gate.gates)
      ? certificate.release_gate.gates.filter((g) => g.id === 'C5-citation')[0]
      : null;

  const runtime =
    observations.length > 0
      ? {
          available: true,
          value:
            Math.round(
              (observations.filter((o) => (o.citation_count || 0) > 0).length /
                observations.length) *
                1000
            ) / 1000,
          sample_size: observations.length,
          source: 'Observability(citation_count>0 占比)',
        }
      : na('no observation records yet');

  return {
    citationAccuracy: {
      available: !!gate,
      value: gate ? (gate.pass ? 1.0 : 0.0) : null,
      gate_id: 'C5-citation',
      gate_pass: gate ? gate.pass : null,
      runtime_citation_present_rate: runtime,
      source: 'Registry/O-1 Certificate(release_gate C5) + Observability',
      note: gate
        ? '静态值来自 O-1 认证门禁结论；运行时引用率来自观测数据，二者分开呈现，不混算。'
        : 'O-1 证书缺失 → 静态引用准确率 N/A',
    },
  };
}

// ------------------------------------------------------------
// 指标 5：KQS（Knowledge Quality Score）
// ------------------------------------------------------------
function buildKqsMetrics(provider) {
  let records = [];
  try {
    records = provider.getAll();
  } catch (e) {
    return { kqs: na('registry unreadable') };
  }
  const scored = records.filter((r) => typeof r.quality_score === 'number');
  if (scored.length === 0) return { kqs: na('no quality_score in registry') };

  const avg = scored.reduce((s, r) => s + r.quality_score, 0) / scored.length;
  return {
    kqs: {
      available: true,
      value: Math.round(avg * 10000) / 10000,
      min: Math.min.apply(null, scored.map((r) => r.quality_score)),
      max: Math.max.apply(null, scored.map((r) => r.quality_score)),
      sample_size: scored.length,
      perObject: scored.map((r) => ({ knowledge_id: r.knowledge_id, quality_score: r.quality_score })),
      note: '仅统计 Registry 中显式带 quality_score 的认证对象；grandfathered 经典不参与（无该字段）。',
      source: 'Registry(quality_score)',
    },
  };
}

// ------------------------------------------------------------
// 指标 7 & 8：Query Count / Knowledge Usage
// ------------------------------------------------------------
function buildObservabilityMetrics(observations, storeAvailable) {
  if (!storeAvailable) {
    return {
      queryCount: na('observability store not initialized'),
      knowledgeUsage: na('observability store not initialized'),
    };
  }

  const queryCount = {
    available: true,
    value: observations.length,
    source: 'Observability(store.readAll)',
  };

  if (observations.length === 0) {
    return {
      queryCount,
      knowledgeUsage: na('no observation records yet'),
      latency: na('no observation records yet'),
    };
  }

  const typeFreq = {};
  observations.forEach((o) => {
    const types = Array.isArray(o.knowledge_type) ? o.knowledge_type : [];
    if (types.length === 0) {
      typeFreq['(none)'] = (typeFreq['(none)'] || 0) + 1;
      return;
    }
    types.forEach((t) => {
      typeFreq[t] = (typeFreq[t] || 0) + 1;
    });
  });

  const latencies = observations
    .map((o) => o.latency_ms)
    .filter((x) => typeof x === 'number');
  const latency =
    latencies.length > 0
      ? {
          available: true,
          value: Math.round(latencies.reduce((s, x) => s + x, 0) / latencies.length),
          p95: latencies.slice().sort((a, b) => a - b)[
            Math.max(0, Math.ceil(latencies.length * 0.95) - 1)
          ],
          sample_size: latencies.length,
          source: 'Observability(latency_ms)',
        }
      : na('no latency samples');

  return {
    queryCount,
    knowledgeUsage: {
      available: true,
      value: typeFreq,
      sample_size: observations.length,
      source: 'Observability(knowledge_type 频次)',
    },
    latency,
  };
}

// ------------------------------------------------------------
// 指标 6：Health Score
//   为认证对象附加 O-1 证书中的 19 字段 Metadata（只读）与 C5 引用结论；
//   经典（corpus）无 19 字段 metadata → Metadata 维度诚实显示 N/A。
// ------------------------------------------------------------
function buildHealthMetrics(unified, certificate, regressionStatus) {
  if (!unified || unified.length === 0) return { healthScore: na('no knowledge records') };

  const metaById = {};
  if (certificate && certificate.knowledge_id && certificate.metadata) {
    metaById[certificate.knowledge_id] = certificate.metadata;
  }
  let citationPassById = {};
  if (certificate && certificate.release_gate && Array.isArray(certificate.release_gate.gates)) {
    const c5 = certificate.release_gate.gates.filter((g) => g.id === 'C5-citation')[0];
    if (c5) citationPassById[certificate.knowledge_id] = !!c5.pass;
  }

  const enriched = unified.map((r) => {
    const out = Object.assign({}, r);
    if (metaById[r.knowledge_id]) out.metadata = metaById[r.knowledge_id];
    if (citationPassById[r.knowledge_id] !== undefined) {
      out.citation_pass = citationPassById[r.knowledge_id];
    }
    return out;
  });

  const ctx = {};
  if (regressionStatus && regressionStatus.available) {
    if (typeof regressionStatus.baseline.classic_hit3_routed === 'number') {
      ctx.retrievalHit3 = regressionStatus.baseline.classic_hit3_routed;
    }
    ctx.regressionAccept = regressionStatus.value === 'PASS';
  }
  // Feedback / Usage 不传 → knowledgeHealthScore 内部标记 N/A（不伪造）

  const agg = aggregateHealthScore(enriched, ctx);
  return {
    healthScore: {
      available: true,
      value: agg.averageScore,
      perRecord: agg.perRecord,
      naDimensions: agg.naDimensions,
      note:
        'N/A 维度已按权重重归一化剔除，未以任何默认值填充。缺失维：' +
        (agg.naDimensions.length ? agg.naDimensions.join(' / ') : '无'),
      source: 'knowledgeHealthScore(Registry metadata + Regression 上下文)',
    },
  };
}

// ------------------------------------------------------------
// 主入口
// ------------------------------------------------------------
/**
 * 构建 Dashboard 快照（纯只读）。
 * @param {object} config { registryPath, certificatePath, corpusPath,
 *                          regressionPath, readinessPath, observabilityPath, store }
 * @returns {object} { generated_at, sources, metrics, degraded }
 */
function buildDashboard(config) {
  config = Object.assign({}, DEFAULT_PATHS, config || {});

  const provider = createRegistryProvider({
    type: 'json',
    filePath: config.registryPath,
    corpusPath: config.corpusPath,
  });

  const certificate = safeReadJson(config.certificatePath);
  const regression = safeReadJson(config.regressionPath);
  const readiness = safeReadJson(config.readinessPath);

  let store = config.store || null;
  let storeAvailable = true;
  if (!store) {
    try {
      store = new JsonObservabilityStore(
        config.observabilityPath ? { filePath: config.observabilityPath } : {}
      );
    } catch (e) {
      storeAvailable = false;
    }
  }
  let observations = [];
  try {
    observations = store ? store.readAll() : [];
  } catch (e) {
    observations = [];
    storeAvailable = false;
  }

  const reg = buildRegistryMetrics(provider, config.corpusPath);
  const regr = buildRegressionMetrics(regression, readiness);
  const cite = buildCitationMetrics(certificate, observations);
  const kqs = buildKqsMetrics(provider);
  const obs = buildObservabilityMetrics(observations, storeAvailable);
  const health = buildHealthMetrics(reg.unified, certificate, regr.regressionStatus);

  const metrics = Object.assign(
    {
      knowledgeCount: reg.knowledgeCount,
      registryStatus: reg.registryStatus,
    },
    cite,
    regr,
    kqs,
    health,
    obs
  );

  const degraded = Object.keys(metrics).filter((k) => metrics[k] && metrics[k].available === false);

  return {
    generated_at: new Date().toISOString(),
    version: 'dashboard-mvp/v1.0.1',
    sources: {
      registry: config.registryPath,
      certificate: config.certificatePath,
      corpus: config.corpusPath,
      regression: config.regressionPath,
      readiness: config.readinessPath,
      observability: store && store.filePath ? store.filePath : '(custom store)',
    },
    readonly: true,
    recomputes_retrieval: false,
    metrics,
    degraded,
  };
}

module.exports = {
  buildDashboard,
  DEFAULT_PATHS,
  // 导出子构建器便于单测
  buildRegistryMetrics,
  buildRegressionMetrics,
  buildCitationMetrics,
  buildKqsMetrics,
  buildObservabilityMetrics,
  buildHealthMetrics,
};
