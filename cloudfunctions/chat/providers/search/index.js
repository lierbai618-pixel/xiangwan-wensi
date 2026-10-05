// ============================================================
// providers/search/index.js
//   Phase Q2-1 → Q2-4-A：Search Provider 统一抽象层（网络检索入口）。
//
//   设计依据：docs/Phase-Q2-Architecture.md §3.1 / Phase-Q2-Search-Policy.md
//   职责：
//     · getProviderName()   读取 SEARCH_PROVIDER（默认 mock — 安全默认态）。
//     · search(query, opts) 路由到具体 provider，返回统一形状：
//         { ok, provider, results:[{title,url,snippet,source,time}], reason, cached }
//     · 进程内缓存（ephemeral，永不持久化）、fail-soft（永不抛未捕获异常）。
//
//   Q2-4-A 新增机制（仅作用于真实 provider，mock/none 不受影响）：
//     · 硬超时 withTimeout（默认 3000ms，SEARCH_TIMEOUT_MS 可配）
//     · 指数退避重试 withRetry（默认 2 次，5xx/网络/超时重试，4xx 不重试）
//     · 来源过滤 applySourceFilter（SEARCH_BLOCKED_DOMAINS / SEARCH_ALLOWED_DOMAINS）
//     · 成本保护 CostGuard（SEARCH_DAILY_QUOTA 日配额，仅真实 provider 计费）
//     · 结果上限 SEARCH_MAX_RESULTS（默认 5，降低成本与噪声）
//
//   关键约束（计划书 + 数据隔离规范）：
//     · 检索结果仅存在于请求内存（searchContext），随回答生成结束即释放，
//       绝不写入 corpus / embedding / metadata / history。
//     · 真实源仅在 FRESHNESS_FACTUAL_ENABLED=true 且配置密钥时由上层激活；
//       本层只负责正确转发、加固与降级。
//     · 'none' / 'mock' / 无密钥 → ok:false，上层维持「诚实边界+反思」行为。
// ============================================================
'use strict';

var mockProvider = require('./mock');
var bingProvider = require('./bing');
var tavilyProvider = require('./tavily');
var serpProvider = require('./serp');
// Phase Q2-10：provider-agnostic 国内搜索 API 适配层（data_route=domestic，替代废弃的 SearXNG 自托管）
var domesticProvider = require('./domesticApiSearch');
// Phase Q2-12：腾讯云联网搜索 WSA 专用适配（POST + Bearer + Pages 二次解析，data_route=domestic）
var tencentProvider = require('./tencentWsaSearch');
// Phase Q2-13：阿里云百炼(DashScope) 联网搜索适配（基于现有中转 API；仅取 search_results，data_route=domestic）
var qwenProvider = require('./qwenSearch');
// Phase Q2-23：Agnes AI (api.agnes-ai.cn) 搜索适配（OpenAI 兼容 /v1/chat/completions，data_route=domestic）
var agnesProvider = require('./agnesSearch');
// Phase Q2-25-B：Brave Search API 检索源（retrieval-only，免费层可用；data_route=cross_border）
var braveProvider = require('./brave');
// Phase Q2-25-C：Wikipedia 检索源（零 key、事实型；服务器境外但仅传公开事实、零 PII，风险量级异于 Brave）
var wikiProvider = require('./wiki');
var util = require('./util');
var shared = require('./shared');
// Phase Q2-4-C：per-user 灰度闸门（默认关闭，零影响）
var canaryGate = require('./canaryGate');
// Phase Q2-4-D：隐私边界与数据出口控制层（最前端，fail-closed，默认关闭）
var privacyGate = require('./privacyGate');
// 复用 eventRetriever 的 Node16 nodeFetch，避免第三份实现（不修改冻结资产）
var retriever = require('../../freshness/eventRetriever');

// ------------------------------------------------------------
// 配置（环境变量 → 内存，附带 _setConfig 供测试注入）
// ------------------------------------------------------------
var _config = {
  timeoutMs: util.toInt(process.env.SEARCH_TIMEOUT_MS, 3000),     // 单次检索硬超时（≤3s，政策 §4）
  retries: util.toInt(process.env.SEARCH_RETRY, 2),               // 最大重试次数
  maxResults: util.toInt(process.env.SEARCH_MAX_RESULTS, 5),      // 单查询最大结果数（成本/噪声）
  blockedDomains: process.env.SEARCH_BLOCKED_DOMAINS || '',      // 黑名单（逗号分隔）
  allowedDomains: process.env.SEARCH_ALLOWED_DOMAINS || '',      // 白名单（逗号分隔，优先）
  dailyQuota: util.toInt(process.env.SEARCH_DAILY_QUOTA, 500),   // 当日真实检索配额
};

