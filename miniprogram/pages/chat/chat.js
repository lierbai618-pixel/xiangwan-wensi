// 向晚问思 · 聊天页
// ★ 前端不持有任何模型/API 配置 ★
// 模型由管理后台（admin）配置在云数据库 model_config 集合，
// chat 云函数读取并多模型自动切换生成增强回答；本页只发问题、收结果，并带上回答模式(mode)。
// 若后台未配置模型或模型全部失败，云函数会回退本地检索式回答。
// 前端新增三模式选择器（Phase Q2-2）：answerMode(fast/deep/think) 透传后端，
// 与既有 mode(RAG 深度) 并存；本注释仅说明，不改变任何请求/回答逻辑。

const topics = [
  { label: "我很迷茫", prompt: "我现在很迷茫，不知道人生方向怎么找？", tag: "迷茫" },
  { label: "我失败了", prompt: "我最近经历了一次失败，很难走出来，该怎么看待？", tag: "失败" },
  { label: "在意评价", prompt: "我总是在意别人怎么看我，怎么办？", tag: "关系" },
  { label: "认识自己", prompt: "我想更认识自己，但不知道从哪里开始？", tag: "自我" },
  { label: "情绪失控", prompt: "我最近情绪起伏很大，怎样才能稳一点？", tag: "情绪" },
  { label: "想改变", prompt: "我想改变现状，但一直拖延、迈不出第一步，怎么办？", tag: "行动" },
  { label: "意义感", prompt: "我觉得生活没什么意义，这种感觉正常吗？", tag: "意义" },
  { label: "长期坚持", prompt: "我想长期做一件事，但总半途而废，怎么坚持下去？", tag: "长期" },
];

// 模式选择器（Phase Q2-2）：🌐普通 / 🌅思考 / 🔍苏格拉底 / 🫂倾诉。
// 与后端 answerMode(fast/think/socratic/soothe) 一一对应；默认 think 与后端默认一致。
// 2026-09-21 CR-精简问答卡片（第三轮）：**移除 📚 深度（key="deep"）选项**。
//   仅前端选项下架，后端 answerMode 的 deep 分支保留未动（回滚只需恢复本数组一行）。
// 注：旧 RAG 深度子开关 `mode`(plain/deep/classic) 仍保留在请求中（默认 plain），
//     保证后端链路兼容，本阶段不改变其默认回答逻辑。
const answerModes = [
  { key: "fast", icon: "🌐", label: "普通", desc: "通用助手：自然对话，简洁直接，不套模板" },
  { key: "think", icon: "🌅", label: "思考", desc: "结合体：先讲清事实，再从思辨角度追问一层" },
  { key: "socratic", icon: "🔍", label: "苏格拉底", desc: "苏格拉底式追问：不直接给答案，用一连串问题帮你自己想清楚" },
  { key: "soothe", icon: "🫂", label: "倾诉", desc: "情绪出口：倾听优先，先接住你的感受，不急于给方案" },
];

// 情绪出口（P0）：公版经典抚慰知识包 + 危机护栏（前端依赖，含情绪/危机识别与先贤卡片）
const comfort = require("../../data/comfort.js");

// 先贤视角（Phase X）：「谁在答」。与后端 modePersona.SAGES 的 key 保持一致。
// 选中任一先贤后，后端会以其口吻与精神回应；选「无」则走常规模式。
const sages = [
  { key: "none", name: "无", desc: "常规回答" },
  { key: "kongzi", name: "孔子", desc: "温润长者：重仁、礼、学、省，多用反问引导自省" },
  { key: "laozi", name: "老子", desc: "玄远留白：道法自然、无为、柔弱胜刚强" },
  { key: "mengzi", name: "孟子", desc: "气盛言直：性善、养气、义利之辨" },
  { key: "zhuangzi", name: "庄子", desc: "洒脱寓言：逍遥、齐物、无用之用" },
  { key: "wangyangming", name: "王阳明", desc: "心即理：知行合一、致良知" },
  { key: "socrates", name: "苏格拉底", desc: "产婆术：用追问帮你想清，而非给答案" },
  { key: "epictetus", name: "爱比克泰德", desc: "斯多葛：区分可控与不可控，求内在自由" },
  { key: "marx", name: "马克思", desc: "实践与矛盾：看事物的物质根基与社会关系" },
];

function modeLabel(key) {
  return key === "deep" ? "深度思考" : key === "classic" ? "经典引用" : "普通解释";
}

function answerModeLabel(key) {
  // 注：deep 分支**刻意保留** —— 2026-09-21 起新对话不再可选「深度」，
  //     但历史会话中已存在的 deep 消息仍需正确显示为「📚 深度」，故不可删除本分支。
  return key === "fast" ? "🌐 普通" : key === "deep" ? "📚 深度" : key === "soothe" ? "🫂 倾诉" : "🌅 思考";
}

