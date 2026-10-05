// 向晚问思 - 管理云函数
// actions:
//   whoami  -> 返回调用者的 openid（用于配置 ADMIN_OPENID）
//   stats   -> 总用户数 / 总对话数 / 今日对话数
//   users   -> 用户列表（openid、对话数、最近活跃），按最近活跃倒序
//   user    -> 某个 openid 的对话记录（最新在前）
//
// 权限：若配置了环境变量 ADMIN_OPENID，则只有该 openid 可访问；未配置则放行（开发期）。
const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const $ = db.command.aggregate;
const https = require("https");
const http = require("http");
const { URL } = require("url");

// Node 16 兼容的 fetch 替代（与 chat/rag.js 同源，便于维护）
function nodeFetch(urlStr, options) {
  return new Promise(function (resolve, reject) {
    let parsed;
    try {
      parsed = new URL(urlStr);
    } catch (e) {
      return reject(e);
    }
    const lib = parsed.protocol === "http:" ? http : https;
    const body = options && options.body ? Buffer.from(options.body) : Buffer.alloc(0);
    const headers = Object.assign({}, (options && options.headers) || {});
    headers["Content-Length"] = body.length;
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: (options && options.method) || "GET",
        headers: headers,
        timeout: (options && options.timeout) || 30000,
      },
      function (res) {
        const chunks = [];
        res.on("data", function (c) {
          chunks.push(c);
        });
        res.on("end", function () {
          const text = Buffer.concat(chunks).toString("utf-8");
          let json = {};
          try {
            json = text ? JSON.parse(text) : {};
          } catch (e) {
            json = {};
          }
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            text: function () {
              return Promise.resolve(text);
            },
            json: function () {
              return Promise.resolve(json);
            },
          });
        });
      }
    );
    req.on("timeout", function () {
      req.destroy(new Error("timeout"));
    });
    req.on("error", function (e) {
      reject(e);
    });
    if (body.length) req.write(body);
    req.end();
  });
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function normalizeBaseURL(baseURL) {
  return (baseURL || "")
    .toString()
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/chat\/completions$/i, "");
}

function normalizeModelError(error) {
  const msg = (error || "").toString();
  if (/HTTP_404/i.test(msg) || /Model not exist/i.test(msg)) {
    return "模型 ID 不存在。百炼兼容模式通常填写 qwen-plus、qwen-max 这类小写模型 ID；不要填控制台展示名，例如 Qwen3.7-Max。原始错误：" + msg;
  }
  return msg;
}

// 实测单个模型配置是否可用（Node 16 兼容 nodeFetch + timeout 超时）
async function testModelCall(cfg) {
  const url = normalizeBaseURL(cfg.baseURL) + "/chat/completions";

  try {
    const res = await nodeFetch(url, {
      method: "POST",
      timeout: cfg.timeout || 20000,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + cfg.apiKey,
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.35,
        max_tokens: 60,
        messages: [{ role: "user", content: "你好，请用一句话回复测试" }],
      }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(function () { return ""; });
      throw new Error(normalizeModelError("HTTP_" + res.status + " " + txt.slice(0, 240)));
    }
    const data = await res.json().catch(function () { return {}; });
    const answer =
      data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      data.choices[0].message.content;
    if (!answer || !answer.trim()) throw new Error("empty_answer");
    return answer.trim();
  } catch (e) {
    if (e && e.message === "timeout") throw new Error("timeout");
    throw e;
  }
}

