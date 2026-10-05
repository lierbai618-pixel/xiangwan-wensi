// ============================================================
// scripts/test_q27.js
//   Phase Q2-7：Domestic Search L2 Canary Activation（离线金丝雀就绪验证）
//
//   运行：node scripts/test_q27.js
//   约束（用户授权）：零真实网络（fakeFetch 模拟国内 SearXNG 返回）；
//     不部署生产 / 不扩用户 / 不触及冻结资产。
//
//   本脚本验证「若按 L2 灰度配置（SEARCH_PROVIDER=domestic +
//   FRESHNESS_FACTUAL_ENABLED=true + PRIVACY_GATE_ENABLED=true +
//   SEARCH_CANARY_ENABLED=true + 白名单 openid）上线，20 条真实问题
//   会如何表现」。覆盖用户 6 项验证 + 护栏在线 + 零跨境证明。
//
//   Node 16.13 兼容（无可选链 / 空值合并 / 模板字符串仅用于断言文本）。
// ============================================================
'use strict';

var path = require('path');
var fs = require('fs');
var crypto = require('crypto');

var CHAT = path.join(__dirname, '..', 'cloudfunctions', 'chat');
var thinkEngine = require(path.join(CHAT, 'think', 'thinkEngine'));
var searchLayer = require(path.join(CHAT, 'providers', 'search'));
var retriever = require(path.join(CHAT, 'freshness', 'eventRetriever'));
var guard = require(path.join(CHAT, 'freshnessRuntimeGuard'));

var FROZEN = ['corpus.json', 'intent.js', 'knowledgeRouter.js', 'rag.js'];
// 基线 SHA（来自工作记忆，须与磁盘一致；不一致=冻结资产被破坏）
var BASELINE = {
  'corpus.json': '068fa1fa052ec7b93a9d60008c26b29c425c40f0ab724ab33483dbd1001459ae',
  'intent.js': '765ad138ec68c0f159c6f75a60e5268beb02fba152f6d53dbdc539ba1560ca38',
  'knowledgeRouter.js': '848908445dbb5ea93a6f52775dc3c8e6922ff971d6cee115547f236ffed0a935',
  'rag.js': '90c9cc5fe1d9f30837f63a9a67d512e6d08262ef19e125ddd7bebf8ee0890698',
};

// ---------- 轻量断言框架 ----------
var pass = 0, fail = 0;
var fails = [];
function ok(cond, msg) { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; fails.push(msg); console.log('  ✗ ' + msg); } }
function eq(a, b, msg) { ok(a === b, msg + ' (期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a) + ')'); }
function includes(hay, needle, msg) { ok(('' + hay).indexOf(needle) >= 0, msg + ' (需包含「' + needle + '」)'); }
function section(name) { console.log('\n=== ' + name + ' ==='); }

function sha256File(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
function mtimeMs(p) { return fs.statSync(p).mtimeMs; }

function snapshotFrozen() {
  var snap = { corpusLen: 0, items: {} };
  FROZEN.forEach(function (f) {
    var p = path.join(CHAT, f);
    snap.items[f] = { sha: sha256File(p), mtime: mtimeMs(p) };
  });
  snap.corpusLen = require(path.join(CHAT, 'corpus.json')).length;
  return snap;
}

// ---------- fakeFetch（绝不触网） ----------
var L2_MARK = '【L2联网】';
function hashStr(s) { var h = 0; s = '' + s; for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; } return h; }

// 模拟国内 SearXNG（仅国内引擎）返回：带 L2 标记 + 来源域名（绝不含境外/PII）
function makeDomesticFakeFetch() {
  return function (url) {
    var q = '';
    var m = /[?&]q=([^&]+)/.exec(url || '');
    if (m) { try { q = decodeURIComponent(m[1]); } catch (e) { q = ''; } }
    var tag = q ? q.slice(0, 10) : '查询';
    var body = {
      results: [
        { title: '国内源·' + tag, url: 'https://www.gov.cn/notice/' + hashStr(q),
          snippet: L2_MARK + '关于「' + tag + '」的国内公开检索摘要', content: L2_MARK + '关于「' + tag + '」的国内公开检索摘要',
          source: 'baidu', engine: 'baidu' },
        { title: '媒体报道·' + tag, url: 'https://www.people.com.cn/x/' + (hashStr(q) + 1),
          snippet: L2_MARK + '关于「' + tag + '」的公开数据更新', content: L2_MARK + '关于「' + tag + '」的公开数据更新',
          source: 'sogou', engine: 'sogou' }
      ]
    };
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(body); } });
  };
}
// 失败注入：provider 返回空结果（无可用事实 → 应回退 RAG）
function makeEmptyFakeFetch() {
  return function () { return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ results: [] }); } }); };
}
// 失败注入：网络异常（transport error → searchLayer catch → provider_exception）
function makeThrowFakeFetch() {
  return function () { return Promise.reject(new Error('network down (simulated)')); };
}

