// ============================================================
// providers/search/agnesSearch.js
//   Phase Q2-24：Agnes AI (apihub.agnes-ai.com) Provider Adapter。
//     模型优选 agnes-2.0-flash + reasoning_effort:low + max_tokens:2048。
//     OpenAI 兼容 /v1/chat/completions，Bearer 鉴权。⚠ Base URL 含 hub，非 bare api。
//
//   与 qwenSearch 的关键差异：
//     · 无 enable_search 专有字段（标准 OpenAI 兼容，搜索能力取决于模型本身）
//     · 无 search_results 结构化提取（以模型综合文字为主，走 synth 模式）
//     · 可选 AGNES_SEARCH_EXTRA_BODY 注入自定义字段（如 tools/web_search_options）
//
//   配置（环境变量）：
//     AGNES_SEARCH_BASE_URL      必须；https://apihub.agnes-ai.com/v1（注意含 hub）
//     AGNES_SEARCH_API_KEY       必须；Bearer Token
//     AGNES_SEARCH_MODEL         模型名（默认 'agnes-2.0-flash'，实测 2.5s 联网搜索）
//     AGNES_SEARCH_ENABLE        是否启用（默认 'true'，置 'false' 关闭）
//     AGNES_SEARCH_EXTRA_BODY    附加 body 字段（JSON 字符串，建议注入 {"reasoning_effort":"low"} 降低推理开销）
//     AGNES_SEARCH_MAX_TOKENS    最大输出 token（默认 2048，与 reasoning_low 配合获得最佳产出）
//
//   数据出境：apihub.agnes-ai.com 为国内域名 → data_route=domestic。
// ============================================================
'use strict';

var util = require('./util');
// Phase Q2-25：三模式人格层（非冻结）。fast→通用助手，think→结合体事实型。
// 注意：本文件位于 providers/search/，modePersona 在 cloudfunctions/chat/ 根，需上两级。
var modePersona = require('../../modePersona');

// ---- 配置读取（调用时读取，保证部署切换即时生效）----
function cfg(name, def) {
  var v = process.env[name];
  return (v === undefined || v === null) ? def : v;
}

