// 向晚问思 - 管理页
function pad(n) {
  return n < 10 ? "0" + n : "" + n;
}

function formatTime(v) {
  if (!v) return "";
  let d;
  if (typeof v === "string") {
    d = new Date(v);
  } else if (v && v.$date) {
    d = new Date(v.$date);
  } else if (v instanceof Date) {
    d = v;
  } else {
    return "";
  }
  if (isNaN(d.getTime())) return "";
  return (
    d.getFullYear() +
    "-" +
    pad(d.getMonth() + 1) +
    "-" +
    pad(d.getDate()) +
    " " +
    pad(d.getHours()) +
    ":" +
    pad(d.getMinutes())
  );
}

function defaultModelForm() {
  return {
    name: "百炼",
    apiKey: "",
    baseURL: "https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    timeout: 30000,
    enabled: true,
    order: 1,
    note: "阿里云百炼 OpenAI 兼容模式",
  };
}

function normalizeModelError(message) {
  const msg = (message || "").toString();
  if (/HTTP_404/i.test(msg) || /Model not exist/i.test(msg)) {
    return "模型 ID 不存在。百炼兼容模式通常填写 qwen-plus、qwen-max 这类小写模型 ID；不要填控制台展示名，例如 Qwen3.7-Max。";
  }
  if (/HTTP_401/i.test(msg) || /Incorrect API key/i.test(msg)) {
    return "API Key 不正确或已失效。请确认使用的是当前百炼业务空间对应地域的 API Key。";
  }
  if (/HTTP_429/i.test(msg) || /quota/i.test(msg)) {
    return "请求频率或额度超限。请稍后重试，或检查账号余额与调用配额。";
  }
  if (/timeout/i.test(msg)) {
    return "请求超时。请检查百炼地域地址、业务空间 ID 和网络连通性。";
  }
  return msg || "测试失败";
}