const starter = {
  id: "starter",
  role: "assistant",
  content:
    "你好，我是「向晚问思」，一个以经典哲学、文学与心理学为根基的思辨助手。我不会替你做决定，而是陪你一起把问题看清、拓展视角，最后把判断留给你自己。先说说眼下最卡住你的事？",
  citations: [],
  _citesOpen: false,
};

Page({
  data: {
    messages: [starter],
    inputValue: "",
    loading: false,
    topics,
    answerModes,
    answerMode: "think", // 三模式默认「思考」，与后端 answerMode 默认一致
    mode: "plain",       // 旧 RAG 深度子开关字段保留，默认 plain 不变，保证后端链路兼容
    modeDesc: "结合体：先讲清事实，再从思辨角度追问一层",
    sages,               // 先贤视角候选
    sage: "none",        // 当前选中的先贤 key（none=不使用先贤视角）
    sageName: "",        // 当前先贤展示名（用于提示）
    sageDesc: "",        // 当前先贤一句话说明
    showTopics: true,
    scrollTarget: "msg-starter", // 恒定有效目标，避免初始空串导致 scroll-view 抖动
    _convId: "", // 当前会话 ID（conversationId），贯穿 load/append/新对话
    _loadingHistory: false,
    _typingToken: 0,
    showPrivacy: false, // 首次进入的隐私授权浮层
  },

  onLoad() {
    // 首次进入且未同意隐私政策 → 弹授权浮层（审核合规）
    if (!wx.getStorageSync("privacyAgreed")) {
      this.setData({ showPrivacy: true });
    }
    // 会话初始化放到 onShow，确保每次回到聊天页都校准备当前会话
  },

  onShow() {
    // 先消费「待带入对话」的暂存（来自每日一思/人格测试/收藏页），再决定是否重载会话，
    // 确保即使在已加载的同一会话中也照常回填，回填后立刻清除，避免反复套用。
    this.applyPending();
    const cid = wx.getStorageSync("currentConversationId") || "";
    if (cid && cid === this.data._convId) return; // 同一会话不重复加载
    this.ensureSession();
  },

  // 消费 pendingSage / pendingQuestion：回填先贤选择与输入框，并清除 storage。
  applyPending() {
    const pendingSage = wx.getStorageSync("pendingSage");
    const pendingQuestion = wx.getStorageSync("pendingQuestion");
    if (!pendingSage && !pendingQuestion) return;
    const patch = {};
    if (pendingQuestion) {
      patch.inputValue = pendingQuestion;
      wx.removeStorageSync("pendingQuestion");
    }
    if (pendingSage && pendingSage !== "none") {
      const def = (this.data.sages || []).find((s) => s.key === pendingSage);
      if (def) {
        patch.sage = pendingSage;
        patch.sageName = def.name;
        patch.sageDesc = def.desc;
      }
      wx.removeStorageSync("pendingSage");
    }
    if (Object.keys(patch).length) this.setData(patch);
  },

  // 确保有可用会话：有 currentConversationId 则加载，否则新建
  ensureSession() {
    const cid = wx.getStorageSync("currentConversationId") || "";
    if (cid) {
      this.loadConversation(cid);
    } else {
      this.createConversation();
    }
  },

  // 按 conversationId 加载指定会话；不存在或为空则回初始引导
  // 恢复目标：用户消息 + AI 回答 + 引用来源 + 时间 + 反馈能力（answerId/_isAnswer/_question）。
  // 只恢复用户输入是不合格的——历史回答必须完整可读、可展开来源、可继续反馈。
  loadConversation(cid) {
    this.setData({ _loadingHistory: true, _convId: cid });
    wx.cloud
      .callFunction({ name: "history", data: { action: "load", conversationId: cid } })
      .then((res) => {
        const r = (res && res.result) || {};
        const raw = Array.isArray(r.messages) ? r.messages : [];
        const userCount = raw.filter((m) => m && m.role === "user").length;
        const assistantCount = raw.filter((m) => m && m.role === "assistant").length;
        // 会话恢复链路调试日志（排查「回答消失」类问题的第一现场）
        console.log(
          "[会话恢复] conversationId=" + cid +
          " | 加载消息数=" + raw.length +
          " | user=" + userCount +
          " | assistant=" + assistantCount +
          " | 空内容assistant=" + raw.filter((m) => m && m.role === "assistant" && !(m.content || "").trim()).length
        );
        if (r.ok && raw.length > 0) {
          const stamp = Date.now();
          const msgs = raw.map((m, i) => {
            const base = Object.assign({}, m, {
              id: m.id || "h-" + i + "-" + stamp,
              citations: (m.citations || []).map((c) => Object.assign({}, c, { _textOpen: false })),
              _citesOpen: false,
              _typing: false, // 历史消息直接整条呈现，不再走打字机
            });
            if (m.role === "assistant") {
              // 反馈相关字段：有 answerId 才是一条真实回答，可继续点赞/反馈
              base.answerId = m.answerId || "";
              base._isAnswer = !!m.answerId;
              base._question = (raw[i - 1] && raw[i - 1].role === "user" && raw[i - 1].content) || "";
              base._mode = m.mode || "";
              base._reqModeLabel = m.modeLabel || "";
              base._answerMode = m.answerMode || "";
              base._answerModeLabel = m.answerModeLabel || "";
              base._modelUsed = m.modelUsed || "";
              base._sage = m.sage || "none";
              base._sageName = m.sageName || "";
              base._socratic = !!m.socratic;
              base._faved = false; // 稍后由收藏列表对账回填
              base._modelError = "";
              base._feedback = null;
              base._showReasons = false;
              base._qualityOpen = false;
              base._qualityFailure = "";
              base._qualityGood = "";
              base._qualityDone = false;
              // route 结构不完整时置空，避免 wxml 访问 route.dimensions.length 报错
              base.route = m.route && Array.isArray(m.route.dimensions) ? m.route : null;
            }
            return base;
          });
          this.setData({
            messages: msgs,
            showTopics: false,
            scrollTarget: "msg-" + msgs[msgs.length - 1].id,
          });
          this.syncFavState(msgs); // 收藏态对账：标记历史中已收藏的回答
        } else {
          this.setData({ messages: [starter], showTopics: true, scrollTarget: "msg-starter" });
        }
      })
      .catch((e) => {
        console.warn("[会话恢复] 失败 conversationId=" + cid, e);
        this.setData({ messages: [starter], showTopics: true, scrollTarget: "msg-starter" });
      })
      .then(() => this.setData({ _loadingHistory: false }));
  },

  // 新建会话并设为当前；新建即空会话（旧会话保留在列表，由 sessions 页管理）
  createConversation(cb) {
    wx.cloud
      .callFunction({ name: "history", data: { action: "create" } })
      .then((res) => {
        const r = (res && res.result) || {};
        const cid = r._id || "";
        wx.setStorageSync("currentConversationId", cid);
        this.setData({ messages: [starter], showTopics: true, _convId: cid, _loadingHistory: false });
        if (cb) cb(cid);
      })
      .catch(() => {
        // 失败不清空 _convId：保留已生成的本地兜底 ID，保证即使 history 未部署也能正常收发；
        // 若已有真实 cid（如 send 设置的本地 ID），也不应被清掉。
        this.setData({ messages: [starter], showTopics: true, _loadingHistory: false });
        if (cb) cb("");
      });
  },

  // 打开会话列表页
  openSessions() {
    wx.navigateTo({ url: "/pages/sessions/sessions" });
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

  // loadHistory 已由多会话模型取代：见 loadConversation / createConversation / ensureSession

  // 把一轮 [user, assistant] 追加进云端当前会话（不阻塞主流程，失败静默）
  //
  // ★★ 关键约束：传入的 assistantMsg 必须是「完整内容的快照副本」★★
  //   typewriter() 用 setData 数据路径逐字更新 messages[idx].content，
  //   而 this.data.messages[idx] 与 assistantMsg 是同一个对象引用，
  //   因此打字机一旦启动就会把原对象的 content 改写成「已显示的部分」。
  //   历史 Bug：appendHistory 在 typewriter 之后调用 → 云端只存下第 1 个字符「【」，
  //   切回会话时 AI 回答看起来「消失」。修复＝先快照后打字，且此处只读快照。
  appendHistory(userMsg, assistantMsg, cid) {
    const openid = (getApp().globalData && getApp().globalData.openid) || wx.getStorageSync("openid");
    const conversationId = cid || this.data._convId || "";
    if (!openid || !conversationId) {
      console.warn("[会话持久化] 跳过：openid=" + !!openid + " conversationId=" + conversationId);
      return;
    }
    const nowIso = new Date().toISOString();
    // 去掉前端临时字段，只存必要内容，避免体积膨胀；
    // 引用保留渲染详情所需字段，保证历史消息也能展开「思想来源」。
    const cleanCites = (list) =>
      (list || []).map((c) => ({
        title: c.title || "",
        section: c.section || "",
        source: c.source || "",
        year: c.year || "",
        text: c.text || "",
        why: c.why || "",
        principle: c.principle || "",
        inspiration: c.inspiration || "",
        tags: c.tags || [],
      }));
    const clean = (m) => {
      const base = {
        role: m.role,
        content: m.content || "",
        createdAt: m.createdAt || nowIso,
        citations: cleanCites(m.citations),
      };
      if (m.role === "assistant") {
        base.answerId = m.answerId || "";
        base.mode = m._mode || "";
        base.modeLabel = m._reqModeLabel || "";
        base.answerMode = m._answerMode || "";
        base.answerModeLabel = m._answerModeLabel || "";
        base.modelUsed = m._modelUsed || "";
        base.sage = m.sage || "none";
        base.sageName = m.sageName || "";
        base.socratic = !!m.socratic;
        base.route = m.route && Array.isArray(m.route.dimensions) ? m.route : null;
      }
      return base;
    };
    const uPayload = clean(userMsg);
    const aPayload = clean(assistantMsg);
    console.log(
      "[会话持久化] conversationId=" + conversationId +
      " | user长度=" + uPayload.content.length +
      " | assistant长度=" + aPayload.content.length +
      " | answerId=" + aPayload.answerId +
      " | 引用数=" + aPayload.citations.length
    );
    if (!aPayload.content.trim()) {
      console.error("[会话持久化] 异常：assistant 内容为空，本轮不写入，避免污染历史。");
      return;
    }
    wx.cloud.callFunction({
      name: "history",
      data: { action: "append", conversationId, userMsg: uPayload, assistantMsg: aPayload },
    }).catch((e) => console.warn("[会话持久化] 写入失败", e));
  },

  // 打字机式渲染：收到完整回答后逐字显示，缓解等待焦虑。
  // 用 _typingToken 防止新消息/清空打断了旧动画。
  // 性能要点：只更新「正在打字那一条消息」的两个字段（路径更新），
  // 不再每帧重建整个 messages 数组、也不再每帧改 scrollTarget，
  // 以彻底消除整页高频重渲与 scroll-into-view 反复触发导致的闪烁。
  typewriter(assistantMsg) {
    const token = ++this.data._typingToken;
    const full = assistantMsg.content || "";
    const id = assistantMsg.id;
    const idx = this.data.messages.findIndex((m) => m.id === id);
    if (idx < 0) return; // 消息不存在则跳过，避免异常
    let shown = 0;
    const step = () => {
      if (token !== this.data._typingToken) return; // 已被打断
      shown = Math.min(full.length, shown + 1);
      this.setData({
        ["messages[" + idx + "].content"]: full.slice(0, shown),
        ["messages[" + idx + "]._typing"]: shown < full.length,
      });
      if (shown < full.length) {
        setTimeout(step, 18);
      } else {
        this.setData({ ["messages[" + idx + "]._typing"]: false });
      }
    };
    step();
  },

  onInput(e) {
    this.setData({ inputValue: e.detail.value });
  },

  // 切换三模式（🌐普通 / 📚深度 / 🌅思考 / 🔍苏格拉底）。answerMode 透传后端；
  // 旧 RAG 深度子开关 mode 保持默认 plain 不动，确保现有回答逻辑不变、链路兼容。
  setAnswerMode(e) {
    const am = e.currentTarget.dataset.mode;
    if (am === this.data.answerMode) return;
    const def = answerModes.find((m) => m.key === am);
    this.setData({ answerMode: am, modeDesc: (def && def.desc) || "" });
  },

  // 情绪出口（P0）：倾诉模式下，根据用户输入生成「抚慰卡 / 危机卡」消息数组。
  // 危机优先于情绪抚慰；非 soothe 模式或无可匹配情绪时返回空数组。
  buildSootheCards(userText) {
    if (this.data.answerMode !== "soothe") return [];
    if (comfort.detectCrisis(userText)) {
      const c = comfort.CRISIS_CARD;
      return [{
        id: "crisis-" + Date.now(),
        role: "assistant",
        _type: "crisis",
        title: c.title,
        lines: c.lines,
        hotlines: c.hotlines,
        note: c.note,
      }];
    }
    const emotion = comfort.detectEmotion(userText);
    if (!emotion) return [];
    const item = comfort.pickComfort(emotion);
    if (!item) return [];
    return [{
      id: "comfort-" + Date.now(),
      role: "assistant",
      _type: "comfort",
      emotion: emotion,
      quote: item.quote,
      author: item.author,
      source: item.source,
      interpretation: item.interpretation,
      disclaimer: comfort.COMFORT_DISCLAIMER,
    }];
  },

  // 先贤视角（Phase X）：选择「谁在答」。选 none 即关闭先贤视角。
  // 选中后后端会强制走人格合成路径，给出该先贤口吻的回答。
  setSage(e) {
    const key = e.currentTarget.dataset.sage;
    if (key === this.data.sage) return;
    const def = sages.find((s) => s.key === key);
    this.setData({
      sage: key,
      sageName: (def && def.name) || "",
      sageDesc: (def && def.desc) || "",
    });
  },

  useTopic(e) {
    const prompt = e.currentTarget.dataset.prompt;
    this.setData({ inputValue: prompt, showTopics: false });
    this.send(prompt);
  },

  goAbout() {
    wx.switchTab({ url: "/pages/about/about" });
  },

  // 聊天页也可转发，带封面图
  onShareAppMessage() {
    return {
      title: "向晚问思 · 经典思辨助手",
      path: "/pages/chat/chat",
      imageUrl: "/assets/share-card.png",
    };
  },

  // 新对话：新建一个空白会话，旧会话保留在列表（由 sessions 页管理删除）
  newConversation() {
    if (this.data.loading) return;
    this.data._typingToken++; // 打断打字机动画
    this.createConversation();
  },

  // 设置入口：进入"清空全部对话"确认流程（隐私政策承诺的能力，P2 方案 A）
  onSettings() {
    wx.showActionSheet({
      itemList: ["清空全部对话"],
      success: (r) => {
        if (r.tapIndex === 0) this.confirmClearAll();
      },
    });
  },

  confirmClearAll() {
    wx.showModal({
      title: "清空全部对话",
      content: "确定删除全部历史对话？此操作不可恢复；但匿名分析数据（提问与反馈统计）会保留。",
      confirmText: "清空",
      confirmColor: "#a32d2d",
      success: (res) => {
        if (!res.confirm) return;
        const openid = (getApp().globalData && getApp().globalData.openid) || wx.getStorageSync("openid");
        if (!openid) {
          // 无 openid：仅前端清空（历史本就未持久化）
          this.resetToStarter();
          return;
        }
        wx.showLoading({ title: "清空中", mask: true });
        wx.cloud
          .callFunction({ name: "history", data: { action: "deleteAll" } })
          .then((res2) => {
            const ok = res2 && res2.result && res2.result.ok;
            if (ok) this.resetToStarter();
            wx.showToast({ title: ok ? "已清空" : "清空失败", icon: ok ? "success" : "none" });
          })
          .catch(() => {
            wx.showToast({ title: "清空失败", icon: "none" });
          })
          .then(() => wx.hideLoading());
      },
    });
  },

  // 回到初始引导并清空当前会话状态（不影响匿名分析数据）
  resetToStarter() {
    this.data._typingToken++; // 打断打字机动画
    wx.removeStorageSync("currentConversationId");
    this.setData({
      _convId: "",
      messages: [starter],
      inputValue: "",
      showTopics: true,
      scrollTarget: "msg-starter",
    });
  },

  toggleCites(e) {
    const id = e.currentTarget.dataset.id;
    const messages = this.data.messages.map((m) =>
      m.id === id ? Object.assign({}, m, { _citesOpen: !m._citesOpen }) : m
    );
    this.setData({ messages });
  },

  toggleCiteText(e) {
    const msgId = e.currentTarget.dataset.msgId;
    const citeTitle = e.currentTarget.dataset.citeTitle;
    const messages = this.data.messages.map((m) => {
      if (m.id !== msgId || !m.citations) return m;
      const citations = m.citations.map((c) =>
        c.title === citeTitle ? Object.assign({}, c, { _textOpen: !c._textOpen }) : c
      );
      return Object.assign({}, m, { citations });
    });
    this.setData({ messages });
  },

  // E-5 回答质量反馈：👍/👎 与负向原因。我们优化的是「用户是否觉得被帮助」。
  rateAnswer(e) {
    const id = e.currentTarget.dataset.id;
    const helpful = e.currentTarget.dataset.helpful === "up";
    const messages = this.data.messages.map((m) =>
      m.id === id ? Object.assign({}, m, { _feedback: helpful, _showReasons: !helpful }) : m
    );
    this.setData({ messages });
    this.submitFeedback(id, helpful, "");
  },

  chooseReason(e) {
    const id = e.currentTarget.dataset.id;
    const reason = e.currentTarget.dataset.reason;
    const messages = this.data.messages.map((m) =>
      m.id === id ? Object.assign({}, m, { _feedback: false, _showReasons: false }) : m
    );
    this.setData({ messages });
    this.submitFeedback(id, false, reason);
  },

  submitFeedback(id, helpful, reason) {
    const msg = this.data.messages.find((m) => m.id === id);
    if (!msg) return;
    wx.cloud
      .callFunction({
        name: "feedback",
        data: {
          question: msg._question || "",
          answer_id: msg.answerId || "",
          helpful: helpful,
          reason: reason,
        },
      })
      .catch(() => {});
  },

  // Phase F · answer_quality_log：量化评分之后，收集「为什么有效/无效」的定性文本（可选，不打断主流程）
  toggleQuality(e) {
    const id = e.currentTarget.dataset.id;
    const messages = this.data.messages.map((m) =>
      m.id === id ? Object.assign({}, m, { _qualityOpen: !m._qualityOpen }) : m
    );
    this.setData({ messages });
  },

  onQualityInput(e) {
    const id = e.currentTarget.dataset.id;
    const field = e.currentTarget.dataset.field; // failure | good
    const value = e.detail.value;
    const messages = this.data.messages.map((m) =>
      m.id === id
        ? Object.assign({}, m, field === "good" ? { _qualityGood: value } : { _qualityFailure: value })
        : m
    );
    this.setData({ messages });
  },

  submitQuality(e) {
    const id = e.currentTarget.dataset.id;
    const msg = this.data.messages.find((m) => m.id === id);
    if (!msg) return;
    const failure = (msg._qualityFailure || "").trim();
    const good = (msg._qualityGood || "").trim();
    if (!failure && !good) {
      const messages = this.data.messages.map((m) =>
        m.id === id ? Object.assign({}, m, { _qualityOpen: false }) : m
      );
      this.setData({ messages });
      return;
    }
    wx.cloud
      .callFunction({
        name: "feedback",
        data: {
          type: "quality",
          question: msg._question || "",
          answer_id: msg.answerId || "",
          failureReason: failure,
          goodPoint: good,
        },
      })
      .then(() => {
        const messages = this.data.messages.map((m) =>
          m.id === id ? Object.assign({}, m, { _qualityOpen: false, _qualityDone: true }) : m
        );
        this.setData({ messages });
      })
      .catch(() => {});
  },

  // —————————— 收藏 / 复制（Phase X） ——————————
  // 加载收藏列表，回填空回答的 _faved 态，使已收藏的回答在对话中显示「已收藏」。
  syncFavState(msgs) {
    const openid = (getApp().globalData && getApp().globalData.openid) || wx.getStorageSync("openid");
    if (!openid) return;
    const ids = (msgs || []).filter((m) => m.role === "assistant" && m.answerId).map((m) => m.answerId);
    if (!ids.length) return;
    wx.cloud
      .callFunction({ name: "history", data: { action: "favList" } })
      .then((res) => {
        const r = (res && res.result) || {};
        const favIds = {};
        (r.list || []).forEach((f) => { if (f && f.answerId) favIds[f.answerId] = true; });
        const updated = this.data.messages.map((m) =>
          m.role === "assistant" && favIds[m.answerId] ? Object.assign({}, m, { _faved: true }) : m
        );
        this.setData({ messages: updated });
      })
      .catch(() => {});
  },

  // 切换收藏态：未收藏 → favAdd；已收藏 → favRemove。按 answerId 去重。
  toggleFav(e) {
    const id = e.currentTarget.dataset.id;
    const msg = this.data.messages.find((m) => m.id === id);
    if (!msg || !msg.answerId) {
      wx.showToast({ title: "该回答暂不支持收藏", icon: "none" });
      return;
    }
    const openid = (getApp().globalData && getApp().globalData.openid) || wx.getStorageSync("openid");
    if (!openid) {
      wx.showToast({ title: "请先同意隐私政策", icon: "none" });
      return;
    }
    const faved = !!msg._faved;
    const patch = (v) => {
      const messages = this.data.messages.map((m) => (m.id === id ? Object.assign({}, m, { _faved: v }) : m));
      this.setData({ messages });
    };
    if (!faved) {
      wx.showLoading({ title: "收藏中", mask: true });
      wx.cloud
        .callFunction({
          name: "history",
          data: {
            action: "favAdd",
            answerId: msg.answerId,
            question: msg._question || "",
            answer: msg.content || "",
            citations: (msg.citations || []).map((c) => ({ title: c.title, section: c.section, source: c.source, text: c.text })),
            sage: msg.sage || "none",
            socratic: !!msg.socratic,
            answerMode: msg._answerMode || "",
          },
        })
        .then((res) => {
          const ok = res && res.result && res.result.ok;
          patch(ok);
          wx.showToast({ title: ok ? "已收藏" : "收藏失败", icon: ok ? "success" : "none" });
        })
        .catch(() => wx.showToast({ title: "收藏失败", icon: "none" }))
        .then(() => wx.hideLoading());
    } else {
      wx.showLoading({ title: "取消收藏", mask: true });
      wx.cloud
        .callFunction({ name: "history", data: { action: "favRemove", answerId: msg.answerId } })
        .then((res) => {
          const ok = res && res.result && res.result.ok;
          patch(!ok); // 失败则保持已收藏
          wx.showToast({ title: ok ? "已取消" : "操作失败", icon: ok ? "none" : "none" });
        })
        .catch(() => wx.showToast({ title: "操作失败", icon: "none" }))
        .then(() => wx.hideLoading());
    }
  },

  // 复制回答文本（以弹窗展示，长按可复制，避免调用剪贴板隐私接口）
  copyAnswer(e) {
    const id = e.currentTarget.dataset.id;
    const msg = this.data.messages.find((m) => m.id === id);
    if (!msg || !msg.content) return;
    wx.showModal({
      title: "回答内容",
      content: msg.content,
      showCancel: true,
      confirmText: "知道了",
      cancelText: "长按复制",
      success: () => {},
    });
  },

  // 跳转到收藏页（tabBar）
  goFavorites() {
    wx.switchTab({ url: "/pages/favorites/favorites" });
  },

  onSend() {
    const text = (this.data.inputValue || "").trim();
    if (!text || this.data.loading) return;
    this.send(text);
  },

  send(text) {
    this.data._typingToken++; // 打断任何进行中的打字机动画
    const mode = this.data.mode;
    let cid = this.data._convId || wx.getStorageSync("currentConversationId") || "";
    if (!cid) {
      // 兜底：未拿到会话 ID（history 云函数未部署 / 未就绪）时，用本地临时 ID 保证收发可用，
      // 同时后台尝试建会话以持久化（失败不影响本次发送）。
      cid = "local-" + Date.now();
      this.setData({ _convId: cid });
      wx.setStorageSync("currentConversationId", cid);
      this.createConversation(); // 异步持久化，不阻塞发送
    }
    this._doSend(text, mode, cid);
  },

  _doSend(text, mode, cid) {
    const answerMode = this.data.answerMode;
    const sage = this.data.sage; // 先贤视角（Phase X）：none 表示不使用
    const socratic = answerMode === "socratic"; // 苏格拉底模式
    const userMsg = {
      id: "u-" + Date.now(),
      role: "user",
      content: text,
      citations: [],
      _citesOpen: false,
    };
    const messages = this.data.messages.concat(userMsg);
    this.setData({
      messages,
      inputValue: "",
      loading: true,
      showTopics: false,
      scrollTarget: "msg-" + userMsg.id,
    });

    const history = this.buildHistory(messages);

    // P0 真流式输出：优先走 HTTP/SSE 逐块接收（首字 ~1s，对标豆包）；
    //   wx.request 失败（如未配置合法域名）/超时则回退 callFunction 整段（_fallbackCallFunction）。
    const assistantMsg = {
      id: "a-" + Date.now(),
      role: "assistant",
      content: "",
      citations: [],
      route: null,
      _citesOpen: false,
      _modelError: "",
      _mode: "model",
      _reqMode: mode,
      _reqModeLabel: modeLabel(mode),
      answerMode: answerMode,
      _answerMode: answerMode,
      _answerModeLabel: answerModeLabel(answerMode),
      _modelUsed: "",
      answerId: "",
      _question: text,
      sage: sage,
      sageName: (sage !== "none" ? this.data.sageName : ""),
      socratic: socratic,
      _faved: false,
      _feedback: null,
      _showReasons: false,
      _qualityOpen: false,
      _qualityFailure: "",
      _qualityGood: "",
      _qualityDone: false,
      _isAnswer: true,
    };
    const pending = messages.concat(assistantMsg);
    this.setData({ messages: pending, scrollTarget: "msg-" + assistantMsg.id });
    this._streamChat({ text, history, mode, answerMode, sage, socratic, cid, userMsg, assistantMsg, messages });  },

  // ---- P0 真流式相关方法 ----
  // 通过 HTTP/SSE 逐块接收，首字延迟从整段 ~5s 降到 ~1s（对标豆包）。
  // 失败/未配置合法域名时回退 _fallbackCallFunction（callFunction 整段 + 打字机）。
  _streamChat(ctx) {
    const self = this;
    const STREAM_URL = "https://YOUR_CLOUD_ENV_ID.api.tcloudbase.com/chat";
    let acc = "";
    let buf = "";
    let finished = false;
    const task = wx.request({
      url: STREAM_URL,
      method: "POST",
      enableChunked: true,
      header: { "content-type": "application/json" },
      data: {
        message: ctx.text, history: ctx.history, mode: ctx.mode,
        answerMode: ctx.answerMode, sage: ctx.sage, socratic: ctx.socratic,
        conversationId: ctx.cid, stream: true,
      },
      success() {
        // onChunkReceived 已累积增量；若整段未达（极罕见）则回退
        if (!acc) { self._fallbackCallFunction(ctx); return; }
        self._finishStream(ctx, acc, "ans-" + Date.now(), "", []);
      },
      fail() {
        // 域名未配 / 网络失败 → 回退 callFunction 整段
        self._fallbackCallFunction(ctx);
      },
    });
    task.onChunkReceived((chunk) => {
      if (finished) return;
      const raw = chunk && chunk.data ? (chunk.data instanceof ArrayBuffer ? self._ab2str(chunk.data) : chunk.data.toString()) : "";
      buf += raw;
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line || line.indexOf("data:") !== 0) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        let obj;
        try { obj = JSON.parse(data); } catch (e) { continue; }
        if (obj.error) {
          finished = true;
          self._replaceAssistant(ctx, "抱歉，刚才没有回复。" + (obj.error || ""));
          return;
        }
        if (obj.delta) { acc += obj.delta; self._appendDelta(ctx, acc); }
        if (obj.done) {
          finished = true;
          self._finishStream(ctx, acc, obj.answerId || ("ans-" + Date.now()), obj._modelUsed || "", obj.citations || []);
        }
      }
    });
  },

  _appendDelta(ctx, acc) {
    const idx = this.data.messages.findIndex((m) => m.id === ctx.assistantMsg.id);
    if (idx < 0) return;
    this.setData({ ["messages[" + idx + "].content"]: acc, loading: false });
  },

  _replaceAssistant(ctx, text) {
    const idx = this.data.messages.findIndex((m) => m.id === ctx.assistantMsg.id);
    if (idx < 0) return;
    const m = this.data.messages[idx];
    this.setData({ ["messages[" + idx + "].content"]: text, loading: false });
    this.appendHistory(ctx.userMsg, Object.assign({}, m, { content: text }), ctx.cid);
  },

  _finishStream(ctx, acc, answerId, modelUsed, citations) {
    const idx = this.data.messages.findIndex((m) => m.id === ctx.assistantMsg.id);
    if (idx < 0) return;
    const m = this.data.messages[idx];
    const updated = Object.assign({}, m, {
      content: acc,
      answerId: answerId || m.answerId || ("ans-" + Date.now()),
      _modelUsed: modelUsed || m._modelUsed,
      citations: citations || m.citations,
      _isAnswer: true,
    });
    const cards = this.buildSootheCards(ctx.text);
    const list = this.data.messages.slice();
    list[idx] = updated;
    const display = cards.length ? list.concat(cards) : list;
    this.setData({ messages: display, loading: false, scrollTarget: "msg-" + (cards.length ? cards[cards.length - 1].id : updated.id) });
    // 先快照持久化（完整 content），再启动打字机重放（保留引用/反馈体验）
    this.appendHistory(ctx.userMsg, Object.assign({}, updated, { content: acc }), ctx.cid);
    this.typewriter(updated);
  },

  _fallbackCallFunction(ctx) {
    // 回退：callFunction 整段返回（保留原逻辑 + 打字机）。基于当前 messages 替换占位，避免重复。
    const { text, history, mode, answerMode, sage, socratic, cid, userMsg, assistantMsg, messages } = ctx;
    wx.cloud
      .callFunction({ name: "chat", data: { message: text, history, mode, answerMode, sage, socratic, conversationId: cid } })
      .then((res) => {
        const result = (res && res.result) || {};
        if (!result.ok) throw new Error(result.error || "服务异常");
        return result;
      })
      .then((result) => {
        const fullAnswer = result.answer || "";
        const am = Object.assign({}, assistantMsg, {
          content: fullAnswer, citations: result.citations || [], route: result.route || null,
          _modelError: result._modelError || "", _mode: result.mode || "local",
          _modelUsed: result._modelUsed || "", answerId: result.answerId || ("ans-" + Date.now()),
          _question: text, _isAnswer: true,
        });
        const list = this.data.messages.slice();
        const i = list.findIndex((m) => m.id === assistantMsg.id);
        if (i >= 0) list[i] = am; else list.push(am);
        const cards = this.buildSootheCards(text);
        const display = cards.length ? list.concat(cards) : list;
        this.setData({ messages: display, loading: false, scrollTarget: "msg-" + (cards.length ? cards[cards.length - 1].id : am.id) });
        this.appendHistory(userMsg, Object.assign({}, am, { content: fullAnswer }), cid);
        this.typewriter(am);
      })
      .catch((err) => {
        const msg = (err && err.message) || "";
        const isTimeout = /timed out|timeout|504003/i.test(msg);
        if (isTimeout) {
          wx.cloud
            .callFunction({ name: "chat", data: { message: text, history, localOnly: true, mode, answerMode, sage, socratic, conversationId: cid } })
            .then((res2) => { const r2 = (res2 && res2.result) || {}; if (!r2.ok) throw new Error(r2.error || "服务异常"); return r2; })
            .then((r2) => {
              const fullFallback = r2.answer || "";
              const fallbackMsg = Object.assign({}, assistantMsg, {
                content: fullFallback, citations: r2.citations || [], route: r2.route || null,
                _modelError: "模型响应较慢，已用本地检索回答", _mode: "local",
                answerId: r2.answerId || ("ans-" + Date.now()), _question: text, _isAnswer: true,
              });
              const list2 = this.data.messages.slice();
              const j = list2.findIndex((m) => m.id === assistantMsg.id);
              if (j >= 0) list2[j] = fallbackMsg; else list2.push(fallbackMsg);
              const fbCards = this.buildSootheCards(text);
              const fbDisplay = fbCards.length ? list2.concat(fbCards) : list2;
              this.setData({ messages: fbDisplay, loading: false, scrollTarget: "msg-" + (fbCards.length ? fbCards[fbCards.length - 1].id : fallbackMsg.id) });
              this.appendHistory(userMsg, Object.assign({}, fallbackMsg, { content: fullFallback }), cid);
              this.typewriter(fallbackMsg);
            })
            .catch(() => {
              const errMsg = { id: "e-" + Date.now(), role: "assistant", content: "抱歉，刚才没有回复。请稍后再试一次。", citations: [], _citesOpen: false };
              const list3 = this.data.messages.slice();
              const k = list3.findIndex((m) => m.id === assistantMsg.id);
              if (k >= 0) list3[k] = errMsg; else list3.push(errMsg);
              this.setData({ messages: list3, loading: false });
            });
          return;
        }
        const errMsg = { id: "e-" + Date.now(), role: "assistant", content: "抱歉，刚才没有回复。" + msg + " 请稍后再试一次。", citations: [], _citesOpen: false };
        const list4 = this.data.messages.slice();
        const k2 = list4.findIndex((m) => m.id === assistantMsg.id);
        if (k2 >= 0) list4[k2] = errMsg; else list4.push(errMsg);
        this.setData({ messages: list4, loading: false });
      });
  },

  _ab2str(buf) {
    try {
      const bytes = new Uint8Array(buf);
      let s = "";
      for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
      return decodeURIComponent(escape(s));
    } catch (e) {
      return "";
    }
  },

  buildHistory(messages) {
    return messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .filter((m) => m.id !== "starter")
      .map((m) => ({ role: m.role, content: m.content }));
  },
});
