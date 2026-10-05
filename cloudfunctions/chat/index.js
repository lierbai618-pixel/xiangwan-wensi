// 向晚问思 - 云函数入口
// 接收 { message, history }，计算 turn（history 中 user 消息数），返回 { ok, answer, citations, mode, retrieval, _modelUsed }
// 同时把本次对话写入云数据库 logs 集合，供管理页统计用户与对话。
// 大模型增强：读取云数据库 model_config 中已启用的模型，按顺序自动切换调用；全部失败回退本地回答。
const cloud = require("wx-server-sdk");
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const crypto = require("crypto");
const { generateAnswer, inferQueryFrame, retrieve } = require("./rag");
// CR-002 安全加固：纯函数护栏与脱敏工具（新增文件，非冻结资产）
let inputGuard = null;
let piiScrub = null;
try { inputGuard = require("./security/inputGuard"); } catch (e) { inputGuard = null; }
try { piiScrub = require("./security/piiScrub"); } catch (e) { piiScrub = null; }
// Phase P+：观测落库（fire-and-forget，失败不影响主流程）
const { logObservation } = require("./observability/observabilityLogger");
// Phase Q2-13：联网搜索(qwen provider)复用后台 model_config 的单例句柄。
//   与 freshness/thinkEngine 内 require 的是同一模块实例（缓存单例），
//   故在此设置 _searchModelConfig 后，搜索派发分支(qwen)可见。
const searchLayer = require("./providers/search");
const modePersona = require("./modePersona"); // Phase X：先贤/苏格拉底人格 prompt 解析
// Phase X：先贤视角 / 苏格拉底追问 —— 复用后台 model_config 对话模型（models[0]，与
//   rag.js generateAnswer 同模型，实测 ~8s 可达）做人格纯生成；不联网、不触碰冻结资产 rag.js。
//   不直接走 searchLayer（其默认 provider 联网、且百炼 qwen3.8-max 纯生成跨云延迟 >25s 不可用）。
const personaGen = require("./personaGen");
// Phase Q：Freshness Layer 热点思辨（旁路包装，feature flag 控制）。
//   FRESHNESS_ENABLED !== "true" 时完全不加载、零行为变化（一键回滚点）。
//   开启后：Category A/危机/异常一律直落原 generateAnswer，冻结链路不变。
const FRESHNESS_ENABLED = (process.env.FRESHNESS_ENABLED || "").toLowerCase() === "true";
// Phase Q1-B：事实检索源开关（默认关）。只透传给 Freshness 编排层做门控，
// 不改变任何现有 Capability / RAG 行为；true 时预留未来真实检索入口（Phase Q2）。
const FRESHNESS_FACTUAL_ENABLED = (process.env.FRESHNESS_FACTUAL_ENABLED || "").toLowerCase() === "true";
// Phase Q2-1：Search Provider 选择（默认 mock；真实源 bing/tavily/serp 仅当
//   FRESHNESS_FACTUAL_ENABLED=true 且配置密钥时由 searchLayer 激活；
//   本阶段所有真实搜索保持关闭，SEARCH_PROVIDER=mock）。
const SEARCH_PROVIDER = (process.env.SEARCH_PROVIDER || "mock").toLowerCase();
let freshnessMaybeHandle = null;
if (FRESHNESS_ENABLED) {
  try {
    freshnessMaybeHandle = require("./freshness").maybeHandle;
  } catch (e) {
    console.error("[freshness] 模块加载失败，回退原链路:", e && e.message);
    freshnessMaybeHandle = null;
  }
}
// Phase R：Capability Layer 实时工具能力（时间/天气/计算/位置）。
//   修复的架构缺陷：实时事实问题（"现在几点"）此前被误送进哲学生成器，
//   导致答非所问并自曝"无法联网"。这类问题属于**能力层**，与知识层无关。
//   默认启用（这是缺陷修复，不是新特性实验）；CAPABILITY_ENABLED=false 为熔断开关。
//   命中即绕过 RAG；未命中返回 null，链路与此前完全一致。
const CAPABILITY_ENABLED = (process.env.CAPABILITY_ENABLED || "true").toLowerCase() !== "false";
let capabilityMaybeHandle = null;
if (CAPABILITY_ENABLED) {
  try {
    capabilityMaybeHandle = require("./capabilities").maybeHandle;
  } catch (e) {
    console.error("[capability] 模块加载失败，回退原链路:", e && e.message);
    capabilityMaybeHandle = null;
  }
}
// Phase Q2-3：问思融合引擎（三模式真实行为分流）。
//   位置：Capability → Freshness → **thinkEngine** → generateAnswer(冻结兜底)。
//   分流：fast=search / deep=RAG(直接 return null 走原链路) / think=search+RAG+reasoning。
//   THINK_ENGINE_ENABLED=false 为一键熔断：关掉后回答逐字节等同 Q2-2 之前。
//   返回 null 即「本引擎不接管」，与既有旁路语义完全一致。
const THINK_ENGINE_ENABLED = (process.env.THINK_ENGINE_ENABLED || "true").toLowerCase() !== "false";
let thinkEngineRun = null;
if (THINK_ENGINE_ENABLED) {
  try {
    thinkEngineRun = require("./think/thinkEngine").run;
  } catch (e) {
    console.error("[think] 模块加载失败，回退原链路:", e && e.message);
    thinkEngineRun = null;
  }
}
// 资料库盘点（Library Inventory）旁路：处理「资料库里有 X 吗 / 有哪些书」等元问题。
//   默认启用；LIBRARY_INVENTORY_ENABLED=false 为一键熔断（回退原语义检索链路）。
//   命中即短路，未命中返回 null，与既有能力旁路语义一致。
const LIBRARY_INVENTORY_ENABLED = (process.env.LIBRARY_INVENTORY_ENABLED || "true").toLowerCase() !== "false";
let libraryInventoryHandle = null;
if (LIBRARY_INVENTORY_ENABLED) {
  try {
    libraryInventoryHandle = require("./libraryInventory").maybeHandle;
  } catch (e) {
    console.error("[libraryInventory] 模块加载失败，回退原链路:", e && e.message);
    libraryInventoryHandle = null;
  }
}

