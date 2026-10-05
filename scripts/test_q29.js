// ============================================================
// scripts/test_q29.js
//   Phase Q2-10：provider-agnostic 国内搜索 API 接入 — 离线验证
//
//   运行：node scripts/test_q29.js
//   授权约束：零真实网络（fakeFetch 模拟国内搜索 API）；
//     不部署 / 不扩用户 / 不触冻结资产 / 不改生产环境变量。
//
//   必须验证 6 项：
//     1. 搜索结果进入回答
//     2. 搜索失败自动回退 RAG
//     3. corpus SHA 不变化
//     4. embedding 数量不变化（corpus 条目数代理）
//     5. audit 不包含：query / 用户信息 / 搜索全文 / URL
//     6. data_route = domestic
//
//   额外：适配器通用性单测（不同响应形状 + RESULT_PATH 字段映射均可解析）
//
//   Node 16.13 兼容（无可选链 / 空值合并）。
// ============================================================
'use strict';

var path = require('path');
var fs = require('fs');
var crypto = require('crypto');

var CHAT = path.join(__dirname, '..', 'cloudfunctions', 'chat');
var thinkEngine = require(path.join(CHAT, 'think', 'thinkEngine'));
var searchLayer = require(path.join(CHAT, 'providers', 'search'));
var domesticApi = require(path.join(CHAT, 'providers', 'search', 'domesticApiSearch'));
var retriever = require(path.join(CHAT, 'freshness', 'eventRetriever'));
var guard = require(path.join(CHAT, 'freshnessRuntimeGuard'));

var FROZEN = ['corpus.json', 'intent.js', 'knowledgeRouter.js', 'rag.js'];
var BASELINE = {
  'corpus.json': '068fa1fa052ec7b93a9d60008c26b29c425c40f0ab724ab33483dbd1001459ae',
  'intent.js': '765ad138ec68c0f159c6f75a60e5268beb02fba152f6d53dbdc539ba1560ca38',
  'knowledgeRouter.js': '848908445dbb5ea93a6f52775dc3c8e6922ff971d6cee115547f236ffed0a935',
  'rag.js': '90c9cc5fe1d9f30837f63a9a67d512e6d08262ef19e125ddd7bebf8ee0890698',
};

// ---------- 断言框架 ----------
var pass = 0, fail = 0;
var fails = [];
function ok(cond, msg) { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; fails.push(msg); console.log('  ✗ ' + msg); } }
function eq(a, b, msg) { ok(a === b, msg + ' (期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a) + ')'); }
function notIn(hay, needle, msg) { ok(('' + hay).indexOf(needle) < 0, msg + ' (必须不含「' + needle + '」)'); }
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
function qParam(url) {
  var m = /[?&]q=([^&]+)/.exec(url || '');
  if (!m) return '';
  try { return decodeURIComponent(m[1]); } catch (e) { return ''; }
}
// 模拟国内搜索 API（天行/聚合类形状：{ code, newslist:[{title,url,content}] }）
function makeDomesticFakeFetch() {
  return function (url) {
    var q = qParam(url);
    var tag = q ? q.slice(0, 10) : '查询';
    var body = {
      code: 200,
      newslist: [
        { title: '国内源·' + tag, url: 'https://www.gov.cn/notice/' + hashStr(q),
          content: L2_MARK + '关于「' + tag + '」的国内公开检索摘要' },
        { title: '媒体报道·' + tag, url: 'https://www.people.com.cn/x/' + (hashStr(q) + 1),
          content: L2_MARK + '关于「' + tag + '」的公开数据更新' }
      ]
    };
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(body); } });
  };
}
function makeEmptyFakeFetch() {
  return function () { return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ code: 200, newslist: [] }); } }); };
}
function makeThrowFakeFetch() {
  return function () { return Promise.reject(new Error('network down (simulated)')); };
}

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

