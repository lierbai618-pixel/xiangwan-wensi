// 知识库联调脚本（P0 收尾 · 内容无关的纯工程验证）
// 验证范围：
//   [A] Legacy 模式 end-to-end 检索（真实 corpus.json，无云凭证可跑）
//   [B] KB rankChunks 排序逻辑（用合成 chunks 夹具验证，无需云）
//   [C] KB 模式回退：无云凭证时自动回退 legacy，不崩溃
//   [D] ingest.splitChunks 单元：Parent/Child 产出 + 关联正确
// 不修改任何生产代码，不引入 embedding，不改变 legacy 行为。
const path = require("path");
const fs = require("fs");

const RAG = require(path.join(__dirname, "..", "cloudfunctions", "chat", "rag.js"));
const { splitChunks } = require(path.join(__dirname, "..", "cloudfunctions", "ingest", "index.js"));

const questionsPath = path.join(__dirname, "..", "tests", "questions.json");
const questions = JSON.parse(fs.readFileSync(questionsPath, "utf-8")).questions || [];

function printCitations(citations) {
  return (citations || []).map((c, i) => {
    const cite = c.citation || {};
    return `     [${i + 1}] ${c.title || "?"} | display="${cite.display_text || ""}" | pos="${cite.source_position || ""}" | score=${(c.score || 0).toFixed(2)}`;
  }).join("\n");
}

let pass = 0;
let fail = 0;
function check(name, cond) {
  if (cond) {
    pass++;
    console.log("   ✓ " + name);
  } else {
    fail++;
    console.log("   ✗ " + name);
  }
}

async function main() {
  console.log("=== P0 知识库联调（纯 Node，无云凭证）===\n");

  // [A] Legacy 模式 end-to-end
  console.log("[A] Legacy 模式检索（默认，无云）— 验证旧接口不被破坏");
  let legacyAllOk = true;
  for (const q of questions) {
    const r = await RAG.generateAnswer(q.query, { turn: 0, models: [] });
    const ok = r && Array.isArray(r.citations) && r.citations.length > 0;
    if (!ok) legacyAllOk = false;
    check(`"${q.query.slice(0, 14)}…" 返回≥1引用`, ok);
    if (ok) {
      console.log(`   问题: ${q.query}`);
      console.log(`   模式=${r.mode} | 引用数=${r.citations.length} | queryTerms=${(r.retrieval && r.retrieval.queryTerms || []).length} | minScore=${(r.retrieval && r.retrieval.minScore)}`);
      console.log(printCitations(r.citations));
      // legacy 模式返回文档级引用（title/source/text/summary/tags），不含 chunk 级 citation 信封。
      // KB 模式的 chunk 级 citation 信封(display_text/source_position/verified) 在 [B] 单独验证。
      const citeOk = r.citations.every((c) => c.title && typeof c.source !== "undefined" && c.text);
      check(`   └ 引用字段完整(legacy: title/source/text)`, citeOk);
    }
  }

  // [B] KB rankChunks 逻辑（合成夹具）
  console.log("\n[B] KB rankChunks 逻辑（合成 chunks 夹具，无云）— 验证新知识库排序与引用结构");
  const fixture = "# 示例文档\n如何把大任务拆成小步骤。先列清单，再按优先级排序，每天只做前三件。\n调查能帮助判断。信息不足时不要急着下结论，先收集事实再分析。\n遇到挫折时，先把问题拆小，再找一件能立刻做的小事。";
  const chunks = splitChunks(fixture, { title: "示例文档", year: "2024", source: "测试夹具" });
  const kb = RAG.rankChunks("怎么把大任务拆成小步骤", chunks, 3);
  check("rankChunks 返回≥1命中", kb.citations.length > 0);
  check("引用 display_text 完整", kb.citations.every((c) => c.citation && c.citation.display_text));
  check("引用 source_position 完整", kb.citations.every((c) => c.citation && typeof c.citation.source_position === "string"));
  check("evidenceStatus=kb", kb.citations.every((c) => c.evidenceStatus === "kb"));
  if (kb.citations.length) console.log(printCitations(kb.citations));

  // [C] KB 模式回退
  console.log("\n[C] KB 模式回退（无云凭证应回退 legacy，不崩溃）");
  process.env.KB_MODE = "kb";
  let fellBack = false;
  const origErr = console.error;
  console.error = function () {
    if (/回退 legacy/.test(Array.prototype.join.call(arguments, " "))) fellBack = true;
    origErr.apply(console, arguments);
  };
  let r2 = null;
  let threw = false;
  try {
    r2 = await RAG.retrieve("怎么分清轻重缓急", 3);
  } catch (e) {
    threw = true;
  }
  console.error = origErr;
  check("KB 模式未崩溃", !threw);
  check("KB 模式返回结果（legacy 回退）", r2 && Array.isArray(r2.citations));
  check("触发 legacy 回退日志", fellBack);
  delete process.env.KB_MODE;

  // [D] ingest.splitChunks 单元
  console.log("\n[D] ingest.splitChunks 单元 — 验证 Parent/Child 产出");
  const sp = splitChunks("# 章节一\n第一段内容较长的文本用于测试切分逻辑是否保持完整。\n第二段继续补充内容。\n# 章节二\n另一节内容用于验证多章节切分。", { title: "测试文档" });
  const parents = sp.filter((c) => c.level === "parent");
  const children = sp.filter((c) => c.level === "child");
  check("产出 2 个 parent chunk", parents.length === 2);
  check("产出 ≥1 个 child chunk", children.length >= 1);
  check("child 关联 parent_local", children.every((c) => !!c.parent_local));
  check("章节名被继承到 section", parents.every((c) => c.section === "章节一" || c.section === "章节二"));

  console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error("联调脚本异常：", e);
  process.exit(1);
});
