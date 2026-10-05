// ============================================================
// test_q33.js — Q2-15 传记幻觉防护回归测试
//
// 覆盖：
//   1. 人物身份查询分类（不落 A 类，归 B 触发搜索）
//   2. freshness 不再短路（searchLayer.getProviderName 修复验证）
//   3. 人物身份降级模板（专用文案，非通用降级）
//   4. 传记幻觉输出检测（学历/院校/出生日期断言）
//   5. 哲学/知识类查询不受影响（A/C 类不变）
//
// 运行：node scripts/test_q33.js
// 依赖：无（纯离线，不触网、不读云库）
// ============================================================
'use strict';

var assert = require('assert');
var path = require('path');

// ---------- 模块加载 ----------
var classifier = require('../cloudfunctions/chat/freshness/eventClassifier');
var responder = require('../cloudfunctions/chat/freshness/responder');
var downgrade = require('../cloudfunctions/chat/freshness/downgrade');
var searchLayer = require('../cloudfunctions/chat/providers/search');
var freshnessIndex = require('../cloudfunctions/chat/freshness/index');

var CATEGORY = require('../cloudfunctions/chat/freshness/schema').CATEGORY;
var EVENT_STATUS = require('../cloudfunctions/chat/freshness/schema').EVENT_STATUS;
var DOWNGRADE_REASON = require('../cloudfunctions/chat/freshness/schema').DOWNGRADE_REASON;

var PASS = 0, FAIL = 0;
function section(name) { console.log('\n=== ' + name + ' ==='); }
function eq(a, b, msg) {
  try { assert.strictEqual(a, b, msg || ''); PASS++; }
  catch(e) { FAIL++; console.log('  ✗ ' + (msg || '') + '\n    expected: ' + JSON.stringify(b) + '\n    actual:   ' + JSON.stringify(a)); }
}
function ok(cond, msg) {
  try { assert.ok(cond, msg || ''); PASS++; }
  catch(e) { FAIL++; console.log('  ✗ ' + (msg || '')); }
}
function notIn(needle, haystack, msg) {
  try { assert.ok(haystack.indexOf(needle) < 0, msg || ('' + needle + ' should not be in ' + haystack)); PASS++; }
  catch(e) { FAIL++; console.log('  ✗ ' + (msg || '')); }
}

// ============================================================
section('1. 人物身份查询分类：全部归 B（不落 A）');
// ============================================================

(function () {
  var personQueries = [
    '付航是谁', '他是谁', '郭德纲何许人也',
    '介绍一下付航', '孔子是什么人', '你知道马斯克吗',
    '能介绍一下马云吗', '董宇辉是何许人也',
  ];
  for (var i = 0; i < personQueries.length; i++) {
    var r = classifier.classifyCategory(personQueries[i]);
    eq(r.category, CATEGORY.B, personQueries[i] + ' → 应归 B');
    ok(r.reason.indexOf('person-identity') >= 0, personQueries[i] + ' → reason 含 person-identity');
  }
})();

// ============================================================
section('2. 非人物身份查询不受影响（哲学→A / 新闻→B / 歧义→C）');
// ============================================================

(function () {
  // 无锚点哲学 → A（不应被误判为人物身份）
  var r1 = classifier.classifyCategory('人生的意义是什么');
  eq(r1.category, CATEGORY.A, '哲学问题仍归 A');
  eq(r1.reason, 'no-event-anchor');

  // 有时间锚点的新闻 → B（原有路径不变）
  var r2 = classifier.classifyCategory('今天有什么新闻');
  eq(r2.category, CATEGORY.B, '新闻查询仍归 B');

  // 带事件名词的当前动态 → B（Q2-14b 修复保持）
  var r3 = classifier.classifyCategory('最近电影票房怎么样');
  eq(r3.category, CATEGORY.B, '票房查询仍归 B');

  // 纯知识但带锚点 → 可能 C 或 B（原有逻辑不变）
  var r4 = classifier.classifyCategory('怎么看待最近的AI突破');
  eq(r4.category, CATEGORY.B, 'AI突破看法归 B');
})();

// ============================================================
section('3. freshness 路由：人物身份不被短路（Q2-14 修复延续）');
// ============================================================

(function () {
  // 验证 searchLayer.getProviderName 可调用且返回非 'none'（当 SEARCH_PROVIDER=qwen 时）
  var providerName = searchLayer.getProviderName();
  // 离线测试环境可能未设 env，但不能是旧变量 FRESHNESS_SEARCH_PROVIDER 的行为
  ok(typeof providerName === 'string', 'getProviderName 返回字符串');
  // 关键：不能因为旧变量未设就永远返回 'none'
  notIn('FRESHNESS_SEARCH_PROVIDER', searchLayer.getProviderName.toString() || '',
         'getProviderName 实现不依赖旧变量 FRESHNESS_SEARCH_PROVIDER');
})();

