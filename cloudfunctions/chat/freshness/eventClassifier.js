// ============================================================
// Freshness Layer — eventClassifier.js
//   Phase Q / Q0 Policy 落地：问题四分类（A/B/C/D）+ 用户意图层。
//
//   政策依据：docs/PhaseQ0-Freshness-Policy.md §2 / §5
//   设计约束：
//     · 纯函数、零云依赖，可离线单测。
//     · 只做「分类」，不做「回答」；不 require rag.js（避免循环引用）。
//     · 可只读消费 intent.js 的 classifyIntent 结论（由调用方传入），
//       不复制其逻辑、不修改其规则。
//     · 歧义从保守：B↔C 取 C 的引导姿态，B↔D 取 D 的降级姿态。
// ============================================================
'use strict';

var S = require('./schema');
var CATEGORY = S.CATEGORY;
var USER_INTENT = S.USER_INTENT;

// ---------- 事件锚点信号（Q0 §2.2：B 类成立的第一条件） ----------
var TIME_ANCHOR_RE = /(最近|这两天|这几天|昨天|今天|刚刚|刚才|上周|本周|目前|眼下|时事|现在|最新|当下|近来|近期|时下|此刻)/u;
var MEDIA_ANCHOR_RE = /(热搜|热榜|头条|新闻里|新闻上|网上说|网上都在|刷屏|疯传|通报|官宣|爆出|曝出|曝光|吃瓜)/u;
var EVENT_REFERENCE_RE = /(那个.{0,12}事件|这个.{0,12}事件|那件.{0,12}事|这件.{0,12}事|.{2,16}的事|的那个瓜)/u;
var EVENT_NOUN_RE = /(事件|风波|事故|惨剧|悲剧|大瓜)/u;
// 争议裁决句式：出现即说明用户在指代某个现实争议事件（哪怕是省略指代）
var DISPUTE_RE = /(哪一方|谁对谁错|谁有理|支持谁|站哪边|你站|站队|封杀|谁干的|内幕|的错|人渣|配被原谅)/u;

// ---------- 反思指向信号（Q0 §2.2：B 类成立的第二条件） ----------
var REFLECTION_FRAME_RE = /(为什么会发生|为什么(会|有人|人们|这么多人)|怎么看|如何看待|怎么理解|从人性|人性角度|从心理|心理学|说明了什么|意味着什么|背后(的|是什么)|反映出|折射出|值得我们|你怎么看|你觉得|想聊聊|想不通)/u;

// ---------- 纯事实查询信号（Q0 §2.3：C 类） ----------
var FACT_ONLY_RE = /(经过是什么|来龙去脉|始末|全过程|结果出来|判决结果|处理结果|最新进展|后续如何|名单|时间线|具体情况|到底发生了什么|是怎么回事|是真的吗|真的假的)/u;

// ---------- 人物动态 / 新闻热点（Q1-B：显式覆盖，独立于意图层） ----------
// 仅当问题已带时间锚点（detectEventAnchor）且命中专属句式时归 B；
// 纯哲学/人生问题（论语/庄子/人生迷茫）无时间锚点，已在 classifyCategory 判 A，不会落入。
var PERSON_UPDATE_RE = /(最近怎么样|近况如何|近况|最近动态|最近消息|最近有什么消息|最近作品|最近发展|近期发展|最近在忙|最近过得怎么样|最近如何|最近在干)/u;
var NEWS_RE = /(今天有?什么新闻|今天有啥新闻|最近有?什么新闻|今天的新闻|新闻热点|热点(新闻|事件|话题)?|热搜|今日头条|今天有什么新鲜事|今天都有什么新鲜事)/u;
// 当前事件名词（带时间锚点时 → 归 B 触发联网检索）。覆盖「今天有什么X新闻/消息/
// 动态」「最近X怎么样」「最新进展」等自然问法，化解此前落入 C/A 永不检索的问题。
var CURRENT_EVENT_NOUN_RE = /(新闻|消息|动态|进展|热点|大事|事件|财报|票房|行情|股市|比赛|发布|上市|获奖|突破|事故|通报|官宣|上架|开播|上映|开售|出炉|怎么样|如何|有啥|有什么|啥|近况)/u;

