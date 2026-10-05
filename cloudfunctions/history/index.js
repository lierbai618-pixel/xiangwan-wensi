// 向晚问思 - 会话历史云函数（多会话模型）
// 每个 openid 可拥有多个会话，每条会话是 conversations 集合中的一条独立文档，
// 其 _id 即 conversationId，作为前端与 question_logs 关联的会话维度。
// 动作：
//   list    —— 列出该 openid 的所有会话（按 updateTime 倒序），返回 [_id, title, updateTime, count]
//   create  —— 新建会话，返回新会话 _id（conversationId）
//   load    —— 按 conversationId 加载该会话的 messages（校验归属，仅返回最近 MAX_TURNS 轮给模型上下文）
//   append  —— 把一轮 [user, assistant] 追加进该会话（校验归属）；首条消息自动用作会话标题
//   remove  —— 删除指定会话（校验归属）
//   deleteAll —— 删除该 openid 的全部会话（校验归属，不影响 question_logs 等匿名分析数据）
// 所有按 conversationId 的写/读操作均校验 openid，越权返回错误，避免串号。
const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const COLLECTION = "conversations";
const MAX_TURNS = 20; // 控制传给模型的上下文轮数（1 轮 = 1 问 1 答）
const DEFAULT_TITLE = "新对话";

// 仅保留最近 MAX_TURNS 轮用于模型上下文（不裁剪存储，存储留全量）
function tailForContext(messages) {
  const pairs = [];
  for (let i = 0; i < messages.length; i += 2) {
    const u = messages[i];
    const a = messages[i + 1];
    if (u && u.role === "user" && a && a.role === "assistant") {
      pairs.push([u, a]);
    } else if (u && u.role === "user") {
      pairs.push([u]); // 末尾孤立的 user（理论上不会持久化）
    }
  }
  const keep = pairs.slice(-MAX_TURNS);
  return keep.reduce((acc, p) => acc.concat(p), []);
}

async function listSessions(openid) {
  const res = await db
    .collection(COLLECTION)
    .where({ openid })
    .orderBy("updateTime", "desc")
    .limit(100)
    .get();
  const list = (res.data || []).map((d) => ({
    _id: d._id,
    title: d.title || DEFAULT_TITLE,
    updateTime: d.updateTime || null,
    count: (d.messages || []).length,
  }));
  return { ok: true, list };
}

async function createSession(openid, title) {
  const res = await db.collection(COLLECTION).add({
    data: {
      openid,
      title: title || DEFAULT_TITLE,
      messages: [],
      createTime: db.serverDate(),
      updateTime: db.serverDate(),
    },
  });
  return { ok: true, _id: res._id };
}

// 取出属于该 openid 的会话文档，越权或无则返回 error
async function getOwnedDoc(openid, conversationId) {
  const docRes = await db.collection(COLLECTION).doc(conversationId).get();
  const d = docRes && docRes.data;
  if (!d) return { error: "会话不存在" };
  if (d.openid !== openid) return { error: "无权限访问该会话" };
  return { doc: d };
}

async function loadSession(openid, conversationId) {
  const r = await getOwnedDoc(openid, conversationId);
  if (r.error) return { ok: false, error: r.error };
  const messages = r.doc.messages || [];
  const emptyAssistant = messages.filter(
    (m) => m && m.role === "assistant" && !String(m.content || "").trim()
  ).length;
  console.log(
    "[history:load] conversationId=" + conversationId +
      " | 消息总数=" + messages.length +
      " | user=" + messages.filter((m) => m && m.role === "user").length +
      " | assistant=" + messages.filter((m) => m && m.role === "assistant").length +
      " | 空assistant=" + emptyAssistant
  );
  return { ok: true, messages: messages, exists: true };
}

// 规范化一条消息：字段白名单 + 服务端补 createdAt。
// 注意：数组内元素不能使用 db.serverDate()，故用 ISO 字符串。
function normalizeMessage(m) {
  if (!m || !m.role) return null;
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
}

async function appendSession(openid, conversationId, userMsg, assistantMsg) {
  const r = await getOwnedDoc(openid, conversationId);
  if (r.error) return { ok: false, error: r.error };
  const doc = r.doc;
  const normUser = normalizeMessage(userMsg);
  const normAssistant = normalizeMessage(assistantMsg);
  // 守卫：assistant 内容为空视为异常轮次，拒绝写入，避免历史里留下「空回答」。
  // （历史 Bug：前端打字机改写原对象，导致这里只收到 1 个字符甚至空串）
  if (!normAssistant || !normAssistant.content.trim()) {
    console.error("[history:append] 拒绝写入：assistant 内容为空 conversationId=" + conversationId);
    return { ok: false, error: "回答内容为空，未写入历史。" };
  }
  const newPair = [normUser, normAssistant].filter(Boolean);
  const incomingTitle = (userMsg && userMsg.content ? userMsg.content : "")
    .replace(/\s+/g, " ")
    .slice(0, 20);
  // 标题策略：已有非默认标题则保留；否则用首条用户消息前 20 字
  const nextTitle =
    doc.title && doc.title !== DEFAULT_TITLE ? doc.title : incomingTitle || doc.title || DEFAULT_TITLE;
  const merged = (doc.messages || []).concat(newPair);
  await db
    .collection(COLLECTION)
    .doc(conversationId)
    .update({
      data: {
        title: nextTitle,
        messages: merged,
        updateTime: db.serverDate(),
      },
    });
  console.log(
    "[history:append] conversationId=" + conversationId +
      " | 本轮写入=" + newPair.length +
      " | assistant长度=" + normAssistant.content.length +
      " | answerId=" + normAssistant.answerId +
      " | 累计消息=" + merged.length +
      " | 累计assistant=" + merged.filter((m) => m && m.role === "assistant").length
  );
  return { ok: true, total: merged.length };
}

