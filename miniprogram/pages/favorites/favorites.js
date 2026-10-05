// 向晚问思 · 收藏夹
// 拉取当前用户收藏的回答；点击展开/收起，可一键带去对话，或移除收藏。
Page({
  data: {
    list: [],
    loading: false,
    empty: false,
  },

  onShow() {
    this.load();
  },

  load() {
    const openid = (getApp().globalData && getApp().globalData.openid) || wx.getStorageSync("openid");
    if (!openid) {
      this.setData({ list: [], empty: true, loading: false });
      return;
    }
    this.setData({ loading: true });
    wx.cloud
      .callFunction({ name: "history", data: { action: "favList" } })
      .then((res) => {
        const r = (res && res.result) || {};
        const raw = Array.isArray(r.list) ? r.list : [];
        const list = raw.map((f, i) => Object.assign({}, f, { _id: f._id || "f" + i, _open: false }));
        this.setData({ list, empty: list.length === 0, loading: false });
      })
      .catch(() => {
        this.setData({ list: [], empty: true, loading: false });
      });
  },

  toggle(e) {
    const id = e.currentTarget.dataset.id;
    const list = this.data.list.map((f) => (f._id === id ? Object.assign({}, f, { _open: !f._open }) : f));
    this.setData({ list });
  },

  // 带去对话：回填该收藏的问题（与先贤视角）到聊天页
  goChatWithFav(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.list.find((f) => f._id === id);
    if (!item) return;
    if (item.sage && item.sage !== "none") {
      wx.setStorageSync("pendingSage", item.sage);
    }
    wx.setStorageSync("pendingQuestion", item.question || item.answer || "");
    wx.switchTab({ url: "/pages/chat/chat" });
  },

  remove(e) {
    const id = e.currentTarget.dataset.id;
    const item = this.data.list.find((f) => f._id === id);
    if (!item) return;
    wx.showModal({
      title: "取消收藏",
      content: "确定移除这条收藏？",
      confirmText: "移除",
      confirmColor: "#a32d2d",
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: "移除中", mask: true });
        wx.cloud
          .callFunction({ name: "history", data: { action: "favRemove", answerId: item.answerId } })
          .then((res2) => {
            const ok = res2 && res2.result && res2.result.ok;
            if (ok) {
              this.setData({ list: this.data.list.filter((f) => f._id !== id) });
            }
            wx.showToast({ title: ok ? "已移除" : "操作失败", icon: ok ? "success" : "none" });
          })
          .catch(() => wx.showToast({ title: "操作失败", icon: "none" }))
          .then(() => wx.hideLoading());
      },
    });
  },

  onShareAppMessage() {
    return { title: "向晚问思 · 我的收藏", path: "/pages/favorites/favorites" };
  },
});
