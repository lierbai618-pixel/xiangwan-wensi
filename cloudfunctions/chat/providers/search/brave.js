// ============================================================
// providers/search/brave.js
//   Phase Q2-25-B：Brave Search API 真实检索源（retrieval-only，免费层可用）。
//
//   定位：与 tavily/bing/serp 同类的「纯检索」provider——只拉真实网页片段
//     （标题+URL+摘要+来源），不自带 LLM 综合。检索结果交给上层
//     freshness 流程：fast 模式直答原始片段，think 模式抽事实后由现有
//     生成器织成五段式。零额外 synthesis 代码，不碰冻结资产。
//
//   ⚠️ 合规红线（务必知悉）：
//     Brave Search API 为美国 Brave Software 服务，数据出境属 cross_border。
//     本项目「跨境数据合规」在备案审核期被标记为硬阻塞项——生产启用前
//     必须由 owner 显式确认合规取舍。本适配层 data_route 恒定 'cross_border'，
//     审计可追。如仅做国内合规，请用 domestic/tencent 等国内源。
//
//   激活条件（三层闸，由上层控制）：SEARCH_PROVIDER=brave
//     + FRESHNESS_FACTUAL_ENABLED=true + 配置 BRAVE_SEARCH_API_KEY。
//
//   机制：
//     · 无 key → 立即 ok:false（fail-soft，绝不抛异常）。
//     · 鉴权头 X-Subscription-Token（Brave 专用，非 Bearer）。
//     · 超时/重试由 index.js 统一包装（withTimeout + withRetry）。
//     · 结果经 util.normalizeResult 标准化（剥离追踪参数、补全 source）。
//
//   配置（环境变量，调用时读取，支持测试注入与部署切换）：
//     BRAVE_SEARCH_API_KEY   必须；Brave 订阅令牌
//     BRAVE_SEARCH_URL       端点（默认 https://api.search.brave.com/res/v1/web/search）
//     BRAVE_SEARCH_COUNT     返回条数（默认取 SEARCH_MAX_RESULTS=5）
//     BRAVE_SEARCH_COUNTRY   地区（默认 cn，取得中文/本地结果）
//     BRAVE_SEARCH_LANG      结果语言（默认 zh）
// ============================================================
'use strict';

var util = require('./util');

function search(query, opts, nodeFetch) {
  var key = (process.env.BRAVE_SEARCH_API_KEY || '').trim();
  if (!key) {
    return Promise.resolve({ ok: false, provider: 'brave', results: [], reason: 'no_api_key' });
  }
  if (typeof nodeFetch !== 'function') {
    return Promise.resolve({ ok: false, provider: 'brave', results: [], reason: 'no_fetch' });
  }

  var endpoint = (process.env.BRAVE_SEARCH_URL || 'https://api.search.brave.com/res/v1/web/search').trim();
  var maxResults = util.toInt(process.env.SEARCH_MAX_RESULTS, 5);
  var count = util.toInt(process.env.BRAVE_SEARCH_COUNT, maxResults);
  var country = (process.env.BRAVE_SEARCH_COUNTRY || 'cn').trim();
  var lang = (process.env.BRAVE_SEARCH_LANG || 'zh').trim();

  // Brave 用 query string（GET），鉴权走 X-Subscription-Token 头。
  var sep = endpoint.indexOf('?') >= 0 ? '&' : '?';
  var url = endpoint + sep + 'q=' + encodeURIComponent(query) +
    '&count=' + encodeURIComponent(String(count)) +
    '&country=' + encodeURIComponent(country) +
    '&search_lang=' + encodeURIComponent(lang) +
    '&text_decorations=false' +
    '&result_filter=web';
  var headers = {
    'Accept': 'application/json',
    'Accept-Encoding': 'gzip',
    'X-Subscription-Token': key,
  };

  // 传输/HTTP 错误由 util.httpGetJson 抛出 → 由 index.js 的 withRetry 重试；
  // 此处仅处理「已成功返回但无可用结果」的确定性情形（返回 ok:false，不重试）。
  return util.httpGetJson(nodeFetch, url, headers, 8000).then(function (data) {
    var web = (data && data.web) || {};
    var raw = web.results || [];
    var results = [];
    for (var i = 0; i < raw.length && results.length < maxResults; i++) {
      var item = raw[i];
      if (!item || typeof item !== 'object') continue;
      // 来源：profile.name（站点名）优先，回退 meta_url.hostname
      var src = (item.profile && item.profile.name) ||
        (item.meta_url && item.meta_url.hostname) || '';
      var normalized = util.normalizeResult({
        title: item.title,
        url: item.url,
        content: item.description || item.snippet || '',
        source: src,
      });
      if (normalized) results.push(normalized);
    }
    if (!results.length) {
      return { ok: false, provider: 'brave', results: [], reason: 'no_results' };
    }
    return { ok: true, provider: 'brave', results: results, reason: '' };
  });
}

module.exports = { search: search };
