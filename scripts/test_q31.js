// ============================================================
// scripts/test_q31.js
//   Phase Q2-13：阿里云百炼(DashScope) 联网搜索 Qwen Provider Adapter — 离线验证
//
//   运行：node scripts/test_q31.js
//   授权约束：零真实网络（fakeFetch 模拟百炼 chat/completions 中转接口）；
//     不部署 / 不扩用户 / 不触冻结资产 / 不改生产环境变量。
//
//   单元 + 集成验证：
//     1. provider contract: search(q,opts,nodeFetch) → {ok,provider,results,reason}
//     2. POST method + Bearer Auth + JSON body（含 messages[0].content + enable_search:true）
//     3. search_results 二次解析（extended.search_info.search_results 数组）
//     4. 事实隔离：仅取 search_results，绝不采用模型综合 content（化解 Q2-11 架构冲突）
//     5. no_endpoint（未配置 BASE_URL → fail-soft 不联网）
//     6. no_results（search_results=[]）
//     7. provider 名 = 'qwen'
//     8. searchLayer 路由：data_route=domestic / 审计干净
//     9. thinkEngine 集成：结果进入回答 / 失败回退 RAG / 事实隔离（回答不含模型综合内容）/ 审计不含敏感 / 冻结 SHA 4/4
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
var qwenApi = require(path.join(CHAT, 'providers', 'search', 'qwenSearch'));
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
var QWEN_MARK = '【QWEN-SEARCH】';        // 仅出现在 search_results（应进入事实底座）
var SYNTH_MARK = '【QWEN-SYNTHESIZED】';  // 仅出现在 message.content（绝不可作为事实底座）
var QWEN_BASE = 'https://dashscope-relay.example.com/v1/chat/completions'; // 占位中转端点
function hashStr(s) { var h = 0; s = '' + s; for (var i = 0; i < s.length; i++) { h = (h * 31 + s.charCodeAt(i)) >>> 0; } return h; }
function bodyQuery(init) {
  try { var b = JSON.parse(init.body); return (b.messages && b.messages[0] && b.messages[0].content) || ''; } catch (e) { return ''; }
}
// 模拟百炼 chat/completions：同时含 content(综合答案) + extended.search_info.search_results(数组)
function makeQwenFakeFetch(seen) {
  return function (url, init) {
    if (seen) { seen.url = url; seen.init = init; }
    var q = bodyQuery(init);
    var data = {
      choices: [{
        message: {
          content: SYNTH_MARK + '模型对「' + q + '」的综合回答（禁止作为事实底座）',
          extended: {
            search_info: {
              search_results: [
                { title: '百炼源·' + q, url: 'https://www.qq.com/news/' + hashStr(q),
                  content: QWEN_MARK + '关于「' + q + '」的检索摘要' },
                { title: '权威媒体', url: 'https://www.163.com/x/' + (hashStr(q) + 1),
                  content: QWEN_MARK + '公开数据更新' }
              ]
            }
          }
        }
      }]
    };
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(data); } });
  };
}
// 隔离验证专用：search_results 无标记、content 带标记 → 断言结果绝不含 SYNTH_MARK
function makeQwenIsolationFakeFetch() {
  return function () {
    var data = {
      choices: [{
        message: {
          content: SYNTH_MARK + '模型综合内容（应当被忽略）',
          extended: { search_info: { search_results: [
            { title: '无标记标题', url: 'https://www.qq.com/s/1', content: '无标记的纯检索摘要' }
          ] } }
        }
      }]
    };
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(data); } });
  };
}
// 单条结果
function makeQwenSingleFakeFetch() {
  return function (url, init) {
    var q = bodyQuery(init);
    var data = { choices: [{ message: { content: SYNTH_MARK + 'ignore',
      extended: { search_info: { search_results: [
        { title: '单条', url: 'https://www.qq.com/s/1', content: QWEN_MARK + '单条摘要' } ] } } } }] };
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(data); } });
  };
}
// 空结果
function makeQwenEmptyFakeFetch() {
  return function () {
    var data = { choices: [{ message: { content: SYNTH_MARK + 'ignore',
      extended: { search_info: { search_results: [] } } } }] };
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(data); } });
  };
}
function makeThrowFakeFetch() {
  return function () { return Promise.reject(new Error('network down (simulated)')); };
}
// Q2-16：模型无任何综合文字（content 空）→ 退化 no_results
function makeQwenTrulyEmptyFakeFetch() {
  return function () {
    var data = { choices: [{ message: { content: '', extended: { search_info: { search_results: [] } } } }] };
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(data); } });
  };
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

