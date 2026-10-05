// security/inputGuard.js
// Rule-based Injection Guard v1 —— 纯函数，无网络 / 无 LLM / 无依赖。
// 定位：仅拦截明显「指令覆盖 / 越狱 / 角色劫持」模式；非完整 Prompt Injection 防御。
// 设计纪律（CR-002）：模式以「指令性动词 + 系统/限制语境」组合为主，避免误杀正常哲学提问。
'use strict';

// 每条 pattern 为不区分大小写的正则（英文）/ 中文字面组合；命中即 block。
// 仅在用户 query 进入 generateAnswer 之前调用。
const PATTERNS = [
  // 中文：忽略 / 忘记 / 无视 + 指令 / 系统 / 限制 / 设定
  /忽略\s*(之前|先前|以上|所有)?\s*(所有)?\s*(的)?\s*(指令|指示|系统|设定|提示|规则|约束|限制)/,
  /忘记\s*(之前|先前|以上|所有)?\s*(的)?\s*(指令|系统|设定|限制|规则)/,
  /无视\s*(之前|先前|以上|所有|任何)?\s*(的)?\s*(指令|限制|规则|约束|设定)/,
  // 角色劫持 / 无限制：要求「没有/无/不受」紧邻「限制/审查」等，避免误伤「如何突破思维限制」
  /(你|你现在|现在你)\s*(是|扮演|成为|作为一个?)?\s*(没有|无|不受)\s*(限制|审查|约束|过滤)/,
  /(无限制|无约束|无审查)\s*(的)?\s*(ai|助手|模式|角色|模型)/i,
  // 英文
  /ignore\s+(previous|all|prior|above)\s+(instructions|prompts?|system)/i,
  /forget\s+(your|all|previous)\s+(instructions|system|rules|prompt)/i,
  /(system\s*prompt|system\s*message)/i,
  /\bDAN\b/i,
  /jailbreak/i,
  /roleplay\s+as\s+(an?\s+)?(unrestricted|uncensored|unfiltered|limitless)\b/i,
  /(act\s+as|you\s+are)\s+(an?\s+)?(unrestricted|uncensored|unfiltered)\b/i,
];

/**
 * 检测输入是否包含明显指令注入 / 越狱模式。
 * @param {string} message 用户原始输入
 * @returns {{block: boolean, reason: string}}
 */
function detect(message) {
  const text = (message || "").toString();
  if (!text) return { block: false, reason: "" };
  for (let i = 0; i < PATTERNS.length; i++) {
    if (PATTERNS[i].test(text)) {
      return { block: true, reason: "injection_pattern_" + i };
    }
  }
  return { block: false, reason: "" };
}

module.exports = { detect, PATTERNS };
