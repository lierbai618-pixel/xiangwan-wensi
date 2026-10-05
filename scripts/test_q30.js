// ============================================================
// scripts/test_q30.js
//   Phase Q2-12：腾讯云联网搜索 WSA Provider Adapter — 离线验证
//
//   运行：node scripts/test_q30.js
//   授权约束：零真实网络（fakeFetch 模拟 WSA POST 接口）；
//     不部署 / 不扩用户 / 不触冻结资产 / 不改生产环境变量。
//
//   单元 + 集成验证：
//     1. provider contract: search(q,opts,nodeFetch) → {ok,provider,results,reason}
//     2. POST method + Bearer Auth + JSON body（含 query）
//     3. Pages JSON string 二次解析（响应 Pages 为 JSON 字符串 → 数组）
//     4. no_endpoint（未配置 BASE_URL → fail-soft 不联网）
//     5. no_results（Pages='[]'）
//     6. provider 名 = 'tencent'
//     7. searchLayer 路由：data_route=domestic / 审计干净
//     8. thinkEngine 集成：结果进入回答 / 失败回退 RAG / 审计不含敏感 / 冻结 SHA 4/4
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
var tencentApi = require(path.join(CHAT, 'providers', 'search', 'tencentWsaSearch'));
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
var TENCENT_MARK = '【TENCENT-WSA】';
var TENCENT_BASE = 'https://api.wsa.cloud.tencent.com/v1/search'; // 占位；真实部署填 WSA 接口
function hashStr(s) { var h = 0; s = '' + s; for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; } return h; }
function bodyQuery(init) {
  try { var b = JSON.parse(init.body); return b.query || b.SearchQuery || ''; } catch (e) { return ''; }
}
// 模拟 WSA 接口：返回 { Pages: "<json string>", code:0 }
function makeTencentFakeFetch(seen) {
  return function (url, init) {
    if (seen) { seen.url = url; seen.init = init; }
    var q = bodyQuery(init);
    var pages = JSON.stringify([
      { title: '腾讯源·' + q, url: 'https://www.qq.com/news/' + hashStr(q),
        content: TENCENT_MARK + '关于「' + q + '」的检索摘要' },
      { title: '媒体报道', url: 'https://www.163.com/x/' + (hashStr(q) + 1),
        content: TENCENT_MARK + '公开数据更新' }
    ]);
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ Pages: pages, code: 0 }); } });
  };
}
// 单条结果
function makeTencentSingleFakeFetch() {
  return function (url, init) {
    var pages = JSON.stringify([{ title: '单条', url: 'https://www.qq.com/s/1', content: TENCENT_MARK + '单条摘要' }]);
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ Pages: pages }); } });
  };
}
// 空结果（Pages='[]'）
function makeTencentEmptyFakeFetch() {
  return function () { return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ Pages: '[]', code: 0 }); } }); };
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

var CANARY_OPENID = 'oCANARY_q30_test_001';
// 驱动 tencent 的 L2 风格配置（仅补充 tencent 专属变量）
var TENCENT_ENV = {
  FRESHNESS_ENABLED: 'true',
  SEARCH_PROVIDER: 'tencent',
  FRESHNESS_FACTUAL_ENABLED: 'true',
  PRIVACY_GATE_ENABLED: 'false',
  SEARCH_CANARY_ENABLED: 'false',
  SEARCH_MAX_RESULTS: '5',
  SEARCH_TIMEOUT_MS: '3000',
  SEARCH_DAILY_QUOTA: '500',
  TENCENT_WSA_BASE_URL: TENCENT_BASE,
  TENCENT_WSA_API_KEY: 'test-tencent-bearer-key'
};

// ---------- audit 泄露扫描 ----------
function assertAuditClean(audit, query, openid, collectedUrls) {
  if (!audit) { ok(false, 'audit 存在且可扫描'); return; }
  var s = JSON.stringify(audit);
  notIn(s, query, 'audit 不含原始 query「' + query.slice(0, 8) + '…」');
  notIn(s, openid, 'audit 不含用户信息(openid)');
  collectedUrls.forEach(function (u) { notIn(s, u, 'audit 不含结果 URL ' + u); });
  notIn(s, TENCENT_MARK, 'audit 不含搜索全文/片段(' + TENCENT_MARK + ')');
  ok(guard.verifyAudit(audit).ok, 'audit 通过 guard 白名单（仅安全字段）');
}

