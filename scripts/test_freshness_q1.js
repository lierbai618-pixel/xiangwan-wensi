// ============================================================
// Phase Q1-B — Freshness Layer 实施验证（离线）
//   纯逻辑 / 零云依赖 / 零网络调用（Capability 与 Freshness 均离线可达）。
//   运行：node scripts/test_freshness_q1.js
//
//   覆盖：
//     F1-F3  B 类（人物动态 / 新闻热点）→ Freshness，无事实时不编造
//     F4-F5  A 类（纯哲学/人生）→ 原 RAG，不进 Freshness
//     F6-F7  Capability（时间/天气）→ 能力层拦截，Freshness 不抢答
//     F8     D 类（政治敏感）→ 安全降级
//     F9     FRESHNESS_ENABLED=false 回退 / B 类无事实源分支隔离检索
//     F10    四冻结资产 SHA256 与改前基准 4/4 一致
//     反幻觉  D-a 硬闸：虚拟事实签名 → 拦截降级；诚实反思 → 放行
// ============================================================
'use strict';

var path = require('path');
var fs = require('fs');
var crypto = require('crypto');
var assert = require('assert');

var CHAT = path.join(__dirname, '..', 'cloudfunctions', 'chat');
var classifier = require(path.join(CHAT, 'freshness', 'eventClassifier'));
var freshness = require(path.join(CHAT, 'freshness', 'index'));
var responder = require(path.join(CHAT, 'freshness', 'responder'));
var retriever = require(path.join(CHAT, 'freshness', 'eventRetriever'));
var capability = require(path.join(CHAT, 'capabilities')); // 仅 maybeHandle
var classifyIntent = require(path.join(CHAT, 'intent')).classifyIntent;

var passed = 0;
var failed = 0;
var failures = [];
function ok(name, cond, extra) {
  if (cond) { passed++; console.log('  \u2713 ' + name); }
  else { failed++; failures.push(name + (extra ? ' | ' + extra : '')); console.log('  \u2717 ' + name + (extra ? ' | ' + extra : '')); }
}

// ---------- 冻结资产 SHA 基准（Q1-B 改前锁定；本阶段严禁变化） ----------
var FROZEN_BASELINE = {
  'corpus.json': '068fa1fa052ec7b93a9d60008c26b29c425c40f0ab724ab33483dbd1001459ae',
  'intent.js': '765ad138ec68c0f159c6f75a60e5268beb02fba152f6d53dbdc539ba1560ca38',
  'knowledgeRouter.js': '848908445dbb5ea93a6f52775dc3c8e6922ff971d6cee115547f236ffed0a935',
  'rag.js': '90c9cc5fe1d9f30837f63a9a67d512e6d08262ef19e125ddd7bebf8ee0890698',
};
function sha256File(rel) {
  var buf = fs.readFileSync(path.join(CHAT, rel));
  return crypto.createHash('sha256').update(buf).digest('hex');
}

