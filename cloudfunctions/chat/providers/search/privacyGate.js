// ============================================================
// providers/search/privacyGate.js
//   Phase Q2-4-D：真实 Search Provider 上线前的「隐私边界与数据出口控制层」。
//
//   定位：位于检索层最前端（canaryGate 之前），判断用户输入是否允许进入
//         外部 Search Provider。默认关闭（零影响），开启后 fail-closed。
//
//   统一输出结构：
//     { allowed:true/false, reason:"", sanitizedQuery:"" }
//       · allowed:false  → 高风险 PII，禁止出境（reason="pii_blocked"）
//       · allowed:true   → 可出境；sanitizedQuery 为脱敏后的最小出境 query
//                          （无 PII 时等于原 query）
//
//   风险分级（最小集合）：
//     高风险（硬阻断）：手机号 / 身份证 / 邮箱 / 银行卡 / 显式 PII 自述 /
//                      完整住址（含街道级细节或显式地址关键词）
//     软 PII（脱敏后放行）：个人语境下的城市/区域提及（如「在上海做…」）
//
//   核心原则：
//     1. 默认安全 —— PRIVACY_GATE_ENABLED 默认 false，关闭时原样放行，
//        不影响任何既有 mock / RAG 行为。
//     2. fail-closed —— 检测器任何异常一律视为阻断（宁可不检索，也不泄露）。
//     3. 最小数据出境 —— 通过时仅把 sanitize 后的 query 交给下游 provider。
//     4. 不记录隐私 —— 本模块为纯函数，绝不保存 query / openid / 个人信息；
//        sanitizedQuery 仅用于本次请求出境，不落库、不入审计、不写日志。
//
//   Node 16.13 兼容（无可选链 / 无空值合并 / 无模板字面量）。
// ============================================================
'use strict';

// ---------- 高风险 PII 正则（最小集合） ----------
// 手机号（含 +86 / 空格 / 横线前缀）
var RE_PHONE = /(?:\+?86[-\s]?)?1[3-9]\d{9}/;
// 身份证（18 位含 X，或 15 位）
var RE_ID = /\b\d{17}[\dXx]\b|\b\d{15}\b/;
// 邮箱
var RE_EMAIL = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
// 显式 PII 自述（用户主动披露身份信息的意图）
var RE_EXPLICIT = /我的(手机号|手机|电话|身份证(号)?|银行卡(号)?|住址|家庭住址|地址|邮箱|电子邮箱|email|微信|工资|月收入|收入|护照|社保)\b/i;

// 省级行政区 + 主要城市（地理实体识别）
var PROVINCES = ['内蒙古', '黑龙江', '河北', '山西', '辽宁', '吉林', '江苏', '浙江', '安徽',
  '福建', '江西', '山东', '河南', '湖北', '湖南', '广东', '广西', '海南', '四川', '贵州',
  '云南', '西藏', '陕西', '甘肃', '青海', '宁夏', '新疆', '北京', '天津', '上海', '重庆',
  '香港', '澳门', '台湾'];
var CITIES = ['广州', '深圳', '杭州', '南京', '成都', '武汉', '西安', '苏州', '郑州', '长沙',
  '青岛', '沈阳', '大连', '厦门', '宁波', '无锡', '福州', '济南', '合肥', '南昌', '昆明',
  '贵阳', '南宁', '兰州', '太原', '石家庄', '哈尔滨', '长春', '常州', '佛山', '东莞', '珠海',
  '中山', '嘉兴', '绍兴', '温州', '金华', '泉州', '南通', '徐州', '唐山', '烟台', '潍坊',
  '洛阳', '包头', '呼和浩特', '银川', '西宁', '乌鲁木齐', '拉萨', '海口', '三亚', '桂林'];
// 街道级地理细粒度词（与省/市同现 ⇒ 视为完整住址，硬阻断）
var GEO_DETAIL = ['路', '街', '道', '巷', '弄', '号', '栋', '幢', '单元', '室', '楼', '大厦',
  '广场', '小区', '公寓', '花园', '苑', '庄', '村', '组', '里', '门牌', '层', '区', '县', '镇', '乡', '街道'];
// 显式地址关键词（命中即硬阻断）
var ADDR_KEYWORDS = ['我家', '住址', '家庭住址', '户籍', '居住地', '通信地址', '联系地址',
  '现居', '住在', '住于', '租住', '户籍地'];