async function removeSession(openid, conversationId) {
  const r = await getOwnedDoc(openid, conversationId);
  if (r.error) return { ok: false, error: r.error };
  await db.collection(COLLECTION).doc(conversationId).remove();
  return { ok: true };
}

// 删除该 openid 下的全部会话（仅 conversations 集合，不影响 question_logs / answer_feedback / answer_quality_log 等匿名分析数据）
async function deleteAllSessions(openid) {
  const res = await db.collection(COLLECTION).where({ openid }).remove();
  return { ok: true, removed: (res && res.stats && res.stats.removed) || 0 };
}

// ---------------- 收藏（favorites 集合） ----------------
// 用户把某条回答收藏到个人思辨库；按 openid+answerId 去重（重复收藏幂等）。
const FAV_COLLECTION = "favorites";

async function addFavorite(openid, item) {
  if (!item || !item.answerId) return { ok: false, error: "缺少收藏标识" };
  const cnt = await db.collection(FAV_COLLECTION).where({ openid, answerId: item.answerId }).count();
  if (cnt.total > 0) return { ok: true, duplicated: true };
  const doc = {
    openid,
    answerId: String(item.answerId),
    question: String(item.question || "").slice(0, 500),
    answer: String(item.answer || "").slice(0, 4000),
    citations: Array.isArray(item.citations) ? item.citations.slice(0, 20) : [],
    sage: item.sage || "none",
    answerMode: item.answerMode || "",
    createdAt: item.createdAt || new Date().toISOString(),
  };
  await db.collection(FAV_COLLECTION).add({ data: doc });
  return { ok: true, added: true };
}

async function listFavorites(openid) {
  const res = await db
    .collection(FAV_COLLECTION)
    .where({ openid })
    .orderBy("createdAt", "desc")
    .limit(200)
    .get();
  return {
    ok: true,
    list: (res.data || []).map((d) => ({
      _id: d._id,
      answerId: d.answerId,
      question: d.question,
      answer: d.answer,
      citations: d.citations || [],
      sage: d.sage || "none",
      answerMode: d.answerMode || "",
      createdAt: d.createdAt || null,
    })),
  };
}

async function removeFavorite(openid, answerId) {
  if (!answerId) return { ok: false, error: "缺少收藏标识" };
  await db.collection(FAV_COLLECTION).where({ openid, answerId: String(answerId) }).remove();
  return { ok: true };
}

exports.main = async (event) => {
  const ctx = cloud.getWXContext();
  const openid = ctx && ctx.OPENID;
  if (!openid) {
    return { ok: false, error: "未获取到用户身份，请稍后重试。" };
  }
  const action = (event && event.action) || "list";
  const conversationId = (event && event.conversationId) || "";
  try {
    if (action === "list") {
      return await listSessions(openid);
    }
    if (action === "create") {
      return await createSession(openid, event && event.title);
    }
    if (action === "load") {
      if (!conversationId) return { ok: false, error: "缺少会话 ID" };
      const r = await loadSession(openid, conversationId);
      return Object.assign({}, r, { context: tailForContext(r.messages || []) });
    }
    if (action === "append") {
      const userMsg = event && event.userMsg;
      const assistantMsg = event && event.assistantMsg;
      if (!conversationId) return { ok: false, error: "缺少会话 ID" };
      if (!userMsg || !assistantMsg) return { ok: false, error: "缺少消息内容。" };
      return await appendSession(openid, conversationId, userMsg, assistantMsg);
    }
    if (action === "remove") {
      if (!conversationId) return { ok: false, error: "缺少会话 ID" };
      return await removeSession(openid, conversationId);
    }
    if (action === "deleteAll") {
      // 仅删除该用户自己的全部会话；匿名分析数据（question_logs 等）不受影响
      return await deleteAllSessions(openid);
    }
    if (action === "favAdd") {
      if (!event.item) return { ok: false, error: "缺少收藏内容" };
      return await addFavorite(openid, event.item);
    }
    if (action === "favList") {
      return await listFavorites(openid);
    }
    if (action === "favRemove") {
      if (!event.answerId) return { ok: false, error: "缺少收藏标识" };
      return await removeFavorite(openid, event.answerId);
    }
    return { ok: false, error: "未知动作：" + action };
  } catch (e) {
    return { ok: false, error: "历史操作失败，请稍后重试。" };
  }
};