// L2 上线配置草案（domestic 通用 API 适配层）
var CANARY_OPENID = 'oCANARY_q29_test_001';
var DOMESTIC_BASE = 'https://api.domestic.search/v1/search'; // 占位；真实部署填国内合规 API
var L2_ENV = {
  FRESHNESS_ENABLED: 'true',                 // 总闸：否则 freshness 层不加载、事实检索不可达
  SEARCH_PROVIDER: 'domestic',
  FRESHNESS_FACTUAL_ENABLED: 'true',
  PRIVACY_GATE_ENABLED: 'true',
  SEARCH_CANARY_ENABLED: 'true',
  SEARCH_CANARY_OPENIDS: CANARY_OPENID,
  SEARCH_MAX_RESULTS: '5',
  SEARCH_TIMEOUT_MS: '3000',
  SEARCH_DAILY_QUOTA: '500',
  // —— 替代废弃的 SEARXNG_* 变量 ——
  DOMESTIC_API_BASE_URL: DOMESTIC_BASE,
  DOMESTIC_API_KEY: 'test-bearer-key',
  DOMESTIC_API_AUTH: 'bearer',
  DOMESTIC_API_QUERY_PARAM: 'q',
  DOMESTIC_API_RESULT_PATH: 'newslist',       // 显式字段映射，证明通用性（非硬编码 API 形状）
  DOMESTIC_API_FIELD_TITLE: 'title',
  DOMESTIC_API_FIELD_URL: 'url',
  DOMESTIC_API_FIELD_SNIPPET: 'content'
};

// 20 条真实问题（4 类各 5；Q18-20 为搜索失败回退组）
var QUESTIONS = [
  { id: 1, cat: '实时时间', q: '现在北京时间几点了', mode: 'fast', net: true },
  { id: 2, cat: '实时时间', q: '今天农历是初几', mode: 'fast', net: true },
  { id: 3, cat: '实时时间', q: '今年中秋节是公历哪一天', mode: 'fast', net: true },
  { id: 4, cat: '实时时间', q: '现在距离2026年底还有多少天', mode: 'fast', net: true },
  { id: 5, cat: '实时时间', q: '现在新疆和北京的时间差是多少', mode: 'fast', net: true },
  { id: 6, cat: '新闻热点', q: '今天有哪些重要的科技新闻', mode: 'fast', net: true },
  { id: 7, cat: '新闻热点', q: '最近国务院有什么新政策发布', mode: 'fast', net: true },
  { id: 8, cat: '新闻热点', q: '今年高考分数线什么时候公布', mode: 'fast', net: true },
  { id: 9, cat: '新闻热点', q: '最近新能源汽车销量有什么新数据', mode: 'fast', net: true },
  { id: 10, cat: '新闻热点', q: '最近有什么重大的体育赛事消息', mode: 'fast', net: true },
  { id: 11, cat: '普通知识', q: '光合作用的基本原理是什么', mode: 'fast', net: true },
  { id: 12, cat: '普通知识', q: '量子纠缠通俗解释一下', mode: 'fast', net: true },
  { id: 13, cat: '普通知识', q: '长江有多少公里长', mode: 'fast', net: true },
  { id: 14, cat: '普通知识', q: '人工智能大模型的训练需要哪些条件', mode: 'fast', net: true },
  { id: 15, cat: '普通知识', q: '民法典关于合同违约是怎么规定的', mode: 'fast', net: true },
  { id: 16, cat: '经典问题', q: '论语里关于学习的名言有哪些', mode: 'fast', net: true },
  { id: 17, cat: '经典问题', q: '庄子逍遥游表达了什么思想', mode: 'fast', net: true },
  { id: 18, cat: '经典问题', q: '王阳明心学核心观点是什么', mode: 'think', net: false },
  { id: 19, cat: '经典问题', q: '如何理解道德经中的无为', mode: 'fast', net: false },
  { id: 20, cat: '经典问题', q: '苏格拉底提问法的精髓是什么', mode: 'fast', net: false }
];

// ---------- audit 泄露扫描（验证项 5） ----------
function assertAuditClean(audit, query, openid, collectedUrls) {
  if (!audit) { ok(false, 'audit 存在且可扫描'); return; }
  var s = JSON.stringify(audit);
  notIn(s, query, 'audit 不含原始 query「' + query.slice(0, 8) + '…」');
  notIn(s, openid, 'audit 不含用户信息(openid)');
  collectedUrls.forEach(function (u) { notIn(s, u, 'audit 不含结果 URL ' + u); });
  notIn(s, L2_MARK, 'audit 不含搜索全文/片段(' + L2_MARK + ')');
  ok(guard.verifyAudit(audit).ok, 'audit 通过 guard 白名单（仅安全字段）');
}