// 个人语境下的省/市脱敏正则（前面可带 在/于/从/到，城市后可带 市/区/县/省，
// 后面跟个人语境词/标点/结尾才脱敏，避免误伤「上海美食」这类话题查询）
var GEO_TOKENS = PROVINCES.concat(CITIES).sort(function (a, b) { return b.length - a.length; });
var GEO_RE = new RegExp('(在|于|从|到)?(' + GEO_TOKENS.join('|') +
  ')(市|区|县|省)?(?=(做|住|工|生|的|读|，|,|。|；|;|\\s|$))', 'g');

// ---------- 配置 ----------
function envTrue(name, dflt) {
  var v = process.env[name];
  if (v === undefined || v === null || v === '') return dflt;
  return ('' + v).toLowerCase() === 'true';
}

function privacyEnabled(cfg) {
  if (cfg && typeof cfg.enabled === 'boolean') return cfg.enabled;
  return envTrue('PRIVACY_GATE_ENABLED', false); // 默认关闭（零影响）
}

// 银行卡：16-19 位纯数字，排除身份证（18/15 位）
function findBankCard(q) {
  var runs = q.match(/\d{16,19}/g) || [];
  for (var i = 0; i < runs.length; i++) {
    if (RE_ID.test(runs[i])) continue; // 命中身份证则跳过
    return runs[i];
  }
  return null;
}

// 高风险地址（应硬阻断）：显式地址关键词 或 省/市 + 街道级细节
function hasHighRiskAddress(q) {
  for (var i = 0; i < ADDR_KEYWORDS.length; i++) {
    if (q.indexOf(ADDR_KEYWORDS[i]) !== -1) return true;
  }
  var hasGeo = false;
  var p, c, g;
  for (p = 0; p < PROVINCES.length; p++) { if (q.indexOf(PROVINCES[p]) !== -1) { hasGeo = true; break; } }
  if (!hasGeo) {
    for (c = 0; c < CITIES.length; c++) { if (q.indexOf(CITIES[c]) !== -1) { hasGeo = true; break; } }
  }
  if (hasGeo) {
    for (g = 0; g < GEO_DETAIL.length; g++) {
      if (q.indexOf(GEO_DETAIL[g]) !== -1) return true;
    }
  }
  return false;
}

// 脱敏：去除软 PII，保留问题语义与用户意图
function sanitize(q) {
  var s = q;
  s = s.replace(RE_EXPLICIT, '');          // 显式 PII 关键词
  s = s.replace(RE_PHONE, '');             // 手机号
  s = s.replace(RE_ID, '');                // 身份证
  s = s.replace(/\d{16,19}/g, '');         // 银行卡（已排除身份证）
  s = s.replace(GEO_RE, '');               // 个人语境下的城市/区域
  s = s.replace(/我(?!们)/g, '');          // 第一人称（最小出境）
  s = s.replace(/\s+/g, ' ');
  s = s.replace(/，+/g, '，').replace(/、+/g, '、').replace(/。+/g, '。');
  s = s.replace(/^[\s，、。,.;;]+|[\s，、。,.;;]+$/g, '');
  return s.trim();
}

function blocked() {
  // 高风险统一 reason=pii_blocked；sanitizedQuery 留空（不向下游泄露任何内容）
  return { allowed: false, reason: 'pii_blocked', sanitizedQuery: '' };
}

// ============================================================
// resolve(query, cfg) → { allowed, reason, sanitizedQuery }
//   cfg.enabled  可注入（离线测试）；否则读 PRIVACY_GATE_ENABLED。
// ============================================================
function resolve(query, cfg) {
  cfg = cfg || {};
  var q = (query || '').toString();

  // 闸门关闭：零影响，原样放行（维持既有 mock / RAG 行为）
  if (!privacyEnabled(cfg)) {
    return { allowed: true, reason: '', sanitizedQuery: q };
  }

  // ---- 高风险硬阻断 ----
  if (RE_PHONE.test(q)) return blocked();
  if (RE_ID.test(q)) return blocked();
  if (RE_EMAIL.test(q)) return blocked();
  if (findBankCard(q)) return blocked();
  if (RE_EXPLICIT.test(q)) return blocked();
  if (hasHighRiskAddress(q)) return blocked();

  // ---- 可脱敏：仅当确有 PII 才改造 query，否则原样放行 ----
  try {
    var sanitized = sanitize(q);
    if (sanitized === q) {
      return { allowed: true, reason: '', sanitizedQuery: q };
    }
    return { allowed: true, reason: 'sanitized', sanitizedQuery: sanitized };
  } catch (e) {
    // fail-closed：脱敏异常也视为阻断，绝不冒险出境
    return blocked();
  }
}

module.exports = {
  resolve: resolve,
  privacyEnabled: privacyEnabled,
  // 测试/审阅导出
  _sanitize: sanitize,
  _hasHighRiskAddress: hasHighRiskAddress,
  _findBankCard: findBankCard,
};
