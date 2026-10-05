// ============================================================
// scripts/test_q25b.js
//   Phase Q2-5-B：免费国内搜索 Provider（domestic / SearXNG 兼容）离线测试。
//
//   运行：node scripts/test_q25b.js
//   要求：零网络（retriever.nodeFetch 注入 fakeFetch，绝不触网）。
//   覆盖（用户要求 8 项）：
//     1. 默认 mock 不变        2. provider 注册成功
//     3. fakeFetch 返回结果     4. timeout fallback
//     5. privacyGate 拦截      6. canary 拒绝
//     7. audit 字段正确        8. data_route=domestic
//   附加：KB 零污染（corpus SHA 不变）。
// ============================================================
'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const searchLayer = require('../cloudfunctions/chat/providers/search');
const canaryGate = require('../cloudfunctions/chat/providers/search/canaryGate');
const privacyGate = require('../cloudfunctions/chat/providers/search/privacyGate');
const retriever = require('../cloudfunctions/chat/freshness/eventRetriever');
const CORPUS = '../cloudfunctions/chat/corpus.json';

// ---------- 轻量断言框架 ----------
let pass = 0, fail = 0;
const fails = [];
function ok(cond, msg) { if (cond) { pass++; } else { fail++; fails.push(msg); console.log('  ✗ ' + msg); } }
function eq(a, b, msg) { ok(a === b, msg + ' (期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a) + ')'); }
function section(name) { console.log('\n=== ' + name + ' ==='); }
function sha256File(rel) {
  const buf = fs.readFileSync(path.join(__dirname, rel));
  return crypto.createHash('sha256').update(buf).digest('hex');
}

// ---------- fakeFetch（绝不触网） ----------
function makeFakeFetch(kind, body) {
  return function (url, request) {
    if (kind === 'json') {
      return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve(body || { results: [] }); } });
    }
    if (kind === 'never') {
      return new Promise(function () {}); // 永不 resolve → 触发超时
    }
    return Promise.resolve({ ok: true, status: 200, json: function () { return Promise.resolve({ results: [] }); } });
  };
}
// SearXNG 形态：content 承载摘要、engine 标识来源
const DOMESTIC_RESULTS = {
  results: [
    { title: '国内源A', url: 'https://a.cn/x', content: '国内事实摘要_SNIPPET_AAA', engine: 'baidu' },
    { title: '国内源B', url: 'https://b.cn/y', content: '国内事实摘要_SNIPPET_BBB', engine: 'sogou' },
  ],
};

// ---------- 环境辅助（避免污染全局） ----------
function withEnv(env, fn) {
  const bak = {};
  Object.keys(env).forEach(function (k) { bak[k] = process.env[k]; process.env[k] = env[k]; });
  let r;
  return fn().then(function (res) { r = res; return res; }).finally(function () {
    Object.keys(env).forEach(function (k) { if (bak[k] === undefined) delete process.env[k]; else process.env[k] = bak[k]; });
    return r;
  });
}