// ============================================================
(function () {
  var realFetch = retriever.nodeFetch;

  section('执行前检查：冻结资产 SHA 基线比对');
  FROZEN.forEach(function (f) {
    eq(sha256File(path.join(CHAT, f)), BASELINE[f], f + ' SHA = 基线（未变化）');
  });
  var snapBefore = snapshotFrozen();
  console.log('  · corpus 条目数(派生 embedding 向量数) = ' + snapBefore.corpusLen);

  // ============================================================
  // 1. Contract 形状
  // ============================================================
  section('单元·1 provider contract 形状');
  withEnv({ TENCENT_WSA_BASE_URL: TENCENT_BASE, TENCENT_WSA_API_KEY: 'k' }, function () {
    return tencentApi.search('测试', {}, makeTencentSingleFakeFetch()).then(function (r) {
      eq(typeof r, 'object', '(1) 返回为对象');
      ok('ok' in r, '(1) 含 ok 字段');
      eq(r.provider, 'tencent', '(1) provider=tencent');
      ok(Array.isArray(r.results), '(1) results 为数组');
      ok('reason' in r, '(1) 含 reason 字段');
    });
  }).then(function () {

    // ============================================================
    // 2. POST + Bearer + JSON body 含 query
    // ============================================================
    section('单元·2 POST 方法 + Bearer 鉴权 + JSON body 含 query');
    return withEnv({ TENCENT_WSA_BASE_URL: TENCENT_BASE, TENCENT_WSA_API_KEY: 'test-tencent-bearer-key' }, function () {
      var seen = {};
      return tencentApi.search('今天科技新闻', {}, makeTencentFakeFetch(seen)).then(function (r) {
        eq(seen.init.method, 'POST', '(2) 使用 POST 方法');
        eq(seen.init.headers['Authorization'], 'Bearer test-tencent-bearer-key', '(2) 带 Bearer 鉴权头');
        eq(seen.init.headers['Content-Type'], 'application/json', '(2) Content-Type=application/json');
        var body = JSON.parse(seen.init.body);
        eq(body.query, '今天科技新闻', '(2) JSON body 含查询字段 query');
        eq(r.ok, true, '(2) POST 调用成功返回 ok=true');
      });
    });
  }).then(function () {

    // ============================================================
    // 3. Pages JSON string 二次解析
    // ============================================================
    section('单元·3 Pages JSON 字符串二次解析');
    return withEnv({ TENCENT_WSA_BASE_URL: TENCENT_BASE, TENCENT_WSA_API_KEY: 'k' }, function () {
      return tencentApi.search('量子计算', {}, makeTencentSingleFakeFetch()).then(function (r) {
        eq(r.ok, true, '(3) Pages 字符串解析成功(ok=true)');
        ok(Array.isArray(r.results) && r.results.length === 1 && r.results[0].url === 'https://www.qq.com/s/1', '(3) 二次解析产出结果且字段映射生效');
        includes(r.results[0].snippet, TENCENT_MARK, '(3) 结果片段含联网标记');
      });
    });
  }).then(function () {

    // ============================================================
    // 4. no_endpoint（fail-soft 不联网）
    // ============================================================
    section('单元·4 no_endpoint（未配置端点 → 不联网降级）');
    return withEnv({}, function () {
      var called = false;
      return tencentApi.search('测试', {}, function () { called = true; return Promise.reject(new Error('should not call')); }).then(function (r) {
        eq(r.ok, false, '(4) 无端点降级 ok=false');
        eq(r.reason, 'no_endpoint', '(4) reason=no_endpoint');
        ok(!called, '(4) 未发起任何外呼（fail-soft）');
      });
    });
  }).then(function () {

    // ============================================================
    // 5. no_results（Pages='[]'）
    // ============================================================
    section('单元·5 no_results（Pages 为空数组）');
    return withEnv({ TENCENT_WSA_BASE_URL: TENCENT_BASE, TENCENT_WSA_API_KEY: 'k' }, function () {
      return tencentApi.search('测试', {}, makeTencentEmptyFakeFetch()).then(function (r) {
        eq(r.ok, false, '(5) 空结果 ok=false');
        eq(r.reason, 'no_results', '(5) reason=no_results');
      });
    });
  }).then(function () {

    // ============================================================
    // 6. provider 名 = tencent
    // ============================================================
    section('单元·6 provider 名为 tencent');
    return withEnv({ TENCENT_WSA_BASE_URL: TENCENT_BASE, TENCENT_WSA_API_KEY: 'k' }, function () {
      return tencentApi.search('测试', {}, makeTencentSingleFakeFetch()).then(function (r) {
        eq(r.provider, 'tencent', '(6) provider 固定为 tencent（→ data_route=domestic 的前提）');
      });
    });
  }).then(function () {

    // ============================================================
    // 7. searchLayer 路由：data_route=domestic + 审计干净
    // ============================================================
    section('集成·7 searchLayer 路由 tencent → data_route=domestic / 审计干净');
    return withEnv(TENCENT_ENV, function () {
      retriever.nodeFetch = makeTencentFakeFetch();
      searchLayer._setConfig({ dailyQuota: 500 }); searchLayer._resetDaily(); searchLayer._resetCache();
      return searchLayer.search('今天有什么科技新闻', { openid: CANARY_OPENID }).then(function (res) {
        eq(res.ok, true, '(7) searchLayer 成功调用 tencent');
        eq(res.provider, 'tencent', '(7) provider=tencent');
        eq(res.audit.data_route, 'domestic', '(7) data_route=domestic（零跨境）');
        eq(searchLayer.isDomesticProvider('tencent'), true, '(7) isDomesticProvider(tencent)=true');
        eq(searchLayer.isRealProvider('tencent'), true, '(7) isRealProvider(tencent)=true（计配额/审计）');
        assertAuditClean(res.audit, '今天有什么科技新闻', CANARY_OPENID, (res.results || []).map(function (x) { return x.url; }));
      });
    });
  }).then(function () {

    // ============================================================
    // 8. thinkEngine 集成：结果进回答 / 失败回退 RAG / 审计干净 / 冻结不变
    // ============================================================
    section('集成·8 thinkEngine 端到端（tencent 走全护栏）');
    return withEnv(TENCENT_ENV, function () {
      retriever.nodeFetch = makeTencentFakeFetch();
      searchLayer._setConfig({ dailyQuota: 500 }); searchLayer._resetDaily(); searchLayer._resetCache();

      var QUESTIONS = [
        { id: 1, cat: '实时时间', q: '现在北京时间几点', net: true },
        { id: 2, cat: '新闻热点', q: '今天有什么科技新闻', net: true },
        { id: 3, cat: '普通知识', q: '光合作用的基本原理是什么', net: true },
        { id: 4, cat: '普通知识', q: '长江有多少公里长', net: true },
        { id: 5, cat: '经典问题', q: '论语里关于学习的名言有哪些', net: true },
        { id: 6, cat: '经典问题', q: '如何理解道德经中的无为', net: false },
        { id: 7, cat: '经典问题', q: '苏格拉底提问法的精髓是什么', net: false }
      ];

      function runOne(item) {
        var prev = retriever.nodeFetch;
        if (!item.net) retriever.nodeFetch = (item.id === 7) ? makeThrowFakeFetch() : makeTencentEmptyFakeFetch();
        var lastAudit = null;
        var urls = [];
        var opts = {
          answerMode: 'fast',
          factualEnabled: true,
          searchProvider: 'tencent',
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
          if (result === null) {
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
        var routeSet = {};
        var anyCrossBorder = false;
        collected.forEach(function (c) {
          var item = c.item, res = c.result, audit = c.lastAudit;
          if (item.net) {
            ok(res !== null, 'Q' + item.id + '[' + item.cat + '] 在线检索成功接管');
            includes(res && res.answer, TENCENT_MARK, '【验证】Q' + item.id + ' 联网检索结果进入回答文本');
            if (audit) {
              eq(audit.data_route, 'domestic', 'Q' + item.id + ' data_route=domestic');
              assertAuditClean(audit, item.q, CANARY_OPENID, c.urls || []);
              routeSet[audit.data_route] = (routeSet[audit.data_route] || 0) + 1;
              if (audit.data_route === 'cross_border') anyCrossBorder = true;
            }
          } else {
            ok(c.fallback === true, 'Q' + item.id + '[fast] 检索失败回退 RAG');
            includes(res && res.answer, '【RAG知识库回答】', '【验证】Q' + item.id + ' 搜索失败回退 RAG 兜底');
            if (audit) {
              eq(audit.data_route, 'domestic', 'Q' + item.id + ' 失败路径 data_route 仍 domestic');
              assertAuditClean(audit, item.q, CANARY_OPENID, c.urls || []);
              routeSet[audit.data_route] = (routeSet[audit.data_route] || 0) + 1;
            }
          }
        });

        ok(!anyCrossBorder, '汇总：全程零 cross_border（data_route 恒 domestic）');
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
        eq(leaked, 0, '【验证】所有审计累计零泄露（query/openid 均不在 audit 中）');
        return Promise.resolve();
      });
    });
  }).then(function () {

    // ---------- 执行后检查：corpus SHA / embedding 数不变 ----------
    section('验证·冻结资产完整性（KB 未被写入）');
    var snapAfter = snapshotFrozen();
    FROZEN.forEach(function (f) {
      eq(snapAfter.items[f].sha, snapBefore.items[f].sha, f + ' SHA 前后一致');
      eq(snapAfter.items[f].mtime, snapBefore.items[f].mtime, f + ' mtime 前后一致（未被写入）');
    });
    eq(snapAfter.corpusLen, snapBefore.corpusLen, 'corpus 条目数前后一致（派生 embedding 向量数不变，无 ingest）');

    retriever.nodeFetch = realFetch;
    return Promise.resolve();
  }).then(function () {
    console.log('\n========================================');
    console.log('Phase Q2-12 腾讯 WSA Adapter: ' + pass + ' PASS / ' + fail + ' FAIL');
    console.log('========================================');
    if (fail > 0) { console.log('失败项:'); fails.forEach(function (m) { console.log('  - ' + m); }); process.exit(1); }
    process.exit(0);
  }).catch(function (e) {
    retriever.nodeFetch = realFetch;
    console.error('测试运行异常:', e);
    process.exit(2);
  });
})();
