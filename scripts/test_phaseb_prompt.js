// Phase B 校验：结构化 rolePrompt 是否符合产品宪法。
// 纯 Node，无需云凭证。运行：node scripts/test_phaseb_prompt.js
const path = require("path");
const rag = require(path.join(__dirname, "..", "cloudfunctions", "chat", "rag.js"));

let pass = 0;
let fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name); }
}

console.log("=== Phase B: rolePrompt 结构校验 ===");

const built = rag.buildRolePrompt();
const R = rag.ROLE_PROMPT;

// 1. section 均存在且非空
//    2026-09-21 CR-删除理解与建议段落：outputContract 已作为死代码移除，
//    故从本清单去掉；生产 prompt 的输出结构由 OUTPUT_FORMATS[*].contract 决定。
["system", "identity", "mission", "workflow", "safety"].forEach((k) => {
  ok("section 存在: " + k, typeof R[k] === "string" && R[k].trim().length > 0);
});

// 2. 组装文本包含六段标识
ok("组装文本含 system 约束", built.includes("最高约束"));
ok("组装文本含 identity", built.includes("思辨助手"));
ok("组装文本含 mission", built.includes("陪用户一起思考"));
ok("组装文本含 workflow 六步", built.includes("理解问题") && built.includes("开放问题"));
ok("组装文本含 safety 引用纪律", built.includes("不得凭空生成名言"));
// 原断言为 built 含【理解】/【思考】—— 但 buildRolePrompt() 从不消费 outputContract，
// 该断言自始不成立（已实测：本文件在本次改动前即为 16 通过 / 6 失败）。
// 2026-09-21 改为断言真实生产路径：无 intentInfo 时回退 general，其分段含【分析】。
ok("组装文本含实际分段结构（fmt.contract 已接入）", built.includes("【分析】"));

// 3. 产品宪法硬性约束落地
ok("危机最高优先级", built.includes("危机最高优先级") && built.includes("12356"));
ok("AI 不承担责任", built.includes("AI 不承担责任") && built.includes("不提供人生最终答案"));
ok("产品边界(非心理治疗/非灌输)", built.includes("不提供心理诊断") && built.includes("不做思想灌输"));
ok("原文/解读分离", built.includes("经典原文") && built.includes("AI 解读") && built.includes("不得伪装成原文"));
ok("无唯一答案", built.includes("不输出唯一正确答案"));

// 4. 内容无关性（不得残留旧人设）
ok("不含旧人设姓名", !built.includes("毛泽东"));
ok("不含旧称呼规则(同志)", !built.includes("同志"));
ok("不含旧著作引用(实践论/矛盾论)", !built.includes("实践论") && !built.includes("矛盾论"));

// 5. 兼容性导出
ok("导出 buildRolePrompt", typeof rag.buildRolePrompt === "function");
ok("导出 rolePrompt 字符串", typeof rag.rolePrompt === "string" && rag.rolePrompt.length > 0);

console.log("\n=== 结果: " + pass + " 通过, " + fail + " 失败 ===");
process.exit(fail ? 1 : 0);
