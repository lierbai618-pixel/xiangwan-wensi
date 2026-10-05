// ============================================================
// Capability Layer — time.js（时间能力）
//   Phase R：系统时间服务。
//
//   铁律：
//     · 禁止回答"我不知道时间""我无法联网获取时间"。
//       时间来自运行时系统时钟，永远可得，不存在"获取不到"。
//     · 禁止编造时间。所有输出均由 Date 计算得出，无任何硬编码。
//     · 统一北京时间（UTC+8）：云函数运行时时区不确定（常为 UTC），
//       因此显式做偏移换算，不依赖服务器本地时区。
//
//   本模块不进入知识库、不进入 embedding、不影响 RAG。
//   纯函数（now 可注入），可离线单测。
// ============================================================
'use strict';

var BEIJING_OFFSET_MIN = 8 * 60; // UTC+8

var WEEKDAY_CN = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];

/**
 * 把任意时刻换算为「北京墙钟时间」的 Date 对象。
 * 换算后使用 getFullYear/getHours 等本地取值方法即得北京时间数值，
 * 与服务器所在时区无关。
 */
function toBeijing(now) {
  var d = now instanceof Date ? new Date(now.getTime()) : new Date();
  return new Date(d.getTime() + (BEIJING_OFFSET_MIN + d.getTimezoneOffset()) * 60000);
}

function pad2(n) {
  return n < 10 ? '0' + n : '' + n;
}

/** 一天中的时段口语描述（凌晨/早上/上午/中午/下午/傍晚/晚上/深夜） */
function dayPart(hour) {
  if (hour < 5) return '凌晨';
  if (hour < 8) return '早上';
  if (hour < 11) return '上午';
  if (hour < 13) return '中午';
  if (hour < 17) return '下午';
  if (hour < 19) return '傍晚';
  if (hour < 23) return '晚上';
  return '深夜';
}

/** 结构化的北京时间快照 */
function snapshot(now) {
  var b = toBeijing(now);
  return {
    year: b.getFullYear(),
    month: b.getMonth() + 1,
    day: b.getDate(),
    hour: b.getHours(),
    minute: b.getMinutes(),
    second: b.getSeconds(),
    weekdayIndex: b.getDay(),
    weekday: WEEKDAY_CN[b.getDay()],
    dayPart: dayPart(b.getHours()),
    iso: b.getFullYear() + '-' + pad2(b.getMonth() + 1) + '-' + pad2(b.getDate()) +
      'T' + pad2(b.getHours()) + ':' + pad2(b.getMinutes()) + ':' + pad2(b.getSeconds()) + '+08:00',
    timezone: 'Asia/Shanghai (UTC+8)',
  };
}

/** 相对日（offsetDays：明天=1，昨天=-1） */
function shiftDays(now, offsetDays) {
  var b = toBeijing(now);
  b.setDate(b.getDate() + offsetDays);
  return {
    year: b.getFullYear(),
    month: b.getMonth() + 1,
    day: b.getDate(),
    weekday: WEEKDAY_CN[b.getDay()],
  };
}

var RELATIVE_MAP = [
  { re: /大后天/u, offset: 3, label: '大后天' },
  { re: /后天/u, offset: 2, label: '后天' },
  { re: /明天/u, offset: 1, label: '明天' },
  { re: /前天/u, offset: -2, label: '前天' },
  { re: /昨天/u, offset: -1, label: '昨天' },
];

function detectRelative(query) {
  var q = (query || '').toString();
  for (var i = 0; i < RELATIVE_MAP.length; i++) {
    if (RELATIVE_MAP[i].re.test(q)) return RELATIVE_MAP[i];
  }
  return null;
}

// ------------------------------------------------------------
// resolve({ subType, query, now })
//   返回 { ok:true, fact, data, capability:'time_query' }
//   ok 恒为 true —— 系统时钟不存在不可用的情况。
// ------------------------------------------------------------
function resolve(input) {
  input = input || {};
  var sub = input.subType || 'time';
  var query = input.query || '';
  var s = snapshot(input.now);

  var ymd = s.year + '年' + s.month + '月' + s.day + '日';
  var hm = pad2(s.hour) + ':' + pad2(s.minute);
  var fact;

  if (sub === 'relative') {
    var rel = detectRelative(query);
    if (rel) {
      var r = shiftDays(input.now, rel.offset);
      fact = rel.label + '是 ' + r.year + '年' + r.month + '月' + r.day + '日，' + r.weekday +
        '（今天是 ' + ymd + '，' + s.weekday + '）。';
      return {
        ok: true,
        capability: 'time_query',
        subType: sub,
        fact: fact,
        data: { today: s, target: r, relativeLabel: rel.label },
      };
    }
    sub = 'date'; // 未识别到相对词，退回今日日期
  }

  if (sub === 'date') {
    fact = '今天是北京时间 ' + ymd + '，' + s.weekday + '。';
  } else if (sub === 'weekday') {
    fact = '今天是' + s.weekday + '（' + ymd + '）。';
  } else if (sub === 'year') {
    fact = '现在是 ' + s.year + '年（今天 ' + s.month + '月' + s.day + '日，' + s.weekday + '）。';
  } else {
    // 默认：完整时刻
    fact = '现在是北京时间 ' + ymd + ' ' + hm + '，' + s.weekday + '。';
  }

  return {
    ok: true,
    capability: 'time_query',
    subType: sub,
    fact: fact,
    data: s,
  };
}

module.exports = {
  resolve: resolve,
  snapshot: snapshot,
  toBeijing: toBeijing,
  shiftDays: shiftDays,
  WEEKDAY_CN: WEEKDAY_CN,
};
