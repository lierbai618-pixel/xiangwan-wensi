// ============================================================
// freshnessRuntimeGuard.js
//   Phase Q2-6：Freshness Runtime Context 隔离检查
//
//   目标（用户授权条款）：让向晚问思支持联网搜索，但**严格保持知识库冻结**。
//     · 搜索结果只能作为「本次请求的 runtime context」。
//     · 禁止 ingest / embedding / 写入知识库 / 更新 metadata / 生成长期缓存知识。
//
//   本模块是「隔离不变量」的可调用校验器，供离线测试与（可选的）运行时自检使用。
//   它不修改任何冻结资产，也不触网、不依赖云环境。
//
//   校验维度：
//     1) 标记不变量：search→fact→ThinkContext→answer.meta 链路上，所有「应 ephemeral」
//        的容器必须带 `_ephemeral=true` 硬标记（任何序列化/落库逻辑都应拒绝它）。
//     2) 泄露扫描：对最终返回给调用方的 result，递归扫描是否含有「疑似知识沉淀结构」
//        （corpus / embedding / ingest / kbWrite / persistFact / longTermCache …）且未标 ephemeral。
//     3) 审计白名单：search.audit 仅允许 7 个安全字段，且绝不含 URL / 用户原文 / 完整结果。
//
//   Node 16.13 兼容（无可选链 / 无空值合并）。
// ============================================================
'use strict';

// 请求级 ephemeral 硬标记键
var MARKER = '_ephemeral';

// search.audit 允许的 7 个安全字段白名单（见 providers/search/index.js _audit）
var AUDIT_SAFE_KEYS = [
  'provider', 'latency_ms', 'cache_hit', 'downgrade_reason',
  'quota_remaining', 'canary_blocked', 'data_route',
];

// 疑似「知识沉淀/长期缓存」写入结构键（命中且未标 ephemeral → 视为隔离违规）
var SUSPECT_KB_KEYS = [
  'corpus', 'embedding', 'ingest', 'kbWrite', 'saveKnowledge',
  'writeCorpus', 'persistFact', 'metadataWrite', 'longTermCache', 'upsertFact',
];

function isEphemeral(obj) {
  return !!obj && typeof obj === 'object' && obj[MARKER] === true;
}

// ------------------------------------------------------------
// 递归泄露扫描：在 result 形状中找出任何未标 ephemeral 的疑似 KB 写入结构。
// 返回泄露路径数组（空 = 通过）。
// ------------------------------------------------------------
function scanLeak(node, path, found) {
  if (node === null || node === undefined || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (var i = 0; i < node.length; i++) scanLeak(node[i], path + '[' + i + ']', found);
    return;
  }
  // 命中疑似知识沉淀键且未标 ephemeral → 泄露
  for (var k = 0; k < SUSPECT_KB_KEYS.length; k++) {
    var key = SUSPECT_KB_KEYS[k];
    if (Object.prototype.hasOwnProperty.call(node, key) && node[MARKER] !== true) {
      found.push(path + '.' + key);
    }
  }
  // 观测元信息中的 context 必须 ephemeral（否则可能被误当知识沉淀）
  if (node.think && node.think.context && node.think.context[MARKER] !== true) {
    found.push(path + '.think.context');
  }
  var keys = Object.keys(node);
  for (var j = 0; j < keys.length; j++) {
    var v = node[keys[j]];
    if (v && typeof v === 'object') scanLeak(v, path + '.' + keys[j], found);
  }
}

// ------------------------------------------------------------
// 校验 search.audit：字段白名单 + 不含 URL/长原文。
// 返回 { ok, issues[] }。
// ------------------------------------------------------------
function verifyAudit(audit) {
  var issues = [];
  if (!audit || typeof audit !== 'object') return { ok: true, issues: issues };
  var keys = Object.keys(audit);
  for (var i = 0; i < keys.length; i++) {
    if (AUDIT_SAFE_KEYS.indexOf(keys[i]) < 0) issues.push('unexpected_audit_key:' + keys[i]);
  }
  // 审计绝不应含 http(s) 链接（会泄露来源 url）、不应含明显长原文
  var s = JSON.stringify(audit);
  if (/https?:\/\//i.test(s)) issues.push('audit_contains_url');
  if (s.length > 512) issues.push('audit_too_large'); // 安全审计只应含极短元数据
  return { ok: issues.length === 0, issues: issues };
}

// ------------------------------------------------------------
// 校验最终返回给调用方的 result：
//   · 无未标 ephemeral 的疑似 KB 写入结构
//   · 若携带 searchAudit，须满足审计白名单
// 返回 { ok, leaks[], auditIssues[] }。
// ------------------------------------------------------------
function verifyAnswerResult(result) {
  var leaks = [];
  scanLeak(result, 'result', leaks);
  var audit = result && result.think && result.think.searchAudit;
  var auditIssues = audit ? verifyAudit(audit).issues : [];
  return { ok: leaks.length === 0 && auditIssues.length === 0, leaks: leaks, auditIssues: auditIssues };
}

// ------------------------------------------------------------
// 校验「应 ephemeral」的容器链：raw results / fact / ThinkContext / answer.meta。
// chain: 任意一组对象（数组元素会被跳过；只校验非数组容器）。
// 返回 { ok, bad[] }。
// ------------------------------------------------------------
function verifyChain(chain) {
  var bad = [];
  (chain || []).forEach(function (node, i) {
    if (node && typeof node === 'object' && !Array.isArray(node) && node[MARKER] !== true) {
      bad.push('node#' + i);
    }
  });
  return { ok: bad.length === 0, bad: bad };
}

// ------------------------------------------------------------
// 汇总报告：一次性给出隔离不变量自检结论（供测试与 CI 消费）。
// ------------------------------------------------------------
function makeIsolationReport(result) {
  var vr = verifyAnswerResult(result);
  return {
    ok: vr.ok,
    leaks: vr.leaks,
    auditIssues: vr.auditIssues,
    checks: {
      no_kb_write_leak: vr.leaks.length === 0,
      audit_whitelist: vr.auditIssues.length === 0,
    },
  };
}

module.exports = {
  MARKER: MARKER,
  AUDIT_SAFE_KEYS: AUDIT_SAFE_KEYS,
  SUSPECT_KB_KEYS: SUSPECT_KB_KEYS,
  isEphemeral: isEphemeral,
  verifyAudit: verifyAudit,
  verifyAnswerResult: verifyAnswerResult,
  verifyChain: verifyChain,
  makeIsolationReport: makeIsolationReport,
};