// ============================================================
(function () {
  var realFetch = retriever.nodeFetch;

  // ---------- 执行前检查 ----------
  section('执行前检查：冻结资产 SHA 基线比对（验证项 3/4 前置）');
  FROZEN.forEach(function (f) {
    eq(sha256File(path.join(CHAT, f)), BASELINE[f], f + ' SHA = 基线（未变化）');
  });
  var snapBefore = snapshotFrozen();
  console.log('  · corpus 条目数(派生 embedding 向量数) = ' + snapBefore.corpusLen);

  // ============================================================
  // 适配器通用性单测（证明零编造：不同响应形状 + 字段映射均可解析为 domestic）
  // ============================================================
  section('适配器通用性单测：不同国内 API 响应形状均可解析');

  // (a) 天行类 { code, newslist:[{title,url,content}] }
  withEnv({ DOMESTIC_API_BASE_URL: DOMESTIC_BASE, DOMESTIC_API_RESULT_PATH: 'newslist', DOMESTIC_API_FIELD_TITLE: 'title', DOMESTIC_API_FIELD_URL: 'url', DOMESTIC_API_FIELD_SNIPPET: 'content' },
    function () {
      var ff = function () { return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ code: 200, newslist: [{ title: 't', url: 'https://a.cn/x', content: '摘要' }] }); } }); };
      return domesticApi.search('量子计算', {}, ff).then(function (r) {
        eq(r.provider, 'domestic', '(a) provider=domestic');
        eq(r.ok, true, '(a) 天行形状解析成功(ok=true)');
        ok(Array.isArray(r.results) && r.results.length === 1 && r.results[0].url === 'https://a.cn/x', '(a) 结果含 url 且字段映射生效');
      });
    }
  ).then(function () {
    // (b) 聚合类 { error_code, result:[{title,url,content}] }
    return withEnv({ DOMESTIC_API_BASE_URL: DOMESTIC_BASE, DOMESTIC_API_RESULT_PATH: 'result', DOMESTIC_API_FIELD_TITLE: 'title', DOMESTIC_API_FIELD_URL: 'url', DOMESTIC_API_FIELD_SNIPPET: 'content' },
      function () {
        var ff = function () { return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ error_code: 0, result: [{ title: 'j', url: 'https://b.cn/y', content: '摘要2' }] }); } }); };
        return domesticApi.search('高考', {}, ff).then(function (r) {
          eq(r.ok, true, '(b) 聚合形状解析成功(ok=true)');
          ok(Array.isArray(r.results) && r.results.length === 1 && r.results[0].url === 'https://b.cn/y', '(b) 结果字段映射生效');
        });
      }
    );
  }).then(function () {
    // (c) 自动探测：无 RESULT_PATH 时识别 { results:[...] }
    return withEnv({ DOMESTIC_API_BASE_URL: DOMESTIC_BASE },
      function () {
        var ff = function () { return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ results: [{ title: 'auto', url: 'https://c.cn/z', content: '摘要3' }] }); } }); };
        return domesticApi.search('测试', {}, ff).then(function (r) {
          eq(r.ok, true, '(c) 自动探测 shapes 解析成功(ok=true)');
        });
      }
    );
  }).then(function () {
    // (d) 未配置端点 → no_endpoint（fail-soft，不联网）
    return withEnv({}, function () {
      return domesticApi.search('测试', {}, function () { return Promise.reject(new Error('should not call')); }).then(function (r) {
        eq(r.ok, false, '(d) 无端点降级 ok=false');
        eq(r.reason, 'no_endpoint', '(d) reason=no_endpoint');
      });
    });
  }).then(function () {
    // ============================================================
    // 护栏在线（支持验证项 5/6）
    // ============================================================
    section('护栏在线：privacyGate / canaryGate / quota（验证项 5/6 支撑）');

    // (a) PII → pii_blocked，零外呼，data_route=blocked
    return withEnv({ FRESHNESS_ENABLED: 'true', SEARCH_PROVIDER: 'domestic', PRIVACY_GATE_ENABLED: 'true', SEARCH_CANARY_ENABLED: 'false', DOMESTIC_API_BASE_URL: DOMESTIC_BASE },
      function () {
        var call = 0;
        retriever.nodeFetch = function () { call++; return makeDomesticFakeFetch()(); };
        searchLayer._setConfig({ dailyQuota: 500 }); searchLayer._resetDaily(); searchLayer._resetCache();
        return searchLayer.search('我的手机号是13800138000，帮我查下', { openid: CANARY_OPENID })
          .then(function (res) {
            eq(res.ok, false, 'PII：检索被拒(ok=false)');
            eq(res.reason, 'pii_blocked', 'PII：reason=pii_blocked');
            eq(res.audit.data_route, 'blocked', 'PII：data_route=blocked（数据未出境）');
            ok(call === 0, 'PII：未发起任何外呼（privacyGate 最前端拦截）');
            ok(guard.verifyAudit(res.audit).ok, 'PII：审计仅安全字段');
          });
      }
    );
  }).then(function () {
    // (b) 非白名单 openid → 强制 mock，无真实外呼，data_route=domestic
    return withEnv({ FRESHNESS_ENABLED: 'true', SEARCH_PROVIDER: 'domestic', FRESHNESS_FACTUAL_ENABLED: 'true', PRIVACY_GATE_ENABLED: 'false', SEARCH_CANARY_ENABLED: 'true', SEARCH_CANARY_OPENIDS: CANARY_OPENID, DOMESTIC_API_BASE_URL: DOMESTIC_BASE },
      function () {
        retriever.nodeFetch = makeDomesticFakeFetch();
        searchLayer._resetDaily(); searchLayer._resetCache();
        return searchLayer.search('今天有什么科技新闻', { openid: 'oNOT_whitelisted_user' })
          .then(function (res) {
            eq(res.audit.canary_blocked, true, '非白名单：canary_blocked=true');
            eq(res.provider, 'mock', '非白名单：provider 降级 mock（无真实外呼）');
            eq(res.audit.data_route, 'domestic', '非白名单：data_route=domestic（零跨境）');
          });
      }
    );
  }).then(function () {
    // (c) 配额耗尽 → quota_exceeded
    return withEnv(L2_ENV,
      function () {
        retriever.nodeFetch = makeDomesticFakeFetch();
        searchLayer._setConfig({ dailyQuota: 0 }); searchLayer._resetDaily(); searchLayer._resetCache();
        return searchLayer.search('今天有什么新闻', { openid: CANARY_OPENID })
          .then(function (res) {
            eq(res.ok, false, '配额耗尽：ok=false');
            eq(res.reason, 'quota_exceeded', '配额耗尽：reason=quota_exceeded');
            eq(res.audit.data_route, 'domestic', '配额耗尽：data_route=domestic');
          });
      }
    );
  }).then(function () {
    // ============================================================
    // 20 条真实问题主流程（必须在 L2_ENV 作用域内）
    // ============================================================
    section('20 条真实问题主流程（domestic 通用 API + 全护栏开启）');
    return withEnv(L2_ENV, function () {
      retriever.nodeFetch = makeDomesticFakeFetch();
      searchLayer._setConfig({ dailyQuota: 500 }); searchLayer._resetDaily(); searchLayer._resetCache();

      function runOne(item) {
        var prev = retriever.nodeFetch;
        if (!item.net) retriever.nodeFetch = (item.id === 20) ? makeThrowFakeFetch() : makeEmptyFakeFetch();
        var lastAudit = null;
        var urls = [];
        var opts = {
          answerMode: item.mode,
          factualEnabled: true,
          searchProvider: 'domestic',
          searchFn: function (q, o) {
            return searchLayer.search(q, o).then(function (r) {
              lastAudit = r.audit;
              (r.results || []).forEach(function (x) { if (x && x.url) urls.push(x.url); });
              return r;
            });
          },
          generateAnswer: fakeRag,
          openid: CANARY_OPENID
        };
        return thinkEngine.run(item.q, opts).then(function (result) {
          retriever.nodeFetch = prev;
          if (item.mode === 'fast' && result === null) {
            return fakeRag(item.q, {}).then(function (r) { return { item: item, result: r, lastAudit: lastAudit, urls: urls, fallback: true }; });
          }
          return { item: item, result: result, lastAudit: lastAudit, urls: urls, fallback: false };
        });
      }

      var collected = [];
      var chain = Promise.resolve();
      QUESTIONS.forEach(function (item) {
        chain = chain.then(function () { return runOne(item); }).then(function (r) { collected.push(r); });
      });
      return chain.then(function () {
        section('验证项 1/2/5/6：逐条断言');
        var routeSet = {};
        var anyCrossBorder = false;
        collected.forEach(function (c) {
          var item = c.item, res = c.result, audit = c.lastAudit;
          if (item.net) {
            ok(res !== null, 'Q' + item.id + '[' + item.cat + '] 在线检索成功接管');
            includes(res && res.answer, L2_MARK, '【验证1】Q' + item.id + ' 联网检索结果进入回答文本');
            ok(audit !== null, 'Q' + item.id + ' 携带 searchAudit');
            if (audit) {
              eq(audit.data_route, 'domestic', '【验证6】Q' + item.id + ' data_route=domestic');
              assertAuditClean(audit, item.q, CANARY_OPENID, c.urls || []);
              if (audit.data_route === 'cross_border') anyCrossBorder = true;
              routeSet[audit.data_route] = (routeSet[audit.data_route] || 0) + 1;
            }
          } else {
            if (item.mode === 'think') {
              ok(res !== null, 'Q' + item.id + '[think] 搜索失败 → 引擎仍返回结果');
              includes(res && res.answer, '【RAG知识库回答】', '【验证2】Q' + item.id + ' 搜索失败回退 RAG(think 内部兜底)');
            } else {
              ok(c.fallback === true, 'Q' + item.id + '[fast] 派发器回退触发');
              includes(res && res.answer, '【RAG知识库回答】', '【验证2】Q' + item.id + ' 搜索失败回退 RAG(派发器兜底)');
            }
            if (audit) {
              eq(audit.data_route, 'domestic', '【验证6】Q' + item.id + ' 失败路径 data_route 仍 domestic');
              assertAuditClean(audit, item.q, CANARY_OPENID, c.urls || []);
              routeSet[audit.data_route] = (routeSet[audit.data_route] || 0) + 1;
            }
          }
        });

        section('验证项 5（汇总）：审计泄露扫描');
        ok(!anyCrossBorder, '汇总：20 问全程零 cross_border');
        console.log('  · data_route 分布: ' + (Object.keys(routeSet).map(function (k) { return k + '=' + routeSet[k]; }).join(', ') || '(无)'));

        var leaked = 0;
        QUESTIONS.forEach(function (item) {
          var a = collected[item.id - 1].lastAudit;
          if (a) {
            var s = JSON.stringify(a);
            if (s.indexOf(item.q) >= 0) leaked++;
            if (s.indexOf(CANARY_OPENID) >= 0) leaked++;
          }
        });
        eq(leaked, 0, '【验证5】所有审计累计零泄露（query/openid 均不在 audit 中）');

        return Promise.resolve();
      });
    });
  }).then(function () {
    // ---------- 执行后检查：corpus SHA / embedding 数不变 ----------
    section('验证项 3/4：corpus 完整性（KB 未被写入）');
    var snapAfter = snapshotFrozen();
    FROZEN.forEach(function (f) {
      eq(snapAfter.items[f].sha, snapBefore.items[f].sha, '【验证3】' + f + ' SHA 前后一致');
      eq(snapAfter.items[f].mtime, snapBefore.items[f].mtime, f + ' mtime 前后一致（未被写入）');
    });
    eq(snapAfter.corpusLen, snapBefore.corpusLen, '【验证4】corpus 条目数前后一致（派生 embedding 向量数不变，无 ingest）');

    retriever.nodeFetch = realFetch;
    return Promise.resolve();
  }).then(function () {
    console.log('\n========================================');
    console.log('Phase Q2-10 离线验证: ' + pass + ' PASS / ' + fail + ' FAIL');
    console.log('========================================');
    if (fail > 0) { console.log('失败项:'); fails.forEach(function (m) { console.log('  - ' + m); }); process.exit(1); }
    process.exit(0);
  }).catch(function (e) {
    retriever.nodeFetch = realFetch;
    console.error('测试运行异常:', e);
    process.exit(2);
  });
})();
