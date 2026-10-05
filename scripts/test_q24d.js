// ============================================================
// scripts/test_q24d.js
//   Phase Q2-4-D：Privacy Boundary Layer 离线测试套件（100% PASS / 0 regression）
//
//   覆盖要求：
//     1. 默认关闭状态
//     2. 普通问题允许（"什么是存在主义"）
//     3. 手机号阻断
//     4. 身份证阻断
//     5. 邮箱阻断
//     6. 地址阻断（完整住址）
//     7. 脱敏成功
//     8. search 未被调用（隐私阻断时 provider 不掉用）
//     9. audit 不泄露隐私
//    10. mock 行为零变化
//    + data_route 枚举验证（domestic / cross_border / blocked）
//
//   全部离线：provider 调用经 retriever.nodeFetch 注入 fakeFetch，绝不触网。
//   Node 22 运行（测试环境，可用 async/await）。所有 section 严格串行 await。
// ============================================================
'use strict';

var path = require('path');
var chatDir = path.join(__dirname, '..', 'cloudfunctions', 'chat');
var privacyGate = require(path.join(chatDir, 'providers', 'search', 'privacyGate'));
var searchLayer = require(path.join(chatDir, 'providers', 'search'));
var retriever = require(path.join(chatDir, 'freshness', 'eventRetriever'));

