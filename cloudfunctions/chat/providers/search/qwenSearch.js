// ============================================================
// providers/search/qwenSearch.js
//   Phase Q2-13：阿里云百炼(DashScope) 联网搜索 Provider Adapter。
//     基于用户「现有中转 API」接入，定位为「qwen」provider 槽位，
//     作为现有 searchLayer 的真实国内检索源（data_route=domestic）。
//
//   ⚠️ 架构约束（化解 Q2-11 评估关切，务必遵守）：
//     百炼 chat/completions 开启 enable_search 后，响应同时包含
//       (a) choices[0].message.content        —— 模型「综合后的回答」（可能自行编造/综合实时事实）
//       (b) choices[0].message.extended.search_info.search_results —— 结构化检索结果数组
//     本适配器【只提取 (b) 作为 runtime context 喂给 fact extraction】，
//     【绝不采用 (a) 作为事实底座或最终答案】——事实隔离与 tencent/domestic 完全一致，
//     从而消除 Q2-11 指出的「模型工具绕过事实隔离、自行综合实时事实」风险。
//
//   设计原则（与既有真实 provider 一致）：
//     · 仅当 QWEN_SEARCH_BASE_URL 配置时才联网；否则立即 ok:false（fail-soft）。
//     · 传输/HTTP 错误由 util.httpPostJson 抛出 → index.js 的 withRetry 重试；
//       此处仅处理「已成功返回但无可用结果」的确定性情形（返回 ok:false，不重试）。
//     · 结果经 util.normalizeResult 标准化。
//     · provider 名固定 'qwen' → data_route 恒定 'domestic'（阿里云国内节点，零跨境）。
//
//   配置（环境变量，调用时读取，支持测试注入与部署切换）：
//     QWEN_SEARCH_BASE_URL       必须；中转 API 的 chat/completions 端点（OpenAI 兼容路径）
//     QWEN_SEARCH_API_KEY        可选；鉴权 Bearer Token（中转若已代持密钥可留空）
//     QWEN_SEARCH_MODEL          模型名（默认 'qwen-plus'）
//     QWEN_SEARCH_ENABLE_SEARCH  是否开启联网（默认 'true'，置 'false' 关闭）
//     QWEN_SEARCH_RESULTS_PATH   检索结果数组在响应中的 dot-path（默认见下）
//     QWEN_SEARCH_EXTRA_BODY     附加固定 body 字段（JSON 字符串，可选，如中转要求额外参数）
//     QWEN_SEARCH_FIELD_TITLE    结果项标题字段（默认 'title'）
//     QWEN_SEARCH_FIELD_URL      结果项链接字段（默认 'url'）
//     QWEN_SEARCH_FIELD_SNIPPET  结果项摘要字段（默认 'content'，缺失回退 summary/description）
//     QWEN_SEARCH_FIELD_SOURCE   结果项来源字段（默认 'title'）
//
//   ⚠️ 数据出境边界：data_route=domestic 的正确性依赖所接入 API 为
//     国内合规服务（阿里云国内节点，服务器与数据均留境）。适配层不做跨境源。
// ============================================================
'use strict';

var util = require('./util');
// Phase Q2-26：三模式人格层（非冻结）。与 agnesSearch 对称接入，fast→通用助手，think→结合体。
// 注意：本文件位于 providers/search/，modePersona 在 cloudfunctions/chat/ 根，需上两级。
var modePersona = require('../../modePersona');

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

// ---- 检索结果数组提取：优先自定义路径，其次常见百炼/DashScope 形状 ----
//   ⚠️ 只取 search_results 数组；[b] message.content（模型综合答案）永远不被引用。
function pickResults(data) {
  if (!data || typeof data !== 'object') return [];
  // 1) 用户显式配置字段（支持 dot-path）
  var custom = (cfg('QWEN_SEARCH_RESULTS_PATH',
    'choices.0.message.extended.search_info.search_results') || '').trim();
  if (custom) {
    var v = resolvePath(data, custom);
    if (Array.isArray(v) && v.length) return v;
  }
  // 2) 常见百炼/DashScope 形状兜底探测（避免硬编单一 API 细节，降低编造风险）
  var probes = [
    'choices.0.message.extended.search_info.search_results',
    'output.choices.0.message.extended.search_info.search_results',
    'choices.0.message.search_info.search_results',
    'choices.0.message.extended.search_results',
    'search_results',
    'searchResults',
    'web_search_results',
    'results'
  ];
  for (var i = 0; i < probes.length; i++) {
    var arr = resolvePath(data, probes[i]);
    if (Array.isArray(arr) && arr.length) return arr;
  }
  return [];
}

