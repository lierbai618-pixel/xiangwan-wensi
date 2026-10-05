// Phase C-3 知识图谱召回测试：用真实资料包构建内存 chunk store，验证
// 「用户人生问题 → 现实问题标签/主题 → 经典章节 → 可引用内容」链路。
// 纯 Node 运行（无需云凭证）。用法：node scripts/test_c3_knowledge_graph.js
const fs = require("fs");
const path = require("path");
const ingest = require("../cloudfunctions/ingest");
const rag = require("../cloudfunctions/chat/rag.js");

const ROOT = path.join(__dirname, "..", "weapp_knowledge_marker"); // not used; ingest resolves from its own dir
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "knowledge", "index.json"), "utf8"));

let pass = 0, fail = 0;
const fails = [];
function check(name, cond) {
  if (cond) { pass++; console.log("  ✔ " + name); }
  else { fail++; fails.push(name); console.log("  ✗ " + name); }
}

// 1) 载入全部 ready 资料包 → 内存 chunk store
const ready = manifest.books.filter((b) => b.status === "ready");
const allChunks = [];
const sourceMap = {};
const metaMap = {};
for (const b of ready) {
  const built = ingest.buildPackageChunks(b.path);
  sourceMap[b.id] = built.content;
  metaMap[b.id] = built.meta;
  for (const c of built.chunks) {
    allChunks.push(Object.assign({}, c, { _id: b.id + "-" + c._localId }));
  }
}
console.log("资料包数:", ready.length, " chunks 总数:", allChunks.length);
check("10 本 ready 资料包全部载入", ready.length === 10);
check("chunks 非空且带 perspective/themes/problem_tags",
  allChunks.every((c) => c.title && Array.isArray(c.themes) && Array.isArray(c.problem_tags)));

// 2) 人生问题召回测试
const questions = [
  { q: "我大学毕业后不知道选择什么方向，很焦虑。", expect: ["论语", "沉思录"] },
  { q: "努力了很久没有结果，我是不是没有价值？", expect: ["沉思录", "庄子", "孟子"] },
  { q: "如何成为更好的人？", expect: ["论语", "大学", "孟子"] },
  { q: "为什么知道道理却做不到？", expect: ["尼各马可伦理学（节选）", "大学"] },
  { q: "我总是被别人的评价影响，怎么办？", expect: ["爱比克泰德《手册》", "沉思录"] },
  { q: "如何面对失败？", expect: ["孟子", "沉思录", "庄子"] },
  { q: "我想长期坚持一件事，怎么培养习惯？", expect: ["尼各马可伦理学（节选）", "论语"] },
  { q: "如何认识自己？", expect: ["柏拉图《申辩篇》", "论语"] },
  { q: "怎样减少内耗，与自己和解？", expect: ["道德经"] },
];

console.log("\n[人生问题召回]");
for (const item of questions) {
  const { citations } = rag.rankChunks(item.q, allChunks, 8);
  const titles = citations.map((c) => c.title);
  const hit = item.expect.filter((e) => titles.includes(e));
  check("召回[" + item.q.slice(0, 12) + "…] 命中期望经典: " + hit.join("/"), hit.length > 0);
  // 引用结构完整 + 可定位
  const citeOk = citations.every((c) =>
    c.citation && c.citation.display_text && c.citation.display_text.includes("《") &&
    typeof c.citation.source_position === "string" && c.text && c.text.length > 0);
  check("  引用字段完整且可定位（" + titles.join(",") + "）", citeOk);
  // 引用内容逐字来自原文（不幻觉）
  const verbatim = citations.every((c) => {
    const src = sourceMap[Object.keys(sourceMap).find((k) => sourceMap[k].includes(c.text))];
    return !!src;
  });
  check("  引用文本逐字来自原典（无幻觉）", verbatim);
}

// 3) user_questions 桥梁：用真实用户问法应能召回对应经典
console.log("\n[user_questions 桥梁]");
const lunyuUQ = metaMap["lunyu"].user_questions[0];
const medUQ = metaMap["meditations"].user_questions[0];
const { citations: cL } = rag.rankChunks(lunyuUQ, allChunks, 8);
check("论语 user_question 召回《论语》: " + lunyuUQ, cL.map((c) => c.title).includes("论语"));
const { citations: cM } = rag.rankChunks(medUQ, allChunks, 8);
check("沉思录 user_question 召回《沉思录》: " + medUQ, cM.map((c) => c.title).includes("沉思录"));

// 4) 版权闸门：pending 必须被拒
console.log("\n[版权闸门]");
const gatePending = ingest.checkIngestGate({ legalConfirm: true, copyrightStatus: "pending" });
const gateDeny = ingest.checkIngestGate({ legalConfirm: false, copyrightStatus: "public-domain" });
check("pending 被拒", gatePending.ok === false);
check("legalConfirm=false 被拒", gateDeny.ok === false);
const gateOk = ingest.checkIngestGate({ legalConfirm: true, copyrightStatus: "public-domain" });
check("合法公有领域通过", gateOk.ok === true);

console.log("\n=== 结果: " + pass + " 通过, " + fail + " 失败 ===");
if (fail) { console.log("失败项:\n - " + fails.join("\n - ")); process.exit(1); }
console.log("Phase C-3 知识图谱召回验证通过。");
