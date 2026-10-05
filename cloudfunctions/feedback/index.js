// 向晚问思 - 回答质量反馈云函数（Phase E-v2 · E-5 / Phase F · answer_quality_log）
// 两类写入，共用一个函数，前端按 type 区分：
//   type=rate    -> answer_feedback   （量化：helpful 是/否 + 负向原因 chip）
//   type=quality -> answer_quality_log （定性：为什么有效/无效，failureReason / goodPoint 自由文本）
// 我们真正要优化的是「用户觉得有没有被帮助、以及为什么」。
const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event) => {
  const data = (event && event.data) ? event.data : event;
  const type = (data.type || "rate").toString();
  const question = (data.question || "").toString().slice(0, 1000);
  const answerId = (data.answer_id || "").toString().slice(0, 64);

  if (!question) {
    return { ok: false, error: "缺少问题内容" };
  }

  try {
    const ctx = cloud.getWXContext();
    const openid = (ctx && ctx.OPENID) || "unknown";

    // —— 定性反馈：记录「为什么这条回答有效 / 无效」——
    if (type === "quality") {
      const failureReason = (data.failureReason || "").toString().slice(0, 200);
      const goodPoint = (data.goodPoint || "").toString().slice(0, 200);
      if (!failureReason && !goodPoint) {
        return { ok: true, skipped: true };
      }
      await db.collection("answer_quality_log").add({
        data: {
          openid: openid,
          question: question,
          answer_id: answerId,
          failureReason: failureReason,
          goodPoint: goodPoint,
          createTime: db.serverDate(),
        },
      });
      return { ok: true };
    }

    // —— 量化反馈（默认）——
    const helpful = !!(data.helpful === true || data.helpful === "true" || data.helpful === 1);
    const reason = (data.reason || "").toString().slice(0, 50);
    await db.collection("answer_feedback").add({
      data: {
        openid: openid,
        question: question,
        answer_id: answerId,
        helpful: helpful,
        reason: reason,
        createTime: db.serverDate(),
      },
    });
    return { ok: true };
  } catch (e) {
    const msg = e && e.message ? e.message : "" + e;
    console.error("反馈写入失败:", msg);
    return { ok: false, error: msg };
  }
};
