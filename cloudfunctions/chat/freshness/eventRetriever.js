// ============================================================
// Freshness Layer — eventRetriever.js
//   Phase Q / Q0 Policy 落地：事实获取（检索源抽象层）。
//
//   政策依据：docs/PhaseQ0-Freshness-Policy.md §1 / §6
//   设计要点：
//     · Provider 抽象：生产当前无已选型搜索源，默认 provider=none，
//       一律诚实降级（Q0：没有可靠事实不得编造）。
//     · 真实合规检索源的选型与接入属 Phase Q2（灰度阶段）事项。
//     · Node 16.13 兼容：自带 nodeFetch（与 rag.js 同款模式，
//       冻结文件不可 import 内部函数，故在此独立实现，不修改 rag.js）。
//     · 环境变量：
//         FRESHNESS_SEARCH_PROVIDER = none | http   （默认 none）
//         FRESHNESS_SEARCH_URL      http provider 的 POST 端点
//         FRESHNESS_SEARCH_KEY      可选 Bearer Key
//         FRESHNESS_SEARCH_TIMEOUT  可选毫秒，默认 8000
// ============================================================
'use strict';

var https = require('https');
var http = require('http');
var URL = require('url').URL;

// Node 16 兼容 fetch（仅覆盖本项目 POST+JSON / GET 场景；与 rag.js 内部实现同模式）
function nodeFetch(urlStr, options) {
  return new Promise(function (resolve, reject) {
    var parsed;
    try {
      parsed = new URL(urlStr);
    } catch (e) {
      return reject(e);
    }
    var lib = parsed.protocol === 'http:' ? http : https;
    var body = options && options.body ? Buffer.from(options.body) : Buffer.alloc(0);
    var headers = Object.assign({}, (options && options.headers) || {});
    headers['Content-Length'] = body.length;
    var req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: (options && options.method) || 'GET',
        headers: headers,
        timeout: (options && options.timeout) || 8000,
      },
      function (res) {
        var chunks = [];
        res.on('data', function (c) { chunks.push(c); });
        res.on('end', function () {
          var text = Buffer.concat(chunks).toString('utf-8');
          var json = {};
          try { json = text ? JSON.parse(text) : {}; } catch (e) { json = {}; }
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            text: function () { return Promise.resolve(text); },
            json: function () { return Promise.resolve(json); },
          });
        });
      }
    );
    req.on('timeout', function () { req.destroy(new Error('timeout')); });
    req.on('error', function (e) { reject(e); });
    if (body.length) req.write(body);
    req.end();
  });
}

function getProviderName() {
  var p = (process.env.FRESHNESS_SEARCH_PROVIDER || 'none').toLowerCase();
  return p === 'http' ? 'http' : 'none';
}

// 标准化检索结果条目：{ title, snippet, url, source, publishedAt }
function normalizeResult(raw) {
  if (!raw || typeof raw !== 'object') return null;
  var snippet = (raw.snippet || raw.summary || raw.content || '').toString().trim();
  if (!snippet) return null;
  return {
    title: (raw.title || '').toString().slice(0, 120),
    snippet: snippet.slice(0, 500),
    url: (raw.url || raw.link || '').toString(),
    source: (raw.source || raw.site || '').toString().slice(0, 60),
    publishedAt: (raw.publishedAt || raw.time || raw.date || '').toString(),
  };
}

// ============================================================
// retrieveEventFacts(eventMention, opts)
//   返回 { ok, provider, results, error, reason }
//     ok=false 时上层必须走降级（Q0 §6），禁止用模型记忆虚构事实。
// ============================================================
async function retrieveEventFacts(eventMention, opts) {
  opts = opts || {};
  var provider = getProviderName();
  var mention = (eventMention || '').toString().trim();

  if (!mention) {
    return { ok: false, provider: provider, results: [], error: '', reason: 'empty_event_mention' };
  }

  // 默认：未配置检索源 → 诚实降级（这是当前生产的预期行为）
  if (provider === 'none') {
    return { ok: false, provider: provider, results: [], error: '', reason: 'no_provider' };
  }

  var url = (process.env.FRESHNESS_SEARCH_URL || '').trim();
  if (!url) {
    return { ok: false, provider: provider, results: [], error: '', reason: 'no_provider_url' };
  }

  var timeout = parseInt(process.env.FRESHNESS_SEARCH_TIMEOUT || '8000', 10) || 8000;
  var headers = { 'Content-Type': 'application/json' };
  var key = (process.env.FRESHNESS_SEARCH_KEY || '').trim();
  if (key) headers['Authorization'] = 'Bearer ' + key;

  try {
    var res = await nodeFetch(url, {
      method: 'POST',
      timeout: timeout,
      headers: headers,
      body: JSON.stringify({ query: mention, limit: 5 }),
    });
    if (!res.ok) {
      return { ok: false, provider: provider, results: [], error: 'HTTP_' + res.status, reason: 'provider_http_error' };
    }
    var data = await res.json();
    var rawList = (data && (data.results || data.items || data.data)) || [];
    var results = [];
    for (var i = 0; i < rawList.length && results.length < 5; i++) {
      var n = normalizeResult(rawList[i]);
      if (n) results.push(n);
    }
    if (!results.length) {
      return { ok: false, provider: provider, results: [], error: '', reason: 'no_results' };
    }
    return { ok: true, provider: provider, results: results, error: '', reason: '' };
  } catch (e) {
    var msg = e && e.message ? e.message : '' + e;
    return { ok: false, provider: provider, results: [], error: msg, reason: 'provider_exception' };
  }
}

module.exports = {
  retrieveEventFacts: retrieveEventFacts,
  getProviderName: getProviderName,
  nodeFetch: nodeFetch, // 导出供 responder 复用（避免第三份实现）
};
