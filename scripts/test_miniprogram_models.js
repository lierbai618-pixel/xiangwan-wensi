// 小程序已配置模型对比测试
// 忠实复刻 cloudfunctions/chat/rag.js 的 callOneModel 行为：
//   - temperature 0.35, max_tokens 2000
//   - system = 真实 ROLE_PROMPT (buildRolePrompt)
//   - 消息结构：system -> user
// 覆盖 model_config 全部 7 个端点 + cloudbaserc 的 QWEN_SEARCH_MODEL(qwen3.8-max)
// 代理：若设置了 HTTPS_PROXY，则经 CONNECT 隧道直连各端点（api.hcnsec.cn 必须走代理）。

const http = require("http");
const https = require("https");
const { URL } = require("url");
const path = require("path");

// 复用小程序真实 system prompt
const rag = require(path.join(__dirname, "..", "cloudfunctions", "chat", "rag.js"));
const buildRolePrompt = rag.buildRolePrompt;

// ---- 代理感知的 https POST（兼容 OpenAI chat/completions）----
function proxyFetch(urlStr, options) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlStr);
    const proxy = process.env.HTTPS_PROXY || process.env.https_proxy ||
                  process.env.HTTP_PROXY || process.env.http_proxy || "";
    const body = options.body ? Buffer.from(options.body) : Buffer.alloc(0);
    const headers = Object.assign({}, options.headers || {});
    headers["Content-Length"] = body.length;
    const timeout = options.timeout || 45000;

    function collect(res, cb) {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf-8");
        let json = {};
        try { json = text ? JSON.parse(text) : {}; } catch (e) { json = {}; }
        cb({ status: res.statusCode, text, json });
      });
    }
    function sendBody(req) {
      if (body.length) req.write(body);
      req.end();
    }

    if (proxy) {
      const p = new URL(proxy);
      const connectReq = http.request({
        host: p.hostname, port: p.port || 80, method: "CONNECT",
        path: parsed.hostname + ":" + (parsed.port || 443),
        timeout,
      });
      connectReq.on("connect", (res, socket) => {
        if (res.statusCode !== 200) return reject(new Error("proxy_CONNECT_" + res.statusCode));
        const req = https.request({
          host: parsed.hostname, port: parsed.port || 443,
          path: parsed.pathname + parsed.search,
          method: options.method || "POST", headers, timeout,
          socket, agent: false, servername: parsed.hostname,
        }, (r) => collect(r, resolve));
        req.on("error", reject);
        req.on("timeout", () => req.destroy(new Error("timeout")));
        sendBody(req);
      });
      connectReq.on("error", reject);
      connectReq.on("timeout", () => connectReq.destroy(new Error("timeout")));
      connectReq.end();
    } else {
      const lib = parsed.protocol === "http:" ? http : https;
      const req = lib.request({
        protocol: parsed.protocol, hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: options.method || "POST", headers, timeout,
      }, (r) => collect(r, resolve));
      req.on("error", reject);
      req.on("timeout", () => req.destroy(new Error("timeout")));
      sendBody(req);
    }
  });
}

async function callModel(cfg, systemContent, userContent, timeout) {
  const url = (cfg.baseURL || "").toString().trim().replace(/\/+$/, "").replace(/\/chat\/completions$/i, "") + "/chat/completions";
  const t0 = Date.now();
  try {
    const res = await proxyFetch(url, {
      method: "POST",
      timeout: timeout || 45000,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        Authorization: "Bearer " + cfg.apiKey,
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.35,
        max_tokens: 2000,
        messages: [
          { role: "system", content: systemContent },
          { role: "user", content: userContent },
        ],
      }),
    });
    const dt = (Date.now() - t0) / 1000;
    if (res.status < 200 || res.status >= 300) {
      return { ok: false, lat: dt, error: "HTTP_" + res.status + " " + (res.text || "").slice(0, 200), answer: "" };
    }
    const data = res.json || {};
    const answer = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!answer || !answer.trim()) return { ok: false, lat: dt, error: "empty_answer", answer: "" };
    return { ok: true, lat: dt, error: "", answer: answer.trim() };
  } catch (e) {
    return { ok: false, lat: (Date.now() - t0) / 1000, error: (e && e.message) || "" + e, answer: "" };
  }
}

