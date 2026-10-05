// 向晚问思 · 关于页
const { books } = require("../../data/books.js");
const { dailyThoughts } = require("../../data/dailyThoughts.js");

function pickByDate() {
  const daysSinceEpoch = Math.floor(Date.now() / 86400000);
  return dailyThoughts[daysSinceEpoch % dailyThoughts.length];
}

Page({
  data: {
    books,
    thought: {},
    isAdmin: false,
  },

  onLoad() {
    this.setData({ thought: pickByDate() });
    this.checkAdmin();
  },

  // 2026-09-22 安全修复（P1-2）：管理入口默认隐藏，仅当后端确认当前用户是管理员时才展示。
  //   判定权完全在后端（admin 云函数 whoami 返回 isAdmin），前端只负责渲染，不做本地判断。
  //   任何失败/异常一律保持隐藏（fail-closed）——宁可管理员看不到入口，也不让普通用户看到。
  checkAdmin() {
    wx.cloud
      .callFunction({ name: "admin", data: { action: "whoami" } })
      .then((res) => {
        const r = (res && res.result) || {};
        this.setData({ isAdmin: r.isAdmin === true });
      })
      .catch(() => {
        this.setData({ isAdmin: false });
      });
  },

  // 在集合内轮替「每日思考」
  refreshThought() {
    const cur = this.data.thought.id;
    const idx = dailyThoughts.findIndex((t) => t.id === cur);
    const next = (idx + 1) % dailyThoughts.length;
    this.setData({ thought: dailyThoughts[next] });
  },

  goAdmin() {
    // 前端入口已按后端判定隐藏；此处再加一道本地守卫，防止绕过 UI 直接触发
    if (!this.data.isAdmin) {
      wx.showToast({ title: "无权限", icon: "none" });
      return;
    }
    wx.navigateTo({ url: "/pages/admin/admin" });
  },

  // 跳转隐私政策/用户协议
  goPrivacy(e) {
    const tab = (e.currentTarget.dataset && e.currentTarget.dataset.tab) || "privacy";
    wx.navigateTo({ url: "/pages/privacy/privacy?tab=" + tab });
  },

  // 分享转发：关于页也可转发，带封面图
  onShareAppMessage() {
    const t = this.data.thought;
    return {
      title: t && t.quote ? "向晚问思 · " + t.quote : "向晚问思 · 经典思辨助手",
      path: "/pages/chat/chat",
      imageUrl: "/assets/share-card.png",
    };
  },

  // 意见反馈：弹窗输入，提交到 feedback 云函数
  feedback() {
    wx.showModal({
      title: "意见反馈",
      editable: true,
      placeholderText: "说说你的建议或遇到的问题…",
      confirmText: "提交",
      success: (r) => {
        if (!r.confirm) return;
        const text = (r.content || "").trim();
        if (!text) {
          wx.showToast({ title: "内容不能为空", icon: "none" });
          return;
        }
        wx.showLoading({ title: "提交中", mask: true });
        wx.cloud
          .callFunction({ name: "feedback", data: { question: text } })
          .then((res) => {
            const ok = res && res.result && res.result.ok;
            wx.showToast({ title: ok ? "已收到，谢谢！" : "提交失败", icon: ok ? "success" : "none" });
          })
          .catch(() => {
            wx.showToast({ title: "提交失败", icon: "none" });
          })
          .then(() => wx.hideLoading());
      },
    });
  },
});
