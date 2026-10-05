// ============================================================
// Capability Layer — weather.js（天气能力）
//   Phase R：实时天气查询。
//
//   与 time.js 的本质区别：
//     时间来自系统时钟，永远可得；天气依赖外部数据源，可能不可得。
//     因此本模块的核心不是"查天气"，而是**在数据源缺位时如何体面回应**。
//
//   铁律：
//     · 绝不编造天气（一个错的温度会让用户穿错衣服，这是真实伤害）。
//     · 绝不用"我无法联网""我做不到"这类自曝短板 + 无出路的回答。
//       正确姿态：声明能力边界 → 给可行替代路径 → 保留人性化收尾。
//     · 数据源未配置是**产品状态**，不是**能力缺陷**，措辞须体现这一点。
//
//   Provider 扩展点：环境变量 WEATHER_PROVIDER（默认 none）。
//   接入真实源时只需实现 fetchFromProvider，其余链路不动。
//
//   本模块不进入知识库、不进入 embedding、不影响 RAG。
// ============================================================
'use strict';

var https = require('https');

var PROVIDER = (process.env.WEATHER_PROVIDER || 'none').toLowerCase();
var PROVIDER_KEY = process.env.WEATHER_API_KEY || '';
var TIMEOUT_MS = parseInt(process.env.WEATHER_TIMEOUT_MS || '3000', 10);

/** 最小 https GET（Node 16.13 无原生 fetch，禁止引入新依赖） */
function httpGetJson(url, timeoutMs) {
  return new Promise(function (resolve) {
    var done = false;
    var finish = function (r) { if (!done) { done = true; resolve(r); } };
    try {
      var req = https.get(url, function (res) {
        var body = '';
        res.on('data', function (c) { body += c; });
        res.on('end', function () {
          try {
            finish({ ok: true, data: JSON.parse(body) });
          } catch (e) {
            finish({ ok: false, reason: 'bad_json' });
          }
        });
      });
      req.on('error', function () { finish({ ok: false, reason: 'network_error' }); });
      req.setTimeout(timeoutMs || TIMEOUT_MS, function () {
        req.destroy();
        finish({ ok: false, reason: 'timeout' });
      });
    } catch (e) {
      finish({ ok: false, reason: 'network_error' });
    }
  });
}

/**
 * 真实数据源接入点（Phase R2 启用）。
 * 当前 PROVIDER=none：直接返回不可用，走能力边界声明。
 */
async function fetchFromProvider(city) {
  if (PROVIDER === 'none' || !PROVIDER_KEY) {
    return { ok: false, reason: 'no_provider' };
  }
  // 预留：按 provider 拼装请求。未验证的源不允许上线，故此处保持保守。
  var url = process.env.WEATHER_API_URL || '';
  if (!url) return { ok: false, reason: 'no_provider' };
  var full = url
    .replace('{city}', encodeURIComponent(city || ''))
    .replace('{key}', encodeURIComponent(PROVIDER_KEY));
  var res = await httpGetJson(full, TIMEOUT_MS);
  if (!res.ok) return { ok: false, reason: res.reason };
  return { ok: true, raw: res.data };
}

// 从问句里尽力提取城市（没有就不猜）
var CITY_RE = /([\u4e00-\u9fa5]{2,8}?)(市|区|县)?\s*(今天|明天|后天|现在|的)?\s*(天气|气温|温度)/u;
function extractCity(query) {
  var q = (query || '').toString();
  var m = q.match(CITY_RE);
  if (!m) return '';
  var c = (m[1] || '').trim();
  // 过滤掉时间词与泛指词被误当城市
  if (/^(今天|明天|后天|现在|外面|外头|这边|那边|这里|那里|我们|你们|一下|请问)$/u.test(c)) return '';
  if (c.length < 2) return '';
  return c;
}

// 能力边界声明（数据源缺位时的标准回应）
function boundaryText(city, hasCity) {
  var where = hasCity ? city : '你所在的城市';
  return '天气这类实时数据，我这里还没有接入可信的气象数据源，所以不能给你一个具体的温度或降雨概率——' +
    '这种事宁可不说，也不能说错，穿错衣服、没带伞都是实实在在的麻烦。' +
    '查' + where + '的实时天气，手机自带的天气应用或微信搜索"天气"都是几秒钟的事。';
}

// ------------------------------------------------------------
// resolve({ query, subType })
//   返回 { ok, capability, fact, data, reason }
//   ok=false 表示无法给出事实，但 fact 仍是一段可直接使用的诚实回应。
// ------------------------------------------------------------
async function resolve(input) {
  input = input || {};
  var query = (input.query || '').toString();
  var city = extractCity(query);

  var got = await fetchFromProvider(city);
  if (!got.ok) {
    return {
      ok: false,
      capability: 'weather_query',
      subType: input.subType || 'today',
      reason: got.reason || 'no_provider',
      fact: boundaryText(city, !!city),
      data: { city: city, provider: PROVIDER },
    };
  }

  // 已接入真实源时的格式化（字段名随 provider 而定，此处做防御式读取）
  var raw = got.raw || {};
  var temp = raw.temp !== undefined ? raw.temp : (raw.temperature !== undefined ? raw.temperature : null);
  var text = raw.text || raw.weather || '';
  if (temp === null && !text) {
    return {
      ok: false,
      capability: 'weather_query',
      subType: input.subType || 'today',
      reason: 'incomplete_data',
      fact: boundaryText(city, !!city),
      data: { city: city, provider: PROVIDER },
    };
  }

  var parts = [];
  if (city) parts.push(city);
  parts.push('当前');
  if (text) parts.push(text);
  if (temp !== null) parts.push(temp + '℃');

  return {
    ok: true,
    capability: 'weather_query',
    subType: input.subType || 'today',
    fact: parts.join(' ') + '。（数据来源：' + PROVIDER + '）',
    data: { city: city, provider: PROVIDER, temp: temp, text: text },
  };
}

module.exports = {
  resolve: resolve,
  extractCity: extractCity,
  boundaryText: boundaryText,
  PROVIDER: PROVIDER,
};
