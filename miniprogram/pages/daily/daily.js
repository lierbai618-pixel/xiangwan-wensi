// 向晚问思 · 每日一思页
// 复用 data/dailyThoughts.js；按日期确定性抽一张，可「换一张」在集合内轮替。
const { dailyThoughts } = require("../../data/dailyThoughts.js");

// 按日期确定性选取索引：同年同日稳定，跨日变化。
function dayIndex(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  const diff = date - start;
  const oneDay = 24 * 60 * 60 * 1000;
  return Math.floor(diff / oneDay); // 当年的第几天
}

function todayLabel(d) {
  const wd = ["日", "一", "二", "三", "四", "五", "六"][d.getDay()];
  return d.getFullYear() + "年" + (d.getMonth() + 1) + "月" + d.getDate() + "日 · 周" + wd;
}

Page({
  data: {
    card: null,
    dateLabel: "",
    total: dailyThoughts.length,
    idx: 0,
    offset: 0, // 「换一张」带来的临时偏移
  },

  onLoad() {
    this.refresh(false);
  },

  refresh(incr) {
    const now = new Date();
    const base = dayIndex(now) % this.data.total;
    const offset = incr ? (this.data.offset + 1) % this.data.total : 0;
    const idx = (base + offset) % this.data.total;
    this.setData({
      card: dailyThoughts[idx],
      dateLabel: todayLabel(now),
      idx: idx,
      offset: offset,
    });
  },

  changeCard() {
    this.refresh(true);
  },

  copyQuote() {
    const c = this.data.card;
    if (!c) return;
    const text = "「" + c.quote + "」——" + c.source.title + "·" + c.source.chapter;
    wx.showModal({
      title: "今日一思",
      content: text,
      showCancel: true,
      confirmText: "知道了",
      cancelText: "长按复制",
      success: () => {},
    });
  },

  goChat() {
    // 把今日问题与原文带入对话，鼓励展开
    const c = this.data.card;
    if (c) {
      wx.setStorageSync("pendingQuestion", c.question + "\n（今日一思：「" + c.quote + "」——" + c.source.title + "）");
    }
    wx.switchTab({ url: "/pages/chat/chat" });
  },

  onShareAppMessage() {
    const c = this.data.card || {};
    return {
      title: "向晚一思：" + (c.theme || "经典思辨") + "｜" + (c.quote || "").slice(0, 20) + "…",
      path: "/pages/daily/daily",
    };
  },
});
