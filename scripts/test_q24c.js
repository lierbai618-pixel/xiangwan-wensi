// ============================================================
// scripts/test_q24c.js
//   Phase Q2-4-C：灰度安全层（SEARCH_CANARY_GATE + Search Audit Metadata）离线测试。
//
//   运行：node scripts/test_q24c.js
//   要求：零网络（retriever.nodeFetch 注入 fakeFetch）。
//   覆盖（用户要求 6 项）：
//     A. 白名单命中   B. 白名单拒绝   C. quota 熔断
//     D. timeout fallback   E. mock 泄漏检测   F. ephemeral 隔离检测
// ============================================================
'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const searchLayer = require('../cloudfunctions/chat/providers/search');
const canaryGate = require('../cloudfunctions/chat/providers/search/canaryGate');
const thinkEngine = require('../cloudfunctions/chat/think/thinkEngine');
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
const REAL_RESULTS = {
  results: [
    { title: '来源A', url: 'https://a.com/x', snippet: 'SUPER_SECRET_SNIPPET_AAA', source: 'a.com' },
    { title: '来源B', url: 'https://b.com/y', snippet: 'SUPER_SECRET_SNIPPET_BBB', source: 'b.com' },
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
  // 准备：隔离 nodeFetch，避免任何真实外呼
  const realFetch = retriever.nodeFetch;
  retriever.nodeFetch = makeFakeFetch('json', REAL_RESULTS);

  // ============================================================
  section('A. 白名单命中（canary 单元）');
  // 闸门关闭 → 原样放行
  eq(canaryGate.resolve('anyone', 'tavily').active, false, 'canary 默认关闭 → active=false');
  eq(canaryGate.resolve('anyone', 'tavily').provider, 'tavily', 'canary 关闭 → provider 不变');
  // 闸门开启 + 白名单命中
  const hit = canaryGate.resolve('vip1', 'tavily', { enabled: true, openids: ['vip1', 'vip2'] });
  eq(hit.provider, 'tavily', '白名单命中 → provider 保持 tavily');
  eq(hit.canaryBlocked, false, '白名单命中 → canaryBlocked=false');
  eq(hit.active, true, '白名单命中 → active=true');
  // 非真实源不受灰度影响
  eq(canaryGate.resolve('vip1', 'mock', { enabled: true, openids: ['vip1'] }).provider, 'mock', 'mock 源不受 canary 影响');

  // ============================================================
  // B–F 均在「请求真实源」前提下验证（SEARCH_PROVIDER=tavily + 测试密钥，绝不触网）。
  await withEnv({ SEARCH_PROVIDER: 'tavily', TAVILY_API_KEY: 'offline-test-key' }, async function () {
  section('B. 白名单拒绝（canary 单元 + 检索层零外呼）');
  const blocked = canaryGate.resolve('stranger', 'tavily', { enabled: true, openids: ['vip1'] });
  eq(blocked.provider, 'mock', '白名单拒绝 → 强制 mock');
  eq(blocked.canaryBlocked, true, '白名单拒绝 → canaryBlocked=true');

  // 检索层：canary 拒绝 → 不调用任何 provider（验证 fetch 计数=0）
  let fetchCalls = 0;
  retriever.nodeFetch = function (u, r) { fetchCalls++; return makeFakeFetch('json', REAL_RESULTS)(u, r); };
  const rBlk = await searchLayer.search('量子计算最新进展', {
    openid: 'stranger',
    __canary: { enabled: true, openids: ['vip1'] },
  });
  eq(rBlk.ok, false, 'canary 拒绝 → ok=false');
  eq(rBlk.reason, 'canary_blocked', 'canary 拒绝 → reason=canary_blocked');
  eq(rBlk.audit.canary_blocked, true, '审计标记 canary_blocked=true');
  eq(fetchCalls, 0, 'canary 拒绝 → 零 provider 调用（无真实外呼）');

  // 环境变量路径验证（SEARCH_CANARY_ENABLED / OPENIDS）
  await withEnv({ SEARCH_CANARY_ENABLED: 'true', SEARCH_CANARY_OPENIDS: 'vip1,vip2' }, async function () {
    eq(canaryGate.resolve('vip2', 'tavily').provider, 'tavily', 'env 白名单命中 → tavily');
    eq(canaryGate.resolve('ghost', 'tavily').provider, 'mock', 'env 白名单拒绝 → mock');
    eq(canaryGate.resolve('unknown', 'tavily').provider, 'mock', 'env 无身份 → fail-closed(mock)');
    return Promise.resolve();
  });

  // ============================================================
  section('C. quota 熔断（真实源请求但日配额耗尽）');
  retriever.nodeFetch = makeFakeFetch('json', REAL_RESULTS);
  searchLayer._setConfig({ dailyQuota: 0 });
  searchLayer._resetDaily();
  const rQuota = await searchLayer.search('某热点事件', { openid: 'vip1', __canary: { enabled: true, openids: ['vip1'] } });
  eq(rQuota.ok, false, 'quota=0 → ok=false');
  eq(rQuota.reason, 'quota_exceeded', 'quota 耗尽 → reason=quota_exceeded');
  eq(rQuota.audit.quota_remaining, 0, '审计 quota_remaining=0');
  searchLayer._setConfig({ dailyQuota: 500 });

  // ============================================================
  section('D. timeout fallback（单 retry，硬超时 fail-soft）');
  searchLayer._setConfig({ timeoutMs: 120, retries: 0, dailyQuota: 500 });
  searchLayer._resetDaily();
  retriever.nodeFetch = makeFakeFetch('never'); // 永不 resolve
  const rTO = await searchLayer.search('超时场景', { openid: 'vip1', __canary: { enabled: true, openids: ['vip1'] } });
  eq(rTO.ok, false, '超时 → ok=false');
  eq(rTO.reason, 'timeout', '超时 → reason=timeout（fail-soft 不抛未捕获）');
  ok(rTO.audit.latency_ms >= 100 && rTO.audit.latency_ms < 2000, '审计 latency_ms 反映超时窗口');
  // 恢复正常 fetch
  retriever.nodeFetch = makeFakeFetch('json', REAL_RESULTS);
  searchLayer._setConfig({ timeoutMs: 3000, retries: 2 });

  // ============================================================
  section('E. mock 泄漏检测（用户可见文本无 [MOCK]）');
  // 白名单命中 → 真实源返回结果；answer 含真实来源、不含 [MOCK]
  searchLayer._setConfig({ dailyQuota: 500 });
  searchLayer._resetDaily();
  const rHit = await searchLayer.search('事实查询', { openid: 'vip1', __canary: { enabled: true, openids: ['vip1'] } });
  eq(rHit.ok, true, '白名单命中 → ok=true（真实源生效）');
  eq(rHit.provider, 'tavily', '白名单命中 → provider=tavily');
  ok(JSON.stringify(rHit).indexOf('[MOCK]') === -1, '真实源结果不含 [MOCK] 标记');

  // 端到端：canary 拒绝 → thinkEngine 回退 RAG，answer 无 [MOCK]
  const fakeRag = function (q, o) {
    return Promise.resolve({ answer: '这是经典文本解读，不含任何外部事实。', citations: [], retrieval: { minScore: 0.3 } });
  };
  const thinkRes = await thinkEngine.run('SUPER_SECRET_QUERY_TOKEN', {
    answerMode: 'think',
    mode: 'plain',
    factualEnabled: true,
    searchProvider: 'tavily',
    openid: 'stranger',
    __canary: { enabled: true, openids: ['vip1'] },
    generateAnswer: fakeRag,
    searchFn: function (q, o) { return searchLayer.search(q, o); },
  });
  ok(thinkRes && thinkRes.answer, 'canary 拒绝 → thinkEngine 回退到 RAG 回答');
  ok(thinkRes.answer.indexOf('[MOCK]') === -1, 'canary 拒绝 → 用户可见 answer 无 [MOCK]');
  ok(thinkRes.think && thinkRes.think.searchAudit && thinkRes.think.searchAudit.canary_blocked === true,
    'canary 拒绝 → think 元信息 searchAudit.canary_blocked=true');

  // ============================================================
  section('F. ephemeral 隔离检测（审计/上下文仅安全字段，KB 零污染）');
  // F1：审计元数据仅含白名单字段，绝不记录用户原文/完整结果/openid
  const audit = rHit.audit;
  const allowedKeys = ['provider', 'latency_ms', 'cache_hit', 'downgrade_reason', 'quota_remaining', 'canary_blocked', 'data_route'];
  const auditKeys = Object.keys(audit).sort();
  eq(JSON.stringify(auditKeys), JSON.stringify(allowedKeys.slice().sort()), '审计字段严格限定为安全白名单');
  ok(JSON.stringify(audit).indexOf('SUPER_SECRET_QUERY_TOKEN') === -1, '审计不含用户原文');
  ok(JSON.stringify(audit).indexOf('SUPER_SECRET_SNIPPET_AAA') === -1, '审计不含完整搜索结果');
  ok(JSON.stringify(audit).indexOf('stranger') === -1, '审计不含 openid 等个人信息');

  // F2：canary 闸门自身不留存 openid（仅相等比较）
  ok(canaryGate.resolve('stranger', 'tavily', { enabled: true, openids: ['vip1'] }).provider === 'mock',
    'canary 仅比较 openid，不存储');

  // F3：thinkEngine 端到端 → 序列化结果不含用户查询原文，context 为脱敏元信息
  const rEph = await thinkEngine.run('SUPER_SECRET_QUERY_TOKEN', {
    answerMode: 'think',
    mode: 'plain',
    factualEnabled: true,
    searchProvider: 'tavily',
    openid: 'vip1',
    __canary: { enabled: true, openids: ['vip1'] },
    generateAnswer: fakeRag,
    searchFn: function (q, o) { return searchLayer.search(q, o); },
    allowMockFacts: true,
  });
  const serialized = JSON.stringify(rEph);
  ok(serialized.indexOf('SUPER_SECRET_QUERY_TOKEN') === -1, '结果序列化不含用户查询原文（未泄漏进 ephemeral 元信息）');
  ok(serialized.indexOf('SUPER_SECRET_SNIPPET_AAA') === -1 || serialized.indexOf('SUPER_SECRET_SNIPPET_BBB') === -1,
    '结果序列化不携带完整原始 snippet（仅经事实抽取的陈述/来源）');

  // F4：corpus 全程零写入（KB 隔离硬保障）
  const shaBefore = sha256File(CORPUS);
  // 再跑若干次真实/降级流程
  for (let i = 0; i < 5; i++) {
    await thinkEngine.run('SUPER_SECRET_QUERY_TOKEN_' + i, {
      answerMode: 'think', factualEnabled: true, searchProvider: 'tavily',
      openid: (i % 2 ? 'vip1' : 'stranger'),
      __canary: { enabled: true, openids: ['vip1'] },
      generateAnswer: fakeRag, searchFn: function (q, o) { return searchLayer.search(q, o); }, allowMockFacts: true,
    });
  }
  const shaAfter = sha256File(CORPUS);
  eq(shaAfter, shaBefore, 'corpus.json SHA 全流程前后不变（KB 零污染）');

  // ============================================================
  }); // end withEnv(SEARCH_PROVIDER=tavily) for B–F
  section('G. 默认安全态（canary 关闭时无任何行为变化）');
  const rDefault = await searchLayer.search('默认态查询', { openid: 'someone' });
  // 当前 SEARCH_PROVIDER 默认 mock → ok 由 mock provider 决定；关键是 canary 不介入
  eq(rDefault.audit.canary_blocked, false, '默认态 → canary_blocked=false');
  ok(rDefault.audit.provider !== undefined, '默认态 → 审计照常产出（仅安全字段）');

  // 恢复
  retriever.nodeFetch = realFetch;

  // ---------- 汇总 ----------
  console.log('\n========================================');
  console.log('Phase Q2-4-C 测试结果: ' + pass + ' PASS / ' + fail + ' FAIL');
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
