// Phase F 冒烟测试：验证 ①analyzeQuery 五分类映射 ②feedback 的 answer_quality_log 写库分支 ③admin insights 聚合 categoryBreakdown + quality
// 用 Module 钩子注入假的 wx-server-sdk，避免依赖云端 SDK。
const path = require("path");
const Module = require("module");

const calls = {};
function makeDb() {
  function coll(name) {
    const chain = {
      add(o) { calls[name] = (calls[name] || 0) + 1; calls[name + "_last"] = o; return Promise.resolve({ _id: "id" }); },
      count() { return Promise.resolve({ total: (global.__datasets[name] || []).length }); },
      where() { return chain; },
      orderBy() { return chain; },
      limit() { return chain; },
      get() { return Promise.resolve({ data: global.__datasets[name] || [] }); },
    };
    return chain;
  }
  return { collection: coll, command: { aggregate: {} }, serverDate: function () { return {}; } };
}

const fakeCloud = {
  init() {},
  database() { return makeDb(); },
  getWXContext() { return { OPENID: "openid_test" }; },
  openapi: { security: { msgSecCheck: () => Promise.resolve({ suggest: "pass" }) } },
};

const origLoad = Module._load;
Module._load = function (request) {
  if (request === "wx-server-sdk") return fakeCloud;
  return origLoad.apply(this, arguments);
};

const feedback = require(path.join(__dirname, "../cloudfunctions/feedback/index.js"));
const admin = require(path.join(__dirname, "../cloudfunctions/admin/index.js"));
const rag = require(path.join(__dirname, "../cloudfunctions/chat/rag.js"));

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log("  \u2713 " + name); }
  else { fail++; console.log("  \u2717 " + name); }
}

