// security/piiScrub.js
// 日志脱敏工具 —— 纯函数，无网络 / 无依赖。
// 仅用于落库前脱敏，不改变用户实际回答。覆盖：手机号 / 邮箱 / 身份证 / 微信号 / 银行卡 / apikey-token。
'use strict';

// 顺序：先长后短，避免部分匹配导致漏脱敏。
// wechat 仅在「微信号:/wxid:/wechat」上下文后匹配 ID，避免误伤普通英文词。
// token 仅在「api_key=/token:」等键值语境匹配，避免误伤普通文本。
const RULES = [
  { name: "idcard", re: /\b\d{17}[\dXx]\b/g, group: 0 },
  { name: "phone", re: /\b1[3-9]\d{9}\b/g, group: 0 },
  { name: "bankcard", re: /\b\d{15,19}\b/g, group: 0 },
  { name: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, group: 0 },
  { name: "wechat", re: /(微信号|wxid|wechat)\s*[:：]?\s*([A-Za-z][A-Za-z0-9_-]{5,19})/gi, group: 2 },
  { name: "token", re: /(api[_-]?key|token|secret|access[_-]?token)\s*[:=]\s*["']?[A-Za-z0-9\-_.]{8,}/gi, group: 0 },
];

/**
 * 对文本做 PII 脱敏（仅替换，不改动结构）。
 * @param {string} text 待脱敏文本
 * @returns {string} 脱敏后文本
 */
function mask(text) {
  if (!text) return text;
  let s = String(text);
  for (const r of RULES) {
    if (r.group && r.group > 0) {
      s = s.replace(r.re, (m, ...args) => {
        const captured = args[r.group - 1];
        return captured ? m.replace(captured, "***") : "***";
      });
    } else {
      s = s.replace(r.re, "***");
    }
  }
  return s;
}

module.exports = { mask, RULES };