(async function () {
  const realFetch = retriever.nodeFetch;
  retriever.nodeFetch = makeFakeFetch('json', DOMESTIC_RESULTS);

  // ============================================================
  section('1. 默认 mock 不变（引入 domestic 源不应改变默认行为）');
  // 当前默认 SEARCH_PROVIDER 未设置 → getProviderName 返回 'mock'
  eq(searchLayer.getProviderName(), 'mock', '默认 SEARCH_PROVIDER → mock');
  const rDefault = await searchLayer.search('默认态查询', { openid: 'someone' });
  eq(rDefault.audit.provider, 'mock', '默认态检索 → provider=mock（行为未变）');
  eq(rDefault.audit.data_route, 'domestic', '默认态 → data_route=domestic（mock 本地，零跨境）');
  eq(rDefault.audit.canary_blocked, false, '默认态 → canary_blocked=false');

  // ============================================================
  section('2. provider 注册成功');
  eq(searchLayer.isDomesticProvider('domestic'), true, 'isDomesticProvider(domestic)=true');
  eq(searchLayer.isRealProvider('domestic'), true, 'isRealProvider(domestic)=true（配额/审计生效，防滥用）');
  eq(searchLayer.isDomesticProvider('tavily'), false, 'isDomesticProvider(tavily)=false');
  eq(searchLayer.isDomesticProvider('mock'), false, 'isDomesticProvider(mock)=false');

  // B–H 均在「请求 domestic 真实源」前提下验证（SEARCH_PROVIDER=domestic + SEARXNG_BASE_URL，绝不触网）
  await withEnv({ SEARCH_PROVIDER: 'domestic', SEARXNG_BASE_URL: 'https://searx.internal/search' }, async function () {
    eq(searchLayer.getProviderName(), 'domestic', 'SEARCH_PROVIDER=domestic → getProviderName=domestic');
    return Promise.resolve();
  });

  // 用独立 env 段验证 unknown → none
  await withEnv({ SEARCH_PROVIDER: 'unknown_xyz' }, async function () {
    eq(searchLayer.getProviderName(), 'none', '未知 provider → 安全降级 none');
    return Promise.resolve();
  });

  // ============================================================
  // 主验证段：domestic 源全部行为
  await withEnv({ SEARCH_PROVIDER: 'domestic', SEARXNG_BASE_URL: 'https://searx.internal/search' }, async function () {
    // 恢复标准 config
    searchLayer._setConfig({ timeoutMs: 3000, retries: 2, dailyQuota: 500 });
    searchLayer._resetDaily();
    retriever.nodeFetch = makeFakeFetch('json', DOMESTIC_RESULTS);

    // ============================================================
    section('3. fakeFetch 返回结果（domestic 源正常解析）');
    let fetchCalls = 0;
    retriever.nodeFetch = function (u, r) { fetchCalls++; return makeFakeFetch('json', DOMESTIC_RESULTS)(u, r); };
    const rOk = await searchLayer.search('存在主义的核心主张', { openid: 'u1' });
    eq(rOk.ok, true, 'domestic 源 → ok=true');
    eq(rOk.provider, 'domestic', 'provider=domestic');
    eq(rOk.results.length, 2, '解析出 2 条结果');
    eq(rOk.results[0].url, 'https://a.cn/x', '首条 url 正确');
    eq(rOk.results[0].snippet.indexOf('国内事实摘要_SNIPPET_AAA'), 0, 'snippet 来自 content 字段');
    eq(rOk.results[0].source, 'baidu', 'source 由 engine 映射补全');
    ok(fetchCalls === 1, '仅单次 provider 调用（无多余外呼）');

    // ============================================================
    section('4. timeout fallback（硬超时 fail-soft）');
    searchLayer._setConfig({ timeoutMs: 120, retries: 0, dailyQuota: 500 });
    searchLayer._resetDaily();
    retriever.nodeFetch = makeFakeFetch('never'); // 永不 resolve
    const rTO = await searchLayer.search('超时场景', { openid: 'u1' });
    eq(rTO.ok, false, '超时 → ok=false');
    eq(rTO.reason, 'timeout', '超时 → reason=timeout（fail-soft 不抛未捕获）');
    ok(rTO.audit.latency_ms >= 100 && rTO.audit.latency_ms < 3000, '审计 latency_ms 反映超时窗口');
    // 恢复
    retriever.nodeFetch = makeFakeFetch('json', DOMESTIC_RESULTS);
    searchLayer._setConfig({ timeoutMs: 3000, retries: 2 });

    // ============================================================
    section('5. privacyGate 拦截（PII 不出境）');
    searchLayer._setConfig({ dailyQuota: 500 });
    searchLayer._resetDaily();
    fetchCalls = 0;
    retriever.nodeFetch = function (u, r) { fetchCalls++; return makeFakeFetch('json', DOMESTIC_RESULTS)(u, r); };
    const rPii = await searchLayer.search('我的手机13800138000请咨询', { openid: 'u1', __privacy: { enabled: true } });
    eq(rPii.ok, false, 'PII → ok=false');
    eq(rPii.reason, 'pii_blocked', 'PII → reason=pii_blocked');
    eq(rPii.audit.data_route, 'blocked', 'PII 拦截 → data_route=blocked（数据未出境）');
    eq(fetchCalls, 0, 'PII 拦截 → 零 provider 调用（不触网）');
    // 单元层确认
    eq(privacyGate.resolve('我的身份证110101199003078888', { enabled: true }).allowed, false, '隐私闸单元：身份证拦截');

    // ============================================================
    section('6. canary 拒绝（灰度兜底强制 mock）');
    searchLayer._setConfig({ dailyQuota: 500 });
    searchLayer._resetDaily();
    retriever.nodeFetch = makeFakeFetch('json', DOMESTIC_RESULTS);
    const rCanary = await searchLayer.search('事实查询', {
      openid: 'stranger',
      __canary: { enabled: true, openids: ['vip1'] },
    });
    eq(rCanary.ok, false, 'canary 拒绝 → ok=false');
    eq(rCanary.reason, 'canary_blocked', 'canary 拒绝 → reason=canary_blocked');
    eq(rCanary.audit.canary_blocked, true, '审计 canary_blocked=true');
    // 白名单命中 → 放行真实 domestic 源
    const rCanaryHit = await searchLayer.search('事实查询', {
      openid: 'vip1',
      __canary: { enabled: true, openids: ['vip1'] },
    });
    eq(rCanaryHit.ok, true, 'canary 命中 → ok=true（domestic 源生效）');
    eq(rCanaryHit.provider, 'domestic', 'canary 命中 → provider=domestic');

    // ============================================================
    section('7. audit 字段正确（仅安全白名单）');
    const audit = rOk.audit;
    const allowedKeys = ['provider', 'latency_ms', 'cache_hit', 'downgrade_reason', 'quota_remaining', 'canary_blocked', 'data_route'];
    eq(JSON.stringify(Object.keys(audit).sort()), JSON.stringify(allowedKeys.slice().sort()), '审计字段严格限定为 7 项安全白名单');
    eq(audit.provider, 'domestic', 'audit.provider=domestic');
    eq(audit.canary_blocked, false, 'audit.canary_blocked=false');
    eq(audit.downgrade_reason, '', 'audit.downgrade_reason=""（成功）');
    ok(audit.quota_remaining > 0, 'audit.quota_remaining>0（配额未耗尽）');
    ok(JSON.stringify(audit).indexOf('存在主义的核心主张') === -1, '审计不含用户原文');
    ok(JSON.stringify(audit).indexOf('国内事实摘要_SNIPPET_AAA') === -1, '审计不含完整搜索结果');
    ok(audit.latency_ms >= 0, 'audit.latency_ms 存在');

    // ============================================================
    section('8. data_route=domestic（国内数据路径核心标记）');
    eq(rOk.audit.data_route, 'domestic', 'domestic 源成功 → data_route=domestic');
    // 跨源对照：tavily 仍 cross_border（确保枚举未混淆）
    await withEnv({ SEARCH_PROVIDER: 'tavily', TAVILY_API_KEY: 'offline-key' }, async function () {
      retriever.nodeFetch = makeFakeFetch('json', DOMESTIC_RESULTS);
      const rTv = await searchLayer.search('对照查询', { openid: 'u1' });
      if (rTv.ok) eq(rTv.audit.data_route, 'cross_border', 'tavily 成功 → data_route=cross_border（枚举未误标）');
      return Promise.resolve();
    });

    // ============================================================
    section('9. KB 零污染（corpus SHA 不变）');
    const shaBefore = sha256File(CORPUS);
    for (let i = 0; i < 6; i++) {
      await searchLayer.search('存在主义_' + i, { openid: (i % 2 ? 'vip1' : 'stranger'), __canary: { enabled: true, openids: ['vip1'] } });
    }
    const shaAfter = sha256File(CORPUS);
    eq(shaAfter, shaBefore, 'corpus.json SHA 全流程前后不变（KB 零污染）');

    return Promise.resolve();
  }); // end withEnv(domestic)

  // 恢复
  retriever.nodeFetch = realFetch;

  // ---------- 汇总 ----------
  console.log('\n========================================');
  console.log('Phase Q2-5-B 测试结果: ' + pass + ' PASS / ' + fail + ' FAIL');
  console.log('========================================');
  if (fail > 0) {
    console.log('失败项:'); fails.forEach(function (m) { console.log('  - ' + m); });
    process.exit(1);
  }
  process.exit(0);
})().catch(function (e) {
  console.error('测试运行异常:', e);
  process.exit(2);
});