function _setConfig(o) {
  if (o && typeof o === 'object') {
    for (var k in o) {
      if (Object.prototype.hasOwnProperty.call(o, k)) _config[k] = o[k];
    }
  }
  return _config;
}

// Phase Q2-13：联网搜索(qwen provider)复用后台 model_config 的注入点（单例）。
//   chat 入口每请求用首个启用模型的 {baseURL,apiKey,model} 设置一次；
//   qwenSearch 优先读 QWEN_SEARCH_* env，其次读本注入，再次 no_endpoint 降级。
//   与 FRESHNESS_ENABLED / 灰度闸门正交：真实外呼仍受 canaryGate 约束。
var _searchModelConfig = null;
function _setSearchModelConfig(c) { _searchModelConfig = c || null; return _searchModelConfig; }

// 成本保护守卫（按日计数，getQuota 动态读 _config.dailyQuota）
var costGuard = shared.createCostGuard(function () { return _config.dailyQuota; });

// 进程内缓存（仅加速、非持久化；上限保护，避免内存膨胀）
var _cache = {};
var _cacheTtlMs = 10 * 60 * 1000; // 10 分钟
var _cacheMax = 200;

function getProviderName() {
  var p = (process.env.SEARCH_PROVIDER || 'mock').toLowerCase();
  if (p === 'bing' || p === 'tavily' || p === 'serp' || p === 'mock' || p === 'domestic' || p === 'tencent' || p === 'qwen' || p === 'agnes' || p === 'brave' || p === 'wiki' || p === 'auto') return p;
  return 'none'; // 未知值 → 安全降级为 none
}

function isRealProvider(p) {
  // 所有真实外呼源（含免费国内源）均计入配额/审计
  return p === 'tavily' || p === 'bing' || p === 'serp' || p === 'domestic' || p === 'tencent' || p === 'qwen' || p === 'agnes' || p === 'brave' || p === 'wiki' || p === 'auto';
}

// 国内数据路径源（data_route=domestic）；区别于境外 cross_border 真实源
function isDomesticProvider(p) {
  return p === 'domestic' || p === 'tencent' || p === 'qwen' || p === 'agnes' || p === 'auto';
}

function _cacheKey(query) {
  return (query || '').toString().trim().toLowerCase().replace(/\s+/g, ' ');
}
function _fromCache(key) {
  var e = _cache[key];
  if (e && (Date.now() - e.t) < _cacheTtlMs) return e.v;
  return null;
}
function _toCache(key, v) {
  if (Object.keys(_cache).length >= _cacheMax) _cache = {}; // 简单环形丢弃
  _cache[key] = { t: Date.now(), v: v };
}

// ============================================================
// search(query, opts) → Promise<统一形状>
//   opts.bypassCache  跳过缓存（测试用）
// ============================================================