(async () => {
  // 1. 五分类映射
  console.log("[1] analyzeQuery \u4e94\u5206\u7c7b\u6620\u5c04");
  const samples = [
    ["\u6211\u5f88\u8ff7\u832b\uff0c\u4e0d\u77e5\u9053\u4eba\u751f\u65b9\u5411", "\u4eba\u751f\u65b9\u5411"],
    ["\u600e\u4e48\u5b66\u4e60\u624d\u80fd\u6210\u957f", "\u5b66\u4e60\u6210\u957f"],
    ["\u603b\u662f\u62d6\u5ef6\uff0c\u6ca1\u6cd5\u6267\u884c", "\u5b66\u4e60\u6210\u957f"],
    ["\u538b\u529b\u592a\u5927\uff0c\u5f88\u5d29\u6e83", "\u60c5\u7eea\u538b\u529b"],
    ["\u5728\u610f\u4ed6\u4eba\u8bc4\u4ef7\uff0c\u793e\u4ea4\u7126\u8651", "\u5173\u7cfb\u95ee\u9898"],
    ["\u6000\u7591\u81ea\u5df1\u7684\u4ef7\u503c\uff0c\u4e0d\u81ea\u4fe1", "\u4eba\u751f\u65b9\u5411"],
    ["\u575a\u6301\u5f88\u4e45\u6ca1\u6709\u7ed3\u679c", "\u957f\u671f\u9009\u62e9"],
    ["\u8981\u4e0d\u8981\u8f6c\u884c\uff0c\u5f88\u96be\u51b3\u5b9a", "\u957f\u671f\u9009\u62e9"],
    ["\u4eca\u5929\u5929\u6c14\u771f\u597d", "\u672a\u5206\u7c7b"],
  ];
  samples.forEach(([q, expectCat]) => {
    const a = rag.analyzeQuery(q, []);
    ok("\u300c" + q + "\u300d\u2192 " + expectCat + " (\u5b9e\u9645:" + a.category + ")", a.category === expectCat);
  });

  // 2. feedback quality \u5206\u652f
  console.log("[2] feedback type=quality \u5199 answer_quality_log");
  global.__datasets = {};
  calls.answer_quality_log = 0;
  calls.answer_feedback = 0;
  const fr = await feedback.main({ type: "quality", question: "\u6211\u5f88\u8ff7\u832b", answer_id: "ans-1", failureReason: "\u592a\u62bd\u8c61", goodPoint: "\u884c\u52a8\u5efa\u8bae\u5177\u4f53" });
  ok("quality \u8fd4\u56de ok", fr.ok === true);
  ok("\u5199\u5165 answer_quality_log", calls.answer_quality_log === 1);

  const fr2 = await feedback.main({ type: "quality", question: "x", answer_id: "a", failureReason: "", goodPoint: "" });
  ok("\u7a7a\u5185\u5bb9 quality \u8df3\u8fc7\u5199\u5e93", fr2.ok === true && fr2.skipped === true && calls.answer_quality_log === 1);

  const fr3 = await feedback.main({ type: "rate", question: "x", answer_id: "a", helpful: true });
  ok("rate \u9ed8\u8ba4\u5199 answer_feedback", calls.answer_feedback === 1);

  // 3. admin insights \u805a\u5408
  console.log("[3] admin insights \u805a\u5408 categoryBreakdown + quality");
  global.__datasets = {
    question_logs: [
      { question: "\u672a\u6765\u600e\u4e48\u529e", category: "\u4eba\u751f\u65b9\u5411", matchedTags: ["\u8ff7\u832b"] },
      { question: "\u5b66\u4e0d\u8fdb\u53bb", category: "\u5b66\u4e60\u6210\u957f", matchedTags: ["\u5b66\u4e60"] },
      { question: "\u597d\u7126\u8651", category: "\u60c5\u7eea\u538b\u529b", matchedTags: ["\u60c5\u7eea"] },
      { question: "\u548c\u670b\u53cb\u5588\u67b6", category: "\u5173\u7cfb\u95ee\u9898", matchedTags: ["\u5173\u7cfb"] },
      { question: "\u575a\u6301\u6ca1\u7ed3\u679c", category: "\u957f\u671f\u9009\u62e9", matchedTags: ["\u957f\u671f"] },
    ],
    answer_feedback: [{ helpful: true, reason: "" }, { helpful: false, reason: "\u53ea\u662f\u8bb2\u9053\u7406" }],
    answer_quality_log: [
      { failureReason: "\u592a\u62bd\u8c61", goodPoint: "\u5171\u60c5\u5230\u4f4d" },
      { failureReason: "\u592a\u62bd\u8c61", goodPoint: "" },
    ],
  };
  const ins = await admin.main({ action: "insights" });
  ok("insights ok", ins.ok === true);
  ok("categoryBreakdown \u542b 5 \u7c7b", ins.categoryBreakdown && ins.categoryBreakdown.length === 5);
  ok("feedback.rate = 50%", ins.feedback && ins.feedback.rate === 50);
  ok("quality.total = 2", ins.quality && ins.quality.total === 2);
  ok("quality.failures \u542b\u300c\u592a\u62bd\u8c61\u300dx2", ins.quality.failures.some((f) => f.text === "\u592a\u62bd\u8c61" && f.count === 2));
  ok("quality.goods \u542b\u300c\u5171\u60c5\u5230\u4f4d\u300dx1", ins.quality.goods.some((g) => g.text === "\u5171\u60c5\u5230\u4f4d" && g.count === 1));

  // 4. chat/index.js answer_id 三层贯通（评审唯一建议）
  console.log("[4] chat.main answer_id \u4e09\u5c42\u8d1f\u901a");
  const chat = require(path.join(__dirname, "../cloudfunctions/chat/index.js"));
  calls.question_logs = 0;
  const cm = await chat.main({ message: "\u6211\u5f88\u8ff7\u832b\uff0c\u4e0d\u77e5\u9053\u672a\u6765\u600e\u4e48\u529e", history: [] });
  await new Promise((r) => setTimeout(r, 60)); // logQuestion 是 fire-and-forget，等其落库
  ok("chat.main ok", cm.ok === true);
  ok("result.answerId \u683c\u5f0f YYYYMMDD_xxxx", /^\d{8}_[a-z0-9]+$/.test(cm.answerId || ""));
  const qLast = (calls.question_logs_last && calls.question_logs_last.data) || {};
  ok("question_logs \u5199\u5165\u5e26 answer_id", calls.question_logs === 1 && /^\d{8}_/.test(qLast.answerId || ""));
  ok("answer_id \u4e09\u5c42\u4e00\u81f4 (\u8fd4\u56de==\u843d\u5e93)", cm.answerId === qLast.answerId);

  console.log("\nPhase F \u6d4b\u8bd5\uff1a" + pass + " \u901a\u8fc7 / " + fail + " \u5931\u8d25");
  process.exit(fail ? 1 : 0);
})();