// ---- 内置 nodeFetch（与 qwenSearch 同构，独立于 eventRetriever）----
function _nodeFetch(u, opts) {
  opts = opts || {};
  return new Promise(function (resolve, reject) {
    var urlP = require('url');
    var parsed = urlP.parse(u);
    var mod = parsed.protocol === 'https:' ? require('https') : require('http');
    var reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + (parsed.search || ''),
      method: (opts.method || 'GET').toUpperCase(),
      headers: opts.headers || {},
      timeout: opts.timeout || 20000,
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

// ---- 提取模型综合文字（标准 OpenAI choices[0].message.content）----
function pickContent(data) {
  if (!data || typeof data !== 'object') return '';
  var msg = data.choices && data.choices[0] && data.choices[0].message;
  if (!msg) return '';
  var c = (msg.content || '').toString().trim();
  if (!c) return '';
  // 过滤明显拒答
  if (/^(抱歉|对不起|对不起，我|我(暂时)?(无法|不能|没有|不太清楚|没有可靠))/u.test(c) && c.length < 80) return '';
  return c;
}

// ---- 尝试提取结构化搜索结果（兜底探测常见格式）----
function pickSearchResults(data) {
  if (!data || typeof data !== 'object') return [];
  var probes = [
    'choices.0.message.search_results',
    'choices.0.message.tool_calls.0.web_search.results',
    'search_results',
    'web_search_results',
    'results'
  ];
  for (var i = 0; i < probes.length; i++) {
    var arr = resolvePath(data, probes[i]);
    if (Array.isArray(arr) && arr.length) return arr;
  }
  return [];
}

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

function _makeSynthResult(synth) {
  if (!synth) return { ok: false, provider: 'agnes', results: [], reason: 'no_content' };
  var synthItem = util.normalizeResult({
    title: '', url: '', content: synth, source: 'agnes-synthesized'
  });
  if (!synthItem) return { ok: false, provider: 'agnes', results: [], reason: 'no_content' };
  synthItem.synthesized = true;
  return { ok: true, provider: 'agnes', results: [synthItem], reason: 'synth_content', synthesized: true };
}

// ============================================================
// search(query, opts, nodeFetch)
//   返回统一形状：{ ok, provider, results, reason, synthesized? }
// ============================================================
function search(query, opts, nodeFetch) {
  var envBase = (cfg('AGNES_SEARCH_BASE_URL', '') || '').trim();
  if (!envBase) {
    return Promise.resolve({ ok: false, provider: 'agnes', results: [], reason: 'no_endpoint' });
  }

  var enabled = (cfg('AGNES_SEARCH_ENABLE', 'true') || 'true').trim() !== 'false';
  if (!enabled) {
    return Promise.resolve({ ok: false, provider: 'agnes', results: [], reason: 'disabled' });
  }

  var apiKey = (cfg('AGNES_SEARCH_API_KEY', '') || '').trim();
  if (!apiKey) {
    return Promise.resolve({ ok: false, provider: 'agnes', results: [], reason: 'no_api_key' });
  }

  var baseUrl = envBase.replace(/\/+$/, '').replace(/\/chat\/completions$/i, '') + '/chat/completions';
  var model = (cfg('AGNES_SEARCH_MODEL', 'agnes-2.0-flash') || 'agnes-2.0-flash').trim();
  var maxTokens = util.toInt(cfg('AGNES_SEARCH_MAX_TOKENS', '2048'), 2048);
  var extraBody = (cfg('AGNES_SEARCH_EXTRA_BODY', '') || '').trim();

  // ---- 构造标准 OpenAI 兼容 body ----
  // Phase Q2-25：system prompt 按模式切换人格（fast=通用助手 / think=结合体事实型）。
  // deep 不进入搜索链路（thinkEngine 直接回退冻结 RAG），此处无需处理。
  var persona = modePersona.personaFor(opts && opts.answerMode, { sage: (opts && opts.sage) || 'none', socratic: !!(opts && opts.socratic) });
  var body = {
    model: model,
    messages: [
      { role: 'system', content: persona || '你是一个知识问答助手。请提供信息密度高、细节充实的回答，直接给出关键事实，不重复问题、不客套开场。' },
      { role: 'user', content: query }
    ],
    stream: false,
    web_search_options: {},  // Agnes 联网搜索（标准 OpenAI 兼容扩展字段）
    reasoning_effort: 'low', // 降低推理开销，提升有效产出（实测 text_tokens 翻倍）
    max_tokens: maxTokens
  };

  // 注入自定义字段（如 tools / web_search_options 等）
  if (extraBody) {
    try {
      var extra = JSON.parse(extraBody);
      if (extra && typeof extra === 'object') {
        for (var ek in extra) {
          if (Object.prototype.hasOwnProperty.call(extra, ek)) body[ek] = extra[ek];
        }
      }
    } catch (e) {
      // 错误配置忽略
    }
  }

  var headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Accept': 'application/json',
    'Authorization': 'Bearer ' + apiKey
  };

  return util.httpPostJson(_nodeFetch, baseUrl, body, headers, 12000).then(function (data) {
    // 优先提取结构化搜索结果
    var raw = pickSearchResults(data);
    var results = [];
    var maxResults = util.toInt(cfg('SEARCH_MAX_RESULTS', '5'), 5);
    for (var i = 0; i < raw.length && results.length < maxResults; i++) {
      var item = raw[i];
      if (!item || typeof item !== 'object') continue;
      var normalized = util.normalizeResult({
        title: item.title || item.name || '',
        url: item.url || item.link || '',
        content: item.content || item.snippet || item.description || item.summary || '',
        source: item.source || item.domain || item.title || ''
      });
      if (normalized) results.push(normalized);
    }
    if (results.length) {
      return { ok: true, provider: 'agnes', results: results, reason: '' };
    }

    // 无结构化结果 → 退化为模型综合文字（synthesized, UNVERIFIED）
    var synth = pickContent(data);
    if (synth) return _makeSynthResult(synth);

    return { ok: false, provider: 'agnes', results: [], reason: 'no_content' };
  });
}

module.exports = { search: search };
