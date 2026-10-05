// ============================================================
// providers/search/shared.js
//   Phase Q2-4-A：搜索成本保护（轻量日配额计数器）。
//
//   设计：进程内按 UTC 日期计数的查询配额守卫。
//     · 仅对「真实 provider」（tavily/bing/serp）计费；mock/none 不计。
//     · 命中缓存的调用不计入配额（index.js 在缓存命中时直接返回，不调用本守卫）。
//     · 无数据库依赖（build-only 阶段）；云函数冷启动会重置计数，属已知局限，
//       跨实例强一致需后续接 search_quota 集合（见 Implementation Report）。
//
//   接口：createCostGuard(getQuota)
//     getQuota() 返回当日配额（动态读取环境变量，便于测试注入）。
//     返回对象：allowed() / remaining() / record() / reset()
// ============================================================
'use strict';

function pad(n) { return (n < 10 ? '0' : '') + n; }

function utcDateKey() {
  var d = new Date();
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
}

function createCostGuard(getQuota) {
  var counts = {}; // { 'YYYY-MM-DD': number }

  function quota() {
    var q = (typeof getQuota === 'function') ? getQuota() : 500;
    return (typeof q === 'number' && q >= 0) ? q : 500;
  }
  function used() {
    return counts[utcDateKey()] || 0;
  }

  return {
    // 是否仍可发起一次真实检索
    allowed: function () {
      return used() < quota();
    },
    // 当日剩余配额
    remaining: function () {
      return Math.max(0, quota() - used());
    },
    // 记录一次成功计费调用
    record: function () {
      var k = utcDateKey();
      counts[k] = (counts[k] || 0) + 1;
    },
    // 测试/重置用
    reset: function () { counts = {}; },
    _used: used,
  };
}

module.exports = { createCostGuard: createCostGuard };
