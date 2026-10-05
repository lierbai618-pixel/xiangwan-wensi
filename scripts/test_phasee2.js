// Phase E-v2 冒烟测试：验证「先做人，再引经」回答模型 + E-1/E-3/E-4
const path = require("path");
const rag = require(path.join(__dirname, "..", "cloudfunctions", "chat", "rag.js"));

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log("✅ " + name); } else { fail++; console.log("❌ " + name); } }

(async function () {
  // ---- E-1 问题理解层 ----
  const a1 = rag.analyzeQuery("我大学毕业了，很迷茫，不知道未来怎么办", []);
  ok("E-1 情绪识别=迷茫", a1.emotion === "迷茫");
  ok("E-1 策略=共情优先(comfort-first)", a1.strategy === "comfort-first");
  ok("E-1 主题=迷茫", a1.theme === "迷茫");

  const a2 = rag.analyzeQuery("怎样制定每日学习计划提高效率", []);
  ok("E-1 意图=求方法", a2.intent === "求方法");
  ok("E-1 无情绪→非共情优先(应为action-first)", a2.strategy === "action-first");

  const a3 = rag.analyzeQuery("我失败了，很难走出来", []);
  ok("E-1 情绪识别=失败", a3.emotion === "失败");
  ok("E-1 失败→共情优先", a3.strategy === "comfort-first");

  // ---- 本地回答结构：先做人，再引经 ----
  const res = await rag.generateAnswer("我大学毕业了，很迷茫，不知道未来怎么办", { turn: 0, models: [] });
  ok("本地路径回退", res.mode === "local");
  const ans = res.answer || "";
  const parts = ans.split("\n\n");
  ok("回答分段≥5", parts.length >= 5);
  // 第一段（opening）之后应是共情/理解，不是经典
  const secondPara = (parts[1] || "").slice(0, 20);
  ok("第2段是共情而非直接引经", !/^《/.test(secondPara) && !/《论语》说/.test(parts[1] || ""));
  // 行动段必须在经典段之前
  const actionIdx = ans.indexOf("可以先试这几件小事");
  const classicIdx = ans.indexOf("说到这，想起可以对照的经典");
  ok("行动段存在", actionIdx > 0);
  ok("经典在行动之后(先做人再引经)", actionIdx > 0 && classicIdx > actionIdx);
  ok("结尾有追问段", (parts[parts.length - 1] || "").length > 10);

  // 带情绪时经典明确标注为「不是标准答案」
  ok("经典标注为非答案", /不是标准答案/.test(ans));

  // ---- E-4 引用卡元数据 ----
  ok("引用卡带 why", (res.citations[0] || {}).why && (res.citations[0].why).indexOf("你遇到的是") === 0);
  ok("引用卡带 principle", !!(res.citations[0] || {}).principle);
  ok("引用卡带 inspiration", !!(res.citations[0] || {}).inspiration);

  // ---- 非情绪问题也应含行动+经典，且策略非共情 ----
  const res2 = await rag.generateAnswer("如何提高学习效率，老是坚持不下来", { turn: 0, models: [] });
  ok("非情绪问题也有行动段", res2.answer.indexOf("可以先试这几件小事") > 0);
  ok("非情绪问题经典仍在行动后", res2.answer.indexOf("可以先试") < res2.answer.indexOf("说到这"));

  // ---- 敏感泄漏检测 ----
  const leak = /毛泽东|实践论|矛盾论|同志/.test(ans + (res2.answer || ""));
  ok("无敏感泄漏", leak === false);

  // ---- 追问（上下文）依然可用 ----
  const res3 = await rag.generateAnswer("那如果我是学生呢？", { turn: 1, models: [], history: [{ role: "user", content: "如何面对失败？" }, { role: "assistant", content: "..." }] });
  ok("追问被重写为自足问题", res3.retrieval && res3.retrieval.followUp === true);

  console.log("\n=== Phase E-v2 结果: " + pass + " 通过 / " + fail + " 失败 ===");
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("测试异常:", e); process.exit(1); });