// ---- 小程序 model_config 中实际配置的全部模型端点 ----
const MODELS = [
  { tag: "agnes-2.0-flash", baseURL: "https://apihub.agnes-ai.com/v1", apiKey: "sk-YOUR_API_KEY_HERE", model: "agnes-2.0-flash", enabled: true, note: "GEN_MODEL 主模型(已启用)" },
  { tag: "qwen-plus@maas", baseURL: "https://ws-kkupdspdhy9hjxu7.cn-beijing.maas.aliyuncs.com/compatible-mode/v1", apiKey: "sk-YOUR_API_KEY_HERE", model: "qwen-plus", enabled: true, note: "model_config 回退(已启用)" },
  { tag: "qwen-plus@dashscope", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", apiKey: "sk-YOUR_API_KEY_HERE", model: "qwen-plus", enabled: false, note: "已配置未启用" },
  { tag: "deepseek-v4-flash-0731", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", apiKey: "sk-YOUR_API_KEY_HERE", model: "deepseek-v4-flash-0731", enabled: false, note: "benchmark 冠军候选" },
  { tag: "DeepSeek-V4-Flash@hcnsec", baseURL: "https://api.hcnsec.cn/v1", apiKey: "sk-YOUR_API_KEY_HERE", model: "DeepSeek-V4-Flash", enabled: false, note: "~3-4s 候选(需代理)" },
  { tag: "deepseek-v4-flash@tokenrhythm", baseURL: "https://tokenrhythm.studio/v1", apiKey: "sk_tr_L_816NCsfO1t79-12LWd7mTJAqkOYk6l7CZHtZCb5Mo", model: "deepseek-v4-flash", enabled: false, note: "第三方网关" },
  { tag: "qwen3.8-max@dashscope", baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", apiKey: "sk-YOUR_API_KEY_HERE", model: "qwen3.8-max", enabled: false, note: "QWEN_SEARCH_MODEL 联网模型" },
];

const QUESTIONS = [
  { key: "philosophy", q: "人应该如何面对死亡？" },
  { key: "socratic", q: "用苏格拉底式追问，帮我问清楚'我到底想不想辞职'。" },
  { key: "technical", q: "Python 的 list 和 tuple 有什么区别？" },
];

(async () => {
  const system = buildRolePrompt("plain", null);
  const out = { timestamp: new Date().toISOString(), models: [] };
  for (const m of MODELS) {
    console.error(">>> testing " + m.tag + " (" + m.model + ")");
    const perQ = await Promise.all(QUESTIONS.map(async (it) => {
      const r = await callModel(m, system, it.q, 50000);
      console.error("    " + it.key + " => " + (r.ok ? "ok " + r.lat.toFixed(1) + "s" : "FAIL " + r.error));
      return { key: it.key, ok: r.ok, lat: r.lat, error: r.error, answer: r.answer.slice(0, 500) };
    }));
    const lats = perQ.filter((x) => x.ok).map((x) => x.lat);
    const avg = lats.length ? lats.reduce((a, b) => a + b, 0) / lats.length : 0;
    out.models.push({
      tag: m.tag, model: m.model, baseURL: m.baseURL, enabled: m.enabled, note: m.note,
      ok_count: perQ.filter((x) => x.ok).length, avg_lat: avg, per_question: perQ,
    });
  }
  const fs = require("fs");
  const fname = "miniprogram_models_test_" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".json";
  fs.writeFileSync(path.join(__dirname, fname), JSON.stringify(out, null, 2), "utf-8");
  console.error("\n=== DONE -> " + fname + " ===");
  // 控制台摘要
  console.log("\n模型 | 启用 | 成功/3 | 平均延迟");
  out.models.forEach((m) => {
    console.log(`${m.tag.padEnd(26)} | ${m.enabled ? "Y" : "n"} | ${m.ok_count}/3 | ${m.avg_lat ? m.avg_lat.toFixed(1) + "s" : "-"}`);
  });
})();