(async function () {
  console.log('========================================');
  console.log('Phase Q1-B Freshness Layer 离线验证');
  console.log('========================================');

  // ---------- 默认状态断言 ----------
  console.log('\n[状态] 检索源默认 none / 事实开关默认 false');
  ok('retriever 默认 provider=none（未接真实搜索）', retriever.getProviderName() === 'none');
  ok('factualEnabled 默认 false（环境变量未设）',
    (process.env.FRESHNESS_FACTUAL_ENABLED || '').toLowerCase() !== 'true');

  // ---------- F1-F3：B 类路由（人物动态 / 新闻热点） ----------
  console.log('\n[F1-F3] B 类路由（须归 Freshness/B）');
  var bCases = [
    { q: '付航最近怎么样？', tag: 'F1 人物动态' },
    { q: '某演员最近有什么作品？', tag: 'F2 人物作品' },
    { q: '今天有什么新闻？', tag: 'F3 新闻热点' },
  ];
  bCases.forEach(function (c) {
    var ii = classifyIntent(c.q, []);
    var cls = classifier.classifyCategory(c.q, ii);
    ok(c.tag + ' → category=B', cls.category === 'B', 'got=' + cls.category + ' reason=' + cls.reason);
  });
  // B 类被 Freshness 拦截（不落原 RAG）：models=[] 时无模型 → 诚实降级，但仍是 Freshness 接管（非 null）
  var bIntercept = await freshness.maybeHandle('付航最近怎么样？', { models: [], history: [] });
  ok('F1 互补：B 类被 Freshness 接管（非 null，不落 RAG）', bIntercept !== null && bIntercept.mode === 'freshness-downgrade');

  // ---------- F4-F5：A 类回归（纯哲学/人生 → RAG） ----------
  console.log('\n[F4-F5] A 类回归（须落原 RAG，不进 Freshness）');
  var aCases = [
    { q: '论语如何看学习？', tag: 'F4 经典' },
    { q: '人生迷茫怎么办？', tag: 'F5 人生' },
    { q: '庄子怎么看自由？', tag: 'A 补充 庄子' },
  ];
  aCases.forEach(function (c) {
    var ii = classifyIntent(c.q, []);
    var cls = classifier.classifyCategory(c.q, ii);
    ok(c.tag + ' → category=A（Freshness 不介入）', cls.category === 'A', 'got=' + cls.category + ' reason=' + cls.reason);
  });
  // 互补断言需 await（maybeHandle 为异步）；用顺序循环确保正确判定
  for (var ai = 0; ai < aCases.length; ai++) {
    var c2 = aCases[ai];
    var r = await freshness.maybeHandle(c2.q, { models: [], history: [] });
    ok(c2.tag + ' 互补：Freshness 返回 null（落原链路）', r === null);
  }

  // ---------- F6-F7：Capability（时间/天气）→ 能力层拦截 ----------
  console.log('\n[F6-F7] Capability 拦截（Freshness 不抢答）');
  var cap1 = await capability.maybeHandle('现在几点？', { history: [], location: null });
  ok('F6 现在几点 → Capability（mode=capability）', !!(cap1 && cap1.mode === 'capability'),
    'got=' + (cap1 && cap1.mode));
  var cap2 = await capability.maybeHandle('北京天气怎么样？', { history: [], location: null });
  ok('F7 北京天气怎么样 → Capability（mode=capability）', !!(cap2 && cap2.mode === 'capability'),
    'got=' + (cap2 && cap2.mode));
  // 关键：Capability 命中后不应再进入 Freshness（派发顺序由 index.js 保证；此处验证分类层不抢答）
  var clsTime = classifier.classifyCategory('现在几点？', classifyIntent('现在几点？', []));
  ok('F6 互补：分类层不把时间问题判为 B', clsTime.category !== 'B', 'got=' + clsTime.category);

  // ---------- F8：D 类（政治敏感）→ 安全降级 ----------
  console.log('\n[F8] 政治敏感 → D 类安全降级');
  var clsD = classifier.classifyCategory('某政治人物最近动态', classifyIntent('某政治人物最近动态', []));
  ok('F8 政治人物最近动态 → category=D', clsD.category === 'D', 'got=' + clsD.category + ' reason=' + clsD.reason);
  var rD = await freshness.maybeHandle('某政治人物最近动态', { models: [], history: [] });
  ok('F8 互补：D 类走 restricted 安全降级', rD && rD.mode === 'freshness-downgrade' &&
    rD.freshness.downgrade_reason === 'restricted_event');

  // ---------- F9：FRESHNESS_ENABLED=false 回退 + B 类检索隔离 ----------
  console.log('\n[F9] 回退与检索隔离');
  // B 类无事实源分支：应跳过检索（不调用 retriever.retrieveEventFacts）
  var origRetrieve = retriever.retrieveEventFacts;
  var retrieveCalled = false;
  retriever.retrieveEventFacts = function () { retrieveCalled = true; return origRetrieve.apply(null, arguments); };
  var rB = await freshness.maybeHandle('付航最近怎么样？', { models: [], history: [] });
  ok('F9：B 类无事实源分支不调用检索（检索源隔离）', retrieveCalled === false);
  retriever.retrieveEventFacts = origRetrieve;
  // 静态度量：index.js 必须将 Freshness 关在 FRESHNESS_ENABLED 之后加载（L1 熔断点存在）
  var idxSrc = fs.readFileSync(path.join(CHAT, 'index.js'), 'utf8');
  ok('F9：index.js 存在 FRESHNESS_ENABLED 总闸（可 L1 熔断）', /FRESHNESS_ENABLED/.test(idxSrc));
  ok('F9：index.js 存在 FRESHNESS_FACTUAL_ENABLED 开关（默认 false）',
    /FRESHNESS_FACTUAL_ENABLED\s*=\s*\(process\.env\.FRESHNESS_FACTUAL_ENABLED\s*\|\|\s*""\)\.toLowerCase\(\)\s*===\s*"true"/.test(idxSrc));

  // ---------- 反幻觉 D-a：纯函数 ----------
  console.log('\n[反幻觉] D-a 反幻觉硬闸（纯函数）');
  ok('虚构：2026年出演某作品 → 命中', freshness.detectFabrication('付航在2026年参加了某喜剧综艺，并出演了新作品《某某》。') === true);
  ok('虚构：2025年发布了新专辑 → 命中', freshness.detectFabrication('她2025年发布了新专辑并官宣巡演。') === true);
  ok('诚实：无年份+无具体新作 → 不命中',
    freshness.detectFabrication('根据目前可核实的信息，我无法确认他近期的具体动态。如果从个人发展角度看，长期价值来自持续表达。') === false);
  ok('诚实：普遍性原则讨论 → 不命中',
    freshness.detectFabrication('一个创作者的发展通常会经历作品积累、风格形成和公众反馈三个阶段。') === false);

  // ---------- 反幻觉 D-a：注入式集成（模拟模型输出） ----------
  console.log('\n[反幻觉] D-a 集成（模拟模型返回）');
  var origGen = responder.generateFreshnessAnswer;
  // 场景 A：模型返回诚实反思 → 应放行（mode=freshness）
  responder.generateFreshnessAnswer = async function () {
    return {
      answer: '关于付航近期具体动态，我目前没有可核实的实时信息，因此不对具体作品和事件作判断。' +
        '如果从创作者的长期发展来看，持续表达与观众关系往往比阶段性的热度更关键。' +
        '你也可以思考：一个创作者真正被记住的，是阶段性的热度，还是持续创造的能力？',
      modelUsed: 'mock', guardViolations: [],
    };
  };
  var rHonest = await freshness.maybeHandle('付航最近怎么样？', { models: ['mock'], history: [] });
  ok('D-a 集成：诚实反思 → mode=freshness 且未判虚构', rHonest && rHonest.mode === 'freshness' && !freshness.detectFabrication(rHonest.answer));

  // 场景 B：模型返回虚构事实 → 应拦截降级（fabrication-gate-rejected）
  responder.generateFreshnessAnswer = async function () {
    return { answer: '付航在2026年参加了某喜剧综艺，并出演了新作品《某某》。', modelUsed: 'mock', guardViolations: [] };
  };
  var rFab = await freshness.maybeHandle('付航最近怎么样？', { models: ['mock'], history: [] });
  ok('D-a 集成：虚构事实 → 拦截降级', rFab && rFab.mode === 'freshness-downgrade' &&
    rFab.freshness.downgrade_reason === 'fabrication-gate-rejected');
  responder.generateFreshnessAnswer = origGen;

  // ---------- F10：冻结资产 SHA256 4/4 一致 ----------
  console.log('\n[F10] 冻结资产 SHA256 比对');
  var shaAllMatch = true;
  Object.keys(FROZEN_BASELINE).forEach(function (f) {
    var cur = sha256File(f);
    var match = cur === FROZEN_BASELINE[f];
    if (!match) shaAllMatch = false;
    ok('冻结资产 ' + f + ' SHA 一致', match, match ? 'ok' : ('\n    改后=' + cur + '\n    基准=' + FROZEN_BASELINE[f]));
  });
  ok('F10：四冻结资产 4/4 MATCH', shaAllMatch);

  // ---------- 汇总 ----------
  console.log('\n========================================');
  console.log('Phase Q1-B 离线验证结果');
  console.log('passed: ' + passed + '  failed: ' + failed);
  if (failures.length) {
    console.log('--- 失败用例 ---');
    failures.forEach(function (f) { console.log('  \u2717 ' + f); });
  }
  console.log('========================================');
  process.exit(failed ? 1 : 0);
})().catch(function (e) {
  console.error('测试执行异常:', e);
  process.exit(1);
});
