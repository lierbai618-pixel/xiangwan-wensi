// ============================================================
// providers/search/tencentWsaSearch.js
//   Phase Q2-12：腾讯云联网搜索（WSA, Web Search API）Provider Adapter。
//
//   定位：作为「tencent」provider 槽位，是对腾讯 WSA 的专用适配
//        （区别于通用 GET 型 domesticApiSearch）。WSA 为 POST 型、
//        Bearer 鉴权、请求体 JSON、返回中含 Pages(JSON 字符串) 需二次解析。
//
//   设计原则（与既有真实 provider 一致）：
//     · 仅当 TENCENT_WSA_BASE_URL 配置时才联网；否则立即 ok:false（fail-soft）。
//     · 传输/HTTP 错误由 util.httpPostJson 抛出 → index.js 的 withRetry 重试；
//       此处仅处理「已成功返回但无可用结果」的确定性情形（返回 ok:false，不重试）。
//     · 结果经 util.normalizeResult 标准化。
//     · provider 名固定 'tencent' → data_route 恒定 'domestic'（零跨境，国内服务）。
//
//   配置（环境变量，调用时读取，支持测试注入与部署切换）：
//     TENCENT_WSA_BASE_URL     必须；WSA 接口地址（如 https://api.wsa.cloud.tencent.com/...）
//     TENCENT_WSA_API_KEY      必须；鉴权 Bearer Token
//     TENCENT_WSA_QUERY_FIELD  请求体中的查询字段名（默认 'query'）
//     TENCENT_WSA_EXTRA_BODY   附加固定 body 字段（JSON 字符串，可选）
//     TENCENT_WSA_PAGES_FIELD  响应中承载检索结果的字段（默认 'Pages'，支持 dot-path）
//     TENCENT_WSA_FIELD_TITLE  结果项标题字段（默认 'title'）
//     TENCENT_WSA_FIELD_URL    结果项链接字段（默认 'url'）
//     TENCENT_WSA_FIELD_SNIPPET 结果项摘要字段（默认 'content'，缺失回退 summary/description）
//     TENCENT_WSA_FIELD_SOURCE 结果项来源字段（默认 'source'）
//
//   ⚠️ 数据出境边界（合规核心）：data_route=domestic 的正确性依赖所接入 API 为
//     国内合规服务（服务器与数据均留境）。适配层不做跨境源，仅对接用户配置的国内端点。
// ============================================================
'use strict';

var util = require('./util');

// ---- 配置读取（调用时读取，保证部署切换即时生效）----
function cfg(name, def) {
  var v = process.env[name];
  return (v === undefined || v === null) ? def : v;
}

// ---- dot-path 解析（Node16 兼容，无可选链）----
function resolvePath(obj, p) {
  if (!p || !obj) return undefined;
  var parts = ('' + p).split('.');
  var cur = obj;
  for (var i = 0; i < parts.length; i++) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[parts[i]];
  }
  return cur;
}

// ---- Pages JSON 字符串 → 数组（二次解析）----
//   WSA 返回体中 Pages 字段为 JSON 字符串，需 JSON.parse 再取数组；
//   同时兼容已为数组的情形（部分网关/代理可能已展开）。
function toPageArray(v) {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    var s = v.trim();
    if (!s) return [];
    try {
      var parsed = JSON.parse(s);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }
  return [];
}

// ---- 结果数组提取：优先自定义路径，其次常见 WSA 形状 ----
function pickPages(data) {
  if (!data || typeof data !== 'object') return [];
  // 1) 用户显式配置字段（支持 dot-path）
  var custom = (cfg('TENCENT_WSA_PAGES_FIELD', 'Pages') || 'Pages').trim();
  var v = resolvePath(data, custom);
  var arr = toPageArray(v);
  if (arr.length) return arr;
  // 2) 常见 WSA 形状兜底探测（避免硬编单一 API 细节，降低编造风险）
  var probes = ['Pages', 'SearchInfo.Pages', 'data.Pages', 'result.Pages', 'Response.Pages'];
  for (var i = 0; i < probes.length; i++) {
    arr = toPageArray(resolvePath(data, probes[i]));
    if (arr.length) return arr;
  }
  return [];
}

function search(query, opts, nodeFetch) {
  var baseUrl = (cfg('TENCENT_WSA_BASE_URL', '') || '').trim();
  if (!baseUrl) {
    // 未配置端点 → 不联网，确定性降级（与各 provider 无 key 行为一致）
    return Promise.resolve({ ok: false, provider: 'tencent', results: [], reason: 'no_endpoint' });
  }
  if (typeof nodeFetch !== 'function') {
    return Promise.resolve({ ok: false, provider: 'tencent', results: [], reason: 'no_fetch' });
  }

  var maxResults = util.toInt(cfg('SEARCH_MAX_RESULTS', '5'), 5);
  var apiKey = (cfg('TENCENT_WSA_API_KEY', '') || '').trim();
  var queryField = (cfg('TENCENT_WSA_QUERY_FIELD', 'query') || 'query').trim();
  var extraBody = (cfg('TENCENT_WSA_EXTRA_BODY', '') || '').trim();

  // ---- 构造 JSON body ----
  var body = {};
  body[queryField] = query;
  if (extraBody) {
    try {
      var extra = JSON.parse(extraBody);
      if (extra && typeof extra === 'object') {
        for (var ek in extra) {
          if (Object.prototype.hasOwnProperty.call(extra, ek)) body[ek] = extra[ek];
        }
      }
    } catch (e) {
      // 错误配置忽略，绝不影响主流程
    }
  }

  // ---- 鉴权头：Bearer ----
  var headers = {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };
  if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;

  // 传输/HTTP 错误抛出 → index.js withRetry 重试；超时由 search() 外层 withTimeout 施加。
  return util.httpPostJson(nodeFetch, baseUrl, body, headers, 8000).then(function (data) {
    var raw = pickPages(data);
    var results = [];
    for (var i = 0; i < raw.length && results.length < maxResults; i++) {
      var item = raw[i];
      if (!item || typeof item !== 'object') continue;
      var fTitle = (cfg('TENCENT_WSA_FIELD_TITLE', 'title') || 'title').trim();
      var fUrl = (cfg('TENCENT_WSA_FIELD_URL', 'url') || 'url').trim();
      var fSnippet = (cfg('TENCENT_WSA_FIELD_SNIPPET', 'content') || 'content').trim();
      var fSource = (cfg('TENCENT_WSA_FIELD_SOURCE', 'source') || 'source').trim();
      var normalized = util.normalizeResult({
        title: item[fTitle],
        url: item[fUrl],
        content: item[fSnippet] || item.summary || item.description || item.content,
        source: item[fSource]
      });
      if (normalized) results.push(normalized);
    }
    if (!results.length) {
      return { ok: false, provider: 'tencent', results: [], reason: 'no_results' };
    }
    return { ok: true, provider: 'tencent', results: results, reason: '' };
  });
}

module.exports = { search: search };