// 读取后台配置的已启用模型（按 order 升序），供多模型自动切换使用
// 返回 { list, error }：error 非空表示读取配置本身失败（如集合不存在），用于前端排查
async function getEnabledModels() {
  try {
    const res = await db
      .collection("model_config")
      .where({ enabled: true })
      .orderBy("order", "asc")
      .limit(20)
      .get();
    return { list: (res.data || []).filter((m) => m && m.apiKey), error: "" };
  } catch (e) {
    const msg = e && e.message ? e.message : "" + e;
    console.error("读取 model_config 失败:", msg);
    return { list: [], error: msg };
  }
}

// 内容安全检测：对文本跑 security.msgSecCheck。
// 返回 { hit, err, scanned, errType }
//   - scanned=true  表示检测成功完成（命中与否以 hit 为准）
//   - scanned=false 表示检测未成功（异常/超时/配额/openid 缺失），此时无法确认内容安全
// 调用方必须按 fail-closed 处理 scanned=false（除非 SEC_DEGRADE_ON_API_ERROR=true 或
// SEC_EMERGENCY_WARN_ONLY=true 两个止血开关之一被显式打开）。
//
// 🔴 2026-09-22 根因修复（P0-2）：msgSecCheck **v2 的 openid 是必填参数**，
//   缺省时接口必然失败——这就是此前线上「-40003 / 0% 可用」的直接原因。
//   现要求调用方传入用户 openid（浏览器端取 x-wx-openid 头，云函数端取 getWXContext().OPENID）。
//   注意：v2 要求 openid 对应**近期活跃**用户，否则同样判定失败。
async function checkTextSafety(text, stage, openid) {
  const content = (text || "").toString().trim();
  if (!content) return { hit: false, err: "", scanned: true, errType: "", errorCode: null };
  // 无有效 openid → 无法完成 v2 校验，按「未检测」返回，交由 decideBlock 决策（不得默认放行）
  if (!openid) {
    console.error("msgSecCheck 缺少 openid，无法检测（stage=" + stage + "）");
    return { hit: false, err: "missing_openid", scanned: false, errType: "missing_openid", errorCode: null };
  }
  try {
    const res = await cloud.openapi.security.msgSecCheck({
      content,
      version: 2,
      scene: 2,
      openid, // ← v2 必填
    });
    // 兼容两种返回结构：detail 数组（新版）或 suggest/result（旧版）
    const detail = res && res.detail;
    if (Array.isArray(detail) && detail.length > 0) {
      const hit = detail.some(
        (d) => d && (d.level === 2 || d.strategy === "content" || /违规|命中|block/i.test(d.label || ""))
      );
      return { hit, err: "", scanned: true, errType: "", errorCode: null };
    }
    const suggest = (res && (res.suggest || res.result)) || "";
    return { hit: suggest === "block" || suggest === "risky", err: "", scanned: true, errType: "", errorCode: null };
  } catch (e) {
    const msg = e && e.message ? e.message : "" + e;
    console.error("msgSecCheck 调用失败:", msg);
    // 结构化错误码：优先取 wx-server-sdk 异常上的 errCode，缺失为 null（CR-002 #004）
    const errorCode = (e && e.errCode !== undefined && e.errCode !== null) ? e.errCode : null;
    // 扫描失败：分类错误类型供审计；scanned=false 交由调用方决策（默认降级放行，见 decideBlock）。
    let errType = "api_error";
    if (/timeout|超时/i.test(msg)) errType = "timeout";
    else if (/quota|limit|频率|配额/i.test(msg)) errType = "quota";
    return { hit: false, err: msg, scanned: false, errType, errorCode };
  }
}

// 事故止血开关：默认关。开启时扫描失败仅告警放行（不拦截），用于安全服务不可用时的临时降级。
function isWarnOnly() {
  return (process.env.SEC_EMERGENCY_WARN_ONLY || "").toLowerCase() === "true";
}

// CR-002 #004：基础设施失败（api_error/timeout/quota）默认降级放行，恢复可用性；
// 仅「确认命中违规 hit===true」才拦截。fail-open on service failure，fail-closed on confirmed violation。
// degradeOnApiError（来自 SEC_DEGRADE_ON_API_ERROR，默认 true）：扫描失败（scanned===false）→ 放行；
// 设为 false 时退回原 fail-closed（扫描失败 → 拦截），等价于免部署回滚。
function decideBlock(res, warnOnly, degradeOnApiError) {
  if (!res) return true;                                       // 防御：结果缺失无法判定 → 拦截
  if (res.hit === true) return true;                          // 要求1：命中违规必拦截
  if (warnOnly === true) return false;                        // SEC_EMERGENCY_WARN_ONLY：仅命中才拦
  if (degradeOnApiError === true && res.scanned === false) return false; // 要求2：扫描失败 → 降级放行
  return res.scanned === false;                               // 降级关：维持原 fail-closed
}