// ---------- fake RAG（generateAnswer 注入） ----------
function fakeRag(message) {
  return Promise.resolve({
    answer: '【RAG知识库回答】' + message,
    citations: [{ title: '论语·学而', summary: '学而时习之', knowledge_type: 'classic' }],
    retrieval: { queryTerms: [], totalDocuments: 1, minScore: 0.5, search: false },
  });
}

// ---------- 环境辅助 ----------
function withEnv(env, fn) {
  var bak = {};
  Object.keys(env).forEach(function (k) { bak[k] = process.env[k]; process.env[k] = env[k]; });
  var r;
  return Promise.resolve().then(function () { return fn(); }).then(function (res) { r = res; return res; })
    .finally(function () {
      Object.keys(env).forEach(function (k) {
        if (bak[k] === undefined) delete process.env[k]; else process.env[k] = bak[k];
      });
      return r;
    });
}

// L2 金丝雀配置（草案，须部署才生效；本阶段不应用）
var L2_ENV = {
  SEARCH_PROVIDER: 'domestic',
  FRESHNESS_FACTUAL_ENABLED: 'true',
  PRIVACY_GATE_ENABLED: 'true',
  SEARCH_CANARY_ENABLED: 'true',
  SEARCH_CANARY_OPENIDS: 'oCANARY_l2_test_001',
  SEARXNG_BASE_URL: 'https://searx.internal.search/search', // 仅占位，测试用 fakeFetch 拦截
};
var CANARY_OPENID = 'oCANARY_l2_test_001';

// ============================================================
// 20 条真实问题（4 类各 5；其中 Q18-20 为搜索失败回退组）
// ============================================================
var QUESTIONS = [
  // —— 实时时间 ——
  { id: 1, cat: '实时时间', q: '现在北京时间几点了', mode: 'fast', net: true },
  { id: 2, cat: '实时时间', q: '今天农历是初几', mode: 'fast', net: true },
  { id: 3, cat: '实时时间', q: '今年中秋节是公历哪一天', mode: 'fast', net: true },
  { id: 4, cat: '实时时间', q: '现在距离2026年底还有多少天', mode: 'fast', net: true },
  { id: 5, cat: '实时时间', q: '现在新疆和北京的时间差是多少', mode: 'fast', net: true },
  // —— 新闻热点 ——
  { id: 6, cat: '新闻热点', q: '今天有哪些重要的科技新闻', mode: 'fast', net: true },
  { id: 7, cat: '新闻热点', q: '最近国务院有什么新政策发布', mode: 'fast', net: true },
  { id: 8, cat: '新闻热点', q: '今年高考分数线什么时候公布', mode: 'fast', net: true },
  { id: 9, cat: '新闻热点', q: '最近新能源汽车销量有什么新数据', mode: 'fast', net: true },
  { id: 10, cat: '新闻热点', q: '最近有什么重大的体育赛事消息', mode: 'fast', net: true },
  // —— 普通知识 ——
  { id: 11, cat: '普通知识', q: '光合作用的基本原理是什么', mode: 'fast', net: true },
  { id: 12, cat: '普通知识', q: '量子纠缠通俗解释一下', mode: 'fast', net: true },
  { id: 13, cat: '普通知识', q: '长江有多少公里长', mode: 'fast', net: true },
  { id: 14, cat: '普通知识', q: '人工智能大模型的训练需要哪些条件', mode: 'fast', net: true },
  { id: 15, cat: '普通知识', q: '民法典关于合同违约是怎么规定的', mode: 'fast', net: true },
  // —— 经典问题（在线） ——
  { id: 16, cat: '经典问题', q: '论语里关于学习的名言有哪些', mode: 'fast', net: true },
  { id: 17, cat: '经典问题', q: '庄子逍遥游表达了什么思想', mode: 'fast', net: true },
  // —— 经典问题（搜索失败回退组） ——
  { id: 18, cat: '经典问题', q: '王阳明心学核心观点是什么', mode: 'think', net: false },
  { id: 19, cat: '经典问题', q: '如何理解道德经中的无为', mode: 'fast', net: false },
  { id: 20, cat: '经典问题', q: '苏格拉底提问法的精髓是什么', mode: 'fast', net: false },
];

