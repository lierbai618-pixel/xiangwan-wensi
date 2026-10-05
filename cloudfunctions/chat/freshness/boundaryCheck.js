// ============================================================
// Freshness Layer — boundaryCheck.js
//   Phase Q / Q0 Policy 落地：Event Boundary Check（事件安全闸）。
//
//   政策依据：docs/PhaseQ0-Freshness-Policy.md §3
//   硬约束：
//     · 独立于 Prompt：本模块是代码闸门，LLM 无权跳过或改写其结论。
//     · 单向从严：任何信号冲突或信息不足，向更严等级收敛，从不放宽。
//     · 每次 Check 必须留痕：event_id / level / signals / timestamp。
//     · restricted：禁止检索、禁止生成 event_context。
//     · sensitive：只确认事件存在，禁止扩展细节。
// ============================================================
'use strict';

var S = require('./schema');
var SENSITIVITY = S.SENSITIVITY;

// ---------- restricted 信号（命中任一即 restricted，禁止检索） ----------
var RESTRICTED_SIGNALS = [
  { key: 'politics-sensitive', re: /(政治|领导人|选举|政变|游行|示威|抗议|上访|维稳|主权|领土)/u },
  { key: 'minor-involved', re: /(未成年|小学生|中学生|初中生|高中生|女童|男童|儿童).{0,20}(事件|受害|死亡|自杀|霸凌|侵害)|校园(霸凌|暴力)/u },
  { key: 'privacy-doxxing', re: /(人肉|开盒|隐私|住址|身份证号|手机号).{0,12}(曝光|泄露|扒|公开)?/u },
  { key: 'harm-mobilization', re: /(抵制.{0,8}(人|群体)|网暴.{0,8}(号召|一起)|攻击.{0,6}(他|她|他们))/u },
  { key: 'terror-extremism', re: /(恐怖袭击|极端组织|邪教)/u },
];

// ---------- sensitive 信号（命中收敛到 sensitive，除非已有 restricted） ----------
var SENSITIVE_SIGNALS = [
  { key: 'public-figure-scandal', re: /(出轨|塌房|嫖娼|吸毒|偷税|逃税|税务|代孕|性侵|性骚扰|家暴|潜规则)/u },
  { key: 'unverified-rumor', re: /(网传|据传|据说|爆料|疑似|听说|有人说|都在传|未经证实)/u },
  { key: 'disaster-tragedy', re: /(遇难|身亡|坠机|空难|火灾|爆炸|地震|洪水|台风|踩踏|矿难|车祸)/u },
  { key: 'group-hostility', re: /(地域黑|性别对立|男女对立|仇视)/u },
  { key: 'judicial-pending', re: /(一审|二审|判决|起诉|立案|调查中|尚未通报)/u },
];

// 等级序号：用于从严收敛
var LEVEL_RANK = { normal: 0, sensitive: 1, restricted: 2 };

function stricterOf(a, b) {
  return LEVEL_RANK[a] >= LEVEL_RANK[b] ? a : b;
}

// ============================================================
// checkEvent(eventMention, opts)
//   eventMention：事件描述文本（分类层提取的主干）
//   opts.extraText ：可选附加文本（如原始问题全文），参与信号扫描
//   返回 {
//     level            : normal | sensitive | restricted
//     allowRetrieval   : boolean   是否允许事实检索
//     allowDetail      : boolean   是否允许生成事件细节摘要
//     allowEventContext: boolean   是否允许生成 event_context
//     signals          : string[]  命中的信号 key
//     audit            : BoundaryAudit（Q0 §3.4 留痕）
//   }
// ============================================================
function checkEvent(eventMention, opts) {
  opts = opts || {};
  var text = ((eventMention || '') + ' ' + (opts.extraText || '')).toString();

  var signals = [];
  var level = SENSITIVITY.NORMAL;

  var i;
  for (i = 0; i < RESTRICTED_SIGNALS.length; i++) {
    if (RESTRICTED_SIGNALS[i].re.test(text)) {
      signals.push(RESTRICTED_SIGNALS[i].key);
      level = stricterOf(level, SENSITIVITY.RESTRICTED);
    }
  }
  for (i = 0; i < SENSITIVE_SIGNALS.length; i++) {
    if (SENSITIVE_SIGNALS[i].re.test(text)) {
      signals.push(SENSITIVE_SIGNALS[i].key);
      level = stricterOf(level, SENSITIVITY.SENSITIVE);
    }
  }

  // 单向从严：事件描述为空/过短 → 无法评估，按 sensitive 处理（不放宽到 normal）
  if ((eventMention || '').trim().length < 4) {
    signals.push('empty-event-mention');
    level = stricterOf(level, SENSITIVITY.SENSITIVE);
  }

  return {
    level: level,
    allowRetrieval: level !== SENSITIVITY.RESTRICTED,
    allowDetail: level === SENSITIVITY.NORMAL,
    allowEventContext: level !== SENSITIVITY.RESTRICTED,
    signals: signals,
    audit: S.makeBoundaryAudit({
      eventId: S.makeEventId((eventMention || '').slice(0, 60), new Date().toISOString().slice(0, 10)),
      level: level,
      signals: signals,
    }),
  };
}

module.exports = {
  checkEvent: checkEvent,
  RESTRICTED_SIGNALS: RESTRICTED_SIGNALS,
  SENSITIVE_SIGNALS: SENSITIVE_SIGNALS,
  LEVEL_RANK: LEVEL_RANK,
};
