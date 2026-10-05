// ============================================================
// Q2-18 分类器回归：确认 person-identity 前置未破坏 A/B/C/D 路由
// ============================================================
'use strict';
var classifier = require('../cloudfunctions/chat/freshness/eventClassifier');
var CATEGORY = require('../cloudfunctions/chat/freshness/schema').CATEGORY;

var cases = [
  ['付航是谁', CATEGORY.B, '人物身份→B'],
  ['付航的学历是什么', CATEGORY.B, '人物属性→B'],
  ['今天有什么科技新闻', CATEGORY.B, '新闻热点→B'],
  ['最近有什么新电影上映', CATEGORY.B, '当前事件名词→B'],
  ['什么是人生意义', CATEGORY.A, '纯哲学无锚点→A'],
  ['论语里说的仁是什么', CATEGORY.A, '经典哲学→A'],
  ['这件事你怎么看', CATEGORY.B, '显式事件指代(这件事)→B(low置信→上层澄清)'],
  ['那个明星出轨了吗', CATEGORY.D, '敏感预信号→D'],
];

var passed = 0, failed = 0;
cases.forEach(function (c) {
  var cls = classifier.classifyCategory(c[0], null);
  var okk = cls.category === c[1];
  if (okk) { passed++; console.log('  ✅ [' + c[1] + '] ' + c[0] + '  (' + c[2] + ')'); }
  else { failed++; console.log('  ❌ [' + cls.category + ' 期望' + c[1] + '] ' + c[0] + '  reason=' + cls.reason); }
});

console.log('\n=== 分类器回归：' + passed + ' PASS / ' + failed + ' FAIL ===');
if (failed > 0) process.exit(1);
