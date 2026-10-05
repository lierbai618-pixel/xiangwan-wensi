// 向晚问思 - 隐私政策 & 用户协议页
// 独立可访问页面，供隐私授权弹窗、关于页入口跳转。内容为静态展示。
Page({
  data: {
    tab: "privacy", // privacy | terms
    // 2026-09-21：新增「剪贴板写入」披露条目（人格测试页外链复制功能的前置声明）
    updatedAt: "2026-09-21",
  },

  onLoad(options) {
    if (options && options.tab === "terms") {
      this.setData({ tab: "terms" });
    }
  },

  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (tab && tab !== this.data.tab) {
      this.setData({ tab });
    }
  },
});
