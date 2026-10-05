// ============================================================
// Capability Layer — formatter.js（回答格式化）
//   Phase R：工具结果 → 用户可读回答。
//
//   格式契约（顺序不可颠倒）：
//     ① 事实结果优先 —— 第一句必须是答案本身，不铺垫、不寒暄、不解释过程。
//     ② 思辨邀请可选 —— 一句话，克制，永远是邀请而非说教。
//
//   为什么邀请必须"可选"：
//     用户问"现在几点"时想要的是时间。硬塞哲学是另一种形式的答非所问，
//     和原来的 bug 属于同一类错误（拿人格覆盖需求）。
//     因此规则是：只有事实成功给出后，才允许附加一句邀请；
//     能力边界声明（查不到天气/位置）自带收尾，不再追加，避免语气错位。
//
//   本模块不进入知识库、不进入 embedding、不影响 RAG。
//   纯函数，可离线单测。
// ============================================================
'use strict';

var INVITE_ENABLED = (process.env.CAPABILITY_INVITE_ENABLED || 'true').toLowerCase() !== 'false';

// 确定性挑选（同问同答，便于测试与审计）
function pick(items, seed) {
  if (!items || items.length === 0) return '';
  var hash = 0;
  var s = (seed || '').toString();
  for (var i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return items[hash % items.length];
}

var INVITES = {
  time_query: [
    '如果你愿意，我们也可以聊聊时间这件事本身——它为什么总是不够用。',
    '顺带一提：如果你此刻在意的其实不是几点，而是"又过去一天了"，我在这儿。',
    '如果你想的话，我们也可以聊聊你打算怎么用接下来的这段时间。',
  ],
  // 深夜/凌晨专用（时段感知，比通用邀请更贴人）
  time_query_late: [
    '这个点还醒着，如果不只是查个时间，想说点什么我都在。',
    '夜深了。如果你是被什么事撑着没睡，可以说说。',
  ],
  calculation_query: [
    '算清楚了。如果这个数背后是个让你为难的决定，我们也可以聊聊怎么选。',
    '数字是这样。要是它牵着某件你正在权衡的事，可以说说看。',
  ],
  weather_query: [
    '如果你其实是在想要不要出门这件事，我们可以聊聊。',
  ],
  location_query: [
    '如果你问的不只是地理位置，我在这儿。',
  ],
};

// 情绪并存时的收尾：先接住人，再谈别的。
// 这里不讲道理、不引经典、不追问——只表明"我看见你了"。
var EMOTION_INVITES = [
  '看你这会儿不太好受。要是想说说，我在。',
  '先把事实给你了。如果心里那件事更重，我们可以聊那个。',
  '时间之外的那件事，如果你愿意讲，我听着。',
];

/**
 * buildAnswer({ capability, subType, ok, fact, data, query })
 *   返回 { answer, hasInvite }
 */
function buildAnswer(input) {
  input = input || {};
  var fact = (input.fact || '').toString().trim();
  if (!fact) return { answer: '', hasInvite: false };

  // 失败 / 能力边界声明：文案自带收尾，不追加邀请
  if (!input.ok) return { answer: fact, hasInvite: false };
  if (!INVITE_ENABLED) return { answer: fact, hasInvite: false };

  var invite;
  if (input.emotional) {
    // 情绪优先：事实照给，收尾换成情绪承接（不说教、不引经典）
    var pool = EMOTION_INVITES;
    if (input.capability !== 'time_query') {
      pool = ['先把结果给你了。如果心里那件事更重，我们可以聊那个。', '看你这会儿不太好受。要是想说说，我在。'];
    }
    invite = pick(pool, input.query || fact);
  } else {
    var key = input.capability;
    // 时段感知：深夜（23:00-05:00）问时间，换更贴人的一句
    if (key === 'time_query' && input.data && typeof input.data.hour === 'number') {
      var h = input.data.hour;
      if (h >= 23 || h < 5) key = 'time_query_late';
    }
    invite = pick(INVITES[key] || [], input.query || fact);
  }
  if (!invite) return { answer: fact, hasInvite: false };

  return { answer: fact + '\n\n' + invite, hasInvite: true };
}

module.exports = {
  buildAnswer: buildAnswer,
  INVITES: INVITES,
  EMOTION_INVITES: EMOTION_INVITES,
};
