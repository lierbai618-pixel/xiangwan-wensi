// ============================================================
// Q2-18 真机级端到端：maybeHandle 全链路（多问法）
// ============================================================
'use strict';

process.env.FRESHNESS_ENABLED = 'true';
process.env.FRESHNESS_FACTUAL_ENABLED = 'true';
process.env.SEARCH_PROVIDER = 'qwen';
process.env.SEARCH_TIMEOUT_MS = '15000';
process.env.QWEN_SEARCH_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
process.env.QWEN_SEARCH_API_KEY = 'sk-YOUR_API_KEY_HERE';
process.env.QWEN_SEARCH_MODEL = 'deepseek-v4-flash-0731';
process.env.QWEN_SEARCH_SYNTH_MODE = 'true';
process.env.SEARCH_CANARY_ENABLED = 'true';
process.env.SEARCH_CANARY_OPENIDS = 'YOUR_ADMIN_OPENID';
process.env.PRIVACY_GATE_ENABLED = 'true';

var freshness = require('../cloudfunctions/chat/freshness');
var maybeHandle = freshness.maybeHandle;

var MODELS = [{
  name: 'deepseek-v4-flash-0731',
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: 'sk-YOUR_API_KEY_HERE',
  model: 'deepseek-v4-flash-0731',
  timeout: 25000
}];

var SYNTH_DISCLAIMER_RE = /(网络(综合|资料|搜索|来源)|联网(搜索|结果)?|来自(网络|搜索)|公开资料|未经(独立)?(核实|证实)|综合(网络|搜索))/u;

async function testOne(query) {
  console.log('\n========================================');
  console.log('问法:', query);
  var t0 = Date.now();
  var res = await maybeHandle(query, {
    models: MODELS,
    openid: 'YOUR_ADMIN_OPENID',
    answerMode: 'think',
    history: []
  });
  var elapsed = Date.now() - t0;
  console.log('耗时:', elapsed + 'ms');
  if (!res) { console.log('  ❌ 返回 null'); return false; }
  console.log('  mode:', res.mode, '| downgraded:', !!(res.freshness && res.freshness.downgraded),
              '| reason:', res.freshness && res.freshness.downgrade_reason,
              '| category:', res.freshness && res.freshness.category,
              '| provider:', res.freshness && res.freshness.search_provider);

  var ok = true;
  if (res.freshness && res.freshness.downgraded) { ok = false; console.log('  ❌ 降级'); }
  else {
    if (res.mode === 'freshness') console.log('  ✅ 接管 B 类');
    else { ok = false; console.log('  ❌ mode 非 freshness'); }
  }
  if (res.answer && res.answer.indexOf('没有可靠的信息来源') >= 0) { ok = false; console.log('  ❌ 命中降级模板文案'); }
  if (res.answer && SYNTH_DISCLAIMER_RE.test(res.answer)) console.log('  ✅ 含联网免责声明');
  else { ok = false; console.log('  ❌ 缺联网免责声明'); }
  console.log('  --- 回答前 240 字 ---');
  console.log('  ' + (res.answer || '').slice(0, 240).replace(/\n/g, '\n  '));
  return ok;
}

async function run() {
  var queries = ['付航是谁', '今天有什么科技新闻', '付航的学历是什么'];
  var pass = 0, fail = 0;
  for (var i = 0; i < queries.length; i++) {
    var r = await testOne(queries[i]);
    if (r) pass++; else fail++;
  }
  console.log('\n=== Q2-18 结果：' + pass + ' PASS / ' + fail + ' FAIL ===');
  if (fail > 0) process.exit(1);
}

run().catch(function (e) { console.error('未捕获异常:', e); process.exit(1); });
