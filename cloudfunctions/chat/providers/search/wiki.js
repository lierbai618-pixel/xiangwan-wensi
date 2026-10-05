// ============================================================
// providers/search/wiki.js
//   Phase Q2-25-C：Wikipedia 检索源（零 key、事实型、公开参考）。
//
//   定位：与 tavily/bing/serp/brave 同类的「纯检索」provider——只拉公开
//     百科事实片段（标题+URL+摘要+来源），不自带 LLM 综合。检索结果交给
//     上层 freshness 流程：fast 模式直答原始片段，think 模式抽事实后由现有
//     生成器织成五段式。零额外 synthesis 代码，不碰冻结资产。
//
//   ⚠️ 与 Brave 的关键区别（合规口径）：
//     · 零 API key、零注册，无商业搜索引擎的「用户原话出境」风险。
//     · 仅传输「公开事实查询」，不含任何用户 PII / 身份 / 敏感内容。
//     · 服务器虽在境外（ technically cross_border），但数据性质为公开参考，
//       与 Brave（整段用户查询交商业搜索引擎）风险量级不同。
//     · 注：zh.wikipedia.org 在大陆网络环境可达性不稳定，生产须真机验证。
//
//   激活条件：SEARCH_PROVIDER=wiki + FRESHNESS_FACTUAL_ENABLED=true。
//     （无需 key；无 nodeFetch 时 ok:false no_fetch 优雅降级。）
//
//   配置（环境变量）：
//     WIKI_LANG        语言/站点（默认 zh；可选 en 等）
//     WIKI_USER_AGENT  自定义 UA（默认 XiangWenWenSi/1.0，部分站点要求）
// ============================================================
'use strict';

var util = require('./util');

function _stripTags(s) {
  if (!s) return '';
  return ('' + s).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function search(query, opts, nodeFetch) {
  if (typeof nodeFetch !== 'function') {
    return Promise.resolve({ ok: false, provider: 'wiki', results: [], reason: 'no_fetch' });
  }
  var maxResults = util.toInt(process.env.SEARCH_MAX_RESULTS, 5);
  var lang = (process.env.WIKI_LANG || 'zh').trim();
  var ua = (process.env.WIKI_USER_AGENT || 'XiangWenWenSi/1.0 (factual-reference)').trim();

  // Wikipedia 开放 search API（无需 key；origin=* 仅浏览器 CORS 用，服务端忽略无妨）
  var endpoint = 'https://' + lang + '.wikipedia.org/w/api.php';
  var url = endpoint +
    '?action=query&list=search&srsearch=' + encodeURIComponent(query) +
    '&srlimit=' + encodeURIComponent(String(maxResults)) +
    '&format=json&origin=*';
  var headers = {
    'Accept': 'application/json',
    'User-Agent': ua,
  };

  // 传输/HTTP 错误由 util.httpGetJson 抛出 → index.js withRetry 重试；
  // 此处仅处理「已成功返回但无可用结果」的确定性情形（返回 ok:false，不重试）。
  return util.httpGetJson(nodeFetch, url, headers, 8000).then(function (data) {
    var raw = (data && data.query && data.query.search) || [];
    var results = [];
    for (var i = 0; i < raw.length && results.length < maxResults; i++) {
      var item = raw[i];
      if (!item || typeof item !== 'object') continue;
      var normalized = util.normalizeResult({
        title: item.title,
        url: 'https://' + lang + '.wikipedia.org/wiki/' + encodeURIComponent((item.title || '').replace(/ /g, '_')),
        content: _stripTags(item.snippet),
        source: 'Wikipedia',
      });
      if (normalized) results.push(normalized);
    }
    if (!results.length) {
      return { ok: false, provider: 'wiki', results: [], reason: 'no_results' };
    }
    return { ok: true, provider: 'wiki', results: results, reason: '' };
  });
}

module.exports = { search: search };
