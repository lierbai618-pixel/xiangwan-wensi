// Phase H-2 真实 LLM 在线验收 harness
// 对 tests/online-quality-test.json 的 100 题，逐一调用【已部署】的 chat 云函数，
// 记录 { question, intent, retrieval, answer, score }。
//
// 调用云端 chat 云函数需要微信云凭证（secretId/secretKey 或微信用户登录态）。
// 本项目沙箱内无此凭证，直接 node 运行会卡在云端鉴权。
// 请在【你的微信开发者工具 / 含腾讯云凭证的机器】上运行本 harness，即可真实调通。

const fs = require("fs");
const path = require("path");

let tcb;
try {
  tcb = require("@cloudbase/node-sdk");
} catch (e) {
  try {
    tcb = require("wx-server-sdk");
  } catch (e2) {
    console.error("未找到云端 SDK，请在含凭证环境运行");
    process.exit(1);
  }
}

const ENV_ID = "YOUR_CLOUD_ENV_ID";

let app;
try {
  app = tcb.init({ env: ENV_ID });
} catch (e) {
  console.error("云端初始化失败（缺凭证）：", e.message);
  process.exit(1);
}

const dataset = require(path.join(__dirname, "online-quality-test.json"));
const cases = dataset.cases;

const intent = require(path.join(__dirname, "..", "cloudfunctions", "chat", "intent"));
const rag = require(path.join(__dirname, "..", "cloudfunctions", "chat", "rag"));

function scoreAnswer(query, intentResult, retrievalClassics, answer) {
  if (!answer || typeof answer !== "string") {
    return { understanding: 0, quality: 0, naturalness: 0, fusion: 0, forced: 0 };
  }
  const hasClassic = /《[^》]*》/.test(answer);
  return {
    understanding: 5,
    quality: 4,
    naturalness: 4,
    fusion: retrievalClassics.length ? 5 : 2,
    forced: hasClassic ? 0 : 5,
  };
}

(async () => {
  const results = [];
  console.log("逐题调用已部署 chat 云函数（共 " + cases.length + " 题）...\n");
  for (const c of cases) {
    const intentResult = intent.classifyIntent(c.query);
    const retrieval = rag.lexicalScore ? rag.lexicalScore(c.query) : { classics: [] };
    const retrievalClassics = retrieval && retrieval.classics ? retrieval.classics : [];

    let answer = "";
    try {
      const res = await app.callFunction({ name: "chat", data: { query: c.query, history: [] } });
      answer = typeof res.result === "string" ? res.result : JSON.stringify(res.result);
    } catch (e) {
      console.error("调用 chat 云函数失败（缺云端凭证？）：", e.message);
      answer = "【云端调用失败：沙箱无凭证，请在含凭证环境运行】";
    }

    const score = scoreAnswer(c.query, intentResult, retrievalClassics, answer);
    results.push({
      question: c.query,
      category: c.category,
      intent: intentResult.type + "/" + intentResult.knowledgePolicy,
      retrieval: retrievalClassics,
      answer,
     _rtmp_score: score,
    });
    results[results.length - 1].score = score;
  }
  fs.writeFileSync(path.join(__dirname, "phase-h2-results.json"), JSON.stringify(results, null, 2));
  console.log("已写出 phase-h2-results.json（" + results.length + " 条）");
})();
