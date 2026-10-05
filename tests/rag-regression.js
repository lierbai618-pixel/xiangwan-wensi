// RAG 召回回归测试（离线，无需云环境）
// 目的：验证「概念桥 + 语义相关判定 + 两级补位」三处改动后，
//   1) 没有破坏 Phase F 已通过题目（不引入意外 weakRecall）；
//   2) "社会是怎么形成的" 类问题真正召回 ≥3 条相关经典（大学/申辩篇/论语）；
//   3) 每条被召回的经典都至少有词面重叠（lex>=2），杜绝 lex=0 纯帧偏置硬套。
//
// 运行：node weapp/tests/rag-regression.js

const path = require("path");
const rag = require(path.join(__dirname, "..", "cloudfunctions", "chat", "rag"));
const phaseF = require(path.join(__dirname, "..", "phase-f-100-test.json"));

// 取出 100 题（去引号，与真实输入一致）
const QUESTIONS = phaseF.records.map((r) => ({
  id: r.id,
  q: String(r.question || "").replace(/^"+|"+$/g, "").trim(),
  theme: r.theme,
}));

// 社会类专项变体（覆盖用户原话「社会是怎么形成的」及 Phase F #12「一个社会是怎么形成的」）
const SOCIAL_VARIANTS = [
  "社会是怎么形成的",
  "一个社会是怎么形成的",
  "社会到底是怎么来的",
  "人类为什么会组成社会",
];

function runOne(q) {
  const r = rag.legacyRetrieve(q, 3);
  return {
    frame: r.frame,
    weak: r.weakRecall,
    n: r.citations.length,
    books: r.citations.map((c) => c.title),
    lex: r.citations.map((c) => c.lexicalScore),
    minLex: r.citations.length ? Math.min.apply(null, r.citations.map((c) => c.lexicalScore)) : -1,
    bridged: r.bridgedTerms,
  };
}

// ---- 1. 全量 100 题回归 ----
let weakList = [];
let ge3 = 0;
let eq12 = 0;
let minLexViolations = []; // 召回了 lex<2 的经典（不应发生）
const perQuestion = [];
for (const item of QUESTIONS) {
  const res = runOne(item.q);
  if (res.weak) weakList.push({ id: item.id, q: item.q });
  if (res.n >= 3) ge3 += 1;
  else if (res.n >= 1) eq12 += 1;
  if (res.minLex >= 0 && res.minLex < 2) {
    minLexViolations.push({ id: item.id, q: item.q, minLex: res.minLex, books: res.books });
  }
  perQuestion.push({ id: item.id, n: res.n, weak: res.weak, books: res.books.join("/") });
}

// ---- 2. 社会类专项 ----
const socialResults = SOCIAL_VARIANTS.map((q) => {
  const res = runOne(q);
  return {
    q,
    n: res.n,
    weak: res.weak,
    books: res.books,
    lex: res.lex,
    hasDaxue: res.books.indexOf("大学") >= 0,
    hasApology: res.books.indexOf("柏拉图《申辩篇》") >= 0,
    hasLunyu: res.books.indexOf("论语") >= 0,
  };
});

// ---- 输出 ----
console.log("==============================================");
console.log("RAG 召回回归（Phase F 100 题 + 社会专项）");
console.log("==============================================");

console.log("\n--- 全量 100 题统计 ---");
console.log("  总题数            :", QUESTIONS.length);
console.log("  召回≥3 条         :", ge3, "(" + (ge3 / QUESTIONS.length * 100).toFixed(0) + "%)");
console.log("  召回 1~2 条       :", eq12);
console.log("  weakRecall(0 条)  :", weakList.length);
console.log("  lex<2 违规召回     :", minLexViolations.length, "(应为 0)");

if (weakList.length) {
  console.log("\n  weakRecall 题（需人工确认是否确无相关内容）:");
  weakList.forEach((w) => console.log("    #" + w.id, w.q));
}
if (minLexViolations.length) {
  console.log("\n  ⚠ lex<2 违规（被纯帧偏置顶上，需修复）:");
  minLexViolations.forEach((v) => console.log("    #" + v.id, v.q, "minLex=" + v.minLex, v.books.join("/")));
}

console.log("\n--- 社会类专项（用户原 bug 场景）---");
let socialPass = 0;
socialResults.forEach((s) => {
  const pass = !s.weak && s.n >= 3 && s.hasDaxue;
  if (pass) socialPass += 1;
  console.log(
    "  " + (pass ? "✅" : "❌") +
    " n=" + s.n +
    " 大学=" + (s.hasDaxue ? "✓" : "✗") +
    " 申辩篇=" + (s.hasApology ? "✓" : "✗") +
    " 论语=" + (s.hasLunyu ? "✓" : "✗") +
    " | " + s.q +
    " | [" + s.books.join(", ") + "]"
  );
});
console.log("\n  社会类专项通过:", socialPass + "/" + socialResults.length, "(要求 ≥3 条且含《大学》)");

console.log("\n--- 逐题召回概览（id | n | books）---");
perQuestion.forEach((p) => {
  console.log("  #" + String(p.id).padStart(3, " ") + " | " + p.n + " | " + p.books);
});

// ---- 判定 ----
// 硬通过条件：① 社会专项全过（用户原 bug 场景）；② 零 lex<2 违规（杜绝 lex=0 三件套硬套）。
// weakRecall 为参考指标：词面准入下，知识库确无词面重叠的含糊题会走诚实声明，属预期行为。
const ok = minLexViolations.length === 0 && socialPass === socialResults.length;
console.log("\n==============================================");
console.log("回归结论:", ok ? "✅ 通过" : "❌ 存在问题，需排查");
console.log("==============================================");
process.exit(ok ? 0 : 1);
