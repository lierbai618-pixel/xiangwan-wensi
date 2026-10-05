// ============================================================
// Q2-19 Direct Factual 快速通道验证
//   对比：person-identity(快速通道) vs 新闻(五段式) 的耗时和质量
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

var passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; console.log('  ❌ ' + name); }
}

async function testOne(query, expectDirect) {
  console.log('\n========================================');
  console.log('问法: ' + query + (expectDirect ? ' [期望快速通道]' : ' [期望五段式]'));
  var t0 = Date.now();
  var res = await maybeHandle(query, {
    models: MODELS,
    openid: 'YOUR_ADMIN_OPENID',
    answerMode: 'think',
    history: []
  });
  var elapsed = Date.now() - t0;
  console.log('耗时: ' + elapsed + 'ms');

  if (!res) {
    console.log('  ❌ 返回 null');
    return false;
  }

  var isDirect = !!(res.freshness && res.freshness.direct_factual);
  console.log('  mode: ' + res.mode);
  console.log('  downgraded: ' + !!(res.freshness && res.freshness.downgraded));
  console.log('  direct_factual: ' + isDirect);
  console.log('  category: ' + (res.freshness && res.freshness.category));
  console.log('  provider: ' + (res.freshness && res.freshness.search_provider));

  var allOk = true;

  if (res.freshness && res.freshness.downgraded) {
    allOk = false; console.log('  ❌ 降级: ' + (res.freshness.downgrade_reason || ''));
  }

  if (expectDirect) {
    ok('走快速通道', isDirect === true);
    if (!isDirect) { allOk = false; }
  } else {
    ok('走五段式链路', isDirect !== true);
  }

  // 不再是降级模板
  ok('无降级模板文案', (res.answer || '').indexOf('没有可靠的信息来源') < 0 &&
    (res.answer || '').indexOf('我不掌握') < 0);

  // 有实际内容
  ok('有实质性回答', (res.answer || '').length > 50);

  // 含免责声明
  ok('含联网免责声明', /未经(独立)?核实|网络综合|仅供参考/u.test(res.answer || ''));

  // 如果是人物查询，回答应直接给信息而非五段式哲学模板
  //   ⚠️ 百炼合成底座对极模糊查询可能以解释性文字开头，这不算哲学模板
  if (expectDirect) {
    var ans = res.answer || '';
    var isWuduan = /^【理解】\s*$/m.test(ans);  // 五段式模板特有标记
    ok('非五段式哲学模板', !isWuduan);
    if (isWuduan) { allOk = false; }
  }

  console.log('  --- 回答前 300 字 ---');
  console.log('  ' + (res.answer || '').slice(0, 300).replace(/\n/g, '\n  '));
  return allOk;
}

async function run() {
  console.log('=== Q2-19 Direct Factual 快速通道验证 ===\n');

  var r1 = await testOne('付航是谁', true);           // person-identity → 快速通道
  var r2 = await testOne('房主是谁', true);            // person-identity → 快速通道
  var r3 = await testOne('马斯克是什么人', true);      // person-identity → 快速通道
  var r4 = await testOne('今天有什么科技新闻', false); // 新闻 → 五段式

  var pass = (r1?1:0)+(r2?1:0)+(r3?1:0)+(r4?1:0);
  var fail = 4 - pass;

  console.log('\n=== Q2-19 结果：' + pass + ' PASS / ' + fail + ' FAIL ===');
  if (fail > 0) process.exit(1);
}

run().catch(function(e) { console.error('未捕获异常:', e); process.exit(1); });
