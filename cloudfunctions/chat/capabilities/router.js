// ============================================================
// Capability Layer — router.js（能力路由）
//   Phase R：实时工具能力识别。
//
//   职责：判断用户问题是否属于「现实工具诉求」，命中则绕过 RAG。
//   识别四类：
//     time_query        现在几点 / 今天几号 / 星期几
//     weather_query     今天天气 / 会不会下雨
//     calculation_query 算术计算
//     location_query    我在哪 / 附近
//
//   核心设计原则（三条，冲突时按序裁决）：
//     ① 能力层不是知识层：本模块零知识库依赖，不读 corpus.json，
//        不做 embedding，不影响 RAG 任何行为。
//     ② 宁可漏判，不可错判：哲学化表达一票否决（veto），
//        "时间的意义是什么" 必须回到 RAG，绝不被工具层劫持。
//     ③ 危机优先：危机信号出现时能力层完全退出，交既有危机链路。
//
//   纯函数、零云依赖、可离线单测。
// ============================================================
'use strict';

var CAPABILITY = {
  TIME: 'time_query',
  WEATHER: 'weather_query',
  CALCULATION: 'calculation_query',
  LOCATION: 'location_query',
};

// ------------------------------------------------------------
// ① 硬否决层（hard veto）：工具词被**哲学化使用**时，工具层不介入。
//    判断标准不是"有没有情绪"，而是"用户要的到底是不是一个事实"。
//    "时间的意义是什么" —— 要的是思考，工具层退出。
//    这是「向晚问思不是工具人」的护栏，优先级高于所有命中规则。
// ------------------------------------------------------------
var VETO_RES = [
  // 追问意义 / 本质 / 价值
  { key: 'veto-meaning', re: /(意义|本质|价值|真谛|究竟是什么|到底是什么|哲学)/u },
  // 追问看法 / 态度
  { key: 'veto-opinion', re: /(如何看待|怎么看待|怎么理解|你怎么看|有什么启示|说明了什么)/u },
  // 时间的隐喻用法："时间过得好快""光阴都去哪了""时间不够用"
  { key: 'veto-metaphor', re: /(过得(好|真|太)?快|流逝|都去哪|不够用|虚度|荒废|珍惜|来不及|回不去)/u },
  // 人生规划语境："怎么管理时间""如何安排时间"→ 属于人生建议，走 RAG
  { key: 'veto-lifeadvice', re: /(如何|怎么|怎样|该不该|要不要).{0,6}(管理|安排|利用|规划|分配|把握).{0,4}(时间|人生|生活)/u },
];

// ------------------------------------------------------------
// ①' 软信号层（soft signal）：情绪。
//    关键设计判断：情绪**不否决**事实诉求。
//    "我好焦虑，现在几点了" —— 时间问题是真的，必须答；
//    若因情绪把它推回 RAG，用户既拿不到时间、又会被自曝"无法联网"，
//    等于原缺陷复发。正确做法是：照常给事实，但改变收尾的语气。
//    情绪影响的是「怎么说」，不是「答不答」。
// ------------------------------------------------------------
var EMOTION_RE = /(焦虑|难过|痛苦|绝望|迷茫|崩溃|孤独|空虚|烦躁|委屈|睡不着|失眠|哭|撑不住|好累)/u;

// 危机信号：能力层完全退出（与既有危机链路不争抢）
var CRISIS_RE = /(自杀|自残|不想活|活不下去|轻生|结束生命)/u;

// ------------------------------------------------------------
// ② 命中层：各能力的强触发式
//    要求「明确的现实事实诉求」，不做模糊外扩。
// ------------------------------------------------------------

