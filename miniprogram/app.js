// 向晚问思 - 小程序入口
// 初始化微信云开发。使用 DYNAMIC_CURRENT_ENV 可自动指向当前云环境，
// 无需手动填写环境 ID（无论账号下有几个环境都能正确路由）。
App({
  globalData: {
    openid: "", // 当前用户匿名标识（来自 chat 云函数 getWXContext().OPENID）
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error("当前基础库不支持云开发，请使用 2.2.3 或以上的基础库");
      return;
    }
    wx.cloud.init({
      env: wx.cloud.DYNAMIC_CURRENT_ENV,
      traceUser: true,
    });
    this.login();
  },

  // 轻登录：不弹授权、不拿头像昵称，只用 openid 做用户维度区分。
  // 调专门的 login 云函数取 OPENID（取自云上下文，客户端无法伪造），前端缓存到本地。
  login() {
    const cached = wx.getStorageSync("openid");
    if (cached) {
      this.globalData.openid = cached;
      return Promise.resolve(cached);
    }
    return wx.cloud
      .callFunction({ name: "login", data: {} })
      .then((res) => {
        const openid = (res && res.result && res.result.openid) || "";
        if (openid) {
          this.globalData.openid = openid;
          wx.setStorageSync("openid", openid);
        }
        return openid;
      })
      .catch(() => "");
  },
});
