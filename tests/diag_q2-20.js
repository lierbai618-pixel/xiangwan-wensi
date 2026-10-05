// ============================================================
// Q2-20 诊断：「脱口秀演员房主任」为什么走五段式而非快速通道
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

var classifier = require('../cloudfunctions/chat/freshness/eventClassifier');
var CATEGORY = require('../cloudfunctions/chat/freshness/schema').CATEGORY;
var freshness = require('../cloudfunctions/chat/freshness');
var maybeHandle = freshness.maybeHandle;

var MODELS = [{
  name: 'deepseek-v4-flash-0731',
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: 'sk-YOUR_API_KEY_HERE',
  model: 'deepseek-v4-flash-0731',
  timeout: 25000
}];

async function run() {
  // 测试多种问法
  var queries = [
    '脱口秀演员房主任',
    '房主任是谁',
    '房绍莉是谁',
    '房主任 本名',
    '介绍一下房主任',
  ];

  for (var i = 0; i < queries.length; i++) {
    var q = queries[i];
    console.log('\n========================================');
    console.log('问法: "' + q + '"');

    // Step 1: 分类器
    var cls = classifier.classifyCategory(q, null);
    console.log('[分类] category=' + cls.category + ' | reason=' + cls.reason +
      ' | directFactual=' + !!cls.directFactual +
      ' | signals=' + JSON.stringify(cls.signals));

    // Step 2: 全链路
    var t0 = Date.now();
    var res = await maybeHandle(q, {
      models: MODELS,
      openid: 'YOUR_ADMIN_OPENID',
      answerMode: 'think',
      history: []
    });
    var elapsed = Date.now() - t0;
    console.log('[全链路] 耗时=' + elapsed + 'ms');

    if (!res) {
      console.log('  ❌ 返回 null（未接管，走原RAG）');
      continue;
    }

    console.log('  mode=' + res.mode);
    if (res.freshness) {
      console.log('  downgraded=' + res.freshness.downgraded);
      console.log('  downgrade_reason=' + (res.freshness.downgrade_reason || '-'));
      console.log('  category=' + (res.freshness.category || '-'));
      console.log('  provider=' + (res.freshness.search_provider || '-'));
      console.log('  direct_factual=' + !!(res.freshness.direct_factical));
      console.log('  guardViolations=' + JSON.stringify(res.freshness.guardViolations || []));
    }
    console.log('  --- 回答前300字 ---');
    console.log('  ' + (res.answer || '(无)').slice(0, 300).replace(/\n/g, '\n  '));
  }
}

run().catch(function(e) { console.error('异常:', e); process.exit(1); });
