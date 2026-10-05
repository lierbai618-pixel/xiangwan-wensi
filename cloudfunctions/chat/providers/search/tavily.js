// ============================================================
// providers/search/tavily.js
//   Phase Q2-4-A：Tavily Search 真实检索源（参考实现，生产可用）。
//
//   定位：LLM 优化摘要，最契合「事实 + 引用」场景（Phase-Q2-Search-Policy §2）。
//   激活条件（三层闸，由上层控制）：SEARCH_PROVIDER=tavily
//     + FRESHNESS_FACTUAL_ENABLED=true + 配置 TAVILY_API_KEY。
//
//   机制：
//     · 无 key → 立即 ok:false（fail-soft，绝不抛异常）。
//     · include_domains / exclude_domains 在 API 侧预过滤（省配额、降噪）。
//     · 超时/重试由 index.js 统一包装（withTimeout + withRetry）。
//     · 结果经 util.normalizeResult 标准化（剥离追踪参数、补全 source）。
// ============================================================
'use strict';

var util = require('./util');

function search(query, opts, nodeFetch) {
  var key = (process.env.TAVILY_API_KEY || '').trim();
  if (!key) {
    return Promise.resolve({ ok: false, provider: 'tavily', results: [], reason: 'no_api_key' });
  }
  if (typeof nodeFetch !== 'function') {
    return Promise.resolve({ ok: false, provider: 'tavily', results: [], reason: 'no_fetch' });
  }

  var endpoint = (process.env.TAVILY_SEARCH_URL || 'https://api.tavily.com/search').trim();
  var maxResults = util.toInt(process.env.SEARCH_MAX_RESULTS, 5);
  var includeDomains = util.parseList(process.env.SEARCH_ALLOWED_DOMAINS);
  var excludeDomains = util.parseList(process.env.SEARCH_BLOCKED_DOMAINS);

  var body = {
    query: query,
    search_depth: 'advanced',
    max_results: maxResults,
    include_answer: false,
    include_raw_content: false,
    include_domains: includeDomains,
    exclude_domains: excludeDomains,
  };
  var headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + key };

  // 传输/HTTP 错误由 util.httpPostJson 抛出 → 由 index.js 的 withRetry 重试；
  // 此处仅处理「已成功返回但无可用结果」的确定性情形（返回 ok:false，不重试）。
  return util.httpPostJson(nodeFetch, endpoint, body, headers, 8000).then(function (data) {
    var raw = (data && data.results) || [];
    var results = [];
    for (var i = 0; i < raw.length && results.length < maxResults; i++) {
      var n = util.normalizeResult(raw[i]);
      if (n) results.push(n);
    }
    if (!results.length) {
      return { ok: false, provider: 'tavily', results: [], reason: 'no_results' };
    }
    return { ok: true, provider: 'tavily', results: results, reason: '' };
  });
}

module.exports = { search: search };