exports.main = async (event) => {
  const ctx = cloud.getWXContext();
  const openid = (ctx && ctx.OPENID) || "";

  // 权限检查（2026-09-22 安全修复 P1-1）：改为 fail-closed。
  //   原写法 `if (adminOpenid && adminOpenid !== openid)` 在 ADMIN_OPENID 缺失/为空时条件短路，
  //   等于**任何人都是管理员**（可读写模型配置中的明文密钥与全部用户对话）。现改为：未配置即拒绝。
  const adminOpenid = process.env.ADMIN_OPENID;
  const isAdmin = !!adminOpenid && adminOpenid === openid;

  const action = (event && event.action) || "stats";

  // whoami 免鉴权：仅供前端判断「是否展示管理入口」，
  //   只返回 openid 与 isAdmin 布尔值，不返回任何敏感数据。
  if (action === "whoami") {
    return { ok: true, openid, isAdmin };
  }

  if (!isAdmin) {
    return { ok: false, error: "无权限访问管理功能。" };
  }

  try {
    if (action === "stats") {
      const total = await db.collection("logs").count();
      const usersAgg = await db
        .collection("logs")
        .aggregate()
        .group({ _id: "$openid" })
        .count("userCount")
        .end();
      const today = await db
        .collection("logs")
        .where({ createTime: db.command.gte(startOfToday()) })
        .count();
      return {
        ok: true,
        totalChats: total.total,
        totalUsers: (usersAgg.list && usersAgg.list[0] && usersAgg.list[0].userCount) || 0,
        todayChats: today.total,
      };
    }

    if (action === "users") {
      const res = await db
        .collection("logs")
        .aggregate()
        .group({
          _id: "$openid",
          count: $.sum(1),
          lastActive: $.max("$createTime"),
        })
        .sort({ lastActive: -1 })
        .limit(100)
        .end();
      const users = (res.list || []).map((u) => ({
        openid: u._id,
        count: u.count,
        lastActive: u.lastActive,
      }));
      return { ok: true, users };
    }

    if (action === "user") {
      const target = (event && event.openid) || "";
      if (!target) return { ok: false, error: "缺少 openid。" };
      const res = await db
        .collection("logs")
        .where({ openid: target })
        .orderBy("createTime", "desc")
        .limit(100)
        .get();
      return { ok: true, logs: res.data || [] };
    }

    // ===== 模型配置管理（model_config 集合）=====
    if (action === "models") {
      try {
        const res = await db
          .collection("model_config")
          .orderBy("order", "asc")
          .limit(50)
          .get();
        return { ok: true, models: res.data || [] };
      } catch (e) {
        // 集合可能尚未创建
        return { ok: true, models: [] };
      }
    }

    if (action === "model_save") {
      const m = (event && event.model) || {};
      const name = (m.name || "").trim();
      if (!name) return { ok: false, error: "请填写模型显示名。" };
      if (!m.apiKey) return { ok: false, error: "请填写 API Key。" };
      if (!m.baseURL) return { ok: false, error: "请填写接口地址。" };
      if (!m.model) return { ok: false, error: "请填写模型名。" };

      const doc = {
        name: name,
        apiKey: m.apiKey,
        baseURL: normalizeBaseURL(m.baseURL),
        model: (m.model || "").trim(),
        timeout: Number(m.timeout) > 0 ? Number(m.timeout) : 30000,
        enabled: m.enabled !== false,
        order: Number(m.order) >= 0 ? Number(m.order) : 99,
        note: (m.note || "").toString().slice(0, 200),
      };

      try {
        if (m._id) {
          await db.collection("model_config").doc(m._id).update({ data: doc });
          return { ok: true, _id: m._id };
        }
        const addRes = await db.collection("model_config").add({ data: doc });
        return { ok: true, _id: addRes._id };
      } catch (e) {
        return { ok: false, error: "保存失败：" + (e && e.message ? e.message : e) };
      }
    }

    if (action === "model_delete") {
      const id = (event && event._id) || "";
      if (!id) return { ok: false, error: "缺少 _id。" };
      try {
        await db.collection("model_config").doc(id).remove();
        return { ok: true };
      } catch (e) {
        return { ok: false, error: "删除失败：" + (e && e.message ? e.message : e) };
      }
    }

    if (action === "model_test") {
      const m = (event && event.model) || {};
      if (!m.apiKey || !m.baseURL || !m.model) {
        return { ok: false, error: "请先填写 apiKey / baseURL / model。" };
      }
      const cfg = {
        name: m.name || m.model,
        apiKey: m.apiKey,
        baseURL: normalizeBaseURL(m.baseURL),
        model: (m.model || "").trim(),
        timeout: Number(m.timeout) > 0 ? Number(m.timeout) : 30000,
      };
      try {
        const answer = await testModelCall(cfg);
        return { ok: true, answer: answer };
      } catch (e) {
        return { ok: false, error: (e && e.message ? e.message : "" + e) };
      }
    }

    // ===== D-3 问题洞察（question_logs 集合）=====
    if (action === "insights") {
      try {
        const total = await db.collection("question_logs").count();
        const res = await db
          .collection("question_logs")
          .orderBy("createTime", "desc")
          .limit(200)
          .get();
        const rows = res.data || [];
        const tagCount = {};
        const qCount = {};
        const catCount = {};
        rows.forEach((r) => {
          (r.matchedTags || []).forEach((t) => {
            tagCount[t] = (tagCount[t] || 0) + 1;
          });
          const q = (r.question || "").trim();
          if (q) qCount[q] = (qCount[q] || 0) + 1;
          const c = r.category || "未分类";
          catCount[c] = (catCount[c] || 0) + 1;
        });
        const categoryBreakdown = Object.keys(catCount)
          .map((c) => ({ category: c, count: catCount[c] }))
          .sort((a, b) => b.count - a.count);
        const topTags = Object.keys(tagCount)
          .map((t) => ({ tag: t, count: tagCount[t] }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 15);
        const topQuestions = Object.keys(qCount)
          .map((q) => ({ question: q, count: qCount[q] }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 15);

        // E-5 反馈聚合：我们真正要优化的是「用户是否觉得被帮助」
        let feedback = { total: 0, helpful: 0, rate: 0, reasons: [] };
        try {
          const fbRes = await db.collection("answer_feedback").limit(500).get();
          const fbRows = fbRes.data || [];
          const reasonCount = {};
          let helpful = 0;
          fbRows.forEach((f) => {
            if (f.helpful) helpful += 1;
            if (!f.helpful && f.reason) reasonCount[f.reason] = (reasonCount[f.reason] || 0) + 1;
          });
          const reasons = Object.keys(reasonCount)
            .map((r) => ({ reason: r, count: reasonCount[r] }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 6);
          feedback = {
            total: fbRows.length,
            helpful: helpful,
            rate: fbRows.length ? Math.round((helpful / fbRows.length) * 100) : 0,
            reasons: reasons,
          };
        } catch (e) {
          feedback.note = (e && e.message ? e.message : "" + e);
        }

        // Phase F · answer_quality_log 聚合：我们真正要优化的是「为什么有效 / 无效」
        let quality = { total: 0, failures: [], goods: [] };
        try {
          const qRes = await db.collection("answer_quality_log").limit(500).get();
          const qRows = qRes.data || [];
          const failCount = {};
          const goodCount = {};
          qRows.forEach((q) => {
            const f = (q.failureReason || "").trim();
            const g = (q.goodPoint || "").trim();
            if (f) failCount[f] = (failCount[f] || 0) + 1;
            if (g) goodCount[g] = (goodCount[g] || 0) + 1;
          });
          const failures = Object.keys(failCount)
            .map((k) => ({ text: k, count: failCount[k] }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);
          const goods = Object.keys(goodCount)
            .map((k) => ({ text: k, count: goodCount[k] }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);
          quality = { total: qRows.length, failures, goods };
        } catch (e) {
          quality.note = (e && e.message ? e.message : "" + e);
        }

        return {
          ok: true,
          totalQuestions: total.total,
          topTags,
          topQuestions,
          categoryBreakdown,
          feedback,
          quality,
        };
      } catch (e) {
        return { ok: true, totalQuestions: 0, topTags: [], topQuestions: [], note: (e && e.message ? e.message : "" + e) };
      }
    }

    return { ok: false, error: "未知的操作类型。" };
  } catch (e) {
    return { ok: false, error: "查询失败：" + (e && e.message ? e.message : e) };
  }
};