// 2026-09-22：openid 归一化（P0-2 配套）。
//   占位值（unknown / http-stream / anonymous）与空值都不能用于 msgSecCheck v2，
//   一律视为「无有效 openid」→ 由 decideBlock 决策，避免把无效值当有效值送接口。
function normalizeOpenid(raw) {
  const v = (raw || "").toString().trim();
  if (!v) return "";
  if (v === "unknown" || v === "http-stream" || v === "anonymous") return "";
  return v;
}

// SEC-3：扫描错误审计。仅记录元数据，绝不落原文 / 隐私。
function hashOpenid(openid) {
  if (!openid) return "";
  return crypto.createHash("sha256").update(String(openid)).digest("hex");
}
// CR-002 #004：新增 errorCode / errorType 元数据；errType 旧字段保留以兼容既有监控查询。
// 入参仅 stage/errType/errorCode/openid，绝不接收 message 原文（要求4：不记录用户原文）。
async function logSecurityEvent(stage, errType, errorCode, openid) {
  try {
    await db.collection("security_events").add({
      data: {
        stage: stage || "",
        errType: errType || "",            // 向后兼容
        errorType: errType || "",          // 语义化命名（与 errType 同值）
        errorCode: (errorCode !== undefined && errorCode !== null) ? errorCode : null,
        openidHash: hashOpenid(openid),
        createTime: db.serverDate(),
      },
    });
  } catch (e) {
    console.error("[security_events] write failed:", e && e.message);
  }
}

// 写对话日志（失败不影响主流程）
async function logChat(openid, message, result, safety) {
  const safeMsg = piiScrub ? piiScrub.mask((message || "").toString()) : (message || "").toString();
  const safeAns = piiScrub ? piiScrub.mask(((result && result.answer) || "").toString()) : ((result && result.answer) || "").toString();
  try {
    await db.collection("logs").add({
      data: {
        openid: openid || "unknown",
        message: safeMsg.slice(0, 1000),
        answer: safeAns.slice(0, 1000),
        mode: (result && result.mode) || "local",
        titles: (result && result.citations ? result.citations.map((c) => c.title) : []),
        safeIn: !!(safety && safety.in),
        safeOut: !!(safety && safety.out),
        createTime: db.serverDate(),
      },
    });
  } catch (e) {
    console.error("logChat failed:", e);
  }
}

// 生成规范化的回答唯一 ID：YYYYMMDD_xxxx，便于 question_logs / answer_feedback / answer_quality_log 三层关联，
// 未来可分析「哪种回答模板满意度最高」（Phase F 评审建议）。
function makeAnswerId() {
  const d = new Date();
  const ymd =
    "" + d.getFullYear() +
    String(d.getMonth() + 1).padStart(2, "0") +
    String(d.getDate()).padStart(2, "0");
  const rand = Math.random().toString(36).slice(2, 8);
  return ymd + "_" + rand;
}

// D-3 数据闭环：记录用户真实提问，供后续 problem_tags 优化与召回提升分析。
// 采集：问题文本、回答模式、推断意图(intent)、命中来源标题、聚合标签(problem_tags 代理)。
async function logQuestion(openid, message, result, mode, conversationId) {
  try {
    const citations = (result && result.citations) || [];
    const analysis = (result && result.analysis) || {};
    const intent = analysis.intent || inferQueryFrame(message);
    const tags = [];
    citations.forEach((c) => {
      (c.tags || []).forEach((t) => {
        if (!tags.includes(t)) tags.push(t);
      });
    });
    const route = (result && result.route) || {};
    // 通用助手升级：记录意图层判定，用于线上观测「哪些问题被跳过了知识库 / 分类是否合理」。
    const qi = (result && result.intent) || {};
    await db.collection("question_logs").add({
      data: {
        openid: openid || "unknown",
        question: (piiScrub ? piiScrub.mask((message || "").toString()) : (message || "").toString()).slice(0, 1000),
        mode: mode || "plain",
        intent: intent || "general",
        questionType: qi.type || "",
        questionDomain: qi.domain || "",
        answerFormat: qi.format || "",
        needKnowledge: qi.needKnowledge === undefined ? null : !!qi.needKnowledge,
        knowledgePolicy: qi.knowledgePolicy || "",
        emotion: analysis.emotion || "",
        theme: analysis.theme || "",
        strategy: analysis.strategy || "",
        category: analysis.category || "",
        matchedTitles: citations.map((c) => c.title),
        books: citations.map((c) => c.title),
        matchedTags: tags,
        routeThemes: route.dimensions || [],
        followUp: !!(result && result.retrieval && result.retrieval.followUp),
        answerId: (result && result.answerId) || "",
        conversationId: conversationId || "",
        createTime: db.serverDate(),
      },
    });
  } catch (e) {
    console.error("logQuestion failed:", e);
  }
}

