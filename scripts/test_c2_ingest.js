// Phase C-2 入库联调（纯 Node，无云依赖）
// 验证：① ingest_package 解析真实资料包；② KB 检索（themes/problem_tags 桥梁）召回正确经典；
//       ③ 引用可定位（sourcePosition）/ 不截断 / 不幻觉（原文逐字）；④ 版权闸门拒绝 pending。
const path = require("path");
const ingest = require(path.join(__dirname, "..", "cloudfunctions", "ingest", "index.js"));
const { rankChunks } = require(path.join(__dirname, "..", "cloudfunctions", "chat", "rag.js"));

let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; console.log("  ✓ " + name + (extra ? "  " + extra : "")); }
  else { fail++; console.log("  ✗ " + name + (extra ? "  " + extra : "")); }
}

// 1) 解析两个 ready 资料包（真实论语 + 沉思录文本）
const lunyu = ingest.buildPackageChunks("chinese_philosophy/lunyu");
const med = ingest.buildPackageChunks("western_philosophy/meditations");
ok("论语包解析出 chunks", lunyu.chunks.length > 0, "(" + lunyu.chunks.length + ")");
ok("沉思录包解析出 chunks", med.chunks.length > 0, "(" + med.chunks.length + ")");
ok("论语 chunk 带 perspective=儒家", lunyu.chunks.every((c) => c.perspective === "儒家"));
ok("沉思录 chunk 带 perspective=斯多葛", med.chunks.every((c) => c.perspective === "斯多葛"));
ok("论语 chunk 带 themes/problem_tags", lunyu.chunks.every((c) => Array.isArray(c.themes) && Array.isArray(c.problem_tags)));
ok("章节结构保留（section 非空）", lunyu.chunks.every((c) => c.section && c.section.length > 0));

const allChunks = lunyu.chunks.concat(med.chunks);

// 2) 5 个人生问题 → 验证召回
const cases = [
  { q: "我大学毕业后不知道选择什么方向，很焦虑。", expect: ["论语", "沉思录"], tag: "迷茫/方向" },
  { q: "努力了很久没有结果，我是不是没有价值？", expect: ["沉思录"], tag: "失败/价值" },
  { q: "如何成为更好的人？", expect: ["论语"], tag: "自我成长" },
  { q: "总是控制不住对未来的担忧，怎么办？", expect: ["沉思录"], tag: "焦虑/控制" },
  { q: "我想开始行动，但一直拖延，怎么破？", expect: ["沉思录"], tag: "行动力" },
];

const report = [];
for (const c of cases) {
  const { citations } = rankChunks(c.q, allChunks, 3);
  const titles = citations.map((x) => x.title);
  const hit = c.expect.filter((e) => titles.includes(e));
  ok(`[${c.tag}] 召回包含期望经典 ${c.expect.join("/")}`, hit.length === c.expect.length, "→ " + titles.join("、"));
  report.push({ q: c.q, expect: c.expect, got: titles, citations });
}

// 3) 引用质量：可定位 / 不截断 / 不幻觉
const sample = report[0].citations;
for (const cit of sample) {
  ok(`引用《${cit.title}》含 source_position`, !!cit.citation && typeof cit.citation.source_position === "string" && cit.citation.source_position.length > 0, "[" + cit.citation.source_position + "]");
  ok(`引用 display_text 格式正确`, /^《.+》(·.+)?\s*\[.+\]$/.test(cit.citation.display_text), cit.citation.display_text);
  // 不幻觉：被引内容必须是 source 的逐字片段
  const src = cit.title.includes("论语") ? lunyu.content : med.content;
  ok(`引用内容逐字来自原文（不幻觉）`, src.includes(cit.text), "len=" + cit.text.length);
  ok(`内容未截断（非空且<=原段）`, cit.text.trim().length > 0);
}

// 4) 版权闸门：pending / legalConfirm=false 必须拒绝
const gatePending = ingest.checkIngestGate({ legalConfirm: true, copyrightStatus: "pending" });
const gateNoConfirm = ingest.checkIngestGate({ legalConfirm: false, copyrightStatus: "public-domain" });
const gateOk = ingest.checkIngestGate({ legalConfirm: true, copyrightStatus: "public-domain" });
ok("闸门拒绝 pending", gatePending.ok === false);
ok("闸门拒绝 legalConfirm=false", gateNoConfirm.ok === false);
ok("闸门放行合规资料", gateOk.ok === true);

console.log("\n=== 检索/引用报告（前 1 题示例，引用为真实原文片段）===");
const q0 = report[0];
console.log("问题：" + q0.q);
q0.citations.forEach((c) => {
  console.log("  · " + c.citation.display_text);
  console.log("    " + c.text.slice(0, 60).replace(/\n/g, " ") + (c.text.length > 60 ? "…" : ""));
});

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
