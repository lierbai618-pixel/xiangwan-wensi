// Phase E smoke test：回答参数化 + 追问重写 + 思想路线
// 运行：node scripts/test_phasee.js
const path = require("path");
const rag = require(path.join(__dirname, "..", "cloudfunctions", "chat", "rag.js"));

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log("  ✓ " + name); }
  else { fail++; console.log("  ✗ " + name); }
}

console.log("\n[1] 回答参数化 resolveAnswerParams");
const p1 = rag.resolveAnswerParams("plain");
const p2 = rag.resolveAnswerParams("deep");
const p3 = rag.resolveAnswerParams("classic");
ok("plain → depth 1", p1.depth === 1);
ok("deep → depth 3", p2.depth === 3);
ok("classic → classic_weight 0.9", p3.classic_weight === 0.9);
ok("非法 mode 回退 plain", rag.resolveAnswerParams("xxx").key === "plain");
const pObj = rag.resolveAnswerParams({ preset: "deep", classic_weight: 0.9, depth: 2 });
ok("参数对象覆盖：preset deep + 覆盖 depth=2/cw=0.9", pObj.key === "deep" && pObj.depth === 2 && pObj.classic_weight === 0.9);
ok("参数越界被 clamp（depth 9 → 3）", rag.resolveAnswerParams({ preset: "plain", depth: 9 }).depth === 3);

console.log("\n[2] buildRolePrompt 由参数渲染，保持三预设语义");
const rpPlain = rag.buildRolePrompt("plain");
const rpDeep = rag.buildRolePrompt("deep");
const rpClassic = rag.buildRolePrompt("classic");
ok("deep 含『视角一 / 视角二』", /视角一 \/ 视角二/.test(rpDeep));
ok("classic 含『经典原文为主轴』", /经典原文为主轴/.test(rpClassic));
ok("plain 平实简短", /平实/.test(rpPlain));
ok("所有预设含最高约束（危机优先级）", /危机最高优先级/.test(rpPlain) && /危机最高优先级/.test(rpDeep));
ok("参数对象也能构建 prompt", /视角一/.test(rag.buildRolePrompt({ preset: "deep" })));

console.log("\n[3] 追问重写 rewriteQuery");
const hist = [
  { role: "user", content: "我该如何面对失败？" },
  { role: "assistant", content: "……（上一轮回答）……" },
];
const rw1 = rag.rewriteQuery("那如果我是学生呢？", hist);
ok("短追问被识别为 followUp", rw1.followUp === true);
ok("检索问题补全上文", rw1.retrievalQuery.indexOf("如何面对失败") >= 0 && rw1.retrievalQuery.indexOf("学生") >= 0);
ok("contextRef = 上一问", rw1.contextRef === "我该如何面对失败？");
const rw2 = rag.rewriteQuery("我最近工作压力很大，怎么调节情绪？", hist);
ok("完整新问题不判为追问", rw2.followUp === false);
ok("新问题 retrievalQuery = 原文", rw2.retrievalQuery === "我最近工作压力很大，怎么调节情绪？");
const rw3 = rag.rewriteQuery("那如果我是学生呢？", []);
ok("无历史时不误判追问", rw3.followUp === false);

console.log("\n[4] 思想路线 buildRoute");
const cites = [
  { title: "论语", tags: ["学习", "行动", "成长"] },
  { title: "沉思录", tags: ["情绪", "自我"] },
];
const r = rag.buildRoute("我学习没动力，情绪也差", cites);
ok("dimensions 非空且 ≤3", r.dimensions.length > 0 && r.dimensions.length <= 3);
ok("推荐书来自 citations", r.books.indexOf("论语") >= 0 && r.books.indexOf("沉思录") >= 0);
ok("core 一句话非空", typeof r.core === "string" && r.core.length > 0);
const rEmpty = rag.buildRoute("随便问问", []);
ok("无 citations 也有兜底 dimension", rEmpty.dimensions.length >= 1);

console.log("\n[5] generateAnswer 端到端（本地路径，无模型）");
(async () => {
  const res = await rag.generateAnswer("那如果我是学生呢？", {
    turn: 1,
    models: [],
    mode: "classic",
    history: [
      { role: "user", content: "我该如何面对失败？" },
      { role: "assistant", content: "……" },
      { role: "user", content: "那如果我是学生呢？" }, // 前端 history 常含本轮
    ],
  });
  ok("返回本地回答", res.mode === "local" && typeof res.answer === "string");
  ok("带回思想路线 route", res.route && res.route.dimensions.length > 0);
  ok("_params 记录解析后的参数", res.params !== undefined || res._params.key === "classic");
  ok("retrieval.followUp = true（追问识别贯通）", res.retrieval && res.retrieval.followUp === true);
  ok("citations 来自 10 本经典（无敏感泄漏）",
    (res.citations || []).every((c) => !/毛泽东|实践论|矛盾论|论持久战/.test(c.title)));
  const leak = /毛泽东|实践论|矛盾论|论持久战|同志你好/.test(res.answer);
  ok("回答无敏感泄漏", leak === false);

  console.log("\n结果：" + pass + " 通过 / " + fail + " 失败");
  process.exit(fail ? 1 : 0);
})();
