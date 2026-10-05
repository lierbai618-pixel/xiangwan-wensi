// ============================================================
// providers/search/canaryGate.js
//   Phase Q2-4-C：真实 Search Provider 激活前的「最后一道灰度安全层」。
//
//   定位：per-user 灰度闸门。它位于检索层最前端，对所有真实源请求统一起效；
//   默认关闭（零影响），仅当 SEARCH_CANARY_ENABLED=true 且请求真实 provider 时介入。
//
//   设计依据：docs/Freshness-Q2-4-B-RealSourceChecklist.md §2（双重闸门之上
//   的 per-user 子闸）。与 FRESHNESS_FACTUAL_ENABLED（事实源总闸）形成两级：
//     总闸开  →  才进入事实检索；
//     总闸开 + canary 开  →  仅白名单 openid 真正打到真实源，其余强制 mock/反思。
//
//   规则：
//     · SEARCH_CANARY_ENABLED 默认 false（关闭）→ 不介入，原样放行。
//     · 关闭时：resolve() 返回 { provider: requested, canaryBlocked:false, active:false }。
//     · 开启且请求 mock/none：不受影响（只对真实源做灰度）。
//     · 开启且请求真实源：
//         - openid 在 SEARCH_CANARY_OPENIDS 白名单 → 放行（provider 不变）。
//         - openid 缺失/未知('unknown')/不在白名单 → 强制 mock（canaryBlocked:true）。
//         - 缺失身份 → fail-closed（宁可不给真实源，也不误放）。
//
//   隐私：本模块只做「相等比较」，绝不记录 openid 原文或任何个人信息。
//
//   Node 16.13 兼容（无可选链 / 无空值合并）。
// ============================================================
'use strict';

function envTrue(name, dflt) {
  var v = process.env[name];
  if (v === undefined || v === null || v === '') return dflt;
  return ('' + v).toLowerCase() === 'true';
}

function parseOpenids(s) {
  if (!s) return [];
  return String(s)
    .split(',')
    .map(function (x) { return x.trim(); })
    .filter(Boolean);
}

function isRealProvider(p) {
  // 含 domestic/tencent/qwen（国内源）：真实外呼，同样受灰度/配额/审计约束
  return p === 'tavily' || p === 'bing' || p === 'serp' || p === 'domestic' || p === 'tencent' || p === 'qwen';
}

// 灰度是否开启（默认关）
function canaryEnabled(cfg) {
  if (cfg && typeof cfg.enabled === 'boolean') return cfg.enabled;
  return envTrue('SEARCH_CANARY_ENABLED', false);
}

// 判定某 openid 是否被放行
//   返回：true(放行) / false(拦截) / null(闸门未激活，交回上层)
function canaryAllows(openid, cfg) {
  if (!canaryEnabled(cfg)) return null; // 闸门未激活
  if (!openid || openid === 'unknown') return false; // 无身份 → fail-closed
  var list = (cfg && Array.isArray(cfg.openids)) ? cfg.openids : parseOpenids(process.env.SEARCH_CANARY_OPENIDS);
  if (list.indexOf(openid) !== -1) return true;
  return false;
}

// 解析「实际生效 provider」
//   opts.__canary 可注入 { enabled, openids } 供离线测试；否则读环境变量。
//   返回 { provider, canaryBlocked, active }
function resolve(openid, requested, cfg) {
  cfg = cfg || {};
  if (!canaryEnabled(cfg)) {
    return { provider: requested, canaryBlocked: false, active: false };
  }
  // 非真实源（mock/none）不受灰度影响
  if (!isRealProvider(requested)) {
    return { provider: requested, canaryBlocked: false, active: false };
  }
  var allow = canaryAllows(openid, cfg);
  if (allow === true) {
    return { provider: requested, canaryBlocked: false, active: true };
  }
  // allow === false（未命中白名单 / 无身份）→ 强制 mock/fallback
  return { provider: 'mock', canaryBlocked: true, active: true };
}

module.exports = {
  canaryEnabled: canaryEnabled,
  canaryAllows: canaryAllows,
  resolve: resolve,
  isRealProvider: isRealProvider,
};