async function rpcHandler(event) {
  const openid = ((cloud.getWXContext() || {}).OPENID) || "unknown";
  // P3 冷启动保活：定时触发器每分钟 ping，命中即直接返回，避免误跑生成/安全扫描逻辑。
  if (event && (typeof event.triggerName === "string" || event.triggerSource === "timer" || event.Type === "Timer")) {
    return { ok: true, warmed: true };
  }
  const message = (event && event.message ? event.message : "").toString().trim();
  const history = Array.isArray(event && event.history) ? event.history : [];
  const localOnly = !!(event && event.localOnly);
  const mode = (event && event.mode) || "plain";
  // Phase Q2-1：三模式（fast/deep/think）正交维度，与 RAG 深度子开关 mode 并存。
  // 未指定 → 默认 think（见 Phase-Q2-Mode-Spec.md §2）。Capability 优先级仍由派发顺序保证。
  const answerMode = (event && event.answerMode) || "think";
  // Phase X：先贤视角(sage) + 苏格拉底追问(socratic) 人格维度（与 answerMode 正交）。
  //   socratic 可由前端显式传 socratic:true，也可由 answerMode==='socratic' 隐式触发。
  const sage = (event && event.sage) || "none";
  const socratic = !!(event && event.socratic) || (("" + answerMode).toLowerCase() === "socratic");
  // 倾诉模式（soothe / 情绪出口）：倾听优先。与 sage/socratic 正交，走人格合成层。
  const soothe = ("" + answerMode).toLowerCase() === "soothe";
  // 神算子模式（shensuanzi / 趣味玄学互动）：引公版经典、娱乐口吻、强制免责。走人格合成层。
  const shensuanzi = ("" + answerMode).toLowerCase() === "shensuanzi";
  // 先贤/苏格拉底人格仅在 fast 合成层完整生效（合成层整段输出即人格），
  // 故 personaActive 时把派发管道强制为 fast，确保人格不被冻结 RAG 内核覆盖。
  const personaActive = (sage && sage !== "none") || socratic || soothe || shensuanzi;
  const pipelineMode = personaActive ? "fast" : answerMode;
  const conversationId = (event && event.conversationId) || "";

  if (!message) {
    return { ok: false, error: "请输入一个问题。" };
  }

  // 2026-09-22 改版（P0-2）：扫描失败降级开关**默认关闭** → 恢复 fail-closed（扫描失败即拦截）。
  //   背景：fail-open 使内容过滤形同虚设（安全接口一失败就全量放行），合规上不可接受。
  //   止血回滚：控制台把 SEC_DEGRADE_ON_API_ERROR 设为 "true" 即恢复降级放行，**无需重新部署**。
  //   另一止血阀 SEC_EMERGENCY_WARN_ONLY="true" 等价于「仅确认命中才拦」。
  const degradeOnApiError = (process.env.SEC_DEGRADE_ON_API_ERROR || "").toLowerCase() === "true";
  const safeOpenid = normalizeOpenid(openid);

  // 入参安全检测（SEC-1）：命中违规必拦；校验失败（含 openid 缺失）按 fail-closed 拦截并区分提示。
  const inSafe = await checkTextSafety(message, "in", safeOpenid);
  if (inSafe.scanned === false) {
    logSecurityEvent("in", inSafe.errType, inSafe.errorCode, openid); // SEC-3 审计（fire-and-forget，仅元数据）
  }
  if (decideBlock(inSafe, isWarnOnly(), degradeOnApiError)) {
    return {
      ok: false,
      error: inSafe.hit === true
        ? "您的提问包含不当内容，已拦截。请换个问题。"
        : "内容安全校验暂时不可用，请稍后再试。",
    };
  }

  // SEC-4 指令注入护栏：规则式，无 LLM / 网络；命中即拒绝生成。
  if (inputGuard) {
    const g = inputGuard.detect(message);
    if (g && g.block) {
      return { ok: false, error: "您的输入包含异常指令模式，已拦截。" };
    }
  }

  const turn = history.filter((m) => m && m.role === "user").length;

  try {
    const { list: rawModels, error: modelCfgError } = await getEnabledModels();
    // Phase Speed（2026-08-10）：GEN_MODEL=agnes 时，把 agnes 端点作为首选生成模型前置，
    //   同时保留 model_config 原模型作为回退（agnes 偶发 502 / 中文乱码时自动降级）。
    //   配合 FRESHNESS_ENABLED=false，去除联网检索的 11–24s 耗时，整体回答显著提速。
    //   agnes 为纯 LLM 代理、不联网，与「暂停联网」意图一致；本地 RAG（corpus.json）仍保留，
    //   故五段式「引经」依旧成立，只是不再做实时网络检索。
    // Phase Speed+（2026-08-12）：主模型链 step-3.5-flash(hcnsec) → qwen-plus → agnes。
    //   按 order 升序组装 primaryChain（order 越小越优先），再拼接 model_config 其余启用模型，
    //   由冻结 rag.js 的 tryModelAnswer 按序迭代做逐模型兜底（顺序即优先级）。
    //   每个主链模型带独立 timeout：hcnsec 网关偏抖（约半数不稳），8s 即熔断切下家；
    //   qwen-plus 走百炼官方较稳，15s；agnes 为最后兜底，25s（默认）。
    //   hcnsec key 为用户提供的第三方网关 key（已授权）；作生产主模型须多模型兜底 + 超时降级。
    //   模式感知（2026-08-12 修复 think/deep 白等）：hcnsec 的 step-3.5-flash 对长 RAG 上下文
    //   有硬性挂起（必然失败，非耗时问题）。故 think/deep 不把 hcnsec 入主链，qwen-plus 直出，
    //   避免每次白等 HCNSEC_TIMEOUT_MS；fast/sage/socratic/soothe/shensuanzi 等短 prompt 仍优先 step-3.5-flash。
    const GEN_MODEL = (process.env.GEN_MODEL || "").toLowerCase();
    const HCNSEC_ENABLED = (process.env.HCNSEC_ENABLED || "false").toLowerCase() === "true";
    const QWEN_PLUS_ENABLED = (process.env.QWEN_PLUS_ENABLED || "true").toLowerCase() === "true";
    // hcnsec 网关生产实测约半数不稳（连短 prompt 也常挂起直连超时），作首选会让大量请求白等。
    // HCNSEC_PRIORITY=true：短上下文优先 step-3.5-flash（用户原意，接受偶发 8s 白等）；
    // 默认 false：qwen-plus/agnes 稳定优先，hcnsec 仅作最终兜底（几乎不触发），消除白等卡顿。
    const HCNSEC_PRIORITY = (process.env.HCNSEC_PRIORITY || "false").toLowerCase() === "true";
    const longCtxMode = (answerMode === "think" || answerMode === "deep");
    const hcnsecFront = HCNSEC_PRIORITY && !longCtxMode;
    // 2026-08-12 P1：agnes 实测最快(4.4s)且稳定，提为主模型（-40，始终最优先）；
    //   qwen-plus 作兜底1（-30）；hcnsec 仅作最终兜底（默认 10，几乎不触发）。
    const agnesOrder = -40;
    const qwenOrder = -30;
    const hcnsecOrder = hcnsecFront ? -20 : 10;
    const primaryChain = [];
    if (HCNSEC_ENABLED && process.env.HCNSEC_API_KEY) {
      primaryChain.push({
        name: "hcnsec-step35",
        baseURL: process.env.HCNSEC_BASE_URL || "https://api.hcnsec.cn/v1",
        apiKey: process.env.HCNSEC_API_KEY,
        model: process.env.HCNSEC_MODEL || "step-3.5-flash",
        enabled: true,
        order: hcnsecOrder,
        timeout: parseInt(process.env.HCNSEC_TIMEOUT_MS || "8000", 10),
      });
    }
    if (QWEN_PLUS_ENABLED && (process.env.QWEN_PLUS_API_KEY || process.env.QWEN_SEARCH_API_KEY)) {
      primaryChain.push({
        name: "qwen-plus",
        baseURL: process.env.QWEN_PLUS_BASE_URL || process.env.QWEN_SEARCH_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1",
        apiKey: process.env.QWEN_PLUS_API_KEY || process.env.QWEN_SEARCH_API_KEY,
        model: process.env.QWEN_PLUS_MODEL || "qwen-plus",
        enabled: true,
        order: qwenOrder,
        timeout: parseInt(process.env.QWEN_PLUS_TIMEOUT_MS || "15000", 10),
      });
    }
    if (GEN_MODEL === "agnes" && process.env.AGNES_SEARCH_API_KEY) {
      primaryChain.push({
        name: "agnes",
        baseURL: process.env.AGNES_SEARCH_BASE_URL,
        apiKey: process.env.AGNES_SEARCH_API_KEY,
        model: process.env.AGNES_SEARCH_MODEL,
        enabled: true,
        order: agnesOrder,
      });
    }
    // 拼接：primaryChain 已按 order 升序，model_config 其余模型去重在后（避免与主链同名重复）。
    primaryChain.sort(function (a, b) { return (a.order || 0) - (b.order || 0); });
    const usedModels = primaryChain.map(function (m) { return m.model; });
    const models = primaryChain.concat(
      (rawModels || []).filter(function (m) { return m && m.model && usedModels.indexOf(m.model) === -1; })
    );
    // Phase Q2-13：联网搜索(qwen)复用后台 model_config（配置一次，搜索自动同享）。
    //   仅透传首个启用模型的 baseURL/apiKey/model；qwenSearch 仍允许 QWEN_SEARCH_* env 覆盖。
    if (searchLayer._setSearchModelConfig) {
      try {
        // Q2-16：联网搜索优先选用后台 model_config 中名称含 deepseek 的模型
        //   （用户指定的百炼 deepseek-v4-flash-0731，联网综合质量最佳）；
        //   找不到则回退首个启用模型。对话模型仍由 models[0]（order 最小）决定，互不影响。
        var searchModel = null;
        if (models && models.length) {
          // 搜索模型优先选 deepseek；其次 qwen-plus / agnes（稳定官方），避开偏抖的 hcnsec 网关；
          // 都没有再退回 models[0]。
          for (var mi = 0; mi < models.length; mi++) {
            if (/deepseek/i.test(models[mi].model || '')) { searchModel = models[mi]; break; }
          }
          if (!searchModel) {
            for (var mi2 = 0; mi2 < models.length; mi2++) {
              if (/qwen-plus|agnes/i.test(models[mi2].model || '')) { searchModel = models[mi2]; break; }
            }
          }
          if (!searchModel) searchModel = models[0];
        }
        searchLayer._setSearchModelConfig(
          searchModel
            ? { baseURL: searchModel.baseURL, apiKey: searchModel.apiKey, model: searchModel.model }
            : null
        );
      } catch (e) {
        console.error("[search] model_config 注入失败，回退 no_endpoint:", e && e.message);
      }
    }
    // localOnly=true：客户端已超时，直接走本地检索回答，避免再次卡模型
    const useModels = localOnly ? [] : models;
    const startTime = Date.now();
    let result = null;
    // 资料库盘点旁路（最早判定）：元问题「资料库里有 X 吗 / 有哪些书」直接命中即短路，
    //   避免被语义检索的帧偏置与概念桥污染（如「书」触发学习桥导致儒道经典顶到最前）。
    if (libraryInventoryHandle) {
      try {
        result = libraryInventoryHandle(message);
      } catch (e) {
        console.error("[libraryInventory] 执行异常，回退原链路:", e && e.message);
        result = null;
      }
    }
    // Phase R：Capability 旁路（最先判定）。
    //   顺序依据：实时事实诉求最具确定性，且与思辨链路互斥——
    //   "现在几点"不该经过事件分类，更不该经过知识检索。
    //   未命中返回 null，后续 Freshness / RAG 链路完全不受影响。
    //   注：前置的「资料库盘点」旁路若已命中（result 非 null），此处跳过，避免覆盖清单答案。
    if (!result && capabilityMaybeHandle) {
      try {
        result = await capabilityMaybeHandle(message, {
          history,
          location: event && event.location,
        });
      } catch (e) {
        console.error("[capability] 执行异常，回退原链路:", e && e.message);
        result = null;
      }
    }
    // Phase Q：Freshness 旁路。B/C/D 类由 freshness 接管；返回 null（A类/危机）或抛异常
    // 一律直落原 generateAnswer——冻结链路是唯一兜底，freshness 永远可整体摘除。
    // Phase X：personaActive（先贤/苏格拉底）时跳过 freshness —— 人格走 fast 合成层生效，
    //   否则会被 freshness 的「无事实降级」拦截，人格根本来不及注入。
    if (!result && !personaActive && freshnessMaybeHandle) {
      try {
        result = await freshnessMaybeHandle(message, {
          turn, models: useModels, modelCfgError, mode, history,
          factualEnabled: FRESHNESS_FACTUAL_ENABLED,
          answerMode: pipelineMode,
          sage: sage, socratic: socratic, // Phase X：先贤/苏格拉底人格透传
          searchProvider: SEARCH_PROVIDER,
          openid: openid, // Phase Q2-4-C：灰度闸门依据（仅相等比较，不记录）
        });
      } catch (e) {
        console.error("[freshness] 执行异常，回退原链路:", e && e.message);
        result = null;
      }
    }
    // Phase Q2-3：问思融合引擎。Capability / Freshness 均未接管时才进入，
    //   因此不改变任何既有优先级。deep 模式与「无可用事实的 fast」一律返回 null，
    //   直落下方冻结 generateAnswer；think 模式内部**只读**调用同一个 generateAnswer，
    //   不会二次生成。任何异常 fail-soft → null，冻结链路永远是兜底。
    // Phase X：personaActive（先贤/苏格拉底）时跳过 thinkEngine —— 人格走下方直接的合成层，
    //   避免被 thinkEngine 的 fast 分支回退冻结 RAG 而丢失人格。
    if (!result && !personaActive && thinkEngineRun) {
      try {
        result = await thinkEngineRun(message, {
          turn, models: useModels, modelCfgError, mode, history,
          answerMode: pipelineMode,
          sage: sage, socratic: socratic, // Phase X：先贤/苏格拉底人格透传
          factualEnabled: FRESHNESS_FACTUAL_ENABLED,
          searchProvider: SEARCH_PROVIDER,
          openid: openid, // Phase Q2-4-C：灰度闸门依据（仅相等比较，不记录）
          generateAnswer: generateAnswer, // 注入冻结资产，thinkEngine 不自行 require
        });
      } catch (e) {
        console.error("[think] 执行异常，回退原链路:", e && e.message);
        result = null;
      }
    }
    // Phase X：先贤视角 / 苏格拉底追问 —— 直接走合成层（agnes 纯 LLM，免费且不联网），
    //   合成文本即人格表达，保证人格完整生效。失败则回退常规链路（仍给答案，仅无人格）。
    if (!result && personaActive) {
      try {
        const chatModel = (useModels && useModels.length) ? useModels[0] : null;
        if (chatModel) {
          const personaPrompt = modePersona.personaFor(soothe ? "soothe" : (shensuanzi ? "shensuanzi" : "fast"), { sage: sage, socratic: socratic });
          // Phase Speed+：透传完整 models 数组，personaGen 内部逐模型兜底（顺序同主链）。
          const text = await personaGen.generate(useModels, personaPrompt, message, 15000);
          if (text) {
            result = {
              mode: "model",
              answer: text,
              citations: [],
              route: { dimensions: [], books: [], core: "" },
              retrieval: { totalDocuments: 0, persona: true, sage: sage, socratic: socratic },
              _modelUsed: (chatModel.model || "persona"),
              _modelStatus: "persona",
              _modelError: "",
            };
          }
        }
      } catch (e) {
        console.error("[persona] 合成失败，回退常规链路:", e && e.message);
      }
    }
    if (!result) {
      result = await generateAnswer(message, { turn, models: useModels, modelCfgError, mode, history });
    }
    result.answerId = makeAnswerId(); // 贯通所有回答路径（model / local / fallback 均经此出口）

    // 出参安全检测（SEC-2）：命中违规必拦；校验失败按 fail-closed 拦截（与入参同策略，2026-09-22 修复）。
    const outSafe = await checkTextSafety(result && result.answer, "out", safeOpenid);
    if (outSafe.scanned === false) {
      logSecurityEvent("out", outSafe.errType, outSafe.errorCode, openid); // SEC-3 审计（仅元数据）
    }
    if (decideBlock(outSafe, isWarnOnly(), degradeOnApiError)) {
      return {
        ok: false,
        error: outSafe.hit === true
          ? "本次回答触发内容安全限制，已停止输出。请换个角度提问。"
          : "内容安全校验暂时不可用，请稍后再试。",
      };
    }

    // Phase P+：异步观测落库（fire-and-forget）。query 落库前脱敏（SEC-5）。
    try {
      logObservation({
        query: piiScrub ? piiScrub.mask(message) : message,
        answerId: result.answerId,
        conversationId: conversationId,
        result: result,
        intent: result.intent,
        latencyMs: Date.now() - startTime,
        openid: openid,
      });
    } catch (e) {
      console.error("logObservation unexpected error:", e);
    }
    // 异步写日志，不等待；message/answer 落库前脱敏（SEC-5）
    logChat(openid, message, result, { in: inSafe, out: outSafe });
    logQuestion(openid, message, result, mode, conversationId);
    return Object.assign({ ok: true, answerMode: answerMode, sage: sage, socratic: socratic }, result);
  } catch (e) {
    return { ok: false, error: "服务暂时不可用，请稍后再试。" };
  }
};

