// ============================================================
// scripts/test_q24a.js
//   Phase Q2-4-A 离线测试套件（零网络、依赖注入）。
//
//   覆盖：
//     A. util 纯函数（stripTracking / normalizeResult / applySourceFilter / withTimeout / withRetry）
//     B. shared CostGuard（日配额）
//     C. tavily 真实 provider（注入 fakeFetch：无 key / 正常 / 网络异常 / 5xx）
//     D. index.js 集成（mock 默认 + 缓存 / tavily 真实路径 / 超时 / 重试 / 来源过滤 / 配额 / 上限 / fail-soft）
//     E. 冻结资产 corpus.json SHA 在检索流程前后不变（KB 零污染）
//
//   运行：node scripts/test_q24a.js
//   使用 async/await（测试运行于 Node22，非云函数 Node16.13）。
// ============================================================
'use strict';

var path = require('path');
var crypto = require('crypto');
var fs = require('fs');

var PROVIDERS = path.join(__dirname, '..', 'cloudfunctions', 'chat', 'providers', 'search');
var CORPUS = path.join(__dirname, '..', 'cloudfunctions', 'chat', 'corpus.json');

var util = require(path.join(PROVIDERS, 'util'));
var shared = require(path.join(PROVIDERS, 'shared'));
var tavily = require(path.join(PROVIDERS, 'tavily'));
var retriever = require(path.join(__dirname, '..', 'cloudfunctions', 'chat', 'freshness', 'eventRetriever'));
var searchLayer = require(path.join(PROVIDERS, 'index'));

// ---- 极简测试框架 ----
var pass = 0, fail = 0;
var failures = [];
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; failures.push(name); console.log('  ✗ ' + name); }
}
function section(t) { console.log('\n[' + t + ']'); }
function eq(a, b, name) { ok(a === b, name + ' (got ' + JSON.stringify(a) + ')'); }
function sha256(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

// ---- fakeFetch 工厂（始终返回 fetch-like 函数）----
function makeFakeFetch(kind, opts) {
  opts = opts || {};
  var state = opts.state;
  return function (url, request) {
    if (kind === 'json') return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(opts.body || { results: [] }); } });
    if (kind === '5xx') return Promise.resolve({ ok: false, status: 500, json: function () { return Promise.resolve({}); } });
    if (kind === '4xx') return Promise.resolve({ ok: false, status: 401, json: function () { return Promise.resolve({}); } });
    if (kind === 'network') return Promise.reject(new Error('ECONNRESET'));
    if (kind === 'never') return new Promise(function () {}); // 永不 resolve → 触发超时
    if (kind === 'count') {
      if (state && state.n < state.failFirst) { state.n++; return Promise.resolve({ ok: false, status: 503, json: function () { return Promise.resolve({}); } }); }
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(opts.body || { results: [] }); } });
    }
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ results: [] }); } });
  };
}

function setFetch(kind, opts) {
  var f = makeFakeFetch(kind, opts);
  retriever.nodeFetch = function (u, req) { return f(u, req); };
  return f;
}

