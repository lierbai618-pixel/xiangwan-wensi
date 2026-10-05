// ============================================================
// providers/search/util.js
//   Phase Q2-1 → Q2-4-A：Search Provider 共享工具（纯函数，无云依赖）。
//   提供：
//     · normalizeResult      结果标准化（剥离追踪参数）
//     · httpPostJson/getJson Node16 兼容的 HTTP JSON 助手（注入 nodeFetch）
//     · withTimeout          硬超时包装（不依赖 nodeFetch 的 timeout 选项）
//     · withRetry            指数退避重试（5xx/网络/超时重试，4xx 不重试）
//     · applySourceFilter    来源域名过滤（黑名单/白名单）
//     · parseList/extractDomain/stripTracking/toInt 辅助纯函数
// ============================================================
'use strict';

// ------------------------------------------------------------
// 基础辅助
// ------------------------------------------------------------
function toInt(v, def) {
  var n = parseInt(v, 10);
  return isNaN(n) ? def : n;
}

// 把 "a, b ,c" → ['a','b','c']（小写去空白）
function parseList(s) {
  if (!s) return [];
  return String(s)
    .split(',')
    .map(function (x) { return x.trim().toLowerCase(); })
    .filter(Boolean);
}

// 从 URL 提取域名（去掉 www. 前缀，小写）
function extractDomain(url) {
  if (!url) return '';
  try {
    var u = new URL(url);
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch (e) {
    var m = /https?:\/\/([^\/?#]+)/i.exec(url);
    return m ? m[1].replace(/^www\./, '').toLowerCase() : '';
  }
}

// 剥离常见追踪参数（utm_*/spm/from/share），缩短 URL、降低引用噪音
function stripTracking(url) {
  if (!url) return url;
  try {
    var u = new URL(url);
    var tracking = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'spm', 'from', 'share', 'sharefrom'];
    for (var i = 0; i < tracking.length; i++) u.searchParams.delete(tracking[i]);
    return u.toString();
  } catch (e) {
    return url;
  }
}

// ------------------------------------------------------------
// 结果标准化：单条 → { title, snippet, url, source, time }
// 返回 null 表示无 snippet 的无效条目（不可作为事实底座）。
// ------------------------------------------------------------
function normalizeResult(raw) {
  if (!raw || typeof raw !== 'object') return null;
  var snippet = (raw.snippet || raw.summary || raw.content || raw.description || '').toString().trim();
  if (!snippet) return null;
  return {
    title: (raw.title || '').toString().slice(0, 120),
    snippet: snippet.slice(0, 500),
    url: stripTracking((raw.url || raw.link || '').toString()),
    source: (raw.source || raw.site || extractDomain(raw.url || raw.link || '')).toString().slice(0, 60),
    time: (raw.time || raw.publishedAt || raw.date || raw.published_time || '').toString(),
  };
}

// ------------------------------------------------------------
// HTTP 助手（注入 nodeFetch，Node16 无原生 fetch）
// ------------------------------------------------------------
function httpPostJson(nodeFetch, url, body, headers, timeout) {
  return nodeFetch(url, {
    method: 'POST',
    headers: headers || { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
    timeout: timeout || 20000,
  }).then(function (res) {
    if (!res.ok) {
      var err = new Error('HTTP_' + (res.status || 0));
      err.status = res.status;
      throw err;
    }
    return res.json();
  });
}

function httpGetJson(nodeFetch, url, headers, timeout) {
  return nodeFetch(url, {
    method: 'GET',
    headers: headers || {},
    timeout: timeout || 20000,
  }).then(function (res) {
    if (!res.ok) {
      var err = new Error('HTTP_' + (res.status || 0));
      err.status = res.status;
      throw err;
    }
    return res.json();
  });
}

// ------------------------------------------------------------
// withTimeout：用 Promise.race 实现硬超时，与 nodeFetch 实现无关。
//   ms<=0 时透传（关闭超时）。超时时 reject { code:'TIMEOUT' }。
// ------------------------------------------------------------
function withTimeout(promise, ms, label) {
  if (!ms || ms <= 0) return promise;
  return new Promise(function (resolve, reject) {
    var done = false;
    var timer = setTimeout(function () {
      if (done) return;
      done = true;
      var e = new Error('timeout' + (label ? ':' + label : ''));
      e.code = 'TIMEOUT';
      reject(e);
    }, ms);
    promise.then(function (v) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(v);
    }, function (err) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}

// 默认重试判定：5xx / 网络错误 / 超时 → 重试；4xx（鉴权/配额）→ 不重试
function defaultShouldRetry(err) {
  if (!err) return false;
  if (err.code === 'TIMEOUT') return true;
  var m = (err.message || '').match(/^HTTP_(\d+)/);
  if (m) {
    var code = parseInt(m[1], 10);
    return code >= 500; // 仅 5xx 重试
  }
  return true; // 网络层错误（ECONNRESET 等）重试
}

function sleep(ms) {
  return new Promise(function (r) { setTimeout(r, ms); });
}

// ------------------------------------------------------------
// withRetry：对每个 attempt 调用 fn()（fn 返回 Promise）。
//   opts.retries   最大重试次数（默认 2，共最多 3 次）
//   opts.timeoutMs 单次调用超时限（传给 withTimeout）
//   opts.baseDelay 退避基数（默认 300ms，指数增长）
//   opts.shouldRetry 自定义判定（默认 defaultShouldRetry）
// ------------------------------------------------------------
function withRetry(fn, opts) {
  opts = opts || {};
  var retries = (typeof opts.retries === 'number') ? opts.retries : 2;
  var baseDelay = (typeof opts.baseDelay === 'number') ? opts.baseDelay : 300;
  var timeoutMs = (typeof opts.timeoutMs === 'number') ? opts.timeoutMs : 3000;
  var shouldRetry = (typeof opts.shouldRetry === 'function') ? opts.shouldRetry : defaultShouldRetry;

  function attempt(remaining) {
    return withTimeout(fn(), timeoutMs, opts.label).catch(function (err) {
      if (remaining <= 0) throw err;
      if (!shouldRetry(err)) throw err;
      var delay = baseDelay * Math.pow(2, (retries - remaining));
      return sleep(delay).then(function () { return attempt(remaining - 1); });
    });
  }
  return attempt(retries);
}

// ------------------------------------------------------------
// applySourceFilter：按域名黑名单/白名单过滤结果。
//   opts.blockedDomains / opts.allowedDomains 为逗号分隔字符串。
//   白名单优先：若设置白名单，仅白名单内域名通过。
// ------------------------------------------------------------
function applySourceFilter(results, opts) {
  opts = opts || {};
  var blocked = parseList(opts.blockedDomains);
  var allowed = parseList(opts.allowedDomains);
  if (!blocked.length && !allowed.length) return results;
  return (results || []).filter(function (r) {
    var d = extractDomain(r.url);
    if (allowed.length && allowed.indexOf(d) === -1) return false;
    if (blocked.length && blocked.indexOf(d) !== -1) return false;
    return true;
  });
}

module.exports = {
  toInt: toInt,
  parseList: parseList,
  extractDomain: extractDomain,
  stripTracking: stripTracking,
  normalizeResult: normalizeResult,
  httpPostJson: httpPostJson,
  httpGetJson: httpGetJson,
  withTimeout: withTimeout,
  withRetry: withRetry,
  defaultShouldRetry: defaultShouldRetry,
  applySourceFilter: applySourceFilter,
};
