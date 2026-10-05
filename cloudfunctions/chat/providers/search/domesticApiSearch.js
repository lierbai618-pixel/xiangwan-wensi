// ============================================================
// providers/search/domesticApiSearch.js
//   Phase Q2-10：provider-agnostic 国内搜索 API 适配层。
//
//   定位：替代废弃的 SearXNG 自托管方案（domesticFreeSearch.js），
//        作为「domestic」provider 槽位的通用国内搜索 API 适配器。
//        任何国内合规搜索/资讯 REST API 均可经环境变量接入，
//        无需改代码（零编造：字段映射由配置驱动）。
//
//   设计原则（与既有真实 provider 一致）：
//     · 仅当 DOMESTIC_API_BASE_URL 配置时才联网；否则立即 ok:false（fail-soft）。
//     · 传输/HTTP 错误由 util.httpGetJson 抛出 → index.js 的 withRetry 重试；
//       此处仅处理「已成功返回但无可用结果」的确定性情形（返回 ok:false，不重试）。
//     · 结果经 util.normalizeResult 标准化（剥离追踪参数、补全 source）。
//     · provider 名固定 'domestic' → data_route 恒定 'domestic'（零跨境，由国内 API 保证）。
//
//   配置（环境变量，调用时读取，支持测试注入与部署切换）：
//     DOMESTIC_API_BASE_URL     必须；API 根地址（可含 ?token= 等查询）
//     DOMESTIC_API_KEY          可选；鉴权密钥
//     DOMESTIC_API_AUTH         'bearer'(默认) | 'x-api-key' | 'query'
//     DOMESTIC_API_QUERY_PARAM  查询参数名（默认 'q'）
//     DOMESTIC_API_EXTRA_PARAMS 附加 URL 参数（如 'type=news&size=10'），原样追加
//     DOMESTIC_API_RESULT_PATH  响应 JSON 中结果数组的 dot-path（如 'newslist'/'data.list'）；
//                               省略时自动探测国内常见聚合 API 形状
//     DOMESTIC_API_FIELD_TITLE  结果项标题字段（默认 'title'）
//     DOMESTIC_API_FIELD_URL    结果项链接字段（默认 'url'）
//     DOMESTIC_API_FIELD_SNIPPET 结果项摘要字段（默认 'content'，缺失时回退 summary/description）
//     DOMESTIC_API_FIELD_SOURCE 结果项来源字段（可选，默认 'source'）
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

// ---- 结果数组提取：优先自定义路径，否则自动探测国内常见聚合 API 形状 ----
function pickResults(data) {
  var custom = (cfg('DOMESTIC_API_RESULT_PATH', '') || '').trim();
  if (custom) {
    var r = resolvePath(data, custom);
    return Array.isArray(r) ? r : [];
  }
  // 常见国内聚合 API（天行/聚合/自建等）响应形状
  var candidates = [
    data && data.results,
    data && data.newslist,
    data && data.result,
    data && data.data,
    data && data.list,
    data && data.Data,
    data && data.articles,
    data && data.result && data.result.list,
    data && data.data && data.data.list
  ];
  for (var i = 0; i < candidates.length; i++) {
    if (Array.isArray(candidates[i])) return candidates[i];
  }
  return [];
}

function search(query, opts, nodeFetch) {
  var baseUrl = (cfg('DOMESTIC_API_BASE_URL', '') || '').trim();
  if (!baseUrl) {
    // 未配置端点 → 不联网，确定性降级（与各 provider 无 key 行为一致）
    return Promise.resolve({ ok: false, provider: 'domestic', results: [], reason: 'no_endpoint' });
  }
  if (typeof nodeFetch !== 'function') {
    return Promise.resolve({ ok: false, provider: 'domestic', results: [], reason: 'no_fetch' });
  }

  var maxResults = util.toInt(cfg('SEARCH_MAX_RESULTS', '5'), 5);
  var key = (cfg('DOMESTIC_API_KEY', '') || '').trim();
  var authMode = (cfg('DOMESTIC_API_AUTH', 'bearer') || 'bearer').trim().toLowerCase();
  var queryParam = (cfg('DOMESTIC_API_QUERY_PARAM', 'q') || 'q').trim();
  var extraParams = (cfg('DOMESTIC_API_EXTRA_PARAMS', '') || '').trim();
  var fTitle = (cfg('DOMESTIC_API_FIELD_TITLE', 'title') || 'title').trim();
  var fUrl = (cfg('DOMESTIC_API_FIELD_URL', 'url') || 'url').trim();
  var fSnippet = (cfg('DOMESTIC_API_FIELD_SNIPPET', 'content') || 'content').trim();
  var fSource = (cfg('DOMESTIC_API_FIELD_SOURCE', 'source') || 'source').trim();

  // 构造 GET URL
  var base = baseUrl.replace(/\/+$/, '');
  var sep = (base.indexOf('?') >= 0) ? '&' : '?';
  var url = base + sep + encodeURIComponent(queryParam) + '=' + encodeURIComponent(query);
  if (extraParams) url += '&' + extraParams;
  if (authMode === 'query' && key) url += '&key=' + encodeURIComponent(key);

  // 鉴权头
  var headers = { 'Accept': 'application/json' };
  if (key && authMode === 'bearer') headers['Authorization'] = 'Bearer ' + key;
  else if (key && authMode === 'x-api-key') headers['X-Api-Key'] = key;

  // 传输/HTTP 错误抛出 → index.js withRetry 重试；超时由 search() 外层 withTimeout 施加。
  return util.httpGetJson(nodeFetch, url, headers, 8000).then(function (data) {
    var raw = pickResults(data);
    var results = [];
    for (var i = 0; i < raw.length && results.length < maxResults; i++) {
      var item = raw[i];
      if (!item || typeof item !== 'object') continue;
      var normalized = util.normalizeResult({
        title: item[fTitle],
        url: item[fUrl],
        content: item[fSnippet] || item.summary || item.description || item.content,
        source: item[fSource]
      });
      if (normalized) results.push(normalized);
    }
    if (!results.length) {
      return { ok: false, provider: 'domestic', results: [], reason: 'no_results' };
    }
    return { ok: true, provider: 'domestic', results: results, reason: '' };
  });
}

module.exports = { search: search };