// ============================================================
(function () {
  var realFetch = retriever.nodeFetch;

  // ---------- 执行前检查 1：冻结资产 SHA 未变化 ----------
  section('执行前检查 1：冻结资产 SHA 基线比对');
  FROZEN.forEach(function (f) {
    var cur = sha256File(path.join(CHAT, f));
    eq(cur, BASELINE[f], f + ' SHA = 基线（未变化）');
  });
  var snapBefore = snapshotFrozen();
  console.log('  · corpus 条目数(派生 embedding 向量数) = ' + snapBefore.corpusLen);

  // ============================================================
  // 护栏在线检查（独立于 20 问，验证五护栏在 L2 配置下行为正确）
  // ============================================================
  section('护栏在线检查：privacyGate / canaryGate / quota / audit / guard');

  // (a) privacyGate 在线：高风险 PII → pii_blocked，data_route=blocked，绝不外呼
  withEnv({ SEARCH_PROVIDER: 'domestic', PRIVACY_GATE_ENABLED: 'true', SEARCH_CANARY_ENABLED: 'false' },
    function () {
      var fetchCallCount = 0;
      retriever.nodeFetch = function () { fetchCallCount++; return makeDomesticFakeFetch()(); };
      searchLayer._setConfig({ dailyQuota: 500 }); searchLayer._resetDaily(); searchLayer._resetCache();
      return searchLayer.search('我的手机号是13800138000，帮我查下', { openid: CANARY_OPENID })
        .then(function (res) {
          eq(res.ok, false, 'PII 查询：检索被拒（ok=false）');
          eq(res.reason, 'pii_blocked', 'PII 查询：reason=pii_blocked');
          eq(res.audit.data_route, 'blocked', 'PII 查询：data_route=blocked（数据未出境）');
          ok(fetchCallCount === 0, 'PII 查询：未发起任何外呼（privacyGate 最前端拦截）');
          ok(guard.verifyAudit(res.audit).ok, 'PII 查询：审计仅安全字段');
        });
    }
  ).then(function () {
    // (b) canaryGate 在线：非白名单 openid → 强制 mock，canary_blocked=true
    return withEnv({ SEARCH_PROVIDER: 'domestic', FRESHNESS_FACTUAL_ENABLED: 'true', PRIVACY_GATE_ENABLED: 'false', SEARCH_CANARY_ENABLED: 'true', SEARCH_CANARY_OPENIDS: CANARY_OPENID, SEARXNG_BASE_URL: L2_ENV.SEARXNG_BASE_URL },
      function () {
        retriever.nodeFetch = makeDomesticFakeFetch();
        searchLayer._resetDaily(); searchLayer._resetCache();
        return searchLayer.search('今天有什么科技新闻', { openid: 'oNOT_whitelisted_user' })
          .then(function (res) {
            eq(res.audit.canary_blocked, true, '非白名单 openid：canary_blocked=true');
            eq(res.provider, 'mock', '非白名单 openid：provider 被降级为 mock（无真实外呼）');
            eq(res.audit.data_route, 'domestic', '非白名单 openid：data_route 仍 domestic（零跨境）');
            ok(guard.verifyAudit(res.audit).ok, '非白名单 openid：审计仅安全字段');
          });
      }
    );
  }).then(function () {
    // (c) quota 在线：日配额耗尽 → quota_exceeded（_config.dailyQuota 控制，非 env-at-call）
    return withEnv({ SEARCH_PROVIDER: 'domestic', FRESHNESS_FACTUAL_ENABLED: 'true', PRIVACY_GATE_ENABLED: 'true', SEARCH_CANARY_ENABLED: 'true', SEARCH_CANARY_OPENIDS: CANARY_OPENID, SEARXNG_BASE_URL: L2_ENV.SEARXNG_BASE_URL },
      function () {
        retriever.nodeFetch = makeDomesticFakeFetch();
        searchLayer._setConfig({ dailyQuota: 0 }); searchLayer._resetDaily(); searchLayer._resetCache();
        return searchLayer.search('今天有什么新闻', { openid: CANARY_OPENID })
          .then(function (res) {
            eq(res.ok, false, '配额耗尽：检索被拒（ok=false）');
            eq(res.reason, 'quota_exceeded', '配额耗尽：reason=quota_exceeded');
            eq(res.audit.data_route, 'domestic', '配额耗尽：data_route=domestic（零跨境）');
            ok(res.audit.quota_remaining === 0, '配额耗尽：quota_remaining=0');
          });
      }
    );
  }).then(function () {
    // (d) freshnessRuntimeGuard 在线：白名单 openid 成功检索 → 通过隔离校验
    return withEnv(L2_ENV, function () {
      retriever.nodeFetch = makeDomesticFakeFetch();
      searchLayer._setConfig({ dailyQuota: 500 }); searchLayer._resetDaily(); searchLayer._resetCache();
      return searchLayer.search('量子计算最新进展', { openid: CANARY_OPENID })
        .then(function (res) {
          ok(res.ok === true, '护栏自检：白名单 openid 成功检索（ok=true）');
          var rep = guard.makeIsolationReport({ think: { searchAudit: res.audit } });
          ok(rep.ok, 'freshnessRuntimeGuard：正常 canary 结果通过隔离校验（无 KB 泄露/审计合规）');
        });
    });
  }).then(function () {
    // ============================================================
    // 20 条真实问题 L2 金丝雀（必须在 L2_ENV 作用域内运行）
    // ============================================================
    section('20 条真实问题 L2 金丝雀（domestic + 全护栏开启）');
    return withEnv(L2_ENV, function () {
      retriever.nodeFetch = makeDomesticFakeFetch();
      searchLayer._setConfig({ dailyQuota: 500 }); searchLayer._resetDaily(); searchLayer._resetCache();

      // 逐条运行；捕获 searchLayer.search 的审计 + 模拟 fast 派发器回退
      function runOne(item) {
        var prevFetch = retriever.nodeFetch;
        if (!item.net) {
          retriever.nodeFetch = (item.id === 20) ? makeThrowFakeFetch() : makeEmptyFakeFetch();
        }
        var lastAudit = null;
        var opts = {
          answerMode: item.mode,
          factualEnabled: true,
          searchProvider: 'domestic',
          searchFn: function (q, o) {
            return searchLayer.search(q, o).then(function (r) { lastAudit = r.audit; return r; });
          },
          generateAnswer: fakeRag,
          openid: CANARY_OPENID,
        };
        return thinkEngine.run(item.q, opts).then(function (result) {
          retriever.nodeFetch = prevFetch; // 还原，避免影响后续
          if (item.mode === 'fast' && result === null) {
            // 模拟 index.js 派发器：thinkEngine 返回 null → 回退 RAG 知识库
            return fakeRag(item.q, {}).then(function (r) {
              return { item: item, result: r, lastAudit: lastAudit, fallback: true };
            });
          }
          return { item: item, result: result, lastAudit: lastAudit, fallback: false };
        });
      }

      var collected = [];
      var chain = Promise.resolve();
      QUESTIONS.forEach(function (item) {
        chain = chain.then(function () { return runOne(item); }).then(function (r) { collected.push(r); });
      });

      return chain.then(function () {
        // ---- 逐条断言 ----
        var routeSet = {};
        var anyCrossBorder = false;
        collected.forEach(function (c) {
          var item = c.item, res = c.result, audit = c.lastAudit;
          if (item.net) {
            ok(res !== null, 'Q' + item.id + '[' + item.cat + '](' + item.mode + ') 在线检索成功接管');
            includes(res && res.answer, L2_MARK, 'Q' + item.id + ' 联网检索结果进入回答文本');
            ok(audit !== null, 'Q' + item.id + ' 携带 searchAudit');
            if (audit) {
              eq(audit.data_route, 'domestic', 'Q' + item.id + ' data_route=domestic（零跨境）');
              ok(guard.verifyAudit(audit).ok, 'Q' + item.id + ' audit 仅安全字段（无敏感信息）');
              if (audit.data_route === 'cross_border') anyCrossBorder = true;
              routeSet[audit.data_route] = (routeSet[audit.data_route] || 0) + 1;
            }
          } else {
            // 搜索失败回退组：必须回到 RAG 知识库
            if (item.mode === 'think') {
              ok(res !== null, 'Q' + item.id + '[think] 搜索失败 → 引擎仍返回结果（未崩溃）');
              includes(res && res.answer, '【RAG知识库回答】', 'Q' + item.id + ' 搜索失败自动回退 RAG（think 内部兜底）');
            } else {
              ok(c.fallback === true, 'Q' + item.id + '[fast] 派发器回退触发（引擎返回 null）');
              includes(res && res.answer, '【RAG知识库回答】', 'Q' + item.id + ' 搜索失败自动回退 RAG（派发器兜底）');
            }
            if (audit) {
              eq(audit.data_route, 'domestic', 'Q' + item.id + ' 失败路径 data_route 仍 domestic（零跨境）');
              ok(guard.verifyAudit(audit).ok, 'Q' + item.id + ' 失败路径 audit 合规');
            }
          }
        });

        // ---- 汇总级断言 ----
        section('汇总验证：6 项用户验收');
        ok(!anyCrossBorder, '汇总：20 问全程零 cross_border（仅 domestic 数据路径）');
        var routeSummary = Object.keys(routeSet).map(function (k) { return k + '=' + routeSet[k]; }).join(', ');
        console.log('  · data_route 分布: ' + (routeSummary || '(无 audit)'));
      });
    });
  }).then(function () {
    // ---------- 执行后检查：corpus SHA / embedding 数量不变 ----------
    section('执行后检查：corpus 完整性（KB 未被写入）');
    var snapAfter = snapshotFrozen();
    FROZEN.forEach(function (f) {
      eq(snapAfter.items[f].sha, snapBefore.items[f].sha, f + ' SHA 前后一致');
      eq(snapAfter.items[f].mtime, snapBefore.items[f].mtime, f + ' mtime 前后一致（未被写入）');
    });
    eq(snapAfter.corpusLen, snapBefore.corpusLen, 'corpus 条目数前后一致（派生的 embedding 向量数不变，无 ingest）');

    retriever.nodeFetch = realFetch;
    return Promise.resolve();
  }).then(function () {
    console.log('\n========================================');
    console.log('Phase Q2-7 L2 Canary 测试结果: ' + pass + ' PASS / ' + fail + ' FAIL');
    console.log('========================================');
    if (fail > 0) { console.log('失败项:'); fails.forEach(function (m) { console.log('  - ' + m); }); process.exit(1); }
    process.exit(0);
  }).catch(function (e) {
    retriever.nodeFetch = realFetch;
    console.error('测试运行异常:', e);
    process.exit(2);
  });
})();
