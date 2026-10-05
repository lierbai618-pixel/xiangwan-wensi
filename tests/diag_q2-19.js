// ============================================================
// Q2-19 快速诊断：「房主是谁」到底卡在哪一步
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
  var query = '房主是谁';
  console.log('=== Q2-19 诊断：「' + query + '」 ===\n');

  // Step 1: 分类器
  console.log('【Step 1】分类器');
  var cls = classifier.classifyCategory(query, null);
  console.log('  category:', cls.category, '| reason:', cls.reason, '| signals:', JSON.stringify(cls.signals));
  console.log('');

  // Step 2: 全链路
  console.log('【Step 2】maybeHandle 全链路');
  var t0 = Date.now();
  var res = await maybeHandle(query, {
    models: MODELS,
    openid: 'YOUR_ADMIN_OPENID',
    answerMode: 'think',
    history: []
  });
  var elapsed = Date.now() - t0;
  console.log('  耗时:', elapsed + 'ms');

  if (!res) {
    console.log('  ❌ 返回 null（未接管）');
    return;
  }

  console.log('  mode:', res.mode);
  if (res.freshness) {
    console.log('  downgraded:', res.freshness.downgraded);
    console.log('  downgrade_reason:', res.freshness.downgrade_reason);
    console.log('  category:', res.freshness.category);
    console.log('  search_provider:', res.freshness.search_provider);
    console.log('  source_confidence:', res.freshness.source_confidence);
    console.log('  guardViolations:', JSON.stringify(res.freshness.guardViolations || []));
  }
  console.log('');
  console.log('--- 回答前 400 字 ---');
  console.log((res.answer || '(无回答)').slice(0, 400));
}

run().catch(function(e) { console.error('异常:', e); process.exit(1); });
