// 会话恢复链路模拟测试（离线，无需云环境）
// 复刻 chat.js 的「发送 → 打字机 → 持久化 → 切换会话 → 恢复」全链路，
// 对比修复前后写入云端的 assistant 内容，验证「回答消失」Bug 已消除。
//
// 运行：node weapp/tests/session-restore-sim.js

// ---- 模拟微信小程序 Page 的 data + setData（含数据路径语义）----
function createPage(initialData) {
  return {
    data: JSON.parse(JSON.stringify(initialData)),
    _rawRefs: null,
    setData(patch) {
      Object.keys(patch).forEach((key) => {
        const m = key.match(/^messages\[(\d+)\]\.(\w+)$/);
        if (m) {
          // ★ 小程序真实语义：按路径写入 this.data，等同于修改该对象本身
          this.data.messages[Number(m[1])][m[2]] = patch[key];
        } else {
          this.data[key] = patch[key];
        }
      });
    },
  };
}

const FULL_ANSWER =
  "【理解】你想弄清楚社会是怎么形成的，这是个很根本的问题。\n\n" +
  "【分析】《大学》给的是一条由内而外的生成路径：修身→齐家→治国→平天下。\n\n" +
  "【行动】可以先观察你身边最小的共同体是靠什么维系的。\n\n" +
  "【经典】《大学》·经：古之欲明明德于天下者，先治其国……\n\n" +
  "【思考】如果秩序来自每个人的自我约束，那约束的边界该由谁来定？";

// ---- 云端会话存储（模拟 conversations 集合）----
const cloudDB = {};
function historyAppend(cid, userMsg, assistantMsg) {
  // 复刻 history 云函数的 normalizeMessage + 空内容守卫
  const norm = (m) => {
    const base = {
      role: m.role,
      content: String(m.content == null ? "" : m.content),
      createdAt: m.createdAt || new Date().toISOString(),
      citations: Array.isArray(m.citations) ? m.citations : [],
    };
    if (m.role === "assistant") {
      base.answerId = m.answerId || "";
      base.mode = m.mode || "";
      base.modeLabel = m.modeLabel || "";
      base.modelUsed = m.modelUsed || "";
      base.route = m.route || null;
    }
    return base;
  };
  const a = norm(assistantMsg);
  if (!a.content.trim()) return { ok: false, error: "回答内容为空，未写入历史。" };
  cloudDB[cid] = (cloudDB[cid] || []).concat([norm(userMsg), a]);
  return { ok: true, total: cloudDB[cid].length };
}
function historyLoad(cid) {
  return { ok: true, messages: cloudDB[cid] || [] };
}

// ---- typewriter（与 chat.js 一致，首帧同步执行）----
function typewriterFirstFrame(page, assistantMsg) {
  const full = assistantMsg.content || "";
  const idx = page.data.messages.findIndex((m) => m.id === assistantMsg.id);
  if (idx < 0) return;
  page.setData({
    ["messages[" + idx + "].content"]: full.slice(0, 1),
    ["messages[" + idx + "]._typing"]: true,
  });
}

function runScenario(label, orderFixed) {
  const cid = "conv-A-" + (orderFixed ? "fixed" : "buggy");
  const userMsg = { id: "u-1", role: "user", content: "社会是怎么形成的", citations: [] };
  const fullAnswer = FULL_ANSWER;
  const assistantMsg = {
    id: "a-1",
    role: "assistant",
    content: fullAnswer,
    citations: [{ title: "大学", section: "经", text: "古之欲明明德于天下者……" }],
    answerId: "20260731_x1a2",
    _mode: "model",
    _reqModeLabel: "普通解释",
  };

  const page = createPage({ messages: [] });
  page.data.messages = [userMsg, assistantMsg];

  let appended;
  if (orderFixed) {
    // 修复后：先用完整快照持久化，再启动打字机
    appended = historyAppend(cid, userMsg, Object.assign({}, assistantMsg, { content: fullAnswer }));
    typewriterFirstFrame(page, assistantMsg);
  } else {
    // 修复前：先打字机（改写了 assistantMsg.content），再持久化
    typewriterFirstFrame(page, assistantMsg);
    appended = historyAppend(cid, userMsg, assistantMsg);
  }

  // 切换到别的会话再切回来 → 重新 load
  const loaded = historyLoad(cid);
  const restoredAssistant = loaded.messages.filter((m) => m.role === "assistant");

  console.log("\n===== " + label + " =====");
  console.log("  写入结果         :", appended.ok ? "已写入" : "被拒绝（" + appended.error + "）");
  console.log("  恢复消息总数     :", loaded.messages.length);
  console.log("  恢复 assistant 数:", restoredAssistant.length);
  const content = restoredAssistant[0] ? restoredAssistant[0].content : "";
  console.log("  恢复回答长度     :", content.length, "（原文", fullAnswer.length, "字）");
  console.log("  恢复回答预览     :", JSON.stringify(content.slice(0, 30)) + (content.length > 30 ? "..." : ""));
  console.log("  answerId 保留    :", restoredAssistant[0] ? restoredAssistant[0].answerId || "(无)" : "(无)");
  console.log("  createdAt 保留   :", restoredAssistant[0] ? !!restoredAssistant[0].createdAt : false);
  console.log("  引用来源保留     :", restoredAssistant[0] ? (restoredAssistant[0].citations || []).length : 0);
  const pass = content === fullAnswer;
  console.log("  判定             :", pass ? "✅ 回答完整恢复" : "❌ 回答丢失/截断");
  return pass;
}

console.log("会话恢复链路模拟测试 —— 场景：A会话提问 → 切走 → 切回");
const buggy = runScenario("修复前（append 在 typewriter 之后）", false);
const fixed = runScenario("修复后（先快照持久化，再打字机）", true);

console.log("\n===== 结论 =====");
console.log("修复前:", buggy ? "通过" : "复现了「AI回答消失」Bug");
console.log("修复后:", fixed ? "通过，回答完整恢复" : "仍有问题");
process.exit(fixed ? 0 : 1);