// ============================================================
// auto 路由（Q2-27）：按「是否需联网」动态选源，调用方经 opts.networkNeeded 告知。
//   networkNeeded=true  → qwen（真实联网检索；先烧快过期模型 qwen-turbo，自动降级 qwen3.8-max）
//   networkNeeded=false → agnes（纯模型知识，不耗 qwen 额度；零跨境，data_route=domestic）
//   分类结论来自 freshness/eventClassifier（Category B=需联网），由调用方传入，
//   本层不做分类，保持低层纯转发。
// ============================================================
function autoSearch(q, opts, nodeFetch) {
  var need = !!(opts && opts.networkNeeded);
  if (need) {
    return qwenProvider.search(q, Object.assign({}, opts, { searchModelConfig: _searchModelConfig }), nodeFetch);
  }
  return agnesProvider.search(q, opts, nodeFetch);
}
// ============================================================
// search(query, opts) → Promise<统一形状>
//   opts.openid        用户标识（灰度闸门依据；本层只做相等比较，绝不记录）
//   opts.bypassCache   跳过缓存（测试用）
//   opts.__canary      测试注入 { enabled, openids }
//   opts.__privacy     测试注入 { enabled }
//   调用链（本层内）：privacyGate（最前端）→ canaryGate → provider
//     · 任意一层拦截 → 不调用外部 provider，返回确定性 fallback。
//   返回 audit 字段：{ provider, latency_ms, cache_hit,
//     downgrade_reason, quota_remaining, canary_blocked, data_route }
//     —— 仅安全元数据，绝不含用户原文/脱敏query/完整结果/个人信息。
//       data_route 枚举：'domestic' | 'cross_border' | 'blocked'
// ============================================================
async function search(query, opts) {
  opts = opts || {};
  var openid = opts.openid || '';
  var q = (query || '').toString().trim();
  var t0 = Date.now();
  if (!q) {
    return { ok: false, provider: getProviderName(), results: [], reason: 'empty_query', cached: false,
      audit: _audit(getProviderName(), t0, false, 'empty_query', false, false) };
  }

  // ---- Phase Q2-4-D：隐私边界闸门（最前端，fail-closed）----
  // 高风险 PII → 不调用任何 provider，确定性 fallback，不影响 RAG 回答。
  var pii = privacyGate.resolve(q, opts.__privacy);
  if (!pii.allowed) {
    return {
      ok: false, provider: getProviderName(), results: [], reason: 'pii_blocked', cached: false,
      audit: _audit(getProviderName(), t0, false, 'pii_blocked', false, true),
    };
  }
  // 最小数据出境：仅把脱敏后的 query 交给下游（闸门关闭时 sanitizedQuery === q）
  var effectiveQ = pii.sanitizedQuery || q;

  var requestedProvider = getProviderName();
  // 灰度闸门：默认关闭；开启且请求真实源时，按 openid 白名单放行/强制 mock。
  var canary = canaryGate.resolve(openid, requestedProvider, opts.__canary);
  var provider = canary.provider;

  // 命中灰度拦截 → 不调用任何 provider，无 [MOCK] 生成，直接诚实降级。
  if (canary.canaryBlocked) {
    return {
      ok: false, provider: 'mock', results: [], reason: 'canary_blocked', cached: false,
      audit: _audit('mock', t0, false, 'canary_blocked', true, false),
    };
  }

  // 'none' → 无检索源，维持 Q1-B 无事实源反思行为
  if (provider === 'none') {
    return { ok: false, provider: 'none', results: [], reason: 'no_provider', cached: false,
      audit: _audit('none', t0, false, 'no_provider', false, false) };
  }

  // 成本保护：仅真实 provider 计费；缓存命中不计数（下方早返回）
  if (isRealProvider(provider) && !costGuard.allowed()) {
    return { ok: false, provider: provider, results: [], reason: 'quota_exceeded', cached: false,
      audit: _audit(provider, t0, false, 'quota_exceeded', false, false) };
  }

  // 缓存命中（仅对稳定结果缓存，降低配额消耗；key 用脱敏 query）
  var key = _cacheKey(effectiveQ);
  if (!opts.bypassCache) {
    var cached = _fromCache(key);
    if (cached) {
      cached.cached = true;
      cached.audit = _audit(provider, t0, true, '', false, false);
      return cached;
    }
  }

  var out;
  try {
    var providerFn;
    if (provider === 'mock') providerFn = function () { return mockProvider.search(effectiveQ, opts); };
    else if (provider === 'bing') providerFn = function () { return bingProvider.search(effectiveQ, opts, retriever.nodeFetch); };
    else if (provider === 'tavily') providerFn = function () { return tavilyProvider.search(effectiveQ, opts, retriever.nodeFetch); };
    else if (provider === 'serp') providerFn = function () { return serpProvider.search(effectiveQ, opts, retriever.nodeFetch); };
    else if (provider === 'domestic') providerFn = function () { return domesticProvider.search(effectiveQ, opts, retriever.nodeFetch); };
    else if (provider === 'tencent') providerFn = function () { return tencentProvider.search(effectiveQ, opts, retriever.nodeFetch); };
    else if (provider === 'qwen') providerFn = function () { return qwenProvider.search(effectiveQ, Object.assign({}, opts, { searchModelConfig: _searchModelConfig }), retriever.nodeFetch); };
    else if (provider === 'agnes') providerFn = function () { return agnesProvider.search(effectiveQ, opts, retriever.nodeFetch); };
    else if (provider === 'brave') providerFn = function () { return braveProvider.search(effectiveQ, opts, retriever.nodeFetch); };
    else if (provider === 'wiki') providerFn = function () { return wikiProvider.search(effectiveQ, opts, retriever.nodeFetch); };
    else if (provider === 'auto') providerFn = function () { return autoSearch(effectiveQ, opts, retriever.nodeFetch); };
    else providerFn = function () { return Promise.resolve({ ok: false, provider: provider, results: [], reason: 'unsupported_provider' }); };

    out = await util.withRetry(
      function () { return providerFn(); },
      { retries: _config.retries, timeoutMs: _config.timeoutMs, label: provider }
    );
  } catch (e) {
    var errMsg = (e && e.message) ? e.message : ('' + e);
    var reason = (e && e.code === 'TIMEOUT') ? 'timeout' : 'provider_exception';
    out = { ok: false, provider: provider, results: [], reason: reason, error: errMsg };
  }
  if (!out) out = { ok: false, provider: provider, results: [], reason: 'empty_output' };

  // 来源过滤（黑名单/白名单）
  if (out.ok && Array.isArray(out.results) && out.results.length) {
    out.results = util.applySourceFilter(out.results, {
      blockedDomains: _config.blockedDomains,
      allowedDomains: _config.allowedDomains,
    });
    if (!out.results.length) {
      out.ok = false;
      out.reason = 'all_filtered';
    }
  }

  // 结果上限（成本控制 + 降低下游噪声）
  if (out.ok && Array.isArray(out.results) && out.results.length > _config.maxResults) {
    out.results = out.results.slice(0, _config.maxResults);
  }

  out.cached = false;
  // 成功计费的真实调用才记录配额（缓存命中/失败不计数）
  if (out.ok && isRealProvider(provider)) costGuard.record();
  // 仅缓存成功结果；失败(含 ok:false / 降级原因)不缓存，避免瞬时故障污染 10min 缓存
  //   （如 qwen 偶发"我无法获取实时数据"被当作成功缓存，用户持续看到"不能联网"）。
  if (out.ok) _toCache(key, out);
  out.audit = _audit(provider, t0, false, out.ok ? '' : (out.reason || ''), false, false);
  return out;
}

