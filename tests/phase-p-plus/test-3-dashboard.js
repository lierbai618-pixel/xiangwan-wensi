// ============================================================
// 测试 3：Dashboard 指标（只读 / 八项齐全 / 不重算检索 / N/A 诚实）
// ------------------------------------------------------------
// 守护约束（Phase P+ 第四阶段 + docs/66 §2）：
//   · 数据来源只能是 Registry / Observability / Regression
//   · **禁止重新计算检索逻辑**：进程内不得加载 rag.js，不做向量检索
//   · 八项指标齐全
//   · 只读：跑完 Dashboard 后所有数据源文件哈希不变
//   · 缺失指标必须 available:false + reason，**不得伪造默认值**
// ============================================================

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const CHAT = path.resolve(__dirname, '..', '..', 'cloudfunctions', 'chat');
const DASH = path.join(CHAT, 'dashboard', 'dashboard.js');
const { buildDashboard, DEFAULT_PATHS } = require(DASH);

const EIGHT_METRICS = [
  'knowledgeCount',
  'registryStatus',
  'citationAccuracy',
  'regressionStatus',
  'kqs',
  'healthScore',
  'queryCount',
  'knowledgeUsage',
];

function sha256(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch (e) {
    return 'MISSING';
  }
}

/** 内存 store：注入可控观测数据，验证运行时指标真实聚合 */
function memStore(records) {
  return {
    filePath: '(memory)',
    write() {
      return Promise.resolve({ ok: true });
    },
    readAll() {
      return records;
    },
  };
}

