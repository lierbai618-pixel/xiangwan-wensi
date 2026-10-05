'use strict';
// ============================================================
// test_q32.js — Phase Q2-14 续：分类器「当前事件」路由 + freshness 不再短路
//   · 断言自然新闻/动态问法稳定归 B（高置信）→ 触发联网检索
//   · 断言纯哲学/知识问法仍归 A（不联网，符合设计）
//   · 断言 freshness.maybeHandle 对 B 类问题【真正调用 searchLayer.search】
//     （直接锁死 Q2-14 修复：此前 retriever.getProviderName() 读旧变量
//      导致永远短路、永不检索）
//   依赖：Node 22 跑测试；不依赖真实网络/真实 API。
// ============================================================
var path = require('path');

var PASS = 0, FAIL = 0;
function ok(cond, name) {
  if (cond) { PASS++; /*console.log('  ✓ ' + name);*/ }
  else { FAIL++; console.log('  ✗ FAIL: ' + name); }
}
function eq(a, b, name) { ok(a === b, name + ' (got=' + JSON.stringify(a) + ', want=' + JSON.stringify(b) + ')'); }
function section(t) { console.log('\n=== ' + t + ' ==='); }

var classifier = require('../cloudfunctions/chat/freshness/eventClassifier');
var freshness = require('../cloudfunctions/chat/freshness');
var searchLayer = require('../cloudfunctions/chat/providers/search');

var B_QUERIES = [
  '今天有什么科技新闻',
  '今天有什么AI相关的消息',
  '今天有什么值得关注的科技动态',
  '最近电影票房怎么样',
  '最新进展是什么',
  '现在正在发生什么大事',
  '今天有什么新闻',
  '最近有什么新闻',
  '怎么看最近的AI突破',
  '你对今天的股市怎么看'
];
var A_QUERIES = [
  '怎么理解庄子的逍遥游',
  '人生的意义是什么',
  '推荐一本好书',
  '勾股定理是什么',
  '论语告诉我什么道理'
];

section('分类器·当前事件问法稳定归 B（触发联网）');
B_QUERIES.forEach(function (q) {
  var r = classifier.classifyCategory(q, null);
  eq(r.category, 'B', 'B类: ' + q);
  eq(r.confidence, 'high', '高置信: ' + q);
});

section('分类器·纯哲学/知识问法仍归 A（不联网，符合设计）');
A_QUERIES.forEach(function (q) {
  var r = classifier.classifyCategory(q, null);
  eq(r.category, 'A', 'A类: ' + q);
});

section('集成·freshness 必须真正调用 searchLayer.search（锁死 Q2-14 短路修复）');
(async function () {
  // 注入假搜索：返回 ok 结果并打调用标记；同时验证搜索被真正触达
  var called = { v: false };
  var realSearch = searchLayer.search;
  searchLayer.search = function (q, opts) {
    called.v = true;
    return Promise.resolve({
      ok: true, provider: 'qwen',
      results: [{ title: '测试新闻', url: 'https://example.com/1', snippet: '摘要', source: '测试源' }],
      reason: '', cached: false,
      audit: { provider: 'qwen', latency_ms: 1, cache_hit: false, downgrade_reason: '', quota_remaining: 499, canary_blocked: false, data_route: 'domestic' }
    });
  };

  try {
    var res = await freshness.maybeHandle('今天有什么科技新闻', {
      factualEnabled: true,
      searchProvider: 'qwen',
      answerMode: 'think',
      openid: 'admin-openid-test',
      models: [],
      history: []
    });
    ok(called.v === true, 'freshness 确实调用了 searchLayer.search（未短路）');
    ok(!!res, 'maybeHandle 返回了结果对象');
    if (res && res.freshness) {
      eq(res.freshness.search_provider, 'qwen', 'search_provider 透传为 qwen');
      ok(!!res.freshness.search_audit, 'search_audit 已填充（证明检索链路被执行）');
    }
  } catch (e) {
    ok(false, 'maybeHandle 抛异常: ' + (e && e.message));
  } finally {
    searchLayer.search = realSearch; // 还原，避免污染其他测试
  }

  console.log('\n----------------------------------------');
  console.log('test_q32 PASS=' + PASS + '  FAIL=' + FAIL);
  process.exit(FAIL === 0 ? 0 : 1);
})();