// ---------------- 极简断言框架 ----------------
var pass = 0, fail = 0, fails = [];
function ok(cond, msg) {
  if (cond) { pass++; }
  else { fail++; fails.push(msg); console.log('  ✗ ' + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + ' (期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a) + ')'); }
function section(name) { console.log('\n=== ' + name + ' ==='); }

// ---------------- 环境与注入 ----------------
function withEnv(env, fn) {
  var bak = {};
  Object.keys(env).forEach(function (k) { bak[k] = process.env[k]; process.env[k] = env[k]; });
  return Promise.resolve().then(fn).then(function (r) {
    Object.keys(env).forEach(function (k) { if (bak[k] === undefined) delete process.env[k]; else process.env[k] = bak[k]; });
    return r;
  }, function (e) {
    Object.keys(env).forEach(function (k) { if (bak[k] === undefined) delete process.env[k]; else process.env[k] = bak[k]; });
    throw e;
  });
}
function makeFakeFetch() {
  var calls = 0;
  var fn = function () {
    calls++;
    return Promise.resolve({ ok: true, status: 200, json: function () {
      return Promise.resolve({ results: [{ title: 't', url: 'https://example.com/a', content: 'c', published_date: '' }] });
    } });
  };
  fn.calls = function () { return calls; };
  return fn;
}
function resetLayer() { searchLayer._resetCache(); searchLayer._resetDaily(); }

var PHONE = '打我电话13800138000咨询';
var ID = '我的身份证是110101199003078888';
var EMAIL = '邮箱是a.b@test.com谢谢';
var ADDR = '我家住北京市海淀区中关村大街1号';
var NORMAL = '什么是存在主义';
var SANITIZE = '我35岁，在上海做程序员，最近失业怎么办？';

// ============================================================
(async function () {

  // ----------------------------------------------------------
  section('1. 默认关闭状态（PRIVACY_GATE_ENABLED 未设 → 零影响）');
  (function () {
    var r = privacyGate.resolve(PHONE); // 无 cfg → 读 env，未设 → 关闭
    eq(r.allowed, true, '默认关闭：含手机 query 仍 allowed');
    eq(r.sanitizedQuery, PHONE, '默认关闭：sanitizedQuery 等于原 query');
  })();
  resetLayer();
  await (async function () {
    var res = await searchLayer.search(PHONE, {}); // 默认 mock，闸门关
    eq(res.ok, true, '默认态：mock 下 PII query 仍 ok=true（不阻断）');
    ok(Array.isArray(res.results) && res.results.length > 0, '默认态：mock 仍返回结果（行为零变化）');
  })();

  // ----------------------------------------------------------
  section('2. 普通问题允许（"什么是存在主义"）');
  (function () {
    var r = privacyGate.resolve(NORMAL, { enabled: true });
    eq(r.allowed, true, '普通哲学问题 allowed=true');
    eq(r.sanitizedQuery, NORMAL, '普通问题 sanitizedQuery 等于原 query（无脱敏）');
    eq(r.reason, '', '普通问题 reason 为空');
  })();

  // ----------------------------------------------------------
  section('3. 手机号阻断');
  (function () { var r = privacyGate.resolve(PHONE, { enabled: true }); eq(r.allowed, false, '手机 allowed=false'); eq(r.reason, 'pii_blocked', '手机 reason=pii_blocked'); })();

  // ----------------------------------------------------------
  section('4. 身份证阻断');
  (function () { var r = privacyGate.resolve(ID, { enabled: true }); eq(r.allowed, false, '身份证 allowed=false'); eq(r.reason, 'pii_blocked', '身份证 reason=pii_blocked'); })();

  // ----------------------------------------------------------
  section('5. 邮箱阻断');
  (function () { var r = privacyGate.resolve(EMAIL, { enabled: true }); eq(r.allowed, false, '邮箱 allowed=false'); eq(r.reason, 'pii_blocked', '邮箱 reason=pii_blocked'); })();

  // ----------------------------------------------------------
  section('6. 地址阻断（完整住址）');
  (function () { var r = privacyGate.resolve(ADDR, { enabled: true }); eq(r.allowed, false, '完整住址 allowed=false'); eq(r.reason, 'pii_blocked', '完整住址 reason=pii_blocked'); })();

  // ----------------------------------------------------------
  section('7. 脱敏成功（去除身份信息、保留语义）');
  (function () {
    var r = privacyGate.resolve(SANITIZE, { enabled: true });
    eq(r.allowed, true, '软 PII query allowed=true（脱敏后放行）');
    ok(r.sanitizedQuery.indexOf('上海') === -1, '脱敏后不含城市「上海」');
    ok(r.sanitizedQuery.indexOf('程序员') !== -1, '脱敏后保留语义「程序员」');
    ok(r.sanitizedQuery.indexOf('失业') !== -1, '脱敏后保留语义「失业」');
    ok(r.sanitizedQuery.indexOf('我') === -1, '脱敏后去除第一人称「我」');
  })();

  // ----------------------------------------------------------
  section('8. search 未被调用（隐私阻断时 provider 零外呼）');
  resetLayer();
  await withEnv({ SEARCH_PROVIDER: 'tavily', PRIVACY_GATE_ENABLED: 'true' }, async function () {
    var fake = makeFakeFetch();
    retriever.nodeFetch = fake; // 拦截真实外呼
    var res = await searchLayer.search(PHONE, {});
    eq(res.reason, 'pii_blocked', '隐私阻断 reason=pii_blocked');
    eq(res.ok, false, '隐私阻断 ok=false');
    eq(fake.calls(), 0, '隐私阻断时 provider（fetch）调用次数=0');
    retriever.nodeFetch = null;
  });

  // ----------------------------------------------------------
  section('9. audit 不泄露隐私');
  var ALLOWED_AUDIT_KEYS = ['provider', 'latency_ms', 'cache_hit', 'downgrade_reason', 'quota_remaining', 'canary_blocked', 'data_route'];
  resetLayer();
  await withEnv({ SEARCH_PROVIDER: 'tavily', PRIVACY_GATE_ENABLED: 'true' }, async function () {
    var res = await searchLayer.search(PHONE, {});
    var audit = res.audit;
    ok(audit && typeof audit === 'object', 'audit 字段存在');
    var keys = Object.keys(audit);
    var onlySafe = keys.every(function (k) { return ALLOWED_AUDIT_KEYS.indexOf(k) !== -1; });
    ok(onlySafe, 'audit 仅含安全字段（无 query/sanitizedQuery/openid）: ' + JSON.stringify(keys));
    eq(audit.data_route, 'blocked', '隐私阻断 data_route=blocked');
    var s = JSON.stringify(audit);
    ok(s.indexOf('13800138000') === -1, 'audit 不含手机号原文');
    ok(s.indexOf('打我电话') === -1, 'audit 不含用户查询原文');
    ok(!('query' in audit) && !('sanitizedQuery' in audit) && !('openid' in audit), 'audit 无 query/sanitizedQuery/openid 键');
  });
  resetLayer();
  await withEnv({ SEARCH_PROVIDER: 'tavily', PRIVACY_GATE_ENABLED: 'true', TAVILY_API_KEY: 'test' }, async function () {
    var fake = makeFakeFetch();
    retriever.nodeFetch = fake;
    var res = await searchLayer.search(NORMAL, {});
    retriever.nodeFetch = null;
    var s = JSON.stringify(res.audit);
    ok(s.indexOf('存在主义') === -1, '放行 audit 不含查询原文');
    eq(res.audit.data_route, 'cross_border', '真实境外 provider data_route=cross_border');
  });

  // ----------------------------------------------------------
  section('10. mock 行为零变化（闸门关闭时）');
  resetLayer();
  await (async function () {
    var res = await searchLayer.search(NORMAL, {});
    eq(res.ok, true, 'mock 普通问题 ok=true');
    ok(res.results.length > 0, 'mock 普通问题返回结果');
    eq(res.audit.data_route, 'domestic', 'mock data_route=domestic（本地，无跨境）');
    var res2 = await searchLayer.search(PHONE, {});
    eq(res2.ok, true, 'mock + PII query 仍 ok=true（闸门关闭不阻断）');
    ok(res2.results.length > 0, 'mock + PII query 仍返回结果');
  })();

  // ----------------------------------------------------------
  section('E. data_route 枚举完整性');
  resetLayer();
  await withEnv({ SEARCH_PROVIDER: 'none' }, async function () {
    var res = await searchLayer.search(NORMAL, {});
    eq(res.audit.data_route, 'domestic', 'none provider data_route=domestic');
  });
  resetLayer();
  await withEnv({ SEARCH_PROVIDER: 'tavily', SEARCH_CANARY_ENABLED: 'true', SEARCH_CANARY_OPENIDS: 'other_openid' }, async function () {
    var res = await searchLayer.search(NORMAL, { openid: 'unknown_user' });
    eq(res.reason, 'canary_blocked', 'canary 拦截 reason=canary_blocked');
    eq(res.audit.data_route, 'domestic', 'canary 强制 mock → data_route=domestic（未跨境）');
  });

  // ---------------- 汇总 ----------------
  console.log('\n========================================');
  console.log('Phase Q2-4-D test_q24d.js 结果： ' + pass + ' PASS / ' + fail + ' FAIL');
  if (fail > 0) {
    console.log('失败项：');
    fails.forEach(function (m) { console.log('  - ' + m); });
    process.exit(1);
  } else {
    console.log('✅ 全部通过');
  }
})().catch(function (e) {
  console.error('测试运行异常：', e);
  process.exit(1);
});
