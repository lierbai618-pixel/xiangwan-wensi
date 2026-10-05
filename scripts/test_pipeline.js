// P0 流水线测试（纯 Node，不依赖云环境）
// 覆盖：①旧模式(legacy)正常检索 ②ingest 切分 ③新知识库模式检索(rankChunks 纯逻辑)
//       ④KB 失败回退 legacy ⑤引用结构完整
// 运行：node scripts/test_pipeline.js
const path = require("path");
const rag = require(path.join(__dirname, "..", "cloudfunctions", "chat", "rag.js"));
const ingest = require(path.join(__dirname, "..", "cloudfunctions", "ingest", "index.js"));

let pass = 0;
let fail = 0;
function ok(name, cond, extra) {
  if (cond) {
    pass += 1;
    console.log("  \u2713 " + name);
  } else {
    fail += 1;
    console.log("  \u2717 " + name + (extra ? "  -> " + extra : ""));
  }
}

(async () => {
  console.log("== 测试1：旧模式（legacy）正常聊天检索 ==");
  delete process.env.KB_MODE;
  const r1 = await rag.retrieve("如何实践");
  ok("legacy 返回 citations 非空", Array.isArray(r1.citations) && r1.citations.length > 0, JSON.stringify(r1).slice(0, 80));
  ok(
    "legacy citation 含 title/section/text",
    r1.citations[0] && r1.citations[0].title && r1.citations[0].text
  );
  ok("legacy 返回 terms", Array.isArray(r1.terms) && r1.terms.length > 0);

  console.log("== 测试2：ingest 切分（markdown + txt） ==");
  const md =
    "# 第一章\n\n这是第一节的内容，关于实践的讨论。\n\n实践、认识、再实践。\n\n## 第二节\n\n矛盾分析：抓住主要矛盾。";
  const chunks = ingest.splitChunks(md, { title: "示例文献", source: "测试" });
  ok("生成 parent + child chunk", chunks.length >= 3, "count=" + chunks.length);
  ok("存在 level=parent", chunks.some((c) => c.level === "parent"));
  ok(
    "存在 level=child 且 parent_local 指向 parent",
    chunks.some((c) => c.level === "child" && c.parent_local)
  );
  ok(
    "child 数量 >= parent 数量（有进一步拆分）",
    chunks.filter((c) => c.level === "child").length >= chunks.filter((c) => c.level === "parent").length
  );
  const joined = chunks.filter((c) => c.level === "child").map((c) => c.content).join("");
  ok("child 内容覆盖原文关键词", joined.includes("实践") && joined.includes("矛盾"));

  const txt = "第一段关于学习的文字。\n\n第二段讲调查研究的重要性，先调查后下结论。\n\n第三段谈长期主义，事情要一件一件办。";
  const txtChunks = ingest.splitChunks(txt, { title: "纯文本示例" });
  ok("纯 txt 也能切出 parent/child", txtChunks.length >= 2);

  console.log("== 测试3：新知识库模式检索（rankChunks 纯逻辑） ==");
  const fakeChunks = chunks.map((c) =>
    Object.assign({}, c, { _id: c._localId, retrievable: true, keywords: c.keywords, content: c.content })
  );
  const r3 = rag.rankChunks("矛盾分析 主要矛盾", fakeChunks, 3);
  ok("KB 检索返回 citations", r3.citations.length > 0);
  ok(
    "KB 命中与查询相关（含『矛盾』）",
    r3.citations[0].text.includes("矛盾") || r3.citations[0].section.includes("矛盾"),
    r3.citations[0] && r3.citations[0].text.slice(0, 30)
  );
  ok("KB citation 含 display_text", r3.citations[0].citation && r3.citations[0].citation.display_text);
  ok("KB citation 含 source_position", r3.citations[0].citation && r3.citations[0].citation.source_position);
  ok("KB citation 标记 evidenceStatus=kb", r3.citations[0].evidenceStatus === "kb");

  console.log("== 测试4：KB 模式失败自动回退 legacy ==");
  process.env.KB_MODE = "kb";
  try {
    const r4 = await rag.retrieve("矛盾");
    ok("KB 模式失败回退 legacy（citations 非空）", Array.isArray(r4.citations) && r4.citations.length > 0);
  } catch (e) {
    ok("KB 模式失败回退 legacy", false, e.message);
  }
  delete process.env.KB_MODE;

  console.log("== 测试5：引用信息结构完整 ==");
  ok(
    "legacy citation 含 evidenceStatus(seed/imported)",
    r1.citations[0].evidenceStatus === "seed" || r1.citations[0].evidenceStatus === "imported"
  );

  console.log("\n结果：通过 " + pass + " / 失败 " + fail);
  process.exit(fail ? 1 : 0);
})();
