// 向晚问思 · 会话列表页（多会话管理）
// 列出当前用户所有会话，支持新建对话、进入会话、删除会话。
// 进入/新建会把目标会话 _id 写入 storage.currentConversationId，
// 返回聊天页后由 chat.onShow 检测到变化并加载对应会话。
const fmtTime = (ts) => {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "";
    const p = (n) => String(n).padStart(2, "0");
    return d.getMonth() + 1 + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  } catch (e) {
    return "";
  }
};

Page({
  data: {
    sessions: [],
    loading: false,
  },

  onShow() {
    this.loadList();
  },

  loadList() {
    this.setData({ loading: true });
    wx.cloud
      .callFunction({ name: "history", data: { action: "list" } })
      .then((res) => {
        const r = (res && res.result) || {};
        if (r.ok && Array.isArray(r.list)) {
          const cur = wx.getStorageSync("currentConversationId") || "";
          const list = r.list.map((s) =>
            Object.assign({}, s, {
              timeText: fmtTime(s.updateTime),
              active: s._id === cur,
            })
          );
          this.setData({ sessions: list });
        }
      })
      .catch(() => {})
      .then(() => this.setData({ loading: false }));
  },

  // 进入某条会话
  openSession(e) {
    const id = e.currentTarget.dataset.id;
    wx.setStorageSync("currentConversationId", id);
    wx.navigateBack();
  },

  // 新建会话并直接进入
  newSession() {
    wx.cloud
      .callFunction({ name: "history", data: { action: "create" } })
      .then((res) => {
        const r = (res && res.result) || {};
        const cid = r._id || "";
        wx.setStorageSync("currentConversationId", cid);
        wx.navigateBack();
      })
      .catch(() => {
        wx.navigateBack();
      });
  },

  // 删除会话
  removeSession(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: "删除会话",
      content: "确定删除这条会话记录吗？此操作不可恢复。",
      confirmText: "删除",
      confirmColor: "#a32d2d",
      success: (r) => {
        if (!r.confirm) return;
        wx.cloud
          .callFunction({ name: "history", data: { action: "remove", conversationId: id } })
          .then(() => {
            const cur = wx.getStorageSync("currentConversationId") || "";
            if (cur === id) wx.removeStorageSync("currentConversationId");
            this.loadList();
          })
          .catch(() => {});
      },
    });
  },
});