// —— time_query ——
var TIME_RES = [
  { sub: 'time', re: /(现在|此刻|当前|目前|这会儿|眼下).{0,3}(几点|什么时间|时间是多少|时刻)/u },
  { sub: 'time', re: /^\s*几点(钟)?了?\s*[?？。!！]*\s*$/u },
  // R-001 补丁①：覆盖「北京时间」系列裸表达（现在北京时间 / 北京时间 / 北京时间几点）。
  //   末位分支使用 ^...$ 全串锚定：只接纳"（现在）北京时间"这类纯询问，
  //   "北京时间和纽约时间差几小时"这类知识问句因带后续文本而不匹配，避免误吃。
  { sub: 'time', re: /(几点了|现在时间|当前时间|报下时间|报个时间|现在是几点|北京时间是?多少|北京时间\s*(现在)?\s*几点|^\s*(现在|此刻|当前|目前|请问)?\s*北京时间\s*[?？。!！]*$)/u },
  // R-001 补丁②：date 锚点补「这个月/本月/这月」，宾语补裸词「日期」（今天日期 / 这个月几号）。
  { sub: 'date', re: /(今天|今日|现在|当前|这个月|本月|这月).{0,3}(几号|几月几号|几月几日|多少号|什么日期|日期是|日期)/u },
  { sub: 'date', re: /^\s*(今天|今日)?\s*(几号|多少号)\s*[?？。!！]*\s*$/u },
  { sub: 'date', re: /(今天是|今日是).{0,4}(几号|多少号|什么日子|哪一天)/u },
  { sub: 'weekday', re: /(今天|今日|现在).{0,3}(星期几|周几|礼拜几)/u },
  { sub: 'weekday', re: /^\s*(星期几|周几|礼拜几)\s*[?？。!！]*\s*$/u },
  // 相对日期（可由系统时间精确推算，不属于编造）
  { sub: 'relative', re: /(明天|后天|大后天|昨天|前天).{0,3}(几号|多少号|星期几|周几|礼拜几|是哪天|什么日子)/u },
  { sub: 'year', re: /(今年|现在).{0,3}(是哪一年|哪年|多少年|是\d{0,4}年吗)/u },
];

// —— weather_query ——
var WEATHER_RES = [
  // R-001 补丁③：口语「冷吗/热吗」与「冷不冷/热不热」同权。
  //   有意收窄间隔为 .{0,2}：避免"今天的人心冷吗"这类隐喻句被天气层吃掉。
  { sub: 'today', re: /(今天|现在|外面|外头)(.{0,4}(天气|气温|温度|冷不冷|热不热|下雨|下雪|要下雨)|.{0,2}(冷吗|热吗))/u },
  { sub: 'forecast', re: /(明天|后天|这周|周末|未来几天).{0,4}(天气|气温|温度|下雨|下雪)/u },
  { sub: 'today', re: /(天气怎么样|天气如何|天气好吗|要带伞吗|需要带伞|会下雨吗|会下雪吗|多少度)/u },
];

// —— calculation_query ——
// 触发要求：出现「数字 + 运算符」或「数字 + 中文运算词」或「计算指令 + 数字」
var CALC_SYMBOL_RE = /\d\s*[+\-*/×÷^]\s*\d/u;
var CALC_CN_OP_RE = /\d[\d.,]*\s*(加上|加|减去|减|乘以|乘|除以|的平方|的立方|次方)/u;
var CALC_CMD_RE = /(算一下|算一算|计算一下|计算|等于多少|等于几|得多少|是多少|求和|开方|平方根|百分之)/u;
var CALC_HAS_NUM_RE = /\d/u;
// 明显不是算术的数字语境（年份/日期/时刻/编号）
var CALC_NOISE_RE = /(\d+\s*年|\d+\s*月\s*\d+|\d+\s*号|\d+\s*点\d*分?|第\s*\d+|\d+\s*岁)/u;

// —— location_query ——
var LOCATION_RES = [
  { sub: 'self', re: /(我在哪|我现在在哪|这是哪儿?|这里是哪儿?|我的位置|当前位置|定位一下)/u },
  { sub: 'nearby', re: /(附近有什么|附近的|周边有什么|离我多远|怎么去)/u },
];

function firstMatch(list, q) {
  for (var i = 0; i < list.length; i++) {
    if (list[i].re.test(q)) return list[i];
  }
  return null;
}

function collectVeto(q) {
  var hits = [];
  for (var i = 0; i < VETO_RES.length; i++) {
    if (VETO_RES[i].re.test(q)) hits.push(VETO_RES[i].key);
  }
  return hits;
}

