// 向晚问思 · 首页
const { dailyThoughts } = require("../../data/dailyThoughts.js");
const { books } = require("../../data/books.js");

// 按日期确定性抽取一条「今日思考」
function pickByDate(list) {
  const daysSinceEpoch = Math.floor(Date.now() / 86400000);
  return daysSinceEpoch % list.length;
}

Page({
  data: {
    thought: {},
    thoughtIdx: 0,
    bookCount: books.length,
    showPrivacy: false, // 首次进入的隐私授权浮层（全局入口）
  },

  onLoad() {
    // 首次进入且未同意隐私政策 → 弹授权浮层（审核合规，覆盖全入口）
    if (!wx.getStorageSync("privacyAgreed")) {
      this.setData({ showPrivacy: true });
    }
    const idx = pickByDate(dailyThoughts);
    this.setData({ thought: dailyThoughts[idx], thoughtIdx: idx });
  },

  // 同意隐私政策：写缓存，关闭浮层
  agreePrivacy() {
    wx.setStorageSync("privacyAgreed", true);
    this.setData({ showPrivacy: false });
  },

  // 不同意：说明需同意后方可使用，提供退出
  declinePrivacy() {
    wx.showModal({
      title: "温馨提示",
      content: "需同意《隐私政策》与《用户协议》后才能使用本小程序。",
      confirmText: "查看并同意",
      cancelText: "退出",
      success: (res) => {
        if (res.cancel && wx.exitMiniProgram) {
          wx.exitMiniProgram({ fail: () => {} });
        }
      },
    });
  },

  // 从浮层跳转到完整协议页
  openPrivacy(e) {
    const tab = (e.currentTarget.dataset && e.currentTarget.dataset.tab) || "privacy";
    wx.navigateTo({ url: "/pages/privacy/privacy?tab=" + tab });
  },

  // 换一张：在集合内轮替（不保存）
  changeThought() {
    const next = (this.data.thoughtIdx + 1) % dailyThoughts.length;
    this.setData({ thought: dailyThoughts[next], thoughtIdx: next });
  },

  goChat() {
    wx.switchTab({ url: "/pages/chat/chat" });
  },

  goDaily() {
    wx.navigateTo({ url: "/pages/daily/daily" });
  },

  goQuiz() {
    wx.navigateTo({ url: "/pages/quiz/quiz" });
  },

  goBooks() {
    wx.navigateTo({ url: "/pages/books/books" });
  },

  // 2026-09-21 CR-删除卜算子模块（第四轮）：goBusuanzi() 已移除。
  //   回滚：从 .CR20260921D-bak/home.js 恢复本方法，并还原 home.wxml 与 app.json。

  onShareAppMessage() {
    const t = this.data.thought;
    return {
      title: t && t.quote ? "向晚问思 · " + t.quote : "向晚问思 · 以经典为镜，陪你思考人生",
      path: "/pages/home/home",
      imageUrl: "/assets/share-card.png",
    };
  },
});
