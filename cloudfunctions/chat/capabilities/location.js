// ============================================================
// Capability Layer — location.js（位置能力）
//   Phase R：位置查询。
//
//   架构事实：云函数本身没有用户位置。位置只能由小程序前端
//   在用户授权后通过 wx.getLocation 上报，经 event.location 传入。
//   因此本模块的正确行为是：
//     · 前端已传入位置 → 直接复述事实。
//     · 未传入 → 说明这是「需要你授权」而非「我不知道」，给出路径。
//
//   铁律：
//     · 绝不编造位置。位置错误可能造成真实的出行损失。
//     · 绝不擅自推断（IP 归属地不等于用户位置，不做此类猜测）。
//     · 隐私优先：位置属敏感信息，不写入任何日志明文字段。
//
//   本模块不进入知识库、不进入 embedding、不影响 RAG。
// ============================================================
'use strict';

/**
 * resolve({ query, subType, location })
 *   location: 前端上报的 { latitude, longitude, address?, city? }
 */
function resolve(input) {
  input = input || {};
  var sub = input.subType || 'self';
  var loc = input.location || null;

  var hasLoc = !!(loc && (loc.address || loc.city ||
    (typeof loc.latitude === 'number' && typeof loc.longitude === 'number')));

  if (!hasLoc) {
    var text = sub === 'nearby'
      ? '要找附近的地方，得先知道你在哪——而我这里拿不到你的位置，除非你在小程序里主动授权定位。' +
        '这不是我"不知道"，是这类信息按设计就不该被我默认拿到。' +
        '如果只是想找个地方，地图应用会比我准得多。'
      : '你的位置我这边拿不到——小程序没有获得定位授权时，云端是看不到你在哪的，' +
        '我也不会靠 IP 之类的东西去猜一个地名给你，猜错了反而误事。' +
        '如果你需要，可以在小程序里开启定位授权；或者直接告诉我你在哪个城市，我们接着聊。';
    return {
      ok: false,
      capability: 'location_query',
      subType: sub,
      reason: 'no_authorization',
      fact: text,
      data: { authorized: false },
    };
  }

  var where = loc.address || loc.city || '';
  var fact;
  if (where) {
    fact = '按你授权的定位，你现在在：' + where + '。';
  } else {
    fact = '按你授权的定位，你现在的坐标是 ' +
      Number(loc.latitude).toFixed(4) + ', ' + Number(loc.longitude).toFixed(4) +
      '（我这里没有地名解析服务，只能给到坐标）。';
  }

  if (sub === 'nearby') {
    fact += ' 至于附近有什么，我这里没有接入地图检索能力，地图应用会更靠谱。';
  }

  return {
    ok: sub !== 'nearby',
    capability: 'location_query',
    subType: sub,
    reason: sub === 'nearby' ? 'no_poi_provider' : '',
    fact: fact,
    // 隐私：不回传原始坐标到观测层，只标记授权状态
    data: { authorized: true },
  };
}

module.exports = { resolve: resolve };
