// ============================================================
// providers/search/bing.js
//   Phase Q2-1：Azure Bing Web Search 源骨架（候选，未启用）。
//   原则：无 API Key → 立即 ok:false（绝不抛异常，fail-soft）。
//   真实激活条件（由上层 searchLayer 控制）：SEARCH_PROVIDER=bing
//   且 FRESHNESS_FACTUAL_ENABLED=true 且配置 BING_SEARCH_KEY。
//   本文件不读取 FRESHNESS_FACTUAL_ENABLED —— 仅作为 provider 实现被调用。
// ============================================================
'use strict';

var util = require('./util');

function search(query, opts, nodeFetch) {
  var key = (process.env.BING_SEARCH_KEY || '').trim();
  if (!key) {
    return Promise.resolve({ ok: false, provider: 'bing', results: [], reason: 'no_api_key' });
  }
  var endpoint = (process.env.BING_SEARCH_URL || 'https://api.bing.microsoft.com/v7.0/search').trim();
  var url = endpoint + '?q=' + encodeURIComponent(query) + '&count=5&mkt=zh-CN';
  var headers = { 'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': key };

  return util.httpGetJson(nodeFetch, url, headers, 8000).then(function (data) {
    var raw = (data && data.webPages && data.webPages.value) || [];
    var results = [];
    for (var i = 0; i < raw.length && results.length < 5; i++) {
      var n = util.normalizeResult(raw[i]);
      if (n) results.push(n);
    }
    if (!results.length) {
      return { ok: false, provider: 'bing', results: [], reason: 'no_results' };
    }
    return { ok: true, provider: 'bing', results: results, reason: '' };
  });
}

module.exports = { search: search };