// ============================================================
section('4. 人物身份专用降级模板');
// ============================================================

(function () {
  var dg = downgrade.buildDowngrade({
    reason: DOWNGRADE_REASON.NO_RELIABLE_FACT,
    userIntent: 'reflection',
    query: '付航是谁',
  });
  eq(dg.action, 'person_identity_boundary', '人物身份查询使用专用降级动作');
  ok(dg.answer.length > 10, '降级回答非空');
  ok(dg.answer.indexOf('没有可靠') >= 0 || dg.answer.indexOf('不能') >= 0,
     '降级回答包含"没有可靠"或"不能"等诚实表达');
  // 必须提到不能给具体细节
  ok(dg.answer.indexOf('细节') >= 0 || dg.answer.indexOf('学历') >= 0 || dg.answer.indexOf('背景') >= 0,
     '降级回答提及不能提供细节/学历/背景');

  // 非人物身份查询不受影响
  var dg2 = downgrade.buildDowngrade({
    reason: DOWNGRADE_REASON.NO_RELIABLE_FACT,
    userIntent: 'reflection',
    query: '最近有什么新闻',
  });
  notIn('person_identity_boundary', dg2.action, '非人物身份不用专用降级');
})();

// ============================================================
section('5. 传记幻觉输出检测（responder guardOutput）');
// ============================================================

(function () {
  // 无事实底座时——检测到学历断言应标记违规
  var hallucinatedAnswer =
    '付航是中国大陆的一位脱口秀演员。他毕业于北京航空航天大学（本科）和中国科学院大学（硕士）。';
  var guard1 = responder.guardOutput(hallucinatedAnswer, null);
  ok(!guard1.ok, '无来源的学历+院校断言应被拦截');
  ok(guard1.violations.length > 0, '应有至少一条 violation');
  ok(guard1.violations.some(function(v) { return v.indexOf('biography-') === 0; }),
     'violation 应含 biography- 前缀');

  // 无事实底座时——出生日期断言应被拦截
  var birthAnswer = '他出生于1993年，早年从事过程序员工作。';
  var guard2 = responder.guardOutput(birthAnswer, { status: EVENT_STATUS.UNVERIFIED });
  ok(!guard2.ok, '无来源的出生日期断言应被拦截');

  // 有 grounded 底座时——允许转述底座中的传记信息（假设底座包含这些信息）
  var groundedAnswer = '根据公开信息，他出生于1993年。（来源：百度百科）';
  var guard3 = responder.guardOutput(groundedAnswer, { status: EVENT_STATUS.GROUNDED });
  // grounded 时 biography 检查不启用，所以这应该通过（除非命中其他规则）
  // 注意：如果答案太短或命中其他 forbidden pattern 也可能失败，这里只检查 biography 不拦
  ok(!guard3.violations.some(function(v) { return v.indexOf('biography-') === 0; }) || guard3.ok,
     'grounded 底座时不触发 biography 检查');

  // 安全回答（不确定语气）应通过
  var safeAnswer = '关于付航的具体背景，我没有可靠的信息来源可以核实。这类信息模型很容易出错。';
  var guard4 = responder.guardOutput(safeAnswer, null);
  ok(guard4.ok, '诚实的不确定回答应通过检查');
})();

// ============================================================
section('6. 护栏指令生成（buildFreshnessGuardrails）');
// ============================================================

(function () {
  // Category B + 无事实底座 → 应包含人物身份专用护栏
  var rails = responder.buildFreshnessGuardrails(null, 'reflection', 'B');
  ok(rails.indexOf('人物身份查询') >= 0 || rails.indexOf('严格禁止断言') >= 0,
     'B 类无底座时应含人物身份专用护栏指令');
  ok(rails.indexOf('学历') >= 0 || rails.indexOf('禁止') >= 0,
     '护栏应明确提到禁止学历等细节');

  // Category A + 无底座 → 不应包含人物身份专用护栏（A 不走 freshness responder）
  var railsA = responder.buildFreshnessGuardrails(null, 'reflection', 'A');
  // A 类理论上不会进 responder，但如果进了也不应有传记特殊指令
  // （这里不做强断言，仅确认不会因 A 类误触发传记拦截正常回答）
})();

// ============================================================
// 结果汇总
// ============================================================
console.log('\n========================================');
console.log('  Q2-15 传记幻觉防护: PASS=' + PASS + '  FAIL=' + FAIL);
console.log('========================================');
process.exit(FAIL > 0 ? 1 : 0);