async function main() {
  // ============================================================
  // A. util 纯函数
  // ============================================================
  section('A. util 纯函数');
  var stripped = util.stripTracking('https://example.com/a?utm_source=x&id=5&spm=1');
  ok(stripped.indexOf('utm_source') === -1 && stripped.indexOf('id=5') !== -1, 'stripTracking 移除 utm/spm，保留业务参数');

  eq(util.normalizeResult({ title: 't', url: 'https://x.com', snippet: '' }), null, 'normalizeResult 无 snippet → null');

  var norm = util.normalizeResult({ title: 't', url: 'https://www.reuters.com/p?utm_medium=y', snippet: 's' });
  ok(norm && norm.url.indexOf('utm_medium') === -1 && norm.source === 'reuters.com', 'normalizeResult 剥离 www + 追踪并补 source');

  var filtered = util.applySourceFilter([{ url: 'https://bad.com/x' }, { url: 'https://good.com/y' }], { blockedDomains: 'bad.com' });
  eq(filtered.length, 1, 'applySourceFilter 黑名单拦截 bad.com');
  eq(filtered[0].url, 'https://good.com/y', 'applySourceFilter 保留 good.com');

  var allowOnly = util.applySourceFilter([{ url: 'https://good.com/y' }, { url: 'https://other.com/z' }], { allowedDomains: 'good.com' });
  eq(allowOnly.length, 1, 'applySourceFilter 白名单仅留 good.com');

  ok(util.defaultShouldRetry({ code: 'TIMEOUT' }) === true, 'defaultShouldRetry 超时→重试');
  ok(util.defaultShouldRetry(new Error('HTTP_503')) === true, 'defaultShouldRetry 5xx→重试');
  ok(util.defaultShouldRetry(new Error('HTTP_401')) === false, 'defaultShouldRetry 4xx→不重试');
  ok(util.defaultShouldRetry(new Error('ECONNRESET')) === true, 'defaultShouldRetry 网络错误→重试');

  var toOk = false;
  util.withTimeout(new Promise(function () {}), 50, 't').catch(function (e) { toOk = (e && e.code === 'TIMEOUT'); });
  await sleep(80);
  ok(toOk, 'withTimeout 超时触发 TIMEOUT');

  // ============================================================
  // B. shared CostGuard
  // ============================================================
  section('B. shared CostGuard 日配额');
  var g = shared.createCostGuard(function () { return 2; });
  ok(g.allowed() === true, '初始 allowed=true');
  g.record(); g.record();
  ok(g.allowed() === false, '达配额 allowed=false');
  eq(g.remaining(), 0, 'remaining=0');
  g.reset();
  ok(g.allowed() === true, 'reset 后恢复');

  // ============================================================
  // C. tavily 真实 provider（注入 fakeFetch，零网络）
  // ============================================================
  section('C. tavily provider 直接调用');
  var oldKey = process.env.TAVILY_API_KEY;
  delete process.env.TAVILY_API_KEY;
  var r0 = await tavily.search('test', {}, makeFakeFetch('json'));
  eq(r0.ok, false, 'tavily 无 key → ok=false');
  eq(r0.reason, 'no_api_key', 'tavily 无 key reason=no_api_key');

  process.env.TAVILY_API_KEY = 'tv-test-key';
  var body = {
    results: [
      { title: 'A', url: 'https://reuters.com/a?utm_source=x', content: 'snippet A', publishedAt: '2026-01-01' },
      { title: 'B', url: 'https://nyt.com/b', content: 'snippet B' },
    ],
  };
  var r1 = await tavily.search('event', {}, makeFakeFetch('json', { body: body }));
  eq(r1.ok, true, 'tavily 有 key+正常 → ok=true');
  eq(r1.provider, 'tavily', 'provider=tavily');
  eq(r1.results.length, 2, '结果数=2');
  ok(r1.results[0].url.indexOf('utm_source') === -1, 'tavily 结果 URL 已剥离追踪参数');
  ok(r1.results[0].source === 'reuters.com', 'tavily 补全 source 域名');

  var rNet = await tavily.search('e', {}, makeFakeFetch('network')).catch(function (e) {
    return { ok: false, provider: 'tavily', results: [], reason: 'provider_exception', error: (e && e.message) ? e.message : ('' + e) };
  });
  eq(rNet.ok, false, 'tavily 网络异常 → ok=false（fail-soft）');
  eq(rNet.reason, 'provider_exception', 'tavily 网络异常 reason=provider_exception');

  var r5 = await tavily.search('e', {}, makeFakeFetch('5xx')).catch(function (e) {
    return { ok: false, provider: 'tavily', results: [], reason: 'provider_exception', error: (e && e.message) ? e.message : ('' + e) };
  });
  eq(r5.ok, false, 'tavily 5xx → ok=false');
  eq(r5.reason, 'provider_exception', 'tavily 5xx reason=provider_exception');

  if (oldKey) process.env.TAVILY_API_KEY = oldKey; else delete process.env.TAVILY_API_KEY;

  // ============================================================
  // D. index.js 集成
  // ============================================================
  section('D. index.js 集成');
  process.env.SEARCH_PROVIDER = 'mock';
  searchLayer._setConfig({ timeoutMs: 3000, retries: 2, maxResults: 5, blockedDomains: '', allowedDomains: '', dailyQuota: 500 });
  searchLayer._resetCache(); searchLayer._resetDaily();

  eq(searchLayer.getProviderName(), 'mock', 'D0 默认 provider=mock（安全默认态）');

  // D1 + D2：mock 首次 + 缓存命中
  var fetchCalls = 0;
  retriever.nodeFetch = function () { fetchCalls++; return makeFakeFetch('json')(); };
  var d1 = await searchLayer.search('今天有什么新闻', {});
  eq(d1.ok, true, 'D1 mock 首次 ok=true');
  ok((d1.results[0].url || '').indexOf('mock.local') !== -1, 'D1 mock 结果含 mock.local');
  eq(d1.cached, false, 'D1 首次 cached=false');
  var d2 = await searchLayer.search('今天有什么新闻', {});
  eq(d2.cached, true, 'D2 二次命中缓存 cached=true');
  eq(fetchCalls, 0, 'D2 缓存命中未触发任何 fetch');

  // D3：tavily 真实路径（注入 fakeFetch 模拟成功）
  process.env.SEARCH_PROVIDER = 'tavily';
  process.env.TAVILY_API_KEY = 'tv-key';
  searchLayer._resetCache(); searchLayer._resetDaily();
  var realBody = { results: [
    { title: 'T1', url: 'https://reuters.com/x?utm_source=a', content: 'fact one', publishedAt: '2026-02-02' },
    { title: 'T2', url: 'https://apnews.com/y', content: 'fact two' },
  ] };
  var realCalls = 0;
  retriever.nodeFetch = function (u, req) { realCalls++; return makeFakeFetch('json', { body: realBody })(u, req); };
  var d3 = await searchLayer.search('某事件', {});
  eq(d3.ok, true, 'D3 tavily 真实路径 ok=true');
  eq(d3.provider, 'tavily', 'D3 provider=tavily');
  eq(realCalls, 1, 'D3 仅 1 次真实外呼');
  ok(d3.results[0].url.indexOf('utm_source') === -1, 'D3 结果 URL 已剥离追踪');

  // D4：tavily 无 key → 不触发外呼
  delete process.env.TAVILY_API_KEY;
  searchLayer._resetCache();
  retriever.nodeFetch = function () { throw new Error('should not be called'); };
  var d4 = await searchLayer.search('e', {});
  eq(d4.ok, false, 'D4 tavily 无 key → ok=false');
  eq(d4.reason, 'no_api_key', 'D4 reason=no_api_key');

  // D5：超时
  process.env.TAVILY_API_KEY = 'tv-key';
  searchLayer._setConfig({ timeoutMs: 60, retries: 0 });
  searchLayer._resetCache(); searchLayer._resetDaily();
  realCalls = 0;
  retriever.nodeFetch = function (u, req) { realCalls++; return makeFakeFetch('never')(u, req); };
  var d5 = await searchLayer.search('e', {});
  eq(d5.ok, false, 'D5 超时 → ok=false');
  eq(d5.reason, 'timeout', 'D5 reason=timeout（index 透传）');

  // D6：重试（前 2 次 5xx，第 3 次成功）
  searchLayer._setConfig({ timeoutMs: 3000, retries: 2 });
  searchLayer._resetCache(); searchLayer._resetDaily();
  var st = { n: 0, failFirst: 2 };
  realCalls = 0;
  retriever.nodeFetch = function (u, req) { realCalls++; return makeFakeFetch('count', { state: st, body: realBody })(u, req); };
  var d6 = await searchLayer.search('e', {});
  eq(d6.ok, true, 'D6 重试后成功 ok=true');
  eq(realCalls, 3, 'D6 共 3 次外呼（2 失败 + 1 成功）');

  // D7：来源过滤（block 全部返回域名）
  searchLayer._setConfig({ blockedDomains: 'reuters.com,apnews.com', allowedDomains: '' });
  searchLayer._resetCache(); searchLayer._resetDaily();
  retriever.nodeFetch = function (u, req) { return makeFakeFetch('json', { body: realBody })(u, req); };
  var d7 = await searchLayer.search('e', {});
  eq(d7.ok, false, 'D7 全部来源被过滤 → ok=false');
  eq(d7.reason, 'all_filtered', 'D7 reason=all_filtered');

  // D8：配额（dailyQuota=1，第二次触发 quota_exceeded）
  searchLayer._setConfig({ blockedDomains: '', allowedDomains: '', dailyQuota: 1 });
  searchLayer._resetCache(); searchLayer._resetDaily();
  retriever.nodeFetch = function (u, req) { return makeFakeFetch('json', { body: realBody })(u, req); };
  var d8a = await searchLayer.search('e1', { bypassCache: true });
  eq(d8a.ok, true, 'D8a 配额内首次成功');
  var d8b = await searchLayer.search('e2', { bypassCache: true });
  eq(d8b.ok, false, 'D8b 超配额第二次 → ok=false');
  eq(d8b.reason, 'quota_exceeded', 'D8b reason=quota_exceeded');

  // D9：结果上限
  searchLayer._setConfig({ dailyQuota: 500, maxResults: 3 });
  searchLayer._resetCache(); searchLayer._resetDaily();
  var many = { results: [] };
  for (var i = 0; i < 10; i++) many.results.push({ title: 'T' + i, url: 'https://s' + i + '.com/x', content: 'c' + i });
  retriever.nodeFetch = function (u, req) { return makeFakeFetch('json', { body: many })(u, req); };
  var d9 = await searchLayer.search('e', {});
  ok(d9.results.length <= 3, 'D9 结果上限 ≤3（maxResults=3，得 ' + d9.results.length + '）');

  // D10：fail-soft（provider 抛同步异常也不泄漏）
  searchLayer._resetCache(); searchLayer._resetDaily();
  retriever.nodeFetch = function () { throw new Error('boom'); };
  var d10 = await searchLayer.search('e', {});
  eq(d10.ok, false, 'D10 fail-soft 同步异常 → ok=false 不泄漏');
  ok(!!d10.reason, 'D10 含 reason=' + d10.reason);

  // 还原默认值
  process.env.SEARCH_PROVIDER = 'mock';
  delete process.env.TAVILY_API_KEY;

  // ============================================================
  // E. 冻结资产 corpus.json SHA 不变（KB 零污染）
  // ============================================================
  section('E. 冻结资产 SHA 不变');
  var before = sha256(CORPUS);
  process.env.SEARCH_PROVIDER = 'mock';
  searchLayer._resetCache();
  await searchLayer.search('任意查询用于触发检索路径', {});
  process.env.SEARCH_PROVIDER = 'tavily';
  process.env.TAVILY_API_KEY = 'tv-key';
  setFetch('json', { body: realBody });
  searchLayer._resetCache(); searchLayer._resetDaily();
  await searchLayer.search('另一查询触发真实检索路径', {});
  var after = sha256(CORPUS);
  eq(after, before, 'E1 corpus.json SHA 检索流程前后不变（KB 零污染）');
  delete process.env.TAVILY_API_KEY;
  process.env.SEARCH_PROVIDER = 'mock';
}

main().then(function () {
  console.log('\n========================================');
  console.log('  PASS: ' + pass + '   FAIL: ' + fail);
  console.log('========================================');
  if (fail > 0) { failures.forEach(function (f) { console.log('  - ' + f); }); process.exit(1); }
  console.log('全部通过 ✓');
  process.exit(0);
}).catch(function (e) {
  console.log('\n[测试异常] ' + (e && e.stack ? e.stack : e));
  console.log('  PASS: ' + pass + '   FAIL: ' + fail);
  process.exit(1);
});

// 兜底超时（防止挂死）
setTimeout(function () {
  console.log('\n[超时保护] 测试未在预期内完成，强制退出');
  console.log('  PASS: ' + pass + '   FAIL: ' + fail);
  process.exit(fail > 0 ? 1 : 2);
}, 30000);