// ---- Q2-16：百炼 OpenAI 兼容模式不返回结构化 search_results，
//   仅返回模型综合文字(choices[0].message.content)。当无结构化数组时，
//   退而取 content 作为「模型合成事实底座」(UNVERIFIED)，仍受 responder
//   反幻觉硬检约束。绝不把 content 当最终答案直接下发。
//   可用 QWEN_SEARCH_SYNTH_MODE=false 关闭此回退（恢复严格 no_results 降级）。
function pickSynthesizedContent(data) {
  if (!data || typeof data !== 'object') return '';
  var msg = data.choices && data.choices[0] && data.choices[0].message;
  if (!msg) return '';
  var c = (msg.content || '').toString().trim();
  if (!c) return '';
  // 过滤明显拒答/空泛，避免把「我无法获取实时数据…」当事实底座。
  //   原逻辑只拦 <80 字的短拒答，导致长拒答（如「我目前无法获取实时数据，建议你…」）
  //   被当作有效综合内容缓存下发，用户看到"不能联网"。扩到：句首拒答词(任意长度)
  //   + 句中"无法/没有 + 实时/最新/当前 + 数据/信息/行情"强拒答信号，一律丢弃 → ok:false 诚实降级。
  if (/^(抱歉|对不起|我(暂时)?(无法|不能|没有|不太清楚|没有可靠))/u.test(c)) return '';
  if (/无法(获取|访问|查到|得到|连接).{0,8}(实时|最新|当前|联网|网络)/u.test(c)) return '';
  if (/没有(实时|最新|当前|可靠的?|联网).{0,8}(数据|信息|行情|结果)/u.test(c)) return '';
  if (/暂时(无法|不能|没有).{0,10}(提供|获取|查到|回答)/u.test(c)) return '';
  return c;
}

// ============================================================
// 内置 nodeFetch（Q2-21：不依赖外部传入的 eventRetriever.nodeFetch，
//   那个实现有响应截断/空内容问题。自建版本与 rag.js 的 nodeFetch 同构）
// ============================================================
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

function _makeSynthResult(synth) {
  if (!synth) return { ok: false, provider: 'qwen', results: [], reason: 'no_results' };
  var synthItem = util.normalizeResult({
    title: '', url: '', content: synth, source: 'bailian-synthesized'
  });
  if (!synthItem) return { ok: false, provider: 'qwen', results: [], reason: 'no_results' };
  synthItem.synthesized = true;
  return { ok: true, provider: 'qwen', results: [synthItem], reason: 'synth_content', synthesized: true };
}

// Q2-27：主模型额度到期/不存在时，错误属「换模型可解决」类才降级备用模型。
//   超时/网络抖动不含（已由上层 withRetry 处理）；其余（404/模型不存在/额度耗尽/欠费）命中。
function isFallbackWorthy(err) {
  var m = (err && err.message) ? ('' + err.message) : '';
  return /404/.test(m)
    || /Model not exist/i.test(m)
    || /model[^a-z]*(not|invalid|unknown)/i.test(m)
    || /quota/i.test(m)
    || /余额/i.test(m)
    || /balance/i.test(m)
    || /exceed/i.test(m)
    || /Resource[^a-z]*not[^a-z]*exist/i.test(m)
    || /The model (is )?(not|invalid)/i.test(m);
}