// ------------------------------------------------------------
// route(query, opts)
//   opts: { intentInfo }  —— 只读消费冻结 intent.js 的结论，不复制其逻辑
//   返回：
//     { hit:false, reason, vetoSignals }        → 不介入，调用方继续原链路
//     { hit:true, capability, subType,
//       confidence, signals, vetoSignals:[] }   → 命中，绕过 RAG
// ------------------------------------------------------------
function route(query, opts) {
  opts = opts || {};
  var q = (query || '').toString().trim();
  if (!q) return { hit: false, reason: 'empty-query', vetoSignals: [] };

  // 危机一票退出（能力层永不与危机链路争抢）
  if (CRISIS_RE.test(q) || (opts.intentInfo && opts.intentInfo.crisis)) {
    return { hit: false, reason: 'crisis-yield', vetoSignals: ['crisis'] };
  }

  // 硬否决层：工具词被哲学化使用 → 回到 RAG
  var veto = collectVeto(q);
  if (veto.length > 0) {
    return { hit: false, reason: 'philosophical-veto:' + veto.join('+'), vetoSignals: veto };
  }

  // 软信号：情绪并存（不否决事实，只影响回应语气）
  var emotional = EMOTION_RE.test(q);

  // time
  var t = firstMatch(TIME_RES, q);
  if (t) {
    return {
      hit: true,
      capability: CAPABILITY.TIME,
      subType: t.sub,
      confidence: 'high',
      signals: ['time-pattern:' + t.sub].concat(emotional ? ['emotional-context'] : []),
      emotional: emotional,
      vetoSignals: [],
    };
  }

  // weather
  var w = firstMatch(WEATHER_RES, q);
  if (w) {
    return {
      hit: true,
      capability: CAPABILITY.WEATHER,
      subType: w.sub,
      confidence: 'high',
      signals: ['weather-pattern:' + w.sub].concat(emotional ? ['emotional-context'] : []),
      emotional: emotional,
      vetoSignals: [],
    };
  }

  // calculation
  if (CALC_HAS_NUM_RE.test(q)) {
    var symbolHit = CALC_SYMBOL_RE.test(q);
    var cnOpHit = CALC_CN_OP_RE.test(q);
    var cmdHit = CALC_CMD_RE.test(q);
    var noise = CALC_NOISE_RE.test(q);
    // 符号式最可靠；中文运算词次之；纯"计算指令+数字"需无日期噪声
    if (symbolHit || cnOpHit || (cmdHit && !noise)) {
      var conf = symbolHit ? 'high' : cnOpHit ? 'high' : 'medium';
      var sig = [];
      if (symbolHit) sig.push('calc-symbol');
      if (cnOpHit) sig.push('calc-cn-op');
      if (cmdHit) sig.push('calc-command');
      return {
        hit: true,
        capability: CAPABILITY.CALCULATION,
        subType: 'arithmetic',
        confidence: conf,
        signals: sig.concat(emotional ? ['emotional-context'] : []),
        emotional: emotional,
        vetoSignals: [],
      };
    }
  }

  // location
  var l = firstMatch(LOCATION_RES, q);
  if (l) {
    return {
      hit: true,
      capability: CAPABILITY.LOCATION,
      subType: l.sub,
      confidence: 'high',
      signals: ['location-pattern:' + l.sub].concat(emotional ? ['emotional-context'] : []),
      emotional: emotional,
      vetoSignals: [],
    };
  }

  return { hit: false, reason: 'no-capability-signal', vetoSignals: [] };
}

module.exports = {
  route: route,
  CAPABILITY: CAPABILITY,
  // 供测试与审计使用（只读导出）
  _internal: {
    VETO_RES: VETO_RES,
    EMOTION_RE: EMOTION_RE,
    TIME_RES: TIME_RES,
    WEATHER_RES: WEATHER_RES,
    LOCATION_RES: LOCATION_RES,
    CRISIS_RE: CRISIS_RE,
  },
};