Page({
  data: {
    stats: { totalUsers: 0, totalChats: 0, todayChats: 0 },
    users: [],
    currentUser: "",
    currentLogs: [],
    models: [],
    insights: { totalQuestions: 0, topTags: [], topQuestions: [] },
    showModelForm: false,
    editingModel: "",
    modelForm: defaultModelForm(),
    savingModel: false,
  },

  onShow() {
    this.loadAll();
    this.loadWhoami();
    this.loadModels();
    this.loadInsights();
  },

  // D-3 问题洞察：高频标签与高频提问，用于 problem_tags 优化与召回提升
  loadInsights() {
    wx.cloud
      .callFunction({ name: "admin", data: { action: "insights" } })
      .then((res) => {
        const r = (res && res.result) || {};
        if (r.ok) {
          this.setData({
            insights: {
              totalQuestions: r.totalQuestions || 0,
              categoryBreakdown: r.categoryBreakdown || [],
              topTags: r.topTags || [],
              topQuestions: r.topQuestions || [],
              feedback: r.feedback || {},
              quality: r.quality || {},
            },
          });
        }
      })
      .catch(() => {});
  },

  loadWhoami() {
    wx.cloud
      .callFunction({ name: "admin", data: { action: "whoami" } })
      .then((res) => {
        const r = (res && res.result) || {};
        if (r.ok) this.setData({ myOpenid: r.openid || "unknown" });
      })
      .catch(() => {});
  },

  copyOpenid() {
    if (!this.data.myOpenid) return;
    wx.showModal({
      title: "我的 openid",
      content: this.data.myOpenid,
      showCancel: false,
      confirmText: "知道了",
    });
  },

  loadAll() {
    this.loadStats();
    this.loadUsers();
  },

  loadStats() {
    wx.cloud
      .callFunction({ name: "admin", data: { action: "stats" } })
      .then((res) => {
        const r = (res && res.result) || {};
        if (r.ok) this.setData({ stats: r });
        else if (r.error) wx.showToast({ title: r.error, icon: "none" });
      })
      .catch(() => {});
  },

  loadUsers() {
    wx.cloud
      .callFunction({ name: "admin", data: { action: "users" } })
      .then((res) => {
        const r = (res && res.result) || {};
        if (r.ok) {
          const users = (r.users || []).map((u) => Object.assign({}, u, { lastActiveText: formatTime(u.lastActive) }));
          this.setData({ users });
        } else if (r.error) {
          wx.showToast({ title: r.error, icon: "none" });
        }
      })
      .catch(() => {});
  },

  openUser(e) {
    const openid = e.currentTarget.dataset.openid;
    wx.cloud
      .callFunction({ name: "admin", data: { action: "user", openid } })
      .then((res) => {
        const r = (res && res.result) || {};
        if (!r.ok) {
          wx.showToast({ title: r.error || "查询失败", icon: "none" });
          return;
        }
        const logs = (r.logs || []).map((l, i) => Object.assign({}, l, { id: "log-" + i, timeText: formatTime(l.createTime) }));
        this.setData({ currentUser: openid, currentLogs: logs });
      })
      .catch(() => {});
  },

  closeUser() {
    this.setData({ currentUser: "", currentLogs: [] });
  },

  loadModels() {
    wx.cloud
      .callFunction({ name: "admin", data: { action: "models" } })
      .then((res) => {
        const r = (res && res.result) || {};
        if (r.ok) this.setData({ models: r.models || [] });
      })
      .catch(() => {});
  },

  openAddModel() {
    this.setData({ showModelForm: true, editingModel: "", modelForm: defaultModelForm() });
  },

  openEditModel(e) {
    const id = e.currentTarget.dataset.id;
    const m = (this.data.models || []).find((x) => x._id === id);
    if (!m) return;
    this.setData({
      showModelForm: true,
      editingModel: id,
      modelForm: {
        name: m.name || "",
        apiKey: m.apiKey || "",
        baseURL: m.baseURL || "",
        model: m.model || "",
        timeout: m.timeout || 30000,
        enabled: m.enabled !== false,
        order: typeof m.order === "number" ? m.order : 1,
        note: m.note || "",
      },
    });
  },

  closeModelForm() {
    this.setData({ showModelForm: false, editingModel: "" });
  },

  onModelInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ["modelForm." + field]: e.detail.value });
  },

  onFormEnabled(e) {
    this.setData({ "modelForm.enabled": e.detail.value });
  },

  saveModel() {
    if (this.data.savingModel) return;
    const f = this.data.modelForm;
    if (!f.name || !f.name.trim()) return wx.showToast({ title: "请填写显示名", icon: "none" });
    if (!f.apiKey || !f.apiKey.trim()) return wx.showToast({ title: "请填写百炼 API Key", icon: "none" });
    if (!f.baseURL || !f.baseURL.trim()) return wx.showToast({ title: "请填写兼容接口地址", icon: "none" });
    if (!f.model || !f.model.trim()) return wx.showToast({ title: "请填写模型 ID", icon: "none" });

    const payload = {
      name: f.name.trim(),
      apiKey: f.apiKey.trim(),
      baseURL: f.baseURL.trim(),
      model: f.model.trim(),
      timeout: Number(f.timeout) > 0 ? Number(f.timeout) : 30000,
      enabled: f.enabled !== false,
      order: Number(f.order) >= 0 ? Number(f.order) : 99,
      note: (f.note || "").toString().slice(0, 200),
    };
    if (this.data.editingModel) payload._id = this.data.editingModel;

    this.setData({ savingModel: true });
    wx.cloud
      .callFunction({ name: "admin", data: { action: "model_save", model: payload } })
      .then((res) => {
        const r = (res && res.result) || {};
        if (r.ok) {
          wx.showToast({ title: "已保存", icon: "success" });
          this.setData({ showModelForm: false, editingModel: "" });
          this.loadModels();
        } else {
          wx.showToast({ title: r.error || "保存失败", icon: "none" });
        }
      })
      .catch((err) => wx.showToast({ title: "保存失败：" + (err && err.errMsg ? err.errMsg : ""), icon: "none" }))
      .then(() => this.setData({ savingModel: false }));
  },

  deleteModel(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.showModal({
      title: "删除模型",
      content: "确定删除该模型配置？",
      success: (sm) => {
        if (!sm.confirm) return;
        wx.cloud
          .callFunction({ name: "admin", data: { action: "model_delete", _id: id } })
          .then((res) => {
            const r = (res && res.result) || {};
            wx.showToast({ title: r.ok ? "已删除" : r.error || "删除失败", icon: r.ok ? "success" : "none" });
            if (r.ok) this.loadModels();
          })
          .catch(() => wx.showToast({ title: "删除失败", icon: "none" }));
      },
    });
  },

  onToggleEnabled(e) {
    const id = e.currentTarget.dataset.id;
    const enabled = e.detail.value;
    const m = (this.data.models || []).find((x) => x._id === id);
    if (!m) return;
    const payload = {
      _id: id,
      name: m.name,
      apiKey: m.apiKey,
      baseURL: m.baseURL,
      model: m.model,
      timeout: m.timeout || 30000,
      enabled,
      order: typeof m.order === "number" ? m.order : 99,
      note: m.note || "",
    };
    wx.cloud
      .callFunction({ name: "admin", data: { action: "model_save", model: payload } })
      .then((res) => {
        const r = (res && res.result) || {};
        if (r.ok) this.loadModels();
        else wx.showToast({ title: r.error || "操作失败", icon: "none" });
      })
      .catch(() => {});
  },

  testModel(e) {
    const id = e.currentTarget.dataset.id;
    const m = (this.data.models || []).find((x) => x._id === id);
    if (!m) return;

    wx.showLoading({ title: "测试中…", mask: true });
    wx.cloud
      .callFunction({
        name: "admin",
        data: {
          action: "model_test",
          model: {
            apiKey: m.apiKey,
            baseURL: m.baseURL,
            model: m.model,
            timeout: m.timeout || 30000,
          },
        },
      })
      .then((res) => {
        const r = (res && res.result) || {};
        const models = (this.data.models || []).map((x) =>
          x._id === id
            ? Object.assign({}, x, {
                _testOk: r.ok,
                _testResult: r.ok ? "连接成功：" + (r.answer || "").slice(0, 40) : "失败：" + normalizeModelError(r.error),
              })
            : x
        );
        this.setData({ models });
      })
      .catch((err) => {
        const models = (this.data.models || []).map((x) =>
          x._id === id
            ? Object.assign({}, x, { _testOk: false, _testResult: "失败：" + normalizeModelError(err && err.errMsg) })
            : x
        );
        this.setData({ models });
      })
      .then(() => wx.hideLoading());
  },
});