function search(query, opts, nodeFetch) {
  // 端点来源优先级（化解「后台配置一次，搜索自动复用」诉求）：
  //   ① QWEN_SEARCH_* env（显式覆盖，利于测试/独立中转）
  //   ② opts.searchModelConfig（来自后台 model_config 的首个启用模型，chat 入口每请求注入）
  //   ③ 均无 → no_endpoint 确定性降级（与各 provider 无 key 行为一致）
  var envBase = (cfg('QWEN_SEARCH_BASE_URL', '') || '').trim();
  var mc = (opts && opts.searchModelConfig) || null;
  var baseUrl, apiKey;
  if (envBase) {
    baseUrl = envBase.replace(/\/+$/, '').replace(/\/chat\/completions$/i, '') + '/chat/completions';
    apiKey = (cfg('QWEN_SEARCH_API_KEY', '') || '').trim();
  } else if (mc && mc.baseURL) {
    // 复用后台 model_config（与 rag.js callOneModel 同构的端点拼装）
    baseUrl = (mc.baseURL || '').toString().trim().replace(/\/+$/, '').replace(/\/chat\/completions$/i, '') + '/chat/completions';
    apiKey = (mc.apiKey || '').toString().trim();
  } else {
    return Promise.resolve({ ok: false, provider: 'qwen', results: [], reason: 'no_endpoint' });
  }

  // Q2-27：主模型（先烧快到期额度，如 qwen-turbo）+ 备用模型（额度到期后无需重部署自动切换，如 qwen3.8-max）。
  var primaryModel = envBase
    ? (cfg('QWEN_SEARCH_MODEL', 'qwen-plus') || 'qwen-plus').trim()
    : (mc.model || 'qwen-plus').toString().trim();
  var fallbackModel = (cfg('QWEN_SEARCH_FALLBACK_MODEL', '') || '').trim();

  var maxResults = util.toInt(cfg('SEARCH_MAX_RESULTS', '5'), 5);
  var enableSearch = (cfg('QWEN_SEARCH_ENABLE_SEARCH', 'true') || 'true').trim() !== 'false' && !personaPure;
  // Q2-26：forced_search 是百炼真正触发联网检索的开关。
  //   实测：仅传 enable_search 时模型仍按「离线先验」拒答实时问题；
  //   补 search_options.forced_search 后 10/10 命中真实行情数据。默认开启。
  var forcedSearch = (cfg('QWEN_SEARCH_FORCED_SEARCH', 'true') || 'true').trim() !== 'false';
  var extraBody = (cfg('QWEN_SEARCH_EXTRA_BODY', '') || '').trim();
  var synthMode = (cfg('QWEN_SEARCH_SYNTH_MODE', 'true') || 'true').trim() !== 'false';
  // Q2-26：按 answerMode 切换人格（与 agnesSearch 对称）。deep 不定义人格 → 回退默认，
  //   保证冻结 rag.js ROLE_PROMPT 的思辨内核不被本层覆盖。
  // Phase X：sage/socratic 即「人格激活」。人格激活且无需联网（networkNeeded===false，由
  //   index.js 对元问题/人格提问设定）时，关闭联网检索，纯人格生成——避免联网噪音污染
  //   人格口吻且更快。
  var sageVal = (opts && opts.sage) || 'none';
  var socraticVal = !!(opts && opts.socratic);
  var personaActive = (sageVal && sageVal !== 'none') || socraticVal;
  var persona = modePersona.personaFor(opts && opts.answerMode, { sage: sageVal, socratic: socraticVal });
  var personaPure = personaActive && (opts && opts.networkNeeded === false);

  // 单次模型调用（doSearch 包裹，便于主→备降级）
  function doSearch(model) {
    var body = {
      model: model,
      messages: [
        { role: 'system', content: persona || '你是一个知识问答助手。请提供信息密度高、细节充实的回答，直接给出关键事实，不重复问题、不客套开场。' },
        { role: 'user', content: query }
      ],
      stream: false,
      max_tokens: 1024  // Q2-22：1024t≈600中文字；system prompt保证信息密度一次到位，无需续写。512过短模型拒答
    };
    // enable_search 仅在开启时下发；personaPure（人格纯生成）时 enableSearch=false，不发送该字段，
    //   避免兼容模式端点对 enable_search:false 的异常行为拖慢/拒答。
    if (enableSearch) {
      body.enable_search = true;
      if (forcedSearch) body.search_options = { forced_search: true };
    }
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

    var headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    if (apiKey) headers['Authorization'] = 'Bearer ' + apiKey;

    // 传输/HTTP 错误抛出 → index.js withRetry 重试；超时由 search() 外层 withTimeout 施加。
    // 优先取结构化 search_results 数组（事实隔离最佳实践）；
    //   若百炼 OpenAI 兼容模式只返回模型综合文字，则按 Q2-16 退化为合成底座(UNVERIFIED)。
    return util.httpPostJson(_nodeFetch, baseUrl, body, headers, (opts && opts.timeout) || 12000).then(function (data) {
      var raw = pickResults(data);
      var results = [];
      for (var i = 0; i < raw.length && results.length < maxResults; i++) {
        var item = raw[i];
        if (!item || typeof item !== 'object') continue;
        var fTitle = (cfg('QWEN_SEARCH_FIELD_TITLE', 'title') || 'title').trim();
        var fUrl = (cfg('QWEN_SEARCH_FIELD_URL', 'url') || 'url').trim();
        var fSnippet = (cfg('QWEN_SEARCH_FIELD_SNIPPET', 'content') || 'content').trim();
        var fSource = (cfg('QWEN_SEARCH_FIELD_SOURCE', 'title') || 'title').trim();
        var normalized = util.normalizeResult({
          title: item[fTitle],
          url: item[fUrl],
          content: item[fSnippet] || item.summary || item.description || item.content,
          source: item[fSource]
        });
        if (normalized) results.push(normalized);
      }
      if (results.length) {
        return { ok: true, provider: 'qwen', results: results, reason: '' };
      }
      // Q2-16+Q2-22：无结构化数组 → 退化为模型合成底座（UNVERIFIED，受反幻觉约束）。
      if (synthMode) {
        var synth = pickSynthesizedContent(data);
        if (synth) return _makeSynthResult(synth);
      }
      return { ok: false, provider: 'qwen', results: [], reason: 'no_results' };
    });
  }

  // Q2-27：主模型失败且错误属「换模型可解决」类 → 自动降级备用模型（如 qwen-turbo 到期切 qwen3.8-max），
  //   无需重新部署。超时/网络抖动不在其列（上层 withRetry 已处理）。
  return doSearch(primaryModel).catch(function (err) {
    if (fallbackModel && fallbackModel !== primaryModel && isFallbackWorthy(err)) {
      console.warn('[qwen] 主模型 ' + primaryModel + ' 失败，降级备用 ' + fallbackModel + '：' + (err && err.message));
      return doSearch(fallbackModel);
    }
    throw err;
  });
}

module.exports = { search: search };
