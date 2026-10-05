// ============================================================
// Q2-20 验证：职业前缀+人名 分类 + 搜索消歧
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

async function testOne(query, expectB, expectDirect) {
  console.log('\n----------------------------------------');
  console.log('问法: "' + query + '"');
  var cls = classifier.classifyCategory(query, null);
  var catOk = cls.category === (expectB ? CATEGORY.B : (expectB === false ? CATEGORY.A : cls.category));
  var dirOk = (expectDirect === true) ? !!cls.directFactual : (expectDirect === false ? !cls.directFactual : true);
  console.log('[分类] ' + (catOk ? '✅' : '❌') + ' category=' + cls.category +
    ' | directFactal=' + !!cls.directFactual + ' | reason=' + cls.reason);

  var t0 = Date.now();
  var res = await maybeHandle(query, {
    models: MODELS,
    openid: 'YOUR_ADMIN_OPENID',
    answerMode: 'think',
    history: []
  });
  var elapsed = Date.now() - t0;
  console.log('[全链路] 耗时=' + elapsed + 'ms');

  if (!res) {
    console.log('  ❌ null（未接管）');
    return { cat: catOk, dir: dirOk, handle: false };
  }

  var downgraded = res.freshness && res.freshness.downgraded;
  var isDirect = res.freshness && res.freshness.direct_factual;
  console.log('  mode=' + res.mode + ' | downgraded=' + downgraded +
    ' | direct_factual=' + isDirect +
    ' | provider=' + (res.freshness && res.freshness.search_provider));

  // 检查回答是否包含关键信息
  var ans = res.answer || '';
  var hasContent = ans.length > 50;
  var hasDisclaimer = /未经(独立)?核实|网络综合|仅供参考/u.test(ans);
  var noDowngradeTemplate = ans.indexOf('没有可靠的信息来源') < 0 && ans.indexOf('我不掌握') < 0;

  console.log('  内容' + (hasContent ? '✅' : '❌') + ' (' + ans.length + '字)' +
    ' | 免责' + (hasDisclaimer ? '✅' : '⚠️') +
    ' | 非降级模板' + (noDowngradeTemplate ? '✅' : '❌'));

  if (ans.length > 0) {
    console.log('  --- 前300字 ---');
    console.log('  ' + ans.slice(0, 300).replace(/\n/g, '\n  '));
  }

  return {
    cat: catOk,
    dir: dirOk,
    handle: true,
    downgraded: downgraded,
    content: hasContent,
    disclaimer: hasDisclaimer,
    notemplate: noDowngradeTemplate
  };
}

async function run() {
  console.log('=== Q2-20 职业前缀+人名 分类 + 消歧验证 ===\n');

  var r;
  r = await testOne('脱口秀演员房主任', true, true);     // 新规则：职业前缀→B
  r = await testOne('房主任是谁', true, true);             // 已有规则
  r = await testOne('房绍莉是谁', true, true);             // 本名→正确消歧
  r = await testOne('介绍一下房主任', true, true);          // 介绍→B
  r = await testOne('演员赵丽颖', true, true);             // 职业+明星名
  r = await testOne('歌手周杰伦', true, true);              // 职业+明星名
  r = await testOne('什么是人生意义', false, false);        // 哲学→A（不受影响）

  console.log('\n=== 完成 ===');
}

run().catch(function(e) { console.error('异常:', e); process.exit(1); });