module.exports = {
  name: 'Dashboard 指标只读聚合',
  run(t) {
    // --- 1. 只读性：跑 Dashboard 前后数据源哈希不变 ---
    const watched = [
      DEFAULT_PATHS.registryPath,
      DEFAULT_PATHS.certificatePath,
      DEFAULT_PATHS.corpusPath,
      DEFAULT_PATHS.regressionPath,
      DEFAULT_PATHS.readinessPath,
    ];
    const before = watched.map(sha256);
    const snap = buildDashboard({ store: memStore([]) });
    const after = watched.map(sha256);
    t.deepEqual(after, before, 'buildDashboard 未修改任何数据源文件（5 个来源 SHA256 不变）');

    // --- 2. 自声明 + 八项指标齐全 ---
    t.equal(snap.readonly, true, '快照自声明 readonly=true');
    t.equal(snap.recomputes_retrieval, false, '快照自声明 recomputes_retrieval=false');
    t.ok(!isNaN(Date.parse(snap.generated_at)), 'generated_at 为合法时间戳');
    EIGHT_METRICS.forEach((m) => {
      t.ok(snap.metrics[m] && typeof snap.metrics[m].available === 'boolean',
        '指标存在且带 available 标记：' + m);
    });

    // --- 3. 不重算检索：源码层 + 运行时双重验证 ---
    const src = fs.readFileSync(DASH, 'utf-8');
    const codeOnly = src.replace(/^\s*\/\/.*$/gm, ''); // 去注释，避免注释里的字样误判
    t.ok(!/require\([^)]*rag['"]/.test(codeOnly), 'dashboard.js 源码未 require rag');
    t.ok(!/embedding|dashscope|text-embedding/i.test(codeOnly), 'dashboard.js 源码无 embedding/向量调用');
    t.ok(!/cosine|dotProduct|similarity/i.test(codeOnly), 'dashboard.js 源码无相似度计算');

    // 运行时：独立子进程加载并执行 Dashboard，检查 require.cache 里是否混入检索模块
    const probe =
      "const p=require(" + JSON.stringify(DASH) + ");" +
      "p.buildDashboard();" +
      "const hit=Object.keys(require.cache).filter(f=>/[\\\\/](rag|intent)\\.js$/.test(f));" +
      "process.stdout.write(JSON.stringify(hit));";
    let loaded = null;
    try {
      loaded = JSON.parse(execFileSync(process.execPath, ['-e', probe], { encoding: 'utf-8' }));
    } catch (e) {
      loaded = ['<probe failed: ' + (e && e.message) + '>'];
    }
    t.deepEqual(loaded, [], '运行时未加载 rag.js / intent.js（require.cache 为证，真正没重算检索）');

    // --- 4. Knowledge Count 与 Registry 一致 ---
    const registry = JSON.parse(fs.readFileSync(DEFAULT_PATHS.registryPath, 'utf-8'));
    const corpus = JSON.parse(fs.readFileSync(DEFAULT_PATHS.corpusPath, 'utf-8'));
    const kc = snap.metrics.knowledgeCount;
    t.equal(kc.value, corpus.length + registry.records.length, 'Knowledge Count = 经典 + 认证对象');
    t.equal(kc.breakdown.classic_grandfathered, corpus.length, 'breakdown 经典数正确');
    t.equal(kc.breakdown.certified_objects, registry.records.length, 'breakdown 认证对象数正确');

    // --- 5. Registry Status 直读注册表元信息 ---
    const rs = snap.metrics.registryStatus;
    t.equal(rs.schema, registry.schema, 'Registry Status schema 与注册表一致');
    t.equal(rs.namespace, registry.namespace, 'Registry Status namespace 与注册表一致');
    t.equal(rs.value, registry.records.length, 'Registry Status 记录数一致');

    // --- 6. Regression Status 来自回归产物，不自行判定 ---
    const regr = JSON.parse(fs.readFileSync(DEFAULT_PATHS.regressionPath, 'utf-8'));
    const allPass = Object.keys(regr.acceptance).every((k) => regr.acceptance[k] === true);
    t.equal(snap.metrics.regressionStatus.value, allPass ? 'PASS' : 'FAIL',
      'Regression Status 结论与 regression-report.json acceptance 一致');
    t.deepEqual(snap.metrics.regressionStatus.acceptance, regr.acceptance, 'acceptance 原样透传（未加工）');
    t.equal(snap.metrics.regressionStatus.baseline.classic_hit3_routed, regr.baseline.routed_hit3,
      'Classic Hit@3 读自回归产物（非重算）');

    // --- 7. Citation Accuracy：静态门禁 + 运行时分开呈现 ---
    const cert = JSON.parse(fs.readFileSync(DEFAULT_PATHS.certificatePath, 'utf-8'));
    const c5 = cert.release_gate.gates.filter((g) => g.id === 'C5-citation')[0];
    t.equal(snap.metrics.citationAccuracy.gate_pass, c5.pass, 'Citation 静态值来自 O-1 C5 门禁结论');
    t.equal(snap.metrics.citationAccuracy.runtime_citation_present_rate.available, false,
      '无观测数据时运行时引用率为 N/A（不用静态值冒充）');

    // --- 8. KQS 只统计带 quality_score 的认证对象 ---
    const scored = registry.records.filter((r) => typeof r.quality_score === 'number');
    const avg = scored.reduce((s, r) => s + r.quality_score, 0) / scored.length;
    t.close(snap.metrics.kqs.value, Math.round(avg * 10000) / 10000, 1e-9, 'KQS 等于认证对象 quality_score 均值');
    t.equal(snap.metrics.kqs.sample_size, scored.length, 'KQS 样本量 = 带分对象数（经典未被计入 1.0 拉高均值）');

    // --- 9. N/A 诚实：无观测数据时不得伪造 ---
    t.equal(snap.metrics.queryCount.value, 0, '无观测记录时 Query Count = 0（真实值，非 N/A）');
    t.equal(snap.metrics.knowledgeUsage.available, false, '无观测记录时 Knowledge Usage 为 N/A');
    t.ok(snap.metrics.knowledgeUsage.value === null, 'N/A 指标 value 为 null（不填 0/默认值）');
    t.ok(typeof snap.metrics.knowledgeUsage.reason === 'string' && snap.metrics.knowledgeUsage.reason.length > 0,
      'N/A 指标必须带 reason 说明');
    t.ok(snap.degraded.indexOf('knowledgeUsage') >= 0, 'degraded 列表如实列出 N/A 指标');
    const degradedCheck = Object.keys(snap.metrics).filter((k) => snap.metrics[k].available === false);
    t.deepEqual(snap.degraded.slice().sort(), degradedCheck.sort(), 'degraded 列表与实际 N/A 指标完全一致');

    // --- 10. 数据源缺失时降级为 N/A，而不是崩溃或造数 ---
    const missing = buildDashboard({
      regressionPath: path.join(__dirname, '__no_regression__.json'),
      certificatePath: path.join(__dirname, '__no_cert__.json'),
      store: memStore([]),
    });
    t.equal(missing.metrics.regressionStatus.available, false, '回归产物缺失 → Regression Status N/A');
    t.ok(missing.metrics.regressionStatus.value === null, '缺失时 value 为 null，不伪造 PASS');
    t.equal(missing.metrics.citationAccuracy.available, false, '证书缺失 → Citation Accuracy N/A');
    t.equal(missing.metrics.knowledgeCount.available, true, '单一数据源缺失不影响其他指标（局部降级）');

    // 注册表缺失 → 相关指标 N/A，整体不崩
    const noReg = t.noThrow(
      () => buildDashboard({ registryPath: path.join(__dirname, '__no_registry__.json'), store: memStore([]) }),
      '注册表缺失时 buildDashboard 不抛错'
    );
    if (noReg) {
      t.equal(noReg.metrics.registryStatus.available, false, '注册表缺失 → Registry Status N/A');
      t.equal(noReg.metrics.kqs.available, false, '注册表缺失 → KQS N/A');
    }

    // --- 11. 注入真实观测数据：运行时指标真正被聚合 ---
    const obs = [
      { knowledge_type: ['classic'], citation_count: 2, latency_ms: 1000 },
      { knowledge_type: ['classic', 'psychology'], citation_count: 3, latency_ms: 2000 },
      { knowledge_type: [], citation_count: 0, latency_ms: 3000 },
    ];
    const withObs = buildDashboard({ store: memStore(obs) });
    t.equal(withObs.metrics.queryCount.value, 3, '注入 3 条观测 → Query Count = 3');
    t.equal(withObs.metrics.knowledgeUsage.available, true, '有观测数据 → Knowledge Usage 可用');
    t.equal(withObs.metrics.knowledgeUsage.value.classic, 2, 'classic 使用频次统计正确');
    t.equal(withObs.metrics.knowledgeUsage.value.psychology, 1, 'psychology 使用频次统计正确');
    t.equal(withObs.metrics.knowledgeUsage.value['(none)'], 1, '未命中知识的请求单列 (none)（不静默丢弃）');
    t.close(withObs.metrics.citationAccuracy.runtime_citation_present_rate.value, 0.667, 0.001,
      '运行时引用率 = 有引用请求占比 2/3');
    t.equal(withObs.metrics.latency.value, 2000, '平均延迟聚合正确');

    // --- 12. Health Score：经典与认证对象诚实分列 ---
    const hs = snap.metrics.healthScore;
    t.equal(hs.available, true, 'Health Score 可用');
    t.equal(hs.perRecord.length, kc.value, 'Health Score 覆盖全部知识对象');
    t.ok(hs.naDimensions.indexOf('feedback') >= 0, 'Health Score 如实标注 feedback 维度 N/A');
    t.ok(hs.naDimensions.indexOf('usage') >= 0, 'Health Score 如实标注 usage 维度 N/A');
    const koRec = hs.perRecord.filter((r) => r.knowledge_id === cert.knowledge_id)[0];
    t.ok(!!koRec, '认证对象 ' + cert.knowledge_id + ' 出现在 Health Score 明细中');
    t.ok(koRec && koRec.naDimensions.indexOf('metadata') < 0,
      '认证对象有 19 字段 Metadata → metadata 维度不为 N/A');
    const classicRec = hs.perRecord.filter((r) => r.knowledge_id.indexOf('classic:') === 0)[0];
    t.ok(classicRec && classicRec.naDimensions.indexOf('metadata') >= 0,
      '经典无 19 字段 Metadata → metadata 维度诚实标 N/A（不按满分处理）');

    t.info('Dashboard 快照：知识 ' + kc.value + ' 项 / KQS ' + snap.metrics.kqs.value +
      ' / Health ' + hs.value + ' / 降级项 ' + snap.degraded.length + ' 个');
  },
};
