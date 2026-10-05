// ============================================================
// Q2-17 端到端验证：SEARCH_TIMEOUT_MS=15000 下完整链路
//   关键：必须先设 env 再 require（否则 _config 锁默认值）
// ============================================================
'use strict';

// ---- 先设环境变量（必须在 require 之前）----
process.env.SEARCH_PROVIDER = 'qwen';
process.env.SEARCH_TIMEOUT_MS = '15000';
process.env.QWEN_SEARCH_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
process.env.QWEN_SEARCH_API_KEY = 'sk-YOUR_API_KEY_HERE';
process.env.QWEN_SEARCH_MODEL = 'deepseek-v4-flash-0731';
process.env.QWEN_SEARCH_SYNTH_MODE = 'true';
process.env.FRESHNESS_FACTUAL_ENABLED = 'true';
process.env.SEARCH_CANARY_ENABLED = 'true';
process.env.SEARCH_CANARY_OPENIDS = 'YOUR_ADMIN_OPENID';
process.env.PRIVACY_GATE_ENABLED = 'true';

// ---- 再 require 模块（此时 env 已就位）----
var searchLayer = require('../cloudfunctions/chat/providers/search');
var qwenSearch = require('../cloudfunctions/chat/providers/search/qwenSearch');

// Node16 兼容 fetch
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

// 重置缓存/配额（干净状态）
searchLayer._resetCache();
searchLayer._resetDaily();

var passed = 0, failed = 0;
function ok(name, cond) {
  if (cond) { passed++; console.log('  ✅ ' + name); }
  else { failed++; console.log('  ❌ ' + name); }
}

async function runTests() {
  console.log('=== Q2-17 端到端验证：15秒超时下搜索链路 ===\n');
  console.log('  config.timeoutMs:', searchLayer._getConfig().timeoutMs);
  console.log('');

  // ---- 单元 1：qwenSearch 直接调用 ----
  console.log('【单元1】qwenSearch 直接调百炼 API');
  var t0 = Date.now();
  var directResult = await qwenSearch.search('付航是谁', {}, nodeFetch);
  var elapsed = Date.now() - t0;
  console.log('  耗时:', elapsed + 'ms');
  console.log('  ok:', directResult.ok, 'reason:', directResult.reason, 'synthesized:', !!directResult.synthesized);

  ok('qwenSearch 返回 ok=true', directResult.ok === true);
  ok('reason=synth_content', directResult.reason === 'synth_content');
  ok('synthesized=true', directResult.synthesized === true);
  ok('results 长度>0', directResult.results && directResult.results.length > 0);
  if (directResult.results && directResult.results[0]) {
    // normalizeResult 把 content 映射为 snippet
    var item = directResult.results[0];
    ok('结果有 snippet（content映射）', !!item.snippet);
    ok('结果 synthesized 标记', item.synthesized === true);
    ok('snippet 包含"付航"', (item.snippet || '').indexOf('付航') >= 0);
    ok('snippet 包含"大专"', (item.snippet || '').indexOf('大专') >= 0);
    console.log('  snippet 前200字:', (item.snippet || '').slice(0, 200));
  }
  ok('耗时<15秒（新超时内）', elapsed < 15000);
  console.log('');

  // ---- 单元 2：searchLayer 完整链路 ----
  console.log('【单元2】searchLayer 完整链路（privacyGate→canaryGate→qwen→withTimeout=15s）');
  searchLayer._resetCache();

  t0 = Date.now();
  var layerResult = await searchLayer.search('付航是谁', {
    openid: 'YOUR_ADMIN_OPENID'
  });
  elapsed = Date.now() - t0;
  console.log('  耗时:', elapsed + 'ms');
  console.log('  ok:', layerResult.ok, 'reason:', layerResult.reason, 'provider:', layerResult.provider);

  ok('searchLayer 返回 ok=true', layerResult.ok === true);
  ok('provider=qwen', layerResult.provider === 'qwen');
  ok('results 长度>0', layerResult.results && layerResult.results.length > 0);
  if (layerResult.results && layerResult.results[0]) {
    ok('结果有 snippet', !!layerResult.results[0].snippet);
    ok('snippet 包含"付航"', (layerResult.results[0].snippet || '').indexOf('付航') >= 0);
    console.log('  snippet 前150字:', (layerResult.results[0].snippet || '').slice(0, 150));
  }
  ok('audit 存在', !!layerResult.audit);
  ok('data_route=domestic', layerResult.audit && layerResult.audit.data_route === 'domestic');
  ok('耗时<25秒（含重试余量）', elapsed < 25000);
  console.log('');

  // ---- 单元 3：回归——3秒超时应 timeout ----
  console.log('【单元3】回归验证：3秒超时应 timeout（证明根因）');
  searchLayer._setConfig({ timeoutMs: 3000 });
  searchLayer._resetCache();

  t0 = Date.now();
  var fastResult;
  try {
    fastResult = await searchLayer.search('付航是谁', {
      openid: 'YOUR_ADMIN_OPENID'
    });
  } catch (e) {
    fastResult = { ok: false, reason: 'exception', error: e.message };
  }
  elapsed = Date.now() - t0;
  console.log('  耗时:', elapsed + 'ms');
  console.log('  ok:', fastResult.ok, 'reason:', fastResult.reason);

  ok('3秒超时 → ok=false', fastResult.ok !== true);
  ok('reason 含 timeout', (fastResult.reason || '').indexOf('timeout') >= 0);
  
  // 恢复
  searchLayer._setConfig({ timeoutMs: 15000 });

  console.log('');
  console.log('=== 结果：' + passed + ' PASS / ' + failed + ' FAIL ===');
  if (failed > 0) process.exit(1);
}

runTests().catch(function (e) { console.error('未捕获异常:', e); process.exit(1); });
