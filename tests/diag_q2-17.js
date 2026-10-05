// ============================================================
// Q2-17 诊断：直接调百炼 API 看"付航是谁"的实际返回
//   验证假设：1) 超时 2) 返回内容被过滤 3) API 错误
// ============================================================
'use strict';
var https = require('https');
var http = require('http');
var url = require('url');

// Node16 兼容 fetch（复用 rag.js 的 nodeFetch）
function nodeFetch(u, opts) {
  opts = opts || {};
  return new Promise(function (resolve, reject) {
    var parsed = url.parse(u);
    var mod = parsed.protocol === 'https:' ? https : http;
    var reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + (parsed.search || ''),
      method: (opts.method || 'GET').toUpperCase(),
      headers: opts.headers || {},
      timeout: opts.timeout || 15000,
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

var BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
var API_KEY = 'sk-YOUR_API_KEY_HERE';
var MODEL = 'deepseek-v4-flash-0731';

async function test() {
  console.log('=== Q2-17 百炼 API 直接诊断 ===');
  console.log('端点:', BASE_URL);
  console.log('模型:', MODEL);
  console.log('');

  var body = {
    model: MODEL,
    messages: [{ role: 'user', content: '付航是谁' }],
    enable_search: true,
    stream: false
  };

  var headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'Authorization': 'Bearer ' + API_KEY
  };

  var t0 = Date.now();
  try {
    var res = await nodeFetch(BASE_URL, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body),
      timeout: 15000 // 15秒足够
    });
    var elapsed = Date.now() - t0;
    console.log('HTTP Status:', res.status);
    console.log('耗时:', elapsed + 'ms');
    console.log('');

    var data = await res.json();
    
    // 1. 检查 search_results 数组
    var srPath = data.choices && data.choices[0] && data.choices[0].message 
      && data.choices[0].message.extended && data.choices[0].message.extended.search_info
      && data.choices[0].message.extended.search_info.search_results;
    console.log('=== search_results 数组 ===');
    console.log('存在:', !!srPath, Array.isArray(srPath) ? '长度=' + srPath.length : '');
    if (Array.isArray(srPath)) {
      srPath.forEach(function (r, i) { console.log('  [' + i + ']', JSON.stringify(r).slice(0, 200)); });
    }
    console.log('');

    // 2. 检查 message.content（综合文字）
    var content = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    console.log('=== message.content（综合文字） ===');
    console.log('长度:', (content || '').length);
    console.log('内容前500字:');
    console.log((content || '').slice(0, 500));
    console.log('');

    // 3. pickSynthesizedContent 过滤检测
    var filtered = false;
    var c = (content || '').toString().trim();
    if (c) {
      if (/^(抱歉|对不起|对不起，我|我(暂时)?(无法|不能|没有|不太清楚|没有可靠))/u.test(c) && c.length < 80) {
        filtered = true;
        console.log('⚠️ pickSynthesizedContent 会过滤此内容（拒答/空泛+短）');
      }
    }
    if (!filtered && c) {
      console.log('✅ pickSynthesizedContent 会通过（合成底座可用）');
    } else if (!c) {
      console.log('❌ content 为空 → 无合成底座');
    }

    // 4. 完整 extended 结构（前1000字）
    var ext = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.extended;
    console.log('');
    console.log('=== extended 字段（前1000字）===');
    console.log(JSON.stringify(ext, null, 2).slice(0, 1000));

  } catch (e) {
    console.log('❌ 异常:', e.message);
  }
}

test().then(function () { process.exit(0); }).catch(function (e) { console.error(e); process.exit(1); });