// ---------- 人物身份查询（Q2-15：防传记幻觉主入口） ----------
// 命中即说明用户在询问某人的身份/背景/经历，属于高幻觉风险查询：
//   模型极易编造学历/生日/履历等具体细节。必须触发联网检索核验，
//   不得落入 A 类（LLM 自由发挥路径）。无需时间锚点——人物事实本身
//   就是检索理由。
var PERSON_IDENTITY_RE = /(是谁|谁$|何许人也|介绍一下.{0,20}$|.{2,10}是什么人|.{2,10}是何许人|.{2,10}何许人也|你认识.{2,10}|你知道.{2,10}吗$|.{2,10}的(学历|经历|履历|生平|背景|简介|资料|近况)(是|有|如何|怎样|怎么样|咋样|是什么))/u;

// ---------- 职业前缀+人名（Q2-20：陈述式人物查询） ----------
//   用户说「脱口秀演员房主任」「演员XXX」「歌手XXX」——没有"是谁/介绍"
//   等触发词，但明显是人物事实查询。此前归 A → 不检索 → 五段式空答。
//   命中即归 B + directFactual，走快速 factual 通道。
var PROFESSION_PREFIX_RE = /^(脱口秀(演员)?|演员|歌手|主持人|导演|作家|诗人|画家|科学家|运动员|教练|网红|博主|UP主|主播|艺人|明星|偶像|模特|舞者|钢琴家|小提琴家|吉他手|厨师|企业家|CEO|创始人|政治家|教授|医生|律师|记者|编辑|播音员|脱口秀|相声|小品|魔术师).{0,8}[\u4e00-\u9fa5]{2,6}$/u;

// ---------- 敏感热点预信号（Q0 §2.4：D 类候选粗筛） ----------
// 正式定级由 boundaryCheck 独立执行；此处只做「是否按 D 类姿态处理」的保守预判。
var D_TOPIC_RES = [
  { key: 'public-figure-scandal', re: /(出轨|塌房|嫖娼|吸毒|偷税|逃税|税务|代孕|性侵|性骚扰|家暴|潜规则)/u },
  { key: 'unverified-rumor', re: /(网传|据传|据说|爆料|疑似|听说|有人说|都在传|未经证实)/u },
  { key: 'disaster-tragedy', re: /(遇难|身亡|坠机|空难|火灾|爆炸|地震|洪水|台风|踩踏|矿难|车祸)/u },
  { key: 'minor-involved', re: /(未成年|小学生|中学生|初中生|高中生|女童|男童|校园霸凌|校园暴力)/u },
  { key: 'privacy-doxxing', re: /(人肉|隐私|住址|身份证号|手机号|开盒)/u },
  { key: 'politics-sensitive', re: /(政治|领导人|选举|政变|游行|示威|抗议|上访|维稳)/u },
  { key: 'group-hostility', re: /(地域黑|性别对立|男女对立|仇视)/u },
];

// ---------- 用户意图信号（Q0 §5） ----------
var EMOTION_SIGNAL_RE = /(难受|难过|崩溃|愤怒|生气|委屈|害怕|恐惧|不安|睡不着|焦虑|压抑|心痛|心寒|绝望|沮丧|震惊|看不下去|堵得慌|接受不了)/u;
var INFORMATION_FRAME_RE = /(是真的吗|真的假的|属实吗|发生了什么|怎么回事|什么情况|有没有这回事)/u;

function hitKeys(rules, text) {
  var keys = [];
  for (var i = 0; i < rules.length; i++) {
    if (rules[i].re.test(text)) keys.push(rules[i].key);
  }
  return keys;
}

