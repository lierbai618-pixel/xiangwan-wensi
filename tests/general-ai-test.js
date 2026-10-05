// 通用 AI 助手升级 · 离线测试 harness
// 运行：node weapp/tests/general-ai-test.js
//
// 校验三件事（均离线、无需云环境 / 模型）：
//   1) 意图分类：100 题 + 5 多轮用例，type / knowledgePolicy 命中预期。
//   2) 多轮上下文：追问经 rewriteQuery 重写后仍能正确归类（不丢话题、不被误判成知识咨询）。
//   3) Prompt 装配不变量：skip 类绝不出现「强行引用经典」指令；
//                        情绪 / 危机提示正确注入；上下文窗口 ≤ 20 条。
//
// 说明：回答完成率(>95%) 与 错误引用数(=0) 取决于模型实际生成，须部署后
//       用 model 回归脚本验证；本 harness 保证的是「架构层不强制引用」这一前提。

const path = require("path");
const rag = require(path.join(__dirname, "..", "cloudfunctions", "chat", "rag"));
const dataset = require(path.join(__dirname, "general-ai-test.json"));

function classifyWithContext(c, history) {
  if (history && history.length) {
    const rw = rag.rewriteQuery(c.query, history);
    return rag.classifyIntent(rw.followUp ? rw.retrievalQuery : c.query, history);
  }
  return rag.classifyIntent(c.query);
}

function matchExpect(actual, expect) {
  const fails = [];
  if (expect.type && actual.type !== expect.type) fails.push("type:" + actual.type + "≠" + expect.type);
  if (expect.knowledgePolicy && actual.knowledgePolicy !== expect.knowledgePolicy) fails.push("policy:" + actual.knowledgePolicy + "≠" + expect.knowledgePolicy);
  if (expect.format && actual.format !== expect.format) fails.push("format:" + actual.format + "≠" + expect.format);
  if (expect.domain && actual.domain !== expect.domain) fails.push("domain:" + actual.domain + "≠" + expect.domain);
  return fails;
}

let pass = 0, fail = 0;
const fails = [];

console.log("======================================================");
console.log("通用 AI 助手升级 · 意图分类 / 策略 / Prompt 装配测试");
console.log("======================================================\n");

// ---------- 1. 单轮 100 题 ----------
console.log("--- 单轮意图分类（" + dataset.cases.length + " 题）---");
for (const c of dataset.cases) {
  const r = classifyWithContext(c);
  const f = matchExpect(r, c.expect);
  if (f.length === 0) {
    pass += 1;
  } else {
    fail += 1;
    fails.push("#" + c.id + " [" + c.category + "] " + c.query + " → " + f.join(", "));
    console.log("  ❌ #" + c.id + " " + c.query + "\n     实际: type=" + r.type + " policy=" + r.knowledgePolicy + " fmt=" + r.format + " dom=" + r.domain);
  }
}
console.log("  通过 " + pass + " / 失败 " + fail);

// ---------- 2. 多轮上下文 ----------
console.log("\n--- 多轮上下文承接（" + dataset.multiturn.length + " 例）---");
let mtPass = 0, mtFail = 0;
for (const c of dataset.multiturn) {
  const r = classifyWithContext(c, c.history);
  const f = matchExpect(r, c.expect);
  if (f.length === 0) { mtPass += 1; console.log("  ✅ " + c.id + " " + c.desc); }
  else { mtFail += 1; fails.push(c.id + " " + c.desc + " → " + f.join(", ")); console.log("  ❌ " + c.id + " " + c.desc + " 实际: type=" + r.type + " policy=" + r.knowledgePolicy); }
}

// ---------- 3. Prompt 装配不变量 ----------
console.log("\n--- Prompt 装配不变量 ---");
const invariants = [];
function checkInvariant(name, cond) {
  invariants.push({ name, ok: cond });
  console.log("  " + (cond ? "✅" : "❌") + " " + name);
}

// 3a. skip 类：严禁「可选参考资料」+ 必须声明「不要引用经典」
const skipContent = rag.composeUserContent(
  "Python 怎么读文件", [], "plain", {}, {}, { knowledgePolicy: "skip", domain: "编程" }
);
checkInvariant("skip 类不含「可选参考资料」指令", !/可选参考资料/.test(skipContent));
checkInvariant("skip 类声明「不要引用经典 / 不哲学化」", /不要引用经典/.test(skipContent) && /哲学化/.test(skipContent));

// 3b. use 类（空检索）：必须声明「不要编造」
const useEmpty = rag.composeUserContent(
  "怎么面对失败", [], "plain", {}, {}, { knowledgePolicy: "use", domain: "人生" }
);
checkInvariant("use 类空检索声明「不要编造任何经典引用」", /不要编造/.test(useEmpty));

// 3c. use 类（有资料）：必须声明「可选论证依据 / 不要为了引用而引用」
const useWithCite = rag.composeUserContent(
  "怎么面对失败",
  [{ title: "孟子", section: "告子下", year: "", source: "", text: "天将降大任于斯人也……" }],
  "plain", {}, {}, { knowledgePolicy: "use", domain: "人生" }
);
checkInvariant("use 类有资料声明「可选论证依据」", /论证依据/.test(useWithCite));
checkInvariant("use 类有资料声明「不要为了引用而引用」", /不要为了引用而引用/.test(useWithCite));

// 3d. 危机提示注入
const crisisContent = rag.composeUserContent(
  "我不想活了", [], "plain", {}, {}, { knowledgePolicy: "skip", domain: "情绪", crisis: true }
);
checkInvariant("危机类注入危机提示与热线 12356", /危机提示/.test(crisisContent) && /12356/.test(crisisContent));

// 3e. 情绪提示注入
const emotionContent = rag.composeUserContent(
  "我好焦虑", [], "plain", {}, { emotion: true, emotionLabel: "焦虑" }, { knowledgePolicy: "use", domain: "情绪" }
);
checkInvariant("情绪类注入共情提示", /情绪提示/.test(emotionContent));

// 3f. 上下文窗口 ≤ 20 条（10 轮）
const longHistory = [];
for (let i = 0; i < 30; i += 1) longHistory.push({ role: i % 2 ? "assistant" : "user", content: "历史消息 " + i });
const prior = rag.buildPriorMessages(longHistory);
checkInvariant("上下文窗口 ≤ 20 条（实际 " + prior.length + "）", prior.length <= 20);

// ---------- 汇总 ----------
const invOk = invariants.filter((x) => x.ok).length;
const total = pass + fail + (invariants.length - invOk) + (mtFail);
const totalOk = pass + mtPass + invOk;
console.log("\n======================================================");
console.log("单轮分类  : " + pass + "/" + dataset.cases.length + " 通过");
console.log("多轮上下文: " + mtPass + "/" + dataset.multiturn.length + " 通过");
console.log("装配不变量: " + invOk + "/" + invariants.length + " 通过");
console.log("------------------------------------------------------");
console.log("合计      : " + totalOk + "/" + (pass + fail + dataset.multiturn.length + invariants.length) + " 通过");
if (fails.length) {
  console.log("\n失败明细：");
  fails.forEach((f) => console.log("  · " + f));
}
console.log("======================================================");
process.exit(fail === 0 && mtFail === 0 && invOk === invariants.length ? 0 : 1);
