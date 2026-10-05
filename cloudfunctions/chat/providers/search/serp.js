// ============================================================
// providers/search/serp.js
//   Phase Q2-1：SerpAPI（Google 结果）源骨架（候选，未启用）。
//   原则：无 API Key → 立即 ok:false（fail-soft）。
//   真实激活条件：SEARCH_PROVIDER=serp 且 FRESHNESS_FACTUAL_ENABLED=true
//   且配置 SERPAPI_KEY。
// ============================================================
'use strict';

var util = require('./util');

function search(query, opts, nodeFetch) {
  var key = (process.env.SERPAPI_KEY || '').trim();
  if (!key) {
    return Promise.resolve({ ok: false, provider: 'serp', results: [], reason: 'no_api_key' });
  }
  var endpoint = (process.env.SERPAPI_URL || 'https://serpapi.com/search.json').trim();
  var url = endpoint + '?engine=google&q=' + encodeURIComponent(query) + '&num=5&api_key=' + encodeURIComponent(key);

  return util.httpGetJson(nodeFetch, url, {}, 8000).then(function (data) {
    var raw = (data && data.organic_results) || [];
    var results = [];
    for (var i = 0; i < raw.length && results.length < 5; i++) {
      var n = util.normalizeResult(raw[i]);
      if (n) results.push(n);
    }
    if (!results.length) {
      return { ok: false, provider: 'serp', results: [], reason: 'no_results' };
    }
    return { ok: true, provider: 'serp', results: results, reason: '' };
  });
}

module.exports = { search: search };