// 审计元数据构造器：仅安全字段，绝不含用户原文/脱敏query/完整结果/个人信息。
function _audit(provider, t0, cacheHit, reason, canaryBlocked, piiBlocked) {
  return {
    provider: provider,
    latency_ms: Date.now() - t0,
    cache_hit: !!cacheHit,
    downgrade_reason: reason || '',
    quota_remaining: (provider && isRealProvider(provider)) ? costGuard.remaining() : -1,
    canary_blocked: !!canaryBlocked,
    data_route: dataRouteOf(provider, !!piiBlocked),
  };
}

// 数据出境路由枚举（合规审计核心字段）：
//   'blocked'      —— 隐私/合规拦截，数据未出境
//   'cross_border' —— 真实境外 provider（tavily/bing/serp）
//   'domestic'     —— 国内数据路径（domestic 免费源）或本地/无跨境（mock/none/未知）
//     ⚠️ domestic 源的「零跨境」正确性依赖所接入 API 为国内合规服务（服务器与数据均留境）。
function dataRouteOf(provider, piiBlocked) {
  if (piiBlocked) return 'blocked';
  if (isDomesticProvider(provider)) return 'domestic';
  if (isRealProvider(provider)) return 'cross_border';
  return 'domestic';
}

module.exports = {
  getProviderName: getProviderName,
  search: search,
  isRealProvider: isRealProvider,
  isDomesticProvider: isDomesticProvider,
  normalizeResult: util.normalizeResult,
  // 测试/运维钩子
  _setConfig: _setConfig,
  _setSearchModelConfig: _setSearchModelConfig,
  _getConfig: function () { return _config; },
  _resetCache: function () { _cache = {}; },
  _resetDaily: function () { costGuard.reset(); },
  _costRemaining: function () { return costGuard.remaining(); },
};