// 事件锚点检测：返回 { hasAnchor, anchorSignals, eventMention }
function detectEventAnchor(query) {
  var q = (query || '').toString();
  var signals = [];
  if (TIME_ANCHOR_RE.test(q)) signals.push('time-anchor');
  if (MEDIA_ANCHOR_RE.test(q)) signals.push('media-anchor');
  if (EVENT_REFERENCE_RE.test(q)) signals.push('event-reference');
  if (EVENT_NOUN_RE.test(q)) signals.push('event-noun');
  if (DISPUTE_RE.test(q)) signals.push('dispute-frame');
  return {
    hasAnchor: signals.length > 0,
    anchorSignals: signals,
    // 事件描述粗提取：去掉提问句式后的剩余主干，供检索/澄清使用
    eventMention: q.replace(/[？?！!。，,]/g, ' ').trim().slice(0, 120),
  };
}

// ============================================================
// classifyCategory(query, intentInfo)
//   intentInfo：可选，为既有 intent.js classifyIntent 的结论（只读消费）。
//   返回 { category, eventAnchor, eventMention, reflectionAim, confidence,
//          dSignals, signals, reason }
//   confidence ∈ { high, medium, low } —— low 触发澄清或保守降级。
// ============================================================
function classifyCategory(query, intentInfo) {
  var q = (query || '').toString().trim();
  var anchor = detectEventAnchor(q);
  var dSignals = hitKeys(D_TOPIC_RES, q);
  var reflectionAim = REFLECTION_FRAME_RE.test(q);
  var factOnly = FACT_ONLY_RE.test(q);

  // 既有意图层结论作为辅助证据（只读，不复制逻辑）
  var intentReflective = !!(
    intentInfo &&
    (intentInfo.type === 'life' || intentInfo.type === 'opinion' || intentInfo.type === 'emotion') &&
    !intentInfo.crisis
  );
  var intentFactual = !!(intentInfo && intentInfo.type === 'knowledge');

  // ① 敏感预信号最优先：命中 D 话题即按 D 类姿态处理。
  //    D 话题词（网传/爆料/事故…）本身就蕴含现实事件指代，无需另验锚点。
  if (dSignals.length > 0) {
    return {
      category: CATEGORY.D,
      eventAnchor: true,
      eventMention: anchor.hasAnchor ? anchor.eventMention : q.slice(0, 120),
      reflectionAim: reflectionAim || intentReflective,
      confidence: 'high',
      dSignals: dSignals,
      signals: anchor.anchorSignals.concat(dSignals),
      reason: 'sensitive-topic:' + dSignals.join('+'),
    };
  }

  // ①-b（Q2-15 / Q2-20）人物身份 / 职业前缀查询：高幻觉风险，不得落入 A 类让 LLM 自由编造学历/履历。
  //   无需时间锚点——人物事实本身就是检索核验理由。标记后下方歧义兜底(⑥)会归入 B。
  var isPersonIdentity = PERSON_IDENTITY_RE.test(q);
  var isProfPrefix = PROFESSION_PREFIX_RE.test(q.trim());  // Q2-20：「脱口秀演员房主任」等陈述式

  // ② 无事件锚点 → A：纯哲学/人生问题，Freshness 完全不介入
  //   ⚠️ 人物身份/职业前缀查询例外（上方已标记），必须穿透本闸触发检索。
  if (!anchor.hasAnchor && !isPersonIdentity && !isProfPrefix) {
    return {
      category: CATEGORY.A,
      eventAnchor: false,
      eventMention: '',
      reflectionAim: reflectionAim || intentReflective,
      confidence: 'high',
      dSignals: [],
      signals: [],
      reason: 'no-event-anchor',
    };
  }

  var signals = anchor.anchorSignals.slice();
  // ②-b（Q1-B）人物动态 / 新闻热点：显式归入 B，独立于意图层结论。
  // 仅当已有时间锚点（上方 !anchor.hasAnchor → A 已保护纯哲学问题）且命中专属句式时成立。
  if (PERSON_UPDATE_RE.test(q) || NEWS_RE.test(q)) {
    return {
      category: CATEGORY.B,
      eventAnchor: true,
      eventMention: anchor.eventMention,
      reflectionAim: true,
      confidence: 'high',
      dSignals: [],
      signals: signals.concat(['person-update-or-news']),
      reason: PERSON_UPDATE_RE.test(q) ? 'person-update' : 'news-query',
    };
  }
  // ②-c（联网搜索主入口）：带时间锚点且含「当前事件名词」→ 归 B（高置信），
  //   触发联网检索 + 反思。覆盖「今天有什么X新闻/消息/动态」「最近X怎么样」
  //   「最新进展」等自然问法，解决此前落 C/A 导致永不检索的问题（Q2-14 续）。
  if (CURRENT_EVENT_NOUN_RE.test(q)) {
    return {
      category: CATEGORY.B,
      eventAnchor: true,
      eventMention: anchor.eventMention,
      reflectionAim: true,
      confidence: 'high',
      dSignals: [],
      signals: signals.concat(['current-event-fact']),
      reason: 'current-event-fact-query',
    };
  }
  // ②-e（Q2-20）职业前缀+人名：陈述式人物查询，无"是谁/介绍"等触发词，
  //   但明显是人物事实查询。此前归 A → 不检索 → 五段式空答（如「脱口秀演员房主任」）。
  //   命中即归 B + directFactual，走快速 factual 通道。（isProfPrefix 已在 ①-b 计算）
  if (isProfPrefix) {
    return {
      category: CATEGORY.B,
      eventAnchor: true,
      eventMention: q.slice(0, 120),
      reflectionAim: false,
      confidence: 'medium',
      directFactual: true,
      dSignals: [],
      signals: signals.concat(['profession-prefix-person']),
      reason: 'profession-prefix-person-query',
    };
  }
  // ②-d（Q2-15 / Q2-18 修复）人物身份查询：高幻觉风险，必须归 B 触发联网检索核验。
  //   ⚠️ 优先级必须高于 ③ factOnly 与 ⑤ intentFactual：intent.js 常把"X是谁"
  //     判为 knowledge → intentFactual → 落 C（只做事实边界、不检索），会绕过本规则，
  //     导致人物竟落到 C/A 永不检索（Q2-18 实测：'付航是谁' 6ms 落 C 降级）。
  //     人物身份本身即检索理由，无需时间锚点。
  if (isPersonIdentity) {
    return {
      category: CATEGORY.B,
      eventAnchor: true,   // 人物身份本身作为检索锚点
      eventMention: q.slice(0, 120),
      reflectionAim: false,  // 纯事实查询，非思辨
      confidence: 'medium',  // 无时间锚点，置信度中等
      directFactual: true,   // Q2-19：标记走快速 factual 通道（跳过五段式二次生成）
      dSignals: [],
      signals: signals.concat(['person-identity-search']),
      reason: 'person-identity-requires-verification',
    };
  }
  // 模糊指代检测：只有省略指代（"那件事"）且无任何实质锚点信息的短句
  var vagueRef = q.length <= 20 &&
    (signals.indexOf('event-reference') >= 0 || signals.indexOf('dispute-frame') >= 0) &&
    signals.indexOf('event-noun') < 0 &&
    signals.indexOf('time-anchor') < 0 &&
    signals.indexOf('media-anchor') < 0;

  // ③ 显式事实框架且无显式反思框架 → C（事实句式优先于意图层推断）
  if (factOnly && !reflectionAim) {
    return {
      category: CATEGORY.C,
      eventAnchor: true,
      eventMention: anchor.eventMention,
      reflectionAim: false,
      confidence: 'high',
      dSignals: [],
      signals: signals.concat(['fact-only-frame']),
      reason: 'fact-only-request',
    };
  }

  // ④ 显式反思框架 → B（模糊指代降置信，供上层触发澄清）
  if (reflectionAim) {
    return {
      category: CATEGORY.B,
      eventAnchor: true,
      eventMention: anchor.eventMention,
      reflectionAim: true,
      confidence: vagueRef ? 'low' : 'high',
      dSignals: [],
      signals: signals.concat(['reflection-frame'], vagueRef ? ['vague-reference'] : []),
      reason: vagueRef ? 'event-anchor+reflection-frame+vague' : 'event-anchor+reflection-frame',
    };
  }

  // ⑤ 无显式框架，用既有意图层结论兜底
  if (intentFactual) {
    return {
      category: CATEGORY.C,
      eventAnchor: true,
      eventMention: anchor.eventMention,
      reflectionAim: false,
      confidence: 'medium',
      dSignals: [],
      signals: signals.concat(['intent-knowledge']),
      reason: 'intent-factual-no-reflection',
    };
  }
  if (intentReflective) {
    return {
      category: CATEGORY.B,
      eventAnchor: true,
      eventMention: anchor.eventMention,
      reflectionAim: true,
      confidence: vagueRef ? 'low' : 'medium',
      dSignals: [],
      signals: signals.concat(['intent-reflective'], vagueRef ? ['vague-reference'] : []),
      reason: 'event-anchor+intent-reflective',
    };
  }

  // ⑥ 歧义兜底：B↔C 取 C 的引导姿态（更保守），confidence=low 供上层触发澄清
  //   ⚠️ 人物身份查询例外（Q2-15）：必须归 B 触发联网检索核验，不得落 C（C 只做事实边界
  //   引导不检索）或 A（A 完全不介入、LLM 自由编造学历/履历）。
  return {
    category: CATEGORY.C,
    eventAnchor: true,
    eventMention: anchor.eventMention,
    reflectionAim: false,
    confidence: 'low',
    dSignals: [],
    signals: signals.concat(['ambiguous-fallback']),
    reason: 'ambiguous-conservative-C',
  };
}