// ============================================================
// P0 真流式输出：HTTP 触发（Web 函数形态 req/res）下，逐块推 SSE。
//   callFunction（事件函数形态）仍走 rpcHandler 整段返回，作为前端回退与现有 thinkEngine 兜底。
//   冻结 rag.js 仅被 require 调用 retrieve（只读不改），生成走 personaGen.generateStream（非冻结）。
//   think/deep 流式版用 retrieve + modePersona 五段式人格替代 thinkEngine（更轻量，质量由人格保证）。
// ============================================================
function readBody(req) {
  return new Promise(function (resolve) {
    if (!req) { resolve(""); return; }
    if (req.body !== undefined) {
      try { resolve(typeof req.body === "string" ? req.body : JSON.stringify(req.body)); } catch (e) { resolve(""); }
      return;
    }
    var buf = "";
    req.on("data", function (c) { buf += c; });
    req.on("end", function () { resolve(buf); });
    req.on("error", function () { resolve(buf); });
  });
}

function buildStreamModels() {
  var arr = [];
  var agnesKey = process.env.AGNES_SEARCH_API_KEY;
  if (agnesKey) {
    arr.push({ name: "agnes", baseURL: process.env.AGNES_SEARCH_BASE_URL, apiKey: agnesKey, model: process.env.AGNES_SEARCH_MODEL, enabled: true, timeout: 25000 });
  }
  var qkey = process.env.QWEN_PLUS_API_KEY || process.env.QWEN_SEARCH_API_KEY;
  if (qkey) {
    arr.push({ name: "qwen-plus", baseURL: process.env.QWEN_PLUS_BASE_URL || process.env.QWEN_SEARCH_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1", apiKey: qkey, model: process.env.QWEN_PLUS_MODEL || "qwen-plus", enabled: true, timeout: 15000 });
  }
  if (process.env.HCNSEC_ENABLED === "true" && process.env.HCNSEC_API_KEY) {
    arr.push({ name: "hcnsec", baseURL: process.env.HCNSEC_BASE_URL || "https://api.hcnsec.cn/v1", apiKey: process.env.HCNSEC_API_KEY, model: process.env.HCNSEC_MODEL || "step-3.5-flash", enabled: true, timeout: parseInt(process.env.HCNSEC_TIMEOUT_MS || "8000", 10) });
  }
  return arr;
}

async function streamHandler(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });
  var send = function (obj) { try { res.write("data: " + JSON.stringify(obj) + "\n\n"); } catch (e) {} };
  var raw = await readBody(req);
  var event = {};
  try { event = JSON.parse(raw || "{}"); } catch (e) { event = (req && req.query) ? req.query : {}; }
  var rawOpenid = (req && req.headers && req.headers["x-wx-openid"]) || "";
  var openid = rawOpenid || "http-stream";        // 仅用于日志展示
  var safeOpenid = normalizeOpenid(rawOpenid);    // 用于 msgSecCheck v2（无效值归一为 ""）
  var degradeOnApiError = (process.env.SEC_DEGRADE_ON_API_ERROR || "").toLowerCase() === "true";
  var message = (event.message || "").toString().trim();
  if (!message) { send({ error: "请输入一个问题。" }); return res.end(); }
  // 入参安全检测（SEC-1）：与 rpcHandler **同策略**——命中必拦，校验失败按 fail-closed 处理。
  //   🔴 2026-09-22 修复（P0-2）：此前本路径只判 hit===true、且 catch(e){} 静默吞错，
  //   导致前端主链路（SSE）的入参检查实际上是失效的。
  var inSafe = { hit: false, scanned: false, errType: "unknown", errorCode: null };
  try {
    inSafe = await checkTextSafety(message, "in", safeOpenid);
  } catch (e) {
    inSafe = { hit: false, scanned: false, errType: "exception", errorCode: null };
  }
  if (inSafe.scanned === false) {
    logSecurityEvent("in", inSafe.errType, inSafe.errorCode, openid);
  }
  if (decideBlock(inSafe, isWarnOnly(), degradeOnApiError)) {
    send({ error: inSafe.hit === true
      ? "您的提问包含不当内容，已拦截。请换个问题。"
      : "内容安全校验暂时不可用，请稍后再试。" });
    return res.end();
  }
  var answerMode = (event.answerMode || "think").toString().toLowerCase();
  var sage = (event.sage || "none").toString();
  var socratic = !!(event.socratic) || answerMode === "socratic";
  var soothe = answerMode === "soothe";
  var shensuanzi = answerMode === "shensuanzi";
  // RAG 检索（soothe/shensuanzi 不检索，避免噪声）
  var ragCtx = "";
  var citations = [];
  if (answerMode !== "soothe" && answerMode !== "shensuanzi") {
    try {
      var ret = await retrieve(message, { limit: 5 });
      var cites = (ret && ret.citations) || [];
      if (cites.length) {
        citations = cites.map(function (c) {
          return { title: c.title, section: c.section, display_text: (c.citation && c.citation.display_text) || "" };
        });
        ragCtx = cites.map(function (c, i) {
          return "[经典 " + (i + 1) + "] 《" + (c.title || "未命名") + "》" + (c.section ? "·" + c.section : "") + "：" + ((c.text || c.summary || "").toString().slice(0, 400));
        }).join("\n\n");
      }
    } catch (e) { console.error("[stream] retrieve failed:", e && e.message); }
  }
  var personaKey = soothe ? "soothe" : (shensuanzi ? "shensuanzi" : "fast");
  var persona = modePersona.personaFor(personaKey, { sage: sage, socratic: socratic });
  if (ragCtx) {
    persona = persona + "\n\n【可供引用的经典素材】（优先用这些，标注出处，不可编造）：\n" + ragCtx;
  }
  var models = buildStreamModels();
  if (!models.length) { send({ error: "无可用生成模型。" }); return res.end(); }
  var full = "";
  var usedModel = "";
  try {
    usedModel = await personaGen.generateStream(models, persona, message, function (delta) {
      if (delta) { full += delta; send({ delta: delta }); }
    }, 30000);
  } catch (e) {
    if (!full) { send({ error: "生成失败：" + ((e && e.message) || e) }); return res.end(); }
    // 已推部分内容，仍尽量收尾
  }
  // 出参安全检测（SEC-1）：与入参同策略（2026-09-22 修复，此前只判 hit 且静默吞错）。
  //   ⚠️ 流式架构的固有局限：内容已逐块下发，本检查只能在生成结束后执行。
  //   前端收到 {error} 会用错误文案**整段替换**该条回答（chat.js 的 _replaceAssistant），
  //   因此仍能起到撤回效果，但无法避免用户短暂看到内容——这是 SSE 形态的边界，非实现缺陷。
  if (full) {
    var outSafe = { hit: false, scanned: false, errType: "unknown", errorCode: null };
    try {
      outSafe = await checkTextSafety(full, "out", safeOpenid);
    } catch (e) {
      outSafe = { hit: false, scanned: false, errType: "exception", errorCode: null };
    }
    if (outSafe.scanned === false) {
      logSecurityEvent("out", outSafe.errType, outSafe.errorCode, openid);
    }
    if (decideBlock(outSafe, isWarnOnly(), degradeOnApiError)) {
      send({ error: outSafe.hit === true
        ? "本次回答触发内容安全限制，已撤回。"
        : "内容安全校验暂时不可用，本次回答已撤回。" });
      return res.end();
    }
  }
  var answerId = makeAnswerId();
  send({ done: true, answerId: answerId, answerMode: answerMode, sage: sage, socratic: socratic, _modelUsed: usedModel, citations: citations });
  res.end();
}