var CANARY_OPENID = 'oCANARY_q31_test_001';
// 驱动 qwen 的 L2 风格配置（仅补充 qwen 专属变量）
var QWEN_ENV = {
  FRESHNESS_ENABLED: 'true',
  SEARCH_PROVIDER: 'qwen',
  FRESHNESS_FACTUAL_ENABLED: 'true',
  PRIVACY_GATE_ENABLED: 'false',
  SEARCH_CANARY_ENABLED: 'false',
  SEARCH_MAX_RESULTS: '5',
  SEARCH_TIMEOUT_MS: '3000',
  SEARCH_DAILY_QUOTA: '500',
  QWEN_SEARCH_BASE_URL: QWEN_BASE,
  QWEN_SEARCH_API_KEY: 'test-qwen-bearer-key',
  QWEN_SEARCH_MODEL: 'qwen-plus'
};

// ---------- audit 泄露扫描 ----------
function assertAuditClean(audit, query, openid, collectedUrls) {
  if (!audit) { ok(false, 'audit 存在且可扫描'); return; }
  var s = JSON.stringify(audit);
  notIn(s, query, 'audit 不含原始 query「' + query.slice(0, 8) + '…」');
  notIn(s, openid, 'audit 不含用户信息(openid)');
  collectedUrls.forEach(function (u) { notIn(s, u, 'audit 不含结果 URL ' + u); });
  notIn(s, QWEN_MARK, 'audit 不含搜索全文/片段(' + QWEN_MARK + ')');
  notIn(s, SYNTH_MARK, 'audit 不含模型综合内容(' + SYNTH_MARK + ')');
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
  withEnv({ QWEN_SEARCH_BASE_URL: QWEN_BASE, QWEN_SEARCH_API_KEY: 'k' }, function () {
    return qwenApi.search('测试', {}, makeQwenSingleFakeFetch()).then(function (r) {
      eq(typeof r, 'object', '(1) 返回为对象');
      ok('ok' in r, '(1) 含 ok 字段');
      eq(r.provider, 'qwen', '(1) provider=qwen');
      ok(Array.isArray(r.results), '(1) results 为数组');
      ok('reason' in r, '(1) 含 reason 字段');
    });
  }).then(function () {

    // ============================================================
    // 2. POST + Bearer + JSON body（含 messages + enable_search）
    // ============================================================
    section('单元·2 POST 方法 + Bearer 鉴权 + JSON body(messages+enable_search)');
    return withEnv({ QWEN_SEARCH_BASE_URL: QWEN_BASE, QWEN_SEARCH_API_KEY: 'test-qwen-bearer-key' }, function () {
      var seen = {};
      return qwenApi.search('今天科技新闻', {}, makeQwenFakeFetch(seen)).then(function (r) {
        eq(seen.init.method, 'POST', '(2) 使用 POST 方法');
        eq(seen.init.headers['Authorization'], 'Bearer test-qwen-bearer-key', '(2) 带 Bearer 鉴权头');
        eq(seen.init.headers['Content-Type'], 'application/json', '(2) Content-Type=application/json');
        var body = JSON.parse(seen.init.body);
        eq(body.messages[0].content, '今天科技新闻', '(2) JSON body 含 messages[0].content=query');
        eq(body.enable_search, true, '(2) body.enable_search=true（开启联网）');
        eq(body.model, 'qwen-plus', '(2) body.model 正确透传');
        eq(r.ok, true, '(2) POST 调用成功返回 ok=true');
      });
    });
  }).then(function () {

    // ============================================================
    // 3. search_results 二次解析
    // ============================================================
    section('单元·3 search_results 数组解析（extended.search_info.search_results）');
    return withEnv({ QWEN_SEARCH_BASE_URL: QWEN_BASE, QWEN_SEARCH_API_KEY: 'k' }, function () {
      return qwenApi.search('量子计算', {}, makeQwenSingleFakeFetch()).then(function (r) {
        eq(r.ok, true, '(3) search_results 解析成功(ok=true)');
        ok(Array.isArray(r.results) && r.results.length === 1 && r.results[0].url === 'https://www.qq.com/s/1', '(3) 解析产出结果且字段映射生效');
        includes(r.results[0].snippet, QWEN_MARK, '(3) 结果片段含联网标记');
      });
    });
  }).then(function () {

    // ============================================================
    // 4. 事实隔离：仅取 search_results，绝不采用 message.content
    // ============================================================
    section('单元·4 事实隔离（仅取 search_results，忽略模型综合 content）');
    return withEnv({ QWEN_SEARCH_BASE_URL: QWEN_BASE, QWEN_SEARCH_API_KEY: 'k' }, function () {
      return qwenApi.search('隔离验证问题', {}, makeQwenIsolationFakeFetch()).then(function (r) {
        eq(r.ok, true, '(4) 含 search_results 时仍 ok=true');
        ok(Array.isArray(r.results) && r.results.length === 1, '(4) 仅 1 条来自 search_results');
        notIn(JSON.stringify(r.results), SYNTH_MARK, '(4) 结果【绝不】含模型综合内容标记 ' + SYNTH_MARK);
        ok(r.results[0].snippet.indexOf(QWEN_MARK) < 0 && r.results[0].snippet.indexOf(SYNTH_MARK) < 0, '(4) 结果片段纯净（无任一标记，证明只取 search_results 字段）');
      });
    });
  }).then(function () {

    // ============================================================
    // 5. no_endpoint（fail-soft 不联网）
    // ============================================================
    section('单元·5 no_endpoint（未配置端点 → 不联网降级）');
    return withEnv({}, function () {
      var called = false;
      return qwenApi.search('测试', {}, function () { called = true; return Promise.reject(new Error('should not call')); }).then(function (r) {
        eq(r.ok, false, '(5) 无端点降级 ok=false');
        eq(r.reason, 'no_endpoint', '(5) reason=no_endpoint');
        ok(!called, '(5) 未发起任何外呼（fail-soft）');
      });
    });
  }).then(function () {

    // ============================================================
    // 6. no_results（search_results=[]）or Q2-16 合成底座回退
    // ============================================================
    section('单元·6 结构化结果为空 → 退化为合成底座 / 或 no_results');
    return withEnv({ QWEN_SEARCH_BASE_URL: QWEN_BASE, QWEN_SEARCH_API_KEY: 'k' }, function () {
      // 6a：结构化结果为空但模型有综合文字 → Q2-16 合成底座（ok=true, synth_content）
      return qwenApi.search('测试', {}, makeQwenEmptyFakeFetch()).then(function (r) {
        eq(r.ok, true, '(6a) 有综合文字→合成底座 ok=true');
        eq(r.reason, 'synth_content', '(6a) reason=synth_content');
        eq(r.synthesized, true, '(6a) 标记 synthesized');
      }).then(function () {
        // 6b：结构化结果为空且模型无综合文字 → no_results（确定性降级）
        return qwenApi.search('测试', {}, makeQwenTrulyEmptyFakeFetch()).then(function (r) {
          eq(r.ok, false, '(6b) 无综合文字 ok=false');
          eq(r.reason, 'no_results', '(6b) reason=no_results');
        });
      });
    });
  }).then(function () {

    // ============================================================
    // 7. provider 名 = qwen
    // ============================================================
    section('单元·7 provider 名为 qwen');
    return withEnv({ QWEN_SEARCH_BASE_URL: QWEN_BASE, QWEN_SEARCH_API_KEY: 'k' }, function () {
      return qwenApi.search('测试', {}, makeQwenSingleFakeFetch()).then(function (r) {
        eq(r.provider, 'qwen', '(7) provider 固定为 qwen（→ data_route=domestic 的前提）');
      });
    });
  }).then(function () {

    // ============================================================
    // 7b. 复用后台 model_config（opt.searchModelConfig），端点由 baseURL 拼装
    // ============================================================
    section('单元·7b 复用后台 model_config（opt.searchModelConfig）');
    return withEnv({}, function () {
      var seen = {};
      var mc = { baseURL: 'https://dashscope-relay.example.com/v1', apiKey: 'mc-bearer-key', model: 'qwen-max' };
      return qwenApi.search('今天科技新闻', { searchModelConfig: mc }, makeQwenFakeFetch(seen)).then(function (r) {
        eq(r.ok, true, '(7b) model_config 复用成功(ok=true)');
        eq(r.provider, 'qwen', '(7b) provider=qwen');
        eq(seen.url, 'https://dashscope-relay.example.com/v1/chat/completions', '(7b) 端点由 baseURL 拼装为 /chat/completions');
        eq(seen.init.headers['Authorization'], 'Bearer mc-bearer-key', '(7b) 鉴权用 model_config.apiKey');
        eq(JSON.parse(seen.init.body).model, 'qwen-max', '(7b) body.model 取自 model_config.model');
        includes(r.results[0].snippet, QWEN_MARK, '(7b) 结果含联网标记');
      });
    }).then(function () {
      // model_config 缺失且 env 未设 → 仍 no_endpoint 降级（fail-soft）
      return qwenApi.search('测试', {}, function () { return Promise.reject(new Error('should not call')); }).then(function (r) {
        eq(r.ok, false, '(7b) 无 model_config 且无 env → 降级 ok=false');
        eq(r.reason, 'no_endpoint', '(7b) reason=no_endpoint');
      });
    });
  }).then(function () {

    // ============================================================
    // 8. searchLayer 路由：data_route=domestic + 审计干净
    // ============================================================
    section('集成·8 searchLayer 路由 qwen → data_route=domestic / 审计干净');
    return withEnv(QWEN_ENV, function () {
      retriever.nodeFetch = makeQwenFakeFetch();
      searchLayer._setConfig({ dailyQuota: 500 }); searchLayer._resetDaily(); searchLayer._resetCache();
      return searchLayer.search('今天有什么科技新闻', { openid: CANARY_OPENID }).then(function (res) {
        eq(res.ok, true, '(8) searchLayer 成功调用 qwen');
        eq(res.provider, 'qwen', '(8) provider=qwen');
        eq(res.audit.data_route, 'domestic', '(8) data_route=domestic（零跨境）');
        eq(searchLayer.isDomesticProvider('qwen'), true, '(8) isDomesticProvider(qwen)=true');
        eq(searchLayer.isRealProvider('qwen'), true, '(8) isRealProvider(qwen)=true（计配额/审计）');
        assertAuditClean(res.audit, '今天有什么科技新闻', CANARY_OPENID, (res.results || []).map(function (x) { return x.url; }));
      });
    });
  }).then(function () {

    // ============================================================
    // 9. thinkEngine 集成：结果进回答 / 失败回退 RAG / 事实隔离 / 审计干净 / 冻结不变
    // ============================================================
    section('集成·9 thinkEngine 端到端（qwen 走全护栏 + 事实隔离验证）');
    return withEnv(QWEN_ENV, function () {
      retriever.nodeFetch = makeQwenFakeFetch();
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
        if (!item.net) retriever.nodeFetch = (item.id === 7) ? makeThrowFakeFetch() : makeQwenEmptyFakeFetch();
        var lastAudit = null;
        var urls = [];
        var opts = {
          answerMode: 'fast',
          factualEnabled: true,
          searchProvider: 'qwen',
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
        var anySynthesized = false; // 事实隔离汇总：回答中是否出现模型综合内容标记
        collected.forEach(function (c) {
          var item = c.item, res = c.result, audit = c.lastAudit;
          if (item.net) {
            ok(res !== null, 'Q' + item.id + '[' + item.cat + '] 在线检索成功接管');
            includes(res && res.answer, QWEN_MARK, '【验证】Q' + item.id + ' 联网检索结果(search_results)进入回答文本');
            notIn(res && res.answer, SYNTH_MARK, '【事实隔离】Q' + item.id + ' 回答不含模型综合内容(' + SYNTH_MARK + ')');
            if (res && res.answer && res.answer.indexOf(SYNTH_MARK) >= 0) anySynthesized = true;
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
        ok(!anySynthesized, '【事实隔离·汇总】所有在线回答均不含模型综合内容标记（仅 search_results 作事实底座）');
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
    console.log('Phase Q2-13 Qwen Provider Adapter: ' + pass + ' PASS / ' + fail + ' FAIL');
    console.log('========================================');
    if (fail > 0) { console.log('失败项:'); fails.forEach(function (m) { console.log('  - ' + m); }); process.exit(1); }
    process.exit(0);
  }).catch(function (e) {
    retriever.nodeFetch = realFetch;
    console.error('测试运行异常:', e);
    process.exit(2);
  });
})();
