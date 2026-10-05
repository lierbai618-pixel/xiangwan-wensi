// ============================================================
// Freshness Layer — downgrade.js
//   Phase Q / Q0 Policy 落地：降级策略（Q0 §6）。
//
//   触发：没有可靠事实 / 没有明确事件 / 来源不足 / 信息冲突 / 事件禁入。
//   禁止：编造、强行分析、假装降级（必须显式告知当前状态）。
//   允许三动作：邀请用户补充 / 转向普遍人性讨论 / 诚实承认边界。
//   纯函数、零云依赖，可离线单测。
// ============================================================
'use strict';

var S = require('./schema');
var DOWNGRADE_REASON = S.DOWNGRADE_REASON;
var USER_INTENT = S.USER_INTENT;

// 确定性选择（同问同答，便于测试与审计）
function pick(items, seed) {
  var hash = 0;
  var s = seed || '';
  for (var i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return items[items.length ? hash % items.length : 0];
}

// 动作①：邀请用户补充（事件模糊 / 用户可能掌握第一手背景）
var INVITE_TEMPLATES = [
  '你提到的这件事，我手头没有可靠的核实渠道，不想凭印象乱说。你方便简单描述一下你看到的情况吗？大概什么时候、在哪里看到的、当事人是谁——你给的背景越具体，我们能聊得越实。',
  '这件事我目前查不到可以核实的信息。如果你愿意，可以把你知道的情况讲一讲：时间、来源、最让你在意的那一点。我们基于你提供的事实来聊，我会把它当作"你看到的版本"来对待。',
];

// 动作②：转向普遍人性讨论（把 B 安全降维为 A 的标准动作）
var UNIVERSAL_TEMPLATES = [
  '虽然这件事的具体细节我还没法核实，但这类事情背后的人性是一直值得聊的——比如人在群体里为什么容易失去分寸，或者我们为什么对陌生人的故事投入那么强的情绪。想从这里开始吗？',
  '细节我没办法替你核实，但这类事触到的问题是普遍的：人为什么会这样反应、我们该怎么自处。如果你愿意，我们可以先放下这一件事，聊聊它背后的人心。',
];

// 动作③：诚实承认边界（纯事实查询且无可转化钩子）
var HONEST_TEMPLATES = [
  '这个我可能帮不上——它更依赖最新、可核实的信息，而不是思考。我这里更适合陪你聊事情背后的人性和意义。如果你想聊的是它带给你的感受或困惑，我在这里。',
  '关于这件事的最新进展，我没有可靠的信息渠道，给不了你负责任的答案——这类问题错一个细节就可能误导你。如果你愿意说说它为什么让你在意，我们可以从另一个角度聊。',
];

// 动作④（Q2-15）：人物身份查询专用降级——明确拒绝编造学历/履历，
//   并解释为什么不能给出具体传记信息（高幻觉风险领域）。
var PERSON_IDENTITY_TEMPLATES = [
  '关于这个人的具体背景（学历、经历、履历等），我没有可靠的信息来源可以核实，不能凭印象给你细节——这类信息错一处就可能误导你。如果你愿意聊聊这个人带给你的感受、或者他做的事触动了什么普遍性的话题，我在这里。',
  '这个人的详细背景我不掌握，给不了你负责任的介绍——尤其是学历、出生日期这类细节，模型很容易"自信地出错"。如果你有特定角度想聊（比如他的作品、他说过的话、或者他代表的那类现象），我们可以基于你提供的方向来谈。',
];

// emotion 优先变体：先承接情绪，再降级（Q0 §5：emotion 永远最高）
var EMOTION_PREFIX = [
  '看到你因为这件事这么难受，先别急着去弄清楚每一个细节——你的感受本身更值得被照顾。',
  '这件事让你不好受，我能感觉到。事实的部分我们可以慢一点，先说说它戳中你的是什么。',
];

// ============================================================
// buildDowngrade({ reason, userIntent, query })
//   返回 { answer, action, reason }
//     action: invite_supplement | universal_humanity | honest_boundary
// ============================================================
function buildDowngrade(input) {
  input = input || {};
  var reason = input.reason || DOWNGRADE_REASON.NO_RELIABLE_FACT;
  var intent = input.userIntent || USER_INTENT.REFLECTION;
  var query = input.query || '';

  // Q2-15：人物身份查询降级——使用专用模板，明确拒绝编造传记细节
  var isPersonIdentity = /(是谁|谁$|何许人也|介绍一下.{0,20}$|.{2,10}是什么人|.{2,10}是何许人|你认识.{2,10}|你知道.{2,10}吗$)/u.test(query);

  var action;
  if (reason === DOWNGRADE_REASON.NO_CLEAR_EVENT) {
    action = 'invite_supplement';
  } else if (reason === DOWNGRADE_REASON.RESTRICTED_EVENT) {
    // restricted：不接事件本身，转向普遍原则 / 情绪承接
    action = intent === USER_INTENT.EMOTION ? 'universal_humanity' : 'honest_boundary';
  } else if (isPersonIdentity) {
    // 人物身份查询：无论意图类型，都用专用诚实边界模板（最高优先）
    action = 'person_identity_boundary';
  } else if (intent === USER_INTENT.INFORMATION) {
    action = 'honest_boundary';
  } else {
    action = 'universal_humanity';
  }

  var body;
  if (action === 'invite_supplement') body = pick(INVITE_TEMPLATES, query);
  else if (action === 'universal_humanity') body = pick(UNIVERSAL_TEMPLATES, query);
  else if (action === 'person_identity_boundary') body = pick(PERSON_IDENTITY_TEMPLATES, query);
  else body = pick(HONEST_TEMPLATES, query);

  // emotion 最高优先：先承接，再给降级正文
  var answer = intent === USER_INTENT.EMOTION
    ? pick(EMOTION_PREFIX, query + 'e') + '\n\n' + body
    : body;

  return { answer: answer, action: action, reason: reason };
}

module.exports = { buildDowngrade: buildDowngrade };