exports.main = async function (arg1, arg2) {
  // Web 函数（HTTP 触发）形态：(req, res)，arg2 即 res 可写流 → 真流式 SSE
  if (arg2 && typeof arg2.write === "function") {
    try { return await streamHandler(arg1, arg2); }
    catch (e) {
      try { arg2.writeHead(500, { "Content-Type": "application/json" }); arg2.end(JSON.stringify({ error: String((e && e.message) || e) })); } catch (_) {}
      return;
    }
  }
  // 某些封装下 req/res 包在 event/context 内
  var req = (arg2 && arg2.req) || (arg1 && arg1.req);
  var res = (arg2 && arg2.res) || (arg1 && arg1.res);
  if (res && typeof res.write === "function") {
    try { return await streamHandler(req || arg1, res); }
    catch (e) {
      try { res.writeHead(500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ error: String((e && e.message) || e) })); } catch (_) {}
      return;
    }
  }
  // 事件函数（callFunction）形态：整段返回（前端回退 / 现有 thinkEngine 兜底）
  return rpcHandler(arg1 || {});
};

// CR-002 离线安全测试钩子：仅当 CR002_TEST_HOOK==='1' 时暴露内部函数，生产默认不激活（零行为影响）。
if (process.env.CR002_TEST_HOOK === "1") {
  exports.__cr002 = { checkTextSafety, decideBlock, logSecurityEvent, hashOpenid, isWarnOnly, normalizeOpenid };
}
