// ============================================================
// Q2-21 验证：max_tokens=2000 后回答完整性
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

async function testOne(query) {
  console.log('\n========================================');
  console.log('问法: "' + query + '"');
  var t0 = Date.now();
  var res = await maybeHandle(query, {
    models: MODELS,
    openid: 'YOUR_ADMIN_OPENID',
    answerMode: 'think',
    history: []
  });
  var elapsed = Date.now() - t0;
  
  if (!res) { console.log('❌ null'); return false; }
  
  var ans = res.answer || '';
  console.log('耗时:', elapsed, 'ms');
  console.log('长度:', ans.length, '字');
  console.log('direct_factual:', !!(res.freshness && res.freshness.direct_factual));
  console.log('downgraded:', !!(res.freshness && res.freshness.downgraded));
  
  // 检查完整性
  var complete = true;
  if (ans.length < 400) { console.log('⚠️ 偏短(<400字)'); complete = false; }
  else if (ans.length < 800) { console.log('⚠️ 中等长度(400-800)'); }
  else { console.log('✅ 长度充足(>800字)'); }
  
  // 检查是否截断（最后一个完整句子之后是否紧跟免责声明）
  var hasDisclaimer = /（以上为网络综合内容/u.test(ans);
  if (!hasDisclaimer) { console.log('⚠️ 缺免责声明'); complete = false; }
  
  // 检查关键信息点（房主任）
  if (query.indexOf('房') >= 0) {
    var points = ['房绍莉', '临沂', '初中', '脱口秀', '停演', '争议'];
    var found = points.filter(function(p) { return ans.indexOf(p) >= 0; });
    console.log('关键信息点:', found.length + '/' + points.length, found.join(', '));
    if (found.length < 4) complete = false;
  }
  
  // 付航
  if (query.indexOf('付航') >= 0) {
    var points2 = ['1994', '大专', '脱口秀', 'Passion', '喜剧之王'];
    // 修复：模型常输出小写 passion，原 indexOf 大小写敏感会误判缺失 → 统一小写比对
    var ansLower = ans.toLowerCase();
    var found2 = points2.filter(function(p) { return ansLower.indexOf(p.toLowerCase()) >= 0; });
    console.log('关键信息点:', found2.length + '/' + points2.length, found2.join(', '));
    if (found2.length < 4) complete = false;
  }
  
  console.log('\n--- 完整回答 ---');
  console.log(ans);
  console.log('\n--- [结束, 共' + ans.length + '字] ---');
  return complete && !res.freshness.downgraded;
}

async function run() {
  console.log('=== Q2-21 回答完整性验证（max_tokens=2000）===\n');
  var r1 = await testOne('脱口秀演员房主任');
  var r2 = await testOne('付航是谁');
  var pass = (r1?1:0)+(r2?1:0);
  console.log('\n=== Q2-21 结果：' + pass + '/2 PASS ===');
  if (pass < 2) process.exit(1);
}
run().catch(function(e) { console.error(e); process.exit(1); });
