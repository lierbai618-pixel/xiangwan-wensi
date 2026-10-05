// Phase H 在线质量验收 · 100 题 runner
// 运行：node weapp/tests/online-quality-run.js
//
// 复用既有 rag.js（intent.js 的 classifyIntent / composeUserContent / rewriteQuery / buildPriorMessages）
// 在离线环境校验 Phase H 100 题的意图分类、知识增强策略与不强行引用经典的不变量。
// 调用真实 chat 接口（LLM 生成）需先部署 chat 云函数（见报告文档说明）。

const path = require("path");
const rag = require(path.join(__dirname, "..", "cloudfunctions", "chat", "rag"));
const dataset = require(path.join(__dirname, "online-quality-test.json"));

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
  return fails;
}

let pass = 0, fail = 0;
const fails = [];

console.log("======================================================");
console.log("Phase H 在线质量验收 · 100 题意图分类 / 策略 / 装配不变量");
console.log("======================================================\n");

console.log("--- 单轮意图分类（" + dataset.cases.length + " 题）---");
for (const c of dataset.cases) {
  const r = classifyWithContext(c);
  const f = matchExpect(r, c.expect);
  if (f.length === 0) {
    pass += 1;
  } else {
    fail += 1;
    fails.push("#" + c.id + " [" + c.category + "] " + c.query + " → " + f.join(", "));
  }
}
console.log("  通过 " + pass + " / 失败 " + fail);

console.log("\n--- Prompt 装配不变量 ---");
const invariants = [];
function checkInvariant(name, cond) {
  invariants.push({ name, ok: cond });
  console.log("  " + (cond ? "✅" : "❌") + " " + name);
}
const skipContent = rag.composeUserContent(
  "Python 怎么读文件", [], "plain", {}, {}, { knowledgePolicy: "skip", domain: "编程" }
);
checkInvariant("skip 类不含「可选参考资料」指令", !/可选参考资料/.test(skipContent));
checkInvariant("skip 类声明「不要引用经典 / 不哲学化」", /不要引用经典/.test(skipContent) && /哲学化/.test(skipContent));

const useEmpty = rag.composeUserContent(
  "怎么面对失败", [], "plain", {}, {}, { knowledgePolicy: "use", domain: "人生" }
);
checkInvariant("use 类空检索声明「不要编造任何经典引用」", /不要编造/.test(useEmpty));

const useWithCite = rag.composeUserContent(
  "怎么面对失败",
  [{ title: "孟子", section: "告子下", year: "", source: "", text: "天将降大任于斯人也……" }],
  "plain", {}, {}, { knowledgePolicy: "use", domain: "人生" }
);
checkInvariant("use 类有资料声明「可选论证依据」", /论证依据/.test(useWithCite));
checkInvariant("use 类有资料声明「不要为了引用而引用」", /不要为了引用而引用/.test(useWithCite));

const crisisContent = rag.composeUserContent(
  "我不想活了", [], "plain", {}, {}, { knowledgePolicy: "skip", domain: "情绪", crisis: true }
);
checkInvariant("危机类注入危机提示与热线 12356", /危机提示/.test(crisisContent) && /12356/.test(crisisContent));

const emotionContent = rag.composeUserContent(
  "我好焦虑", [], "plain", {}, { emotion: true, emotionLabel: "焦虑" }, { knowledgePolicy: "use", domain: "情绪" }
);
checkInvariant("情绪类注入共情提示", /情绪提示/.test(emotionContent));

const longHistory = [];
for (let i = 0; i < 30; i += 1) longHistory.push({ role: i % 2 ? "assistant" : "user", content: "历史消息 " + i });
const prior = rag.buildPriorMessages(longHistory);
checkInvariant("上下文窗口 ≤ 20 条（实际 " + prior.length + "）", prior.length <= 20);

const invOk = invariants.filter((x) => x.ok).length;
console.log("\n装配不变量: " + invOk + "/" + invariants.length + " 通过");

console.log("======================================================");
console.log("单轮分类  : " + pass + "/" + dataset.cases.length + " 通过");
console.log("装配不变量: " + invOk + "/" + invariants.length + " 通过");
console.log("------------------------------------------------------");
console.log("合计      : " + (pass + invOk) + "/" + (dataset.cases.length + invariants.length) + " 通过");
if (fails.length) {
  console.log("\n失败明细：");
  fails.forEach((f) => console.log("  · " + f));
}
console.log("======================================================");
process.exit(fail === 0 && invOk === invariants.length ? 0 : 1);