// ============================================================
// detectUserIntent(query, intentInfo) — 用户意图层（Q0 §5）
//   返回 { intent, signals, reason }
//   规则：
//     · emotion 永远最高：既有意图层判 emotion / 危机，或本层情绪信号命中。
//     · information：事实确认框架（"是真的吗"）。
//     · reflection：默认（反思框架或均不命中时的回落）。
// ============================================================
function detectUserIntent(query, intentInfo) {
  var q = (query || '').toString();
  var signals = [];

  // emotion 最高优先级（含既有意图层的危机/情绪结论）
  if (intentInfo && intentInfo.crisis) {
    return { intent: USER_INTENT.EMOTION, signals: ['crisis'], reason: 'crisis-override' };
  }
  if ((intentInfo && intentInfo.type === 'emotion') || EMOTION_SIGNAL_RE.test(q)) {
    if (intentInfo && intentInfo.type === 'emotion') signals.push('intent-emotion');
    if (EMOTION_SIGNAL_RE.test(q)) signals.push('emotion-signal');
    return { intent: USER_INTENT.EMOTION, signals: signals, reason: 'emotion-highest' };
  }

  if (INFORMATION_FRAME_RE.test(q)) {
    return { intent: USER_INTENT.INFORMATION, signals: ['information-frame'], reason: 'fact-confirmation' };
  }

  if (REFLECTION_FRAME_RE.test(q)) signals.push('reflection-frame');
  return { intent: USER_INTENT.REFLECTION, signals: signals, reason: 'default-reflection' };
}

module.exports = {
  classifyCategory: classifyCategory,
  detectUserIntent: detectUserIntent,
  detectEventAnchor: detectEventAnchor,
  TIME_ANCHOR_RE: TIME_ANCHOR_RE,
  MEDIA_ANCHOR_RE: MEDIA_ANCHOR_RE,
  EVENT_REFERENCE_RE: EVENT_REFERENCE_RE,
  DISPUTE_RE: DISPUTE_RE,
  REFLECTION_FRAME_RE: REFLECTION_FRAME_RE,
  FACT_ONLY_RE: FACT_ONLY_RE,
  D_TOPIC_RES: D_TOPIC_RES,
  EMOTION_SIGNAL_RE: EMOTION_SIGNAL_RE,
  PERSON_UPDATE_RE: PERSON_UPDATE_RE,
  NEWS_RE: NEWS_RE,
};