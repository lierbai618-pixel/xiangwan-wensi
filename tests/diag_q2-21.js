// ============================================================
// Q2-21 诊断：回答完整性——对比百炼原始返回 vs 最终交付
//   1. 百炼 message.content 原始长度
//   2. synthesized_text 经过 contextBuilder 后的长度
//   3. 快速通道最终 answer 长度
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
var qwenSearch = require('../cloudfunctions/chat/providers/search/qwenSearch');

var https = require('https');
var http = require('http');
var urlP = require('url');
function nodeFetch(u, opts) {
  opts = opts || {};
  return new Promise(function (resolve, reject) {
    var parsed = urlP.parse(u);
    var mod = parsed.protocol === 'https:' ? https : http;
    var reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + (parsed.search || ''),
      method: (opts.method || 'GET').toUpperCase(),
      headers: opts.headers || {},
      timeout: opts.timeout || 20000,
    };
    var req = mod.request(reqOpts, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var buf = Buffer.concat(chunks);
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          json: function () { return JSON.parse(buf.toString()); },
          text: function () { return buf.toString(); },
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', function () { req.destroy(); reject(new Error('timeout')); });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

var MODELS = [{
  name: 'deepseek-v4-flash-0731',
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: 'sk-YOUR_API_KEY_HERE',
  model: 'deepseek-v4-flash-0731',
  timeout: 25000
}];

async function run() {
  var queries = ['脱口秀演员房主任', '付航是谁'];
  
  for (var i = 0; i < queries.length; i++) {
    var q = queries[i];
    console.log('\n========================================');
    console.log('问法: "' + q + '"');
    
    // A. 直接调百炼看原始返回
    console.log('\n--- A. 百炼 API 原始返回 ---');
    var t0 = Date.now();
    var direct = await qwenSearch.search(q, {}, nodeFetch);
    console.log('耗时:', Date.now() - t0, 'ms');
    console.log('ok:', direct.ok, '| reason:', direct.reason, '| synthesized:', !!direct.synthesized);
    if (direct.results && direct.results[0]) {
      var rawSnippet = direct.results[0].snippet || '';
      console.log('原始 snippet 长度:', rawSnippet.length, '字');
      console.log('原始内容:');
      console.log(rawSnippet.slice(0, 800));
      if (rawSnippet.length > 800) console.log('... [截断显示, 实际', rawSnippet.length, '字]');
    }
    
    // B. 全链路看最终交付
    console.log('\n--- B. maybeHandle 全链路 ---');
    t0 = Date.now();
    var res = await maybeHandle(q, {
      models: MODELS,
      openid: 'YOUR_ADMIN_OPENID',
      answerMode: 'think',
      history: []
    });
    console.log('耗时:', Date.now() - t0, 'ms');
    
    if (!res) { console.log('❌ null'); continue; }
    
    var ans = res.answer || '';
    console.log('最终 answer 长度:', ans.length, '字');
    console.log('direct_factual:', !!(res.freshness && res.freshness.direct_factual));
    console.log('downgraded:', !!(res.freshness && res.freshness.downgraded));
    
    console.log('\n--- 最终完整回答 ---');
    console.log(ans);
    console.log('--- [回答结束, 共', ans.length, '字] ---');
  }
}

run().catch(function(e) { console.error('异常:', e); process.exit(1); });
