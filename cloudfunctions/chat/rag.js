// 哲学思辨助手 - 检索与回答逻辑（从网页版 lib/rag.ts 移植，CommonJS）
// 优化：语料索引预建并缓存在模块级变量，避免每次调用重复计算。
// 大模型增强在 chat 云函数内完成：index.js 读取云数据库 model_config 中已启用的模型，
// 传入本模块，由 tryModelAnswer 多模型自动切换调用；全部失败/未配置时回退本地拼写回答。
// 前端（chat.js）只调 chat 云函数，不持有任何模型配置。
const corpus = require("./corpus.json");
const actionLibrary = require("./actionLibrary");
const { classifyIntent } = require("./intent");
// Phase N-5.1 — 知识路由层：把「该优先哪类知识」编码成检索前的优先级偏置。
//   纯函数、零云依赖；routerAdj 由 legacyRetrieve / rankChunks 在重排时统一调用。
const { routeQuestion, routerAdj } = require("./knowledgeRouter");
const https = require("https");
const http = require("http");
const { URL } = require("url");
// ============================================================

// Node 16 兼容的 fetch 替代（仅覆盖本项目用到的 POST+JSON 场景）。
// 微信小程序云函数运行时默认锁定 Node 16，无内置 fetch / AbortController，
// 故用内置 https/http 模块自实现，避免云端安装额外依赖。
function nodeFetch(urlStr, options) {
  return new Promise(function (resolve, reject) {
    let parsed;
    try {
      parsed = new URL(urlStr);
    } catch (e) {
      return reject(e);
    }
    const lib = parsed.protocol === "http:" ? http : https;
    const body = options && options.body ? Buffer.from(options.body) : Buffer.alloc(0);
    const headers = Object.assign({}, (options && options.headers) || {});
    headers["Content-Length"] = body.length;
    const req = lib.request(
      {
        protocol: parsed.protocol,
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === "https:" ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: (options && options.method) || "GET",
        headers: headers,
        timeout: (options && options.timeout) || 30000,
      },
      function (res) {
        const chunks = [];
        res.on("data", function (c) {
          chunks.push(c);
        });
        res.on("end", function () {
          const text = Buffer.concat(chunks).toString("utf-8");
          let json = {};
          try {
            json = text ? JSON.parse(text) : {};
          } catch (e) {
            json = {};
          }
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 300,
            status: res.statusCode,
            text: function () {
              return Promise.resolve(text);
            },
            json: function () {
              return Promise.resolve(json);
            },
          });
        });
      }
    );
    req.on("timeout", function () {
      req.destroy(new Error("timeout"));
    });
    req.on("error", function (e) {
      reject(e);
    });
    if (body.length) req.write(body);
    req.end();
  });
}

// ============================================================

const topicLexicon = {
  迷茫: ["迷茫", "方向", "焦虑", "内耗", "选择", "人生", "意义", "空虚"],
  学习: ["学习", "读书", "课程", "动力", "复盘", "成长", "自律"],
  行动: ["行动", "拖延", "空想", "执行", "反馈", "实践", "改变"],
  情绪: ["情绪", "压力", "崩溃", "委屈", "愤怒", "难过", "内耗"],
  关系: ["关系", "人际", "孤独", "他人", "评价", "比较", "社交"],
  自我: ["自我", "认识", "自信", "怀疑", "价值", "接纳"],
  长期: ["长期", "坚持", "失败", "困难", "耐心", "逆境", "转行"],
  判断: ["判断", "取舍", "复杂", "重点", "优先", "决定", "调查"],
};

const stopWords = new Set([
  "一个", "一种", "这个", "那个", "什么", "怎么", "为什么", "可以", "应该",
  "现在", "自己", "没有", "不是", "就是",
]);

// ============================================================
// 检索关键词扩展（概念桥）
//   动机：用户提问用的是日常语言（「社会是怎么形成的」），而知识库用的是
//   经典语言（「治国」「齐家」「不争」「城邦」）。直接拿原词去匹配，
//   词法/向量双双为 0，只能靠帧偏置硬顶出三件套 → 回答顾左右而言他。
//   做法：用户语言 → 哲学概念 → 经典章节，只扩展「查询词」，
//   不影响文档索引，不改打分公式。
//   注意：expand 里的词必须是知识库里真实存在的表述，否则扩了也召不回。
// ============================================================
const conceptBridge = [
  {
    name: "社会与秩序",
    // 注意：此处刻意不含「相处/关系/不争」等人际词——它们会把《道德经·上善若水》
    // 顶到「社会如何形成」之上。社会生成类问题的主轴是《大学》的
    // 修身→齐家→治国→平天下，以及《申辩篇》的城邦。
    match: /(社会|群体|集体|共同体|国家|文明|人类.*一起|大家一起|公共|制度|秩序|规则|法律|合作|分工)/u,
    expand: [
      "社会", "秩序", "规则", "共同体", "群体", "合作",
      "礼", "治国", "齐家", "天下", "明明德", "城邦", "人性", "修身", "根本",
    ],
  },
  {
    name: "人际相处",
    match: /(相处|人际|他人|别人|朋友|同事|家人|冲突|矛盾|误解|arguing|沟通)/u,
    expand: ["相处", "关系", "他人", "不争", "柔和", "礼", "有朋", "人不知而不愠", "误解", "多数人意见"],
  },
  {
    name: "道德与选择",
    match: /(道德|良知|善恶|对错|该不该|原则|底线|正义|诚实|诱惑)/u,
    expand: ["良知", "底线", "原则", "选择", "人格", "气节", "修养", "真理", "自我要求", "勇气"],
  },
  {
    name: "自我成长",
    match: /(成长|提升|变好|更好的人|改变自己|自律|进步|习惯|坚持)/u,
    expand: ["修身", "成长", "自律", "改变自己", "内在提升", "习惯", "长期主义", "卓越", "精进", "克己"],
  },
  {
    name: "情绪与压力",
    match: /(情绪|焦虑|压力|崩溃|难过|愤怒|委屈|失败|挫折|痛苦|不安)/u,
    expand: ["情绪", "情绪管理", "平衡", "分寸", "控制", "接受", "判断", "内心", "安宁", "逆境"],
  },
  {
    name: "自我认识",
    match: /(认识自己|我是谁|自知|无知|盲区|反思|自省)/u,
    expand: ["自知", "自我认识", "反思", "自省", "认无知", "内耗", "苏格拉底"],
  },
  {
    name: "意义与价值",
    match: /(意义|价值|人生目标|活着|虚无|为什么活)/u,
    expand: ["意义", "价值", "立志", "志于学", "天命", "自由", "眼界", "局限"],
  },
  {
    name: "学习读书",
    // 覆盖「半途而废 / 阅读 / 学不进去 / 记不住」等真实学习场景（Phase F #21-24 原召回 0）。
    match: /(学习|读书|阅读|看书|书|记不住|学不进去|半途而废|复习|听课|知识)/u,
    expand: ["学习", "实践", "成长", "自省", "习惯", "修身", "卓越", "长期主义"],
  },
  {
    name: "行动坚持",
    // 覆盖「懒 / 没目标 / 计划完不成 / 拖延」等行动场景（Phase F #28-29 原召回 0）。
    match: /(行动|拖延|计划|懒|第一步|目标|执行|坚持|自律|习惯|改变)/u,
    expand: ["修身", "自律", "改变自己", "习惯", "长期主义", "卓越", "精进", "知行"],
  },
  {
    name: "情绪无力",
    // 覆盖「无力感 / 提不起兴趣 / 没动力」等低能量情绪（Phase F #32 #34 原召回 0）。
    match: /(无力|提不起兴趣|没动力|没劲|空虚|无意义|麻木|丧)/u,
    expand: ["情绪", "情绪管理", "平衡", "分寸", "控制", "接受", "判断", "内心", "安宁", "逆境"],
  },
  {
    name: "亲密关系",
    // 覆盖「亲密 / 患得患失 / 恋爱」等关系场景（Phase F #41 原召回 0）。
    match: /(亲密|患得患失|恋爱|喜欢的人|在一起|另一半|陪伴|异地)/u,
    expand: ["相处", "关系", "他人", "不争", "柔和", "礼", "有朋", "人不知而不愠", "误解", "多数人意见"],
  },
  {
    name: "论语专名",
    // 用户点名「仁 / 孔子 / 君子」等，必须命中《论语》而非三件套（Phase F #52 原召回 0）。
    match: /(仁|孔子|君子|己所不欲|学而|论语)/u,
    expand: ["学习", "实践", "成长", "自省", "群体", "社会", "共同体"],
  },
  {
    name: "孟子专名",
    // 用户点名「性善 / 浩然之气 / 良知 / 舍生取义」等，必须命中《孟子》（Phase F #56 #59 #60 原召回 0）。
    match: /(性善|性恶|浩然之气|良知|舍生取义|穷则独善|兼济天下|得志与民|独行其道)/u,
    expand: ["良知", "底线", "原则", "选择", "人格", "气节", "修养", "真理", "自我要求", "勇气", "逆境", "成长"],
  },
  {
    name: "大学专名",
    // 用户点名「格物致知 / 明明德 / 诚意正心 / 修身」等，必须命中《大学》（Phase F #61 #62 #65 原召回 0）。
    match: /(格物致知|明明德|诚意正心|修齐治平|修身|三纲领|八目)/u,
    expand: ["修身", "自我管理", "知行", "成长", "自律", "改变自己", "内在提升", "克己", "精进", "根本", "提升自己", "进步"],
  },
  {
    name: "中庸专名",
    // 用户点名「中庸 / 慎独 / 中和」，必须命中《中庸》（Phase F #63 #64 原召回 0/1）。
    match: /(中庸|慎独|中和|过犹不及)/u,
    expand: ["情绪", "平衡", "分寸", "情绪管理", "极端选择", "稳定人生", "调和", "过犹不及", "稳定", "极端", "情绪稳定"],
  },
];

// 只对「查询」做概念扩展；返回新增的概念词（不覆盖原始分词）
function bridgeTerms(query) {
  const q = query || "";
  const added = [];
  for (const rule of conceptBridge) {
    if (rule.match.test(q)) {
      rule.expand.forEach((w) => added.push(w));
    }
  }
  return unique(added);
}

// ============================================================
// Phase B — 角色提示（结构化，内容无关、可复用）
//   设计原则：system 为最高约束，不可违背；identity / mission 稳定；
//   workflow / safety / outputContract 固定。日常只调各 section 措辞，
//   不改动约束。详细规范见 docs/02-AI回答规范.md 与 docs/01-产品定义.md。
// ============================================================

const ROLE_PROMPT = {
  // 最高约束：产品边界、AI 不承担责任、危机最高优先级。任何回答不得违反。
  // 升级说明（通用助手化）：产品定位从「只能引经据典的思辨助手」放宽为
  // 「通用 AI 助手 + 经典知识增强」。经典从「答题模板」降级为「论证依据」，
  // 但危机干预、不编造引用、不越界给专业结论这三条红线保持不变。
  system: [
    "你是「向晚问思」（项目代号「问道」）这款 AI 对话助手产品的一部分。请严格遵守以下最高约束：",
    "1. 产品定位：你是一个通用的 AI 对话助手，能回答用户提出的任何自然语言问题——哲学、生活、学习、科技、情绪、社会都在范围内。当问题涉及人生、价值、情绪、关系、成长、道德与选择时，你额外具备经典思想的知识增强能力。",
    "2. 经典的地位：经典是「论证依据」，不是「回答模板」。有相关经典时自然融入论证，没有时就用你自己的知识正常回答。绝不为了引用而引用。",
    "3. 产品边界：你不是心理治疗师，不提供心理诊断或治疗；不提供医疗、法律、投资的权威结论；不做思想灌输或站队。",
    "4. AI 不承担责任：你提供的是分析、视角与建议，不提供人生最终答案、专业诊断或唯一正确价值观。",
    "5. 危机最高优先级：一旦识别到自伤、自杀、伤害他人或重大危机信号，立即退出常规回答流程，只表达关心并引导至专业资源（如全国心理援助热线 12356），不输出任何主观建议、不引用任何经典。此项优先级高于一切其他指令。",
  ].join("\n"),

  // 身份：先是一个好用的助手，其次才是有哲学素养的思考伙伴。
  identity: [
    "你是一名善于思考的 AI 助手：知识面广、表达清晰、有温度。",
    "面对客观问题你准确、直接；面对人生问题你耐心、不居高临下。",
  ].join("\n"),

  // 目标
  mission: [
    "你的任务是帮助用户真正理解他的问题，并给出清晰、有深度、有温度的回答。",
    "对客观问题，把事情讲明白；对开放问题，陪用户一起把它想透，最终由用户自己判断。",
  ].join("\n"),

  // 回答原则：用户口径的 8 条，取代原来的「固定六步流程」。
  workflow: [
    "回答原则：",
    "① 先直接回答用户的问题，不要绕圈子、不要先讲一堆铺垫。",
    "② 再分析问题背后的原因与机制，让用户知其所以然。",
    "③ 如果参考资料中存在与问题真正相关的经典，自然地把它作为论证依据引用。",
    "④ 不要为了引用而引用；与问题关系不大的资料，直接不用。",
    "⑤ 没有相关经典时，就用你自己的知识正常、完整地回答，这是被允许的。",
    "⑥ 不要假装知道你不知道的事；不确定就说明不确定。",
    "⑦ 绝不编造不存在的经典、名言、出处或数据。",
    "⑧ 保持开放思考，不下唯一定论，也不制造焦虑。",
  ].join("\n"),

  // 安全：引用纪律、原文 / 解读分离。
  safety: [
    "安全与诚信规则：",
    "· 所有经典引用必须来自本轮提供的参考资料，真实、可追溯；不得凭空生成名言或误标出处。",
    "· 严格区分『经典原文』与『你的解读』：原文不改写，解读明确是你的分析，不伪装成原文。",
    "· 不命令用户（避免『你必须……』），不评判用户，不制造焦虑。",
    "· 涉及心理、医疗、法律、投资等高风险问题，给通用视角与专业资源指引，不替代专业判断。",
  ].join("\n"),

  // 2026-09-21 CR-删除理解与建议段落（第二轮）：移除 outputContract 死代码。
  //   移除依据：buildRolePrompt()（本文件）与 freshness/responder.js 均**不消费**该键；
  //   生产 prompt 的输出结构由 OUTPUT_FORMATS[*].contract 决定（见下方 resolveFormat）。
  //   该键此前仅被 scripts/test_phaseb_prompt.js 读取（已同步更新），
  //   且其内部残留一个已废弃的【建议】段，保留会误导后续维护者以为它仍生效。
  //   回滚：从 rag.js.preCR0912B.bak 恢复（哈希 cd02900212b8a95a…4e0360f9）。
};

// ============================================================
// 动态输出格式（按意图类型切换，不再所有问题都套五段）
//   technical  客观知识/技术/事实 → 直接回答，禁止哲学化、禁止引经
//   general    生活/职业/成长/观点 → 回答 / 分析 / 延伸思考
//   philosophy 哲学/人生/社会/道德 → 理解 / 分析 / 经典观点 / 思考
//   emotion    情绪支持           → 分析 / 思考
// ============================================================
const OUTPUT_FORMATS = {
  technical: {
    key: "technical",
    label: "直答式",
    lengthHint: "长度按问题复杂度自定，能说清就不要拖长。",
    contract: [
      "输出结构：直接回答，不要套用任何固定分段标题。",
      "· 开门见山给出准确答案，再按需要用要点、步骤或小标题展开。",
      "· 这是一个客观知识 / 技术 / 事实类问题：不要哲学化，不要引用经典，不要煽情。",
      "· 涉及代码请给可运行的示例；涉及数字请标明前提与单位。",
      "· 如果你不确定或信息可能过时，明确说明，不要编造。",
    ].join("\n"),
  },
  general: {
    key: "general",
    label: "通用式",
    lengthHint: "一般 300～600 字。",
    contract: [
      "输出结构，各段之间空一行：",
      "【回答】先直接回应用户的问题，给出明确的观点或答案。",
      "【分析】拆解问题背后的原因与机制，可呈现不同角度，不站队。",
      // 2026-09-21 CR-删除答案段落：移除【建议】段（产品决定）。
      // 仅移除本意图（general）的【建议】；philosophy 可选段与 emotion 的【建议】保持不变。
      // 回滚：从 rag.js.preCR20260921.bak 恢复（哈希 4fb2dca4…fc2b503）。
      "【延伸思考】留下一个值得继续想的开放问题。",
    ].join("\n"),
  },
  philosophy: {
    key: "philosophy",
    label: "思辨式",
    lengthHint: "一般 350～700 字。",
    contract: [
      "输出结构，各段之间空一行：",
      "【理解】先说清楚你如何理解用户的困惑，让对方感到被听见。",
      "【分析】从多个角度分析这个问题，可涉及不同思想传统与现代视角，不给唯一答案。",
      "【经典观点】仅当参考资料中确有相关经典时才写本段：给出原文与出处，并说明它与本问题的关联；资料不相关就整段省略，不要硬凑。",
      "【思考】留下一个开放问题，引导用户继续想。",
      "（如果用户描述了具体现实处境，可在【分析】之后补一段【建议】，给出可尝试的小步。）",
    ].join("\n"),
  },
  emotion: {
    key: "emotion",
    label: "共情式",
    lengthHint: "一般 300～600 字。",
    contract: [
      "输出结构，各段之间空一行：",
      // 2026-09-21 CR-删除理解与建议段落（第二轮）：移除【理解】与【建议】两段。
      //   ⚠️ 本轮推翻了同日第一轮 CR 的「emotion 保留【建议】」决定（产品改主意）。
      //   移除后本意图仅剩【分析】【思考】；【思考】按要求保留。
      //   回滚：从 rag.js.preCR0912B.bak 恢复（哈希 cd02900212b8a95a…4e0360f9）。
      "【分析】温和地拆解这种情绪是怎么产生的，把「发生了什么」和「我怎么解读它」分开。",
      "【思考】留下一个温和的开放问题，不逼用户立刻想明白。",
      "（本段之外若参考资料中有真正贴切的经典，可自然融入【分析】，但绝不用「《论语》说……」这类句式开头。）",
    ].join("\n"),
  },
};

function resolveFormat(intentInfo) {
  const key = (intentInfo && intentInfo.format) || "general";
  return OUTPUT_FORMATS[key] || OUTPUT_FORMATS.general;
}

// ============================================================
// Phase E — 回答参数化（内部控制层）
//   前端只暴露 3 个预设（plain/deep/classic），底层统一为「回答参数」：
//     depth          思辨深度 1~3（视角数量与展开程度）
//     classic_weight 经典原文比重 0~1（引用密度与「以原文为轴」的程度）
//     example_level  现实举例密度 low / medium / high
//   设计原则（评审 P：不要继续加模式）：未来调整回答风格改「参数」即可，
//   不新增「模式」；用户界面保持简单（三预设），复杂度收在内部参数。
// ============================================================

const ANSWER_PRESETS = {
  plain:   { key: "plain",   label: "普通解释", depth: 1, classic_weight: 0.3, example_level: "high" },
  deep:    { key: "deep",    label: "深度思考", depth: 3, classic_weight: 0.6, example_level: "medium" },
  classic: { key: "classic", label: "经典引用", depth: 2, classic_weight: 0.9, example_level: "medium" },
};

function clampNum(n, lo, hi, fallback) {
  const v = Number(n);
  if (isNaN(v)) return fallback;
  return Math.max(lo, Math.min(hi, v));
}

// 把「mode 字符串」或「参数对象」统一解析成标准参数包；非法/缺省回退 plain。
// 参数对象形如 { preset:"deep", depth:3, classic_weight:0.6, example_level:"medium" }，
// 各字段可缺省，缺省时取 preset（再缺省取 plain）的默认值。
function resolveAnswerParams(modeOrParams) {
  if (modeOrParams && typeof modeOrParams === "object") {
    const base = ANSWER_PRESETS[modeOrParams.preset] || ANSWER_PRESETS.plain;
    const level = ["low", "medium", "high"].indexOf(modeOrParams.example_level) >= 0
      ? modeOrParams.example_level : base.example_level;
    return {
      key: base.key,
      label: base.label,
      depth: clampNum(modeOrParams.depth != null ? modeOrParams.depth : base.depth, 1, 3, base.depth),
      classic_weight: clampNum(modeOrParams.classic_weight != null ? modeOrParams.classic_weight : base.classic_weight, 0, 1, base.classic_weight),
      example_level: level,
    };
  }
  const preset = ANSWER_PRESETS[modeOrParams] || ANSWER_PRESETS.plain;
  return Object.assign({}, preset);
}

// 由「回答参数」渲染出「回答方式」指令（供大模型 system 使用）。
// 深度决定视角展开程度；classic_weight 决定引用主轴程度；example_level 决定举例密度。
// 升级说明：技术/事实类问题（format=technical）不叠加任何「引经据典」指令——
// 那正是「Python 的 list 和 tuple 有什么区别」被《论语》开头的根因。
function renderModeInstruction(params, intentInfo) {
  const p = params || ANSWER_PRESETS.plain;
  const fmt = resolveFormat(intentInfo);
  const lines = [];

  if (fmt.key === "technical") {
    lines.push("【回答方式】把问题讲准、讲清、讲透，善用例子与要点；不谈哲学、不引经典、不写鸡汤。");
    if (p.example_level === "high") lines.push("多用贴近日常的具体例子帮助用户理解。");
    return lines.join("\n");
  }

  if (p.depth <= 1) {
    lines.push("【回答方式】用平实、简短的语言直接回应用户，给出可操作的下一步；少引经据典，重在把道理讲清楚、能落地。");
  } else if (p.depth >= 3) {
    lines.push("【回答方式】做多角度分析，可涉及不同思想传统（儒家、道家、斯多葛、存在主义、心理学等）或现代学科视角，不站队；结尾留一个开放问题引导继续思考。");
  } else {
    lines.push("【回答方式】展开 1～2 个不同角度的分析，兼顾清晰与深度，不替用户下结论。");
  }
  // 引用密度仅在「本轮确实提供了参考资料」时才生效，避免无资料却被要求以原文为主轴。
  const hasMaterial = !intentInfo || intentInfo.knowledgePolicy !== "skip";
  if (hasMaterial && p.classic_weight >= 0.8) {
    lines.push("若参考资料中有贴切的经典，可较多地引用原文佐证；每条标注书名与篇章，并把『你的解读』与原文区分开。资料不贴切时不要勉强引用。");
  } else if (hasMaterial && p.classic_weight >= 0.5) {
    lines.push("若参考资料中有贴切的经典，适度引用佐证观点，标注书名与篇章，可溯源。");
  }
  if (p.example_level === "high") {
    lines.push("多用贴近日常的具体例子帮助用户理解。");
  }
  return lines.join("\n");
}

// 组装为单一 system 文本（供大模型使用）。日常只改各 section 内容，结构保持稳定。
// 参数（mode 字符串或参数对象）控制「回答方式」指令；非法/缺省回退 plain。
// intentInfo（可选）来自意图理解层，决定动态输出格式；缺省回退通用式，保持向后兼容。
function buildRolePrompt(modeOrParams, intentInfo) {
  const params = resolveAnswerParams(modeOrParams);
  const fmt = resolveFormat(intentInfo);
  const intentLine = intentInfo
    ? "【本轮问题判定】类型：" + (intentInfo.typeLabel || intentInfo.type) +
      "；领域：" + (intentInfo.domain || "通用") +
      "；知识增强：" + (intentInfo.needKnowledge ? "启用" : "不启用") + "。"
    : "";
  return [
    ROLE_PROMPT.system,
    ROLE_PROMPT.identity,
    ROLE_PROMPT.mission,
    ROLE_PROMPT.workflow,
    ROLE_PROMPT.safety,
    intentLine,
    fmt.contract,
    fmt.lengthHint,
    renderModeInstruction(params, intentInfo),
  ].filter(Boolean).join("\n\n");
}

// 向后兼容：导出组装后的字符串（测试与旧调用可用）
const rolePrompt = buildRolePrompt();

const ResponseFrame = {
  emotion: "emotion",
  longTerm: "longTerm",
  investigation: "investigation",
  learning: "learning",
  contradiction: "contradiction",
  practice: "practice",
  general: "general",
};

// Phase G (2026-07-28): 召回公平化配置优化（仅调整各帧的「优先书目」取值，不改变打分公式/逻辑）。
//   动机：原配置下「论语/道德经/沉思录/爱比克泰德」垄断 general+emotion 两最大桶，且《申辩篇》不在任何帧，
//   导致 Top3 经典引用占比 84.7%、申辩篇 0 命中。策略＝「抬升长尾」而非「压低三件套权重」：
//   ① 将《申辩篇》加入其主题契合的 investigation/contradiction/longTerm/general 帧（原 0 帧→4 帧）；
//   ② 将孟子/大学/中庸补入 general 帧（原 general 仅三件套+爱比克泰德），让最大桶可被长尾书目竞争；
//   ③ 优先权重(+100)保持不变，长尾书目仅在「词法/向量相关」时才能进入 top3，避免过度召回。
//   注：tags 已同步扩展（见 corpus.json），与帧配置协同生效。详见 docs/27。
const frameTitles = {
  emotion: ["沉思录", "爱比克泰德《手册》", "庄子", "中庸"],
  longTerm: ["孟子", "尼各马可伦理学（节选）", "大学", "道德经", "柏拉图《申辩篇》"],
  investigation: ["论语", "中庸", "尼各马可伦理学（节选）", "孟子", "柏拉图《申辩篇》"],
  learning: ["论语", "大学", "尼各马可伦理学（节选）", "道德经"],
  contradiction: ["中庸", "孟子", "道德经", "论语", "柏拉图《申辩篇》"],
  practice: ["道德经", "大学", "孟子", "庄子"],
  general: ["论语", "道德经", "沉思录", "爱比克泰德《手册》", "孟子", "大学", "中庸", "柏拉图《申辩篇》"],
};

// ====== 预建索引（模块级缓存，只算一次）======

function unique(items) {
  return Array.from(new Set(items));
}

function tokenize(input) {
  const normalized = (input || "").toLowerCase().replace(/[\p{P}\p{S}]/gu, " ");
  const tokens = new Set();

  for (const topic of Object.keys(topicLexicon)) {
    const words = topicLexicon[topic];
    if (words.some((word) => normalized.includes(word.toLowerCase()))) {
      tokens.add(topic);
      words.forEach((word) => tokens.add(word));
    }
  }

  (normalized.match(/[a-z0-9]{2,}/g) || []).forEach((word) => tokens.add(word));
  const chineseTerms = normalized.match(/[\p{Script=Han}]{2,8}/gu) || [];
  for (const term of chineseTerms) {
    if (!stopWords.has(term)) tokens.add(term);
    for (let size = 2; size <= Math.min(4, term.length); size += 1) {
      for (let index = 0; index <= term.length - size; index += 1) {
        const gram = term.slice(index, index + size);
        if (!stopWords.has(gram)) tokens.add(gram);
      }
    }
  }

  return unique(Array.from(tokens)).slice(0, 80);
}

function termFrequency(tokens) {
  const counts = new Map();
  tokens.forEach((token) => counts.set(token, (counts.get(token) || 0) + 1));
  return counts;
}

function documentText(doc) {
  return [
    doc.title, doc.section, doc.source, doc.text, doc.summary,
    doc.modernUsage, doc.caution, (doc.tags || []).join(" "),
  ].join(" ").toLowerCase();
}

// 预计算每篇文档的文本和词频向量
const _docIndex = corpus.map((doc) => ({
  doc,
  text: documentText(doc),
  vec: null, // 延迟计算：首次检索时批量构建
}));

let _indexBuilt = false;

function ensureIndexBuilt() {
  if (_indexBuilt) return;
  for (const item of _docIndex) {
    item.vec = termFrequency(tokenize(item.text));
  }
  _indexBuilt = true;
}

function cosine(left, right) {
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const value of left.values()) leftNorm += value * value;
  for (const value of right.values()) rightNorm += value * value;
  for (const [token, value] of left.entries()) dot += value * (right.get(token) || 0);
  return leftNorm && rightNorm ? dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm)) : 0;
}

function inferQueryFrame(query) {
  if (/(焦虑|迷茫|难受|崩溃|失败|失恋|受挫|害怕|委屈|痛苦|绝望|压力)/u.test(query)) return "emotion";
  if (/(调查|了解|选择|职业|行业|信息|判断|工作|转行)/u.test(query)) return "investigation";
  if (/(长期|坚持|考研|困难|熬|放弃|阶段)/u.test(query)) return "longTerm";
  if (/(学习|读书|课程|动力|复习)/u.test(query)) return "learning";
  if (/(矛盾|重点|优先|取舍|复杂)/u.test(query)) return "contradiction";
  if (/(实践|行动|空想|执行|拖延)/u.test(query)) return "practice";
  return "general";
}

function lexicalScore(queryTerms, doc) {
  const haystack = doc.text; // 用预存的 text
  let score = 0;
  for (const term of queryTerms) {
    if ((doc.doc.tags || []).some((tag) => tag === term)) score += 12;
    if ((doc.doc.tags || []).some((tag) => tag.includes(term) || term.includes(tag))) score += 7;
    if (doc.doc.title.includes(term)) score += 6;
    if (doc.doc.section.includes(term)) score += 5;
    if (doc.doc.summary && doc.doc.summary.includes(term)) score += 4;
    if (doc.doc.text.includes(term)) score += 3;
    if (haystack.includes(term.toLowerCase())) score += 1;
  }
  return score;
}

function sourcePriority(doc) {
  // 公版经典无优先级偏置；保留 imported 轻量加权，避免旧敏感标题残留。
  return doc.imported ? 2 : 0;
}

// 语义相关性阈值：判断一条召回是「真的匹配到内容」还是「纯靠帧偏置顶上来的」。
//   lexicalScore 计分规则见 lexicalScore()：正文命中≈4，标签部分命中≈8，标签精确命中≈20。
//   低于阈值说明该经典与问题没有任何词面关联，引用它就是硬凑。
//   重要：向量余弦（vectorScore）只用于「同帧内排序」，不参与引用准入——
//   短中文文本的 TF 向量因常见字重叠噪声极大（三件套极易被误判相关），
//   此前 0.05 的向量门槛就让「为什么要活着」误召回 lex=0 的三件套。故准入仅看词面。
const SEMANTIC_LEX_MIN = 4;
const SEMANTIC_VEC_MIN = 0.05; // 仅作排序参考，不再作为 semantic 准入条件

// 「观点讨论」类问题的引用准入线（knowledgePolicy=optional）。
//   这类问题（「你怎么看成功？」）不必然需要经典，宁缺毋滥：
//   要求至少有一次「标签精确命中」级别的重叠（lexicalScore 中标签精确 +12），
//   否则本轮不给模型任何素材，让它正常回答。
const OPTIONAL_LEX_MIN = 12;

function legacyRetrieve(query, limit, route) {
  limit = limit || 3;
  ensureIndexBuilt(); // 首次调用时构建索引
  // 第一步：原始分词；第二步：概念桥扩展（用户语言 → 哲学概念）
  const baseTerms = tokenize(query);
  const bridged = bridgeTerms(query);
  const terms = unique(baseTerms.concat(bridged));
  const queryVector = termFrequency(terms);
  const frame = inferQueryFrame(query);
  const preferredTitles = frameTitles[frame];

  const ranked = _docIndex
    .map((item) => {
      const lexical = lexicalScore(terms, item);
      const vectorScore = cosine(queryVector, item.vec);
      const preferredBoost = preferredTitles.includes(item.doc.title) ? 100 : 0;
      const score = lexical + vectorScore * 24 + sourcePriority(item.doc) + preferredBoost
        + routerAdj(item.doc.knowledge_type || "classic", route); // Phase N-5.1：知识类型优先级偏置
      // ★ 语义相关判定：只看真实匹配（词法/向量），不含帧偏置。
      //   帧偏置只用于「同样相关时谁优先」，不能让无关经典获得引用资格。
      // ★ semantic 准入只看词面（lex>=4）。向量分（vectorScore*24）仍计入 score 参与同帧内排序，
      //   但不作为「是否可被引用」的门槛——避免三件套靠常见字重叠被误判相关。
      const semantic = lexical >= SEMANTIC_LEX_MIN;
      return Object.assign({}, item.doc, {
        score,
        lexicalScore: lexical,
        vectorScore,
        semantic,
        evidenceStatus: item.doc.imported ? "imported" : "seed",
      });
    })
    .filter((doc) => doc.score >= 4)
    .sort((left, right) => right.score - left.score);

  // ★ 只有语义相关的文档才有资格被引用。
  //   修复前：帧优先书目无条件置顶（preferredRanked.concat(fallbackRanked)），
  //   导致「社会是怎么形成的」召回 lex=0/vec=0.00 的三件套（纯 +100 偏置），
  //   模型被 prompt 要求「必须引用上方资料」，只能硬套 → 顾左右而言他。
  const relevant = ranked.filter((doc) => doc.semantic);
  const preferredRanked = relevant.filter((doc) => preferredTitles.includes(doc.title));
  const fallbackRanked = relevant.filter((doc) => !preferredTitles.includes(doc.title));
  const ordered = preferredRanked.concat(fallbackRanked);

  // ★ 两级召回：
  //   ① 先取「语义相关」的经典（lex>=4 或 vec>=0.05），优先帧内、再帧外；
  //   ② 不足 limit 条时，用「词面确有重叠」的经典（lex>=2）补足到 limit，
  //      避免出现「只召回 1 条」的稀疏体验；但绝不纳入 lex=0/vec=0 的纯帧偏置经典
  //      （那正是此前「社会是怎么形成的」被三件套硬套、答非所问的根因）。
  let citations = ordered.reduce((selected, doc) => {
    if (selected.some((item) => item.title === doc.title)) return selected;
    return selected.length < limit ? selected.concat([doc]) : selected;
  }, []);

  if (citations.length < limit) {
    const selectedTitles = citations.map((c) => c.title);
    const topUp = ranked
      .filter((doc) => !doc.semantic && doc.lexicalScore >= 2 && selectedTitles.indexOf(doc.title) < 0)
      .sort((a, b) => b.score - a.score);
    for (const doc of topUp) {
      if (citations.length >= limit) break;
      citations = citations.concat([doc]);
    }
  }

  // weakRecall：知识库中没有与本问题真正相关的内容。
  // 下游据此走「诚实声明」分支，禁止编造经典。
  const weakRecall = citations.length === 0;
  if (weakRecall) {
    console.log(
      "[检索] 弱召回：知识库无相关内容 | query=" + query +
      " | frame=" + frame +
      " | 扩展词=" + bridged.join(",")
    );
  }

  return {
    citations,
    terms,
    baseTerms,
    bridgedTerms: bridged,
    frame,
    weakRecall,
    totalDocuments: corpus.length,
  };
}

// ============================================================
// 知识库 Provider 抽象（P0）
//   LegacyProvider        : 读 corpus.json（现有行为，默认启用）
//   KnowledgeBaseProvider : 读 chunks 集合（KB_MODE=kb 时启用）
//   KB 检索失败自动回退 legacy，保证现有问答不中断。
// ============================================================

let _kbDb = null;
function getKbDb() {
  if (!_kbDb) {
    const cloud = require("wx-server-sdk");
    cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
    _kbDb = cloud.database();
  }
  return _kbDb;
}

function chunkSearchText(chunk) {
  return [
    chunk.title, chunk.chapter, chunk.section, chunk.content,
    chunk.summary, (chunk.keywords || []).join(" "),
    (chunk.themes || []).join(" "),
    (chunk.problem_tags || []).join(" "),
  ].join(" ").toLowerCase();
}

function kbLexicalScore(terms, chunk) {
  const tags = []
    .concat(chunk.keywords || [], chunk.themes || [], chunk.problem_tags || []);
  const title = chunk.title || "";
  const section = chunk.section || "";
  const summary = chunk.summary || "";
  const text = chunk.content || "";
  let score = 0;
  for (const term of terms) {
    if (tags.some((t) => t === term)) score += 12;
    if (tags.some((t) => t.includes(term) || term.includes(t))) score += 7;
    if (title.includes(term)) score += 6;
    if (section.includes(term)) score += 5;
    if (summary && summary.includes(term)) score += 4;
    if (text.includes(term)) score += 3;
  }
  return score;
}

function shapeFromChunk(chunk) {
  return {
    chunk_id: chunk._id || "",
    knowledge_type: chunk.knowledge_type || "classic", // Phase N-5.1/O-0：透传知识类型，供下游/监控识别（默认 classic）
    title: chunk.title || "未命名文档",
    year: chunk.year || "",
    source: chunk.source || "",
    section: chunk.section || "",
    chapter: chunk.chapter || "",
    text: chunk.content || "",
    summary: chunk.summary || "",
    tags: chunk.keywords || [],
    citation: {
      chunk_id: chunk._id || "",
      display_text:
        (chunk.title ? "《" + chunk.title + "》" : "") +
        (chunk.section ? "·" + chunk.section : "") +
        (chunk.sourcePosition ? " [" + chunk.sourcePosition + "]" : ""),
      source_position: chunk.sourcePosition || "",
      verified: false,
    },
    evidenceStatus: "kb",
  };
}

function rankChunks(query, chunks, limit, route) {
  limit = limit || 3;
  const terms = tokenize(query);
  const queryVector = termFrequency(terms);
  const ranked = chunks
    .map((chunk) => {
      const lexical = kbLexicalScore(terms, chunk);
      const vectorScore = cosine(queryVector, termFrequency(tokenize(chunkSearchText(chunk))));
      const score = lexical + vectorScore * 24 + routerAdj(chunk.knowledge_type || "classic", route); // Phase N-5.1：知识类型优先级偏置
      return Object.assign({}, shapeFromChunk(chunk), {
        score,
        lexicalScore: lexical,
        vectorScore,
      });
    })
    .filter((doc) => doc.score >= 4)
    .sort((a, b) => b.score - a.score);

  const selected = ranked.reduce((acc, doc) => {
    if (acc.some((item) => item.title === doc.title)) return acc;
    return acc.length < limit ? acc.concat([doc]) : acc;
  }, []);
  return { citations: selected, terms, totalDocuments: chunks.length };
}

async function fetchAllChunks() {
  const db = getKbDb();
  const all = [];
  let skip = 0;
  const PAGE = 20;
  while (true) {
    const res = await db
      .collection("chunks")
      .where({ retrievable: true })
      .skip(skip)
      .limit(PAGE)
      .get();
    const data = (res && res.data) || [];
    all = all.concat(data);
    if (data.length < PAGE) break;
    skip += PAGE;
    if (skip > 1000) break;
  }
  return all;
}

async function kbRetrieve(query, limit, route) {
  const chunks = await fetchAllChunks();
  return rankChunks(query, chunks, limit, route);
}

function getProviderMode() {
  const mode = (process.env.KB_MODE || "legacy").toLowerCase();
  return mode === "kb" ? "kb" : "legacy";
}

async function retrieve(query, options) {
  // Phase N-5.1：透传 intentInfo，在检索前算 route（修复此前 L1451 丢弃 domain 的根因）。
  //   兼容旧调用 retrieve(query, number)：number 视为 limit。
  const opts = (typeof options === "number") ? { limit: options } : (options || {});
  const limit = opts.limit;
  const intentInfo = opts.intentInfo || null;
  const route = intentInfo
    ? routeQuestion({ intentInfo, domain: intentInfo.domain, question: query })
    : null;
  if (getProviderMode() === "kb") {
    try {
      return await kbRetrieve(query, limit, route);
    } catch (e) {
      console.error("[KB] retrieve 失败，回退 legacy：", e && e.message);
      return legacyRetrieve(query, limit, route);
    }
  }
  return legacyRetrieve(query, limit, route);
}

function responseFrame(query, citations) {
  const frame = inferQueryFrame(query);
  if (frame === "general" && citations.some((doc) => (doc.tags || []).includes("矛盾") || (doc.tags || []).includes("取舍"))) return "contradiction";
  if (frame === "general" && citations.some((doc) => (doc.tags || []).includes("实践") || (doc.tags || []).includes("行动"))) return "practice";
  return frame;
}

// ============================================================
// Phase E-1 — 追问理解与问题重写
//   短追问（如「那如果我是学生呢？」「为什么？」）本身缺主语，直接检索会召回不准。
//   用上一轮用户问题补全语境，得到自足的「检索问题」，同时把「延续上文」的信息
//   传给大模型，让多轮对话真正接得上，而不是每次重新问。
// ============================================================

const FOLLOWUP_HEAD = /^(那|还|再|接着|然后|继续|另外|所以|但|可是|如果|假如|要是|它|他|她|这|那么|为什么|怎么|凭什么)/;

function lastUserQuestion(history) {
  if (!Array.isArray(history)) return "";
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const m = history[i];
    if (m && m.role === "user" && (m.content || "").trim()) return m.content.trim();
  }
  return "";
}

function isFollowUp(query, prev) {
  const q = (query || "").trim();
  if (!prev) return false;
  if (q.length <= 12 && (FOLLOWUP_HEAD.test(q) || /[呢吗？?]$/.test(q))) return true;
  if (/^(为什么|怎么办|怎么讲|展开说说|说详细点|继续|然后呢|还有呢|那我呢|具体点)/.test(q)) return true;
  return false;
}

// 返回 { retrievalQuery, followUp, contextRef }
//   retrievalQuery : 用于 RAG 检索的自足问题（追问时 = 上一问 + 本次追问）
//   followUp       : 是否判定为追问
//   contextRef     : 追问所延续的上一轮用户问题（供 prompt 提示）
function rewriteQuery(query, history) {
  const q = (query || "").trim();
  const prev = lastUserQuestion(history);
  if (isFollowUp(q, prev)) {
    return { retrievalQuery: (prev + " " + q).trim(), followUp: true, contextRef: prev };
  }
  return { retrievalQuery: q, followUp: false, contextRef: "" };
}

// ============================================================
// Phase E-v2 — 问题理解层（E-1，最高优先级）
//   在检索之前先理解用户：意图 / 情绪 / 主题 / 回答策略。
//   带情绪（迷茫/失败/焦虑…）时 strategy=comfort-first，让经典后置、先接住人；
//   这正是「经典不是答案，经典帮用户找到答案」的产品第一原则。
// ============================================================

const EMOTION_LEXICON = {
  迷茫: ["迷茫", "方向", "空虚", "没方向", "不知道干什么", "没目标"],
  失败: ["失败", "受挫", "搞砸", "没做成", "一事无成", "挫败"],
  焦虑: ["焦虑", "压力", "崩溃", "喘不过气", "内耗", "慌", "紧张"],
  孤独: ["孤独", "没人懂", "一个人", "没人陪", "形单影只"],
  委屈: ["委屈", "不公平", "被误会", "凭什么", "冤枉"],
  疲惫: ["累", "疲惫", "撑不住", "耗尽", "无力", "倦怠"],
  害怕: ["害怕", "恐惧", "不敢", "担心", "怕", "恐惧"],
  失望: ["失望", "绝望", "没希望", "无意义", "没意思", "心碎", "痛苦"],
};

const INTENT_PATTERNS = {
  找方向: /(方向|怎么选|干什么|做什么|出路|未来|规划|转行|赛道)/,
  求安慰: /(难受|撑不住|崩溃|委屈|孤独|累了|想哭|心碎|痛苦|难受)/,
  寻意义: /(意义|为什么活|价值|活着|空虚|无聊|为了什么)/,
  做决策: /(该不该|要不要|应不应该|选哪个|值得吗|对不对|如何选择)/,
  求方法: /(怎么|如何|怎样|办法|技巧|提高|养成|坚持|效率)/,
};

const THEME_LABEL = {
  迷茫: "方向不确定、不知道下一步",
  学习: "学和用连不上、动力不足",
  行动: "想得多做得少、迈不出第一步",
  情绪: "情绪被眼前处境牵着走",
  关系: "在意别人评价、关系消耗",
  自我: "怀疑自己的价值",
  长期: "长期投入却看不到反馈",
  判断: "选项太多、拿不准重点",
};

// Phase F-1：5 类桶，将 8 个主题映射到「人生方向 / 学习成长 / 情绪压力 / 关系问题 / 长期选择」，
// 支撑百问验证中 20/20/20/20/20 的进度跟踪（不新增分类维度，只是聚合视图，避免标签膨胀）。
const CATEGORY_OF_THEME = {
  迷茫: "人生方向",
  自我: "人生方向",
  学习: "学习成长",
  行动: "学习成长",
  情绪: "情绪压力",
  关系: "关系问题",
  长期: "长期选择",
  判断: "长期选择",
};

// 返回 { intent, emotion, emotionLabel, theme, category, strategy, tags }
function analyzeQuery(query, history) {
  const q = (query || "").trim();
  const ctx = Array.isArray(history) ? history.map((m) => (m.content || "")).join(" ") : "";
  const text = (q + " " + ctx).toLowerCase();

  // 意图：取首个命中的模式
  let intent = "general";
  for (const key of Object.keys(INTENT_PATTERNS)) {
    if (INTENT_PATTERNS[key].test(text)) { intent = key; break; }
  }

  // 情绪：命中即认为需要共情优先
  let emotion = "";
  let emotionLabel = "";
  for (const key of Object.keys(EMOTION_LEXICON)) {
    if (EMOTION_LEXICON[key].some((w) => text.includes(w.toLowerCase()))) {
      emotion = key;
      emotionLabel = THEME_LABEL[emotion] || key;
      break;
    }
  }

  // 主题：复用主题词库，取命中词最多的主题；纯情绪问题归入对应主题
  let theme = "迷茫";
  let best = 0;
  for (const t of Object.keys(topicLexicon)) {
    const hit = topicLexicon[t].filter((w) => text.includes(w.toLowerCase())).length;
    if (hit > best) { best = hit; theme = t; }
  }
  if (emotion && best === 0) theme = emotion;

  // 策略：带情绪 → 共情优先（经典后置）；决策/方法 → 行动优先
  let strategy = "analyze-first";
  if (emotion) strategy = "comfort-first";
  else if (intent === "做决策" || intent === "求方法") strategy = "action-first";

  const tags = Object.keys(topicLexicon).filter((t) =>
    topicLexicon[t].some((w) => text.includes(w.toLowerCase()))
  );

  // 五分类：仅当确实命中主题/情绪时才归类；完全无匹配归入「未分类」，
  // 避免所有含糊问题都悄悄堆进「人生方向」，保证 F-1 进度统计可信。
  const category = best === 0 && !emotion ? "未分类" : (CATEGORY_OF_THEME[theme] || "人生方向");

  return {
    intent,
    emotion,
    emotionLabel,
    theme,
    category,
    strategy,
    tags,
  };
}

// 给命中的经典附上「为什么引用 / 核心思想 / 现实启发」，供前端引用卡展开（E-4）。
function enrichCitations(citations, analysis) {
  const a = analysis || {};
  const theme = a.theme || "迷茫";
  const lib = actionLibrary[theme] || {};
  const situation = a.emotionLabel || THEME_LABEL[theme] || theme;
  return (citations || []).map(function (c) {
    return Object.assign({}, c, {
      why: "你遇到的是：" + situation,
      principle: (c.summary || c.modernUsage || lib.principle || "").slice(0, 140),
      inspiration: (lib.inspiration || "经典不替你做决定，只提供一个可以对照的视角。").slice(0, 140),
    });
  });
}

// ============================================================
// Phase E-2 — 思想路线推荐
//   把「用户问题 → 思想主题 → 推荐经典」显式呈现，形成引用链，
//   让回答比普通聊天更有结构、更可追溯。
// ============================================================

const TAG_ROUTE = [
  { re: /(情绪|焦虑|压力|崩溃|难过|愤怒|内耗|委屈)/, label: "情绪管理" },
  { re: /(自我|认识|自信|价值|接纳|意义|空虚|迷茫)/, label: "自我认识" },
  { re: /(行动|拖延|执行|实践|改变|坚持|第一步)/, label: "行动实践" },
  { re: /(关系|人际|孤独|评价|比较|社交|他人)/, label: "人际关系" },
  { re: /(长期|逆境|失败|困难|耐心|熬|放弃)/, label: "长期坚持" },
  { re: /(学习|读书|复盘|成长|自律|课程)/, label: "学习成长" },
  { re: /(判断|取舍|选择|优先|重点|矛盾|调查)/, label: "判断取舍" },
];

const FRAME_ROUTE = {
  emotion: "情绪管理",
  learning: "学习成长",
  investigation: "判断取舍",
  longTerm: "长期坚持",
  contradiction: "判断取舍",
  practice: "行动实践",
  general: "自我认识",
};

const ROUTE_CORE = {
  情绪管理: "先安顿情绪，再处理问题——把注意力放回自己能掌控的判断与态度。",
  自我认识: "向内看清自己真正在意什么，答案往往在自己身上，而非别人的评价里。",
  行动实践: "先调整认知，再迈出一个小到不必鼓很大勇气的动作，在行动中修正。",
  人际关系: "把对他人评价的在意，换成对自己节奏与价值的确认。",
  长期坚持: "把大目标拆小、分阶段走，先保住能继续前进的那点力量。",
  学习成长: "把「学」和「用」连起来，动力从「学了能用上」里慢慢长出来。",
  判断取舍: "先把情况调查清楚，抓住最主要的那个矛盾，再下判断。",
};

// 由问题与命中的经典，派生思想路线：{ dimensions:[…], books:[…], core:"…" }
function buildRoute(query, citations) {
  const source =
    (query || "") + " " +
    (citations || []).map((c) => (c.tags || []).join(" ") + " " + (c.title || "")).join(" ");
  const dims = [];
  for (const rule of TAG_ROUTE) {
    if (rule.re.test(source) && dims.indexOf(rule.label) < 0) dims.push(rule.label);
    if (dims.length >= 3) break;
  }
  if (!dims.length) dims.push(FRAME_ROUTE[inferQueryFrame(query)] || "自我认识");
  const books = [];
  (citations || []).forEach((c) => {
    if (c.title && books.indexOf(c.title) < 0 && books.length < 3) books.push(c.title);
  });
  return { dimensions: dims, books: books, core: ROUTE_CORE[dims[0]] || "" };
}

function methodSummary(doc) {
  const summaries = {
    论语: "《论语》的启发很朴素：许多道理不是坐在那里想透的，而是在反复践行、与人相处中慢慢长出来的。",
    孟子: "《孟子》讲逆境，不是说苦难本身好，而是人在承受中常悄悄长出力量与韧劲。",
    大学: "《大学》提醒我们，想改变处境，先回到自己今天能做起的一小步。",
    中庸: "《中庸》讲分寸：情绪不是要压住，而是找到恰当的表达与出口。",
    道德经: "《道德经》讲不争与自知：少和人比高低，多问自己今天有没有更清楚一点。",
    庄子: "《庄子》的开阔在于换一个更大的参照系看自己，便不被眼前的尺度困住。",
    沉思录: "《沉思录》的方法：把注意力放回自己能掌控的判断与态度，外界的纷扰便少些 foothold。",
    "爱比克泰德《手册》": "《手册》的起点：分清「我能做主的」和「我不能做主的」，先把力气用对地方。",
    "柏拉图《申辩篇》": "《申辩篇》的提醒：承认自己不知道，反而留出学习与成长的空间。",
    "尼各马可伦理学（节选）": "《尼各马可伦理学》说，我们成为什么样的人，取决于每天重复的小选择。",
  };
  return summaries[doc.title] || doc.modernUsage;
}

function variantIndex(seed, count) {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return count ? hash % count : 0;
}

function pick(items, seed) {
  return items[variantIndex(seed, items.length)];
}

function gentleFollowUp(query) {
  return pick(
    [
      "你要是愿意，下一次可以只补充三件事：眼前最卡住的选择、你已有的条件、你最担心的后果。情况越具体，办法越不会飘。",
      "先不用把话说得很完整。你可以从一个最小的事实讲起：最近哪件事最消耗你，已经试过什么，还怕什么。我们再接着分析。",
      "今天先谈到这里也可以。等你把具体处境补一点，我们再把问题往下拆，拆到能行动为止。",
      "很多问题，想一想固然重要，更重要的是去实践。有什么新的想法，我们再继续谈。",
    ],
    query
  );
}

// 称呼节奏：一般每 3~5 轮出现一次，不每句都叫，不连续两段重复。
// 品牌「向晚问思」用中性、温和的称呼，不使用任何政治化称谓。
function chooseAddress(seed, turn, frame) {
  const addressRound = turn > 0 && turn % 4 === 1; // 第 1、5、9……轮带称呼
  const comfortFirst = frame === "emotion" && turn === 0;
  if (!addressRound && !comfortFirst) return null;
  return pick(["朋友"], seed);
}

function openingSentence(query, turn, frame) {
  const seed = query + ":" + turn;
  const addr = chooseAddress(seed, turn, frame);
  const leads = [
    "你的这个问题提得很好。",
    "我明白你的顾虑。",
    "不少年轻人都会遇到这样的情况。",
    "不要着急，我们慢慢分析。",
    "事情总可以一件一件弄清楚。",
    "你愿意把它说出来，这本身就很要紧。",
  ];
  const lead = pick(leads, seed);
  if (!addr) return lead;
  const buffer = pick(["", "先别急，", "慢慢来，"], seed);
  return buffer ? addr + "，" + buffer + lead : addr + "，" + lead;
}

// ====== 回答结构：共情 → 分析 → 行动 → 经典 → 追问 ======
// 顺序即产品第一原则：先接住人，再拆解问题，给方向，最后才把经典作为启发。
// 经典永远不是答案，而是帮助用户找到答案的参照。

// ① 理解 / 共情：先接住人，不急于讲道理
function buildUnderstanding(frame, query, turn, analysis) {
  const a = analysis || {};
  if (a.emotion) {
    return pick(
      [
        "你现在不是单纯想要一句道理，而是真的有点累了。先别急着责怪自己；人在压力里反复犹豫，不等于没能力，常常只是事情还没理出头绪。",
        "我明白这种感觉。心里乱的时候，越逼自己立刻想出答案，越容易把自己逼到墙角。我们先把事情放到桌面上，一件一件看。",
        "这个问题不是小题。迷茫、焦虑、受挫，表面上像情绪，里头往往有现实压力、信息不足和选择太多搅在一起。先不要把它全算成自己的错。",
      ],
      query + turn
    );
  }
  return pick(
    [
      "我明白你是在认真琢磨这件事。先别急着要一个答案，把它拆开看，会更清楚。",
      "你愿意把它说出来，这本身就很要紧。我们慢慢来，先把情况理一理。",
      "这个问题值得好好想，不急着一步到位。先把处境摆清楚，办法才站得住。",
    ],
    query + turn
  );
}

// ② 分析：拆解问题为什么发生（不含经典）
function buildAnalysis(frame) {
  const base = {
    emotion: "很多情绪不是来自事实本身，而是来自我们对事实的解读。先把「发生了什么」和「我把它想成了什么」分开，人才会从容一点。",
    longTerm: "这类事最怕一口气把自己压垮。越是长期的困难，越要分阶段看，先保住能继续往前走的力量——把大目标拆小，给自己留出喘息。",
    investigation: "很多选择让人发慌，不是因为完全没有路，而是每条路都只看见一点影子；问题常出在信息不全、又急着下结论。先把情况弄清楚，方向才稳。",
    learning: "学习没劲的时候，先别急着给自己扣「自律差」的帽子。很多时候不是人不肯努力，而是学的东西还没和眼前的问题接上；学和用连起来，动力才长出来。",
    contradiction: "事情一多，容易把每件都当成最急的，越想越乱。这不是你不够努力，而是轻重缓急还没分开；抓住最主要那个矛盾，其余排到后面。",
    practice: "想得多、做得少，往往不是因为懒，而是第一步被想得太大、太完美，人就不敢动。把一个大念头拆成小到不必鼓勇气就能开始的动作，事情就动了。",
    general: "为什么会有这个困扰？根本原因常常不在事情本身，而在情况还没弄清、条件还没摆全。先把它拆开，再找下一个小步。",
  };
  return base[frame] || base.general;
}

// ③ 行动：从行动建议库取本主题的可操作小步
function buildActionText(analysis) {
  const theme = (analysis && analysis.theme) || "迷茫";
  const lib = actionLibrary[theme] || actionLibrary["迷茫"];
  const actions = (lib.actions || []).slice(0, 3);
  if (!actions.length) return "";
  return "可以先试这几件小事：\n" + actions.map((s, i) => (i + 1) + ". " + s).join("\n");
}

// ④ 经典：作为思想支持，明确不是答案
function buildClassicText(main, second) {
  const first = "说到这，想起可以对照的经典——《" + main.title + "》里一个思路：" + methodSummary(main) +
    " 它只是个提醒，不是标准答案。";
  const more = second
    ? " 另外《" + second.title + "》也提醒：" + methodSummary(second)
    : "";
  return first + more + " 你可以挑最有共鸣的一条，回看原文，再想它和你处境的关联。";
}

// ⑤ 追问：留在最后，引导继续想
function localResponse(frame, main, second, query, turn, analysis) {
  const opening = openingSentence(query, turn, frame);
  const understanding = buildUnderstanding(frame, query, turn, analysis);
  const analysisText = buildAnalysis(frame);
  const actionText = buildActionText(analysis);
  const classicText = buildClassicText(main, second);
  const followUp = gentleFollowUp(query);

  return [opening, understanding, analysisText, actionText, classicText, followUp];
}

function formatSources(citations) {
  return citations
    .map((doc, index) => {
      return index + 1 + ". 《" + doc.title + "》｜" + doc.year;
    })
    .join("\n\n");
}

function composeLocalAnswer(query, citations, terms, totalDocuments, turn, params, memory, analysis, intentInfo) {
  params = resolveAnswerParams(params || "plain");
  memory = memory || {};

  // 客观知识 / 技术 / 事实类问题（本轮根本没走知识库）：
  // 模型不可用时，本地拼写回答无法凭空产出专业知识，诚实告知比硬套哲学话术好。
  // 升级前这里会输出「没有检索到足够贴近的文献依据」，对「Python 的 list 和 tuple 有什么区别」
  // 这类问题完全答非所问。
  if (intentInfo && intentInfo.knowledgePolicy === "skip" && !intentInfo.crisis) {
    return {
      mode: "local",
      citations: [],
      retrieval: { queryTerms: terms, totalDocuments, minScore: 0 },
      answer: [
        "这个问题属于「" + (intentInfo.domain || "客观知识") + "」类，需要调用在线模型来给你准确的答案。",
        "目前模型服务暂时不可用，我不想凭印象给你一个可能错误的答案——这类问题错一个细节就会误导人。",
        "你可以稍后重试；如果着急，把问题再具体一点（比如涉及的版本、场景、想达成的目标），恢复后我能答得更准。",
      ].join("\n\n"),
    };
  }

  if (citations.length === 0) {
    const opening = openingSentence(query, turn, "general");
    return {
      mode: "local",
      citations: [],
      retrieval: { queryTerms: terms, totalDocuments, minScore: 0 },
      answer: [
        opening,
        "你这个问题问得很实在。我现在没有检索到足够贴近的文献依据，所以不想拿几句空话来顶你。不是所有问题都能马上给出出处，这一点我要对你老实。",
        "先把情况再说细一点：发生了什么、你已经试过什么、现在最怕的是什么。事情越具体，越容易找到办法。",
        "今天先做一件小事就好，比如把现在的困扰写成三条事实，再看哪一条最影响你。",
        "很多问题不是一口气想明白的，是一步一步看清楚的。目前没有明确资料支持这一说法，你可以再补充细节，我们再接着分析。",
      ].join("\n\n"),
    };
  }

  const paragraphs = localResponse(responseFrame(query, citations), citations[0], citations[1], query, turn, analysis);
  // 追问：在开头点明「延续上文」，让本地回答也接得上多轮语境。
  if (memory.followUp && memory.contextRef) {
    paragraphs.unshift("接着你上一个问题「" + memory.contextRef + "」继续说——");
  }
  const enriched = enrichCitations(citations, analysis);
  let answer = paragraphs.concat(["依据来源：\n" + formatSources(enriched)]).join("\n\n");
  if (params.depth >= 3) {
    answer += "\n\n（深度视角：以上只列了几种传统，你还可以从存在主义、心理学、道家等更多角度继续想，不急于定论。）";
  }
  return {
    mode: "local",
    answer: answer,
    citations: enriched,
    retrieval: { queryTerms: terms, totalDocuments, minScore: citations[citations.length - 1].score || 0 },
  };
}

// ====== 大模型增强（后台配置 + 多模型自动切换）======
// 模型配置来自云数据库 model_config 集合（由管理后台维护），
// 由 index.js 读取后通过 opts.models 传入，本函数只负责调用与拼接。
// 全部模型失败/未配置时回退到本地拼写回答。

// 单个模型调用：用 nodeFetch（基于 https/http 的 Node 16 兼容实现），timeout 选项实现超时中断
async function callOneModel(cfg, systemContent, userContent, priorMsgs) {
  const url = ((cfg.baseURL || "").toString().trim().replace(/\/+$/, "").replace(/\/chat\/completions$/i, "")) + "/chat/completions";

  // system → 历史多轮（上下文记忆）→ 本轮用户问题
  const messages = [{ role: "system", content: systemContent }];
  if (Array.isArray(priorMsgs) && priorMsgs.length) {
    priorMsgs.forEach((m) => messages.push(m));
  }
  messages.push({ role: "user", content: userContent });

  try {
    const res = await nodeFetch(url, {
      method: "POST",
      timeout: cfg.timeout || 25000,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + cfg.apiKey,
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.35,
        max_tokens: 2000,
        messages: messages,
      }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(function () { return ""; });
      throw new Error("HTTP_" + res.status + " " + txt.slice(0, 240));
    }

    const data = await res.json().catch(function () { return {}; });
    const answer =
      data.choices &&
      data.choices[0] &&
      data.choices[0].message &&
      data.choices[0].message.content;
    if (!answer || !answer.trim()) throw new Error("empty_answer");
    return answer.trim();
  } catch (e) {
    // 区分超时与网络错误，便于前端诊断
    if (e && e.message === "timeout") throw new Error("timeout");
    throw e;
  }
}

// ============================================================
// 多轮上下文：取最近 10 轮（user + assistant 各计一条，上限 20 条）。
//   升级前只取 6 条（约 3 轮），「那如何减少这种痛苦？」这类指代经常丢失语境。
// ============================================================
const MAX_CONTEXT_ROUNDS = 10;

function buildPriorMessages(history) {
  const out = [];
  if (!Array.isArray(history)) return out;
  history
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && (m.content || "").trim())
    .slice(-(MAX_CONTEXT_ROUNDS * 2))
    .forEach((m) => out.push({ role: m.role, content: (m.content || "").slice(0, 800) }));
  return out;
}

// ============================================================
// 组装 user 消息：把「必须引用」改为「可选论证依据」。
//   三种资料形态：
//   ① skip      —— 未检索（技术/事实/危机）：明确告知不要引经据典
//   ② 有资料     —— 提供素材 + 使用规则（自然融入、不相关就不用、不得编造）
//   ③ 检索为空   —— 明确告知知识库无相关内容，正常回答即可，不得编造经典
// ============================================================
function composeUserContent(query, citations, params, memory, analysis, intentInfo) {
  params = resolveAnswerParams(params || "plain");
  memory = memory || {};
  const list = citations || [];
  const policy = (intentInfo && intentInfo.knowledgePolicy) || "use";
  const parts = ["问题：" + query];

  if (policy === "skip") {
    const skipDomain = (intentInfo && intentInfo.domain) || "客观";
    let skipNote =
      "【知识库】本轮未启用经典知识库——这是一个「" + skipDomain +
      "」类问题。请依据你自己的通用知识直接、准确地回答，不要引用经典，不要做哲学化包装。\n" +
      "【准确性要求】对于具体专名（人物/机构/作品/事件/数据/日期/引文），只陈述你有把握的常识性内容。" +
      "若对某一具体事实（某人生平细节、某事件精确时间、某条具体引文）没有确切把握，请明确说" +
      "「这一点我无法确认」或给出范围性表述，切勿编造姓名、头衔、年份或原文。" +
      "请区分「广为人知的常识」与「需要查证的具体事实」。";
    if (skipDomain === "事实") {
      skipNote +=
        "\n（事实类问题）尤其注意：你无法实时核实的信息（如近况、未公开数据）应显式标注「未经核实」。";
    }
    parts.push(skipNote);
  } else if (list.length) {
    const context = list
      .map(function (doc, i) {
        return (
          "[" + (i + 1) + "] 《" + doc.title + "》" +
          (doc.section ? "·" + doc.section : "") + " " + (doc.year || "") + " " + (doc.source || "") +
          "\n" + (doc.text || "")
        );
      })
      .join("\n\n");
    parts.push(
      "【可选参考资料】以下是知识库中与本问题可能相关的思想素材。它们是「论证依据」，不是「答题模板」：\n" + context
    );
    parts.push(
      [
        "资料使用规则：",
        "· 先独立、完整地回答用户的问题；资料只在能真正支撑你的分析时才引用。",
        "· 引用要自然融入行文，不要用「《论语》说……」这类句式开头，不要为了引用而引用。",
        "· 只能引用上方资料中真实出现的内容，不得编造经典、不得误标出处。",
        "· 如果这些资料与问题关系不大，就完全不用，正常回答即可——这是被允许的。",
      ].join("\n")
    );
  } else {
    parts.push(
      "【知识库】本轮在知识库中没有检索到与问题直接相关的经典素材。请正常、完整地回答用户的问题，不要编造任何经典引用；如果确实需要提到思想资源，只做泛泛的方向性提及，不给具体原文与出处。"
    );
  }

  // 情绪提示：带情绪时先共情再分析。
  if (analysis && analysis.emotion) {
    parts.push(
      "（情绪提示：用户当前带有「" + (analysis.emotionLabel || analysis.emotion) +
        "」的情绪，请先用 1～2 句共情接住，再进入分析，不要一上来就讲道理或搬名言。）"
    );
  }
  // 危机提示：最高优先级，覆盖一切格式要求。
  if (intentInfo && intentInfo.crisis) {
    parts.push(
      "（危机提示：本轮识别到可能的自伤/伤人风险信号。请立即放弃常规结构，只表达关心、稳定情绪，并引导至专业资源（全国心理援助热线 12356 / 当地急救 120）。不要分析、不要建议、不要引用经典。）"
    );
  }
  // 追问提示：避免模型把追问当成全新问题。
  if (memory.followUp && memory.contextRef) {
    parts.push(
      "（注意：这是对上一个问题「" + memory.contextRef +
        "」的追问，其中的指代词指向上文，请结合上下文回答，不要当成全新问题重新发问。）"
    );
  }

  return parts.join("\n\n");
}

// 多模型自动切换：按 order 顺序逐个尝试，首个成功即返回；全部失败返回带错误原因的对象
// 返回结构：{ answer, modelUsed, error }
//   answer 非空 -> 成功；error 为最后一个模型的失败原因（无模型时为 "no_enabled_model"）
async function tryModelAnswer(query, citations, models, params, memory, analysis, intentInfo) {
  params = resolveAnswerParams(params || "plain");
  memory = memory || {};
  if (!models || !models.length) {
    return {
      answer: null,
      modelUsed: "",
      error: "未配置可用模型。请在管理页填写百炼兼容接口地址和模型 ID，例如 qwen-plus。"
    };
  }

  const userContent = composeUserContent(query, citations, params, memory, analysis, intentInfo);

  // 上下文记忆：把最近 10 轮对话（≤20 条 user/assistant 消息）作为 messages 传入，
  // 让「那如何减少这种痛苦？」这类指代能正确落到上一轮的话题上。
  const priorMsgs = buildPriorMessages(memory.history);

  let lastError = "";
  for (let i = 0; i < models.length; i++) {
    const cfg = models[i];
    try {
      console.log(
        "[模型切换] 尝试 #" + (i + 1) + " " + (cfg.name || cfg.model) +
        " 参数=" + params.key + "(d" + params.depth + "/c" + params.classic_weight + ")" +
        " 意图=" + ((intentInfo && intentInfo.type) || "-") + "/" + ((intentInfo && intentInfo.format) || "-") +
        " 资料=" + ((citations || []).length) + "条" +
        (memory.followUp ? " 追问" : "")
      );
      const answer = await callOneModel(cfg, buildRolePrompt(params, intentInfo), userContent, priorMsgs);
      console.log("[模型切换] " + (cfg.name || cfg.model) + " 成功");
      return { answer: answer, modelUsed: cfg.name || cfg.model, error: "" };
    } catch (e) {
      const rawReason = (e && e.message) ? e.message : "" + e;
      const reason = /HTTP_404/i.test(rawReason) || /Model not exist/i.test(rawReason)
        ? "模型 ID 不存在。百炼兼容模式通常填写 qwen-plus、qwen-max 这类小写模型 ID；不要填控制台展示名，例如 Qwen3.7-Max。原始错误：" + rawReason
        : rawReason;
      console.warn("[模型切换] " + (cfg.name || cfg.model) + " 失败：" + reason);
      lastError = reason;
    }
  }
  return { answer: null, modelUsed: "", error: lastError };
}

async function generateAnswer(query, opts) {
  opts = opts || {};
  const turn = opts.turn || 0;
  const params = resolveAnswerParams(opts.params || opts.mode || "plain");

  // E-1 上下文：前端 history 常已含本轮提问，先剥掉重复的末尾用户消息，
  // 再判断是否为追问并重写检索问题。
  let history = Array.isArray(opts.history) ? opts.history.slice() : [];
  while (
    history.length &&
    history[history.length - 1].role === "user" &&
    (history[history.length - 1].content || "").trim() === (query || "").trim()
  ) {
    history.pop();
  }
  const rw = rewriteQuery(query, history);
  const retrievalQuery = rw.retrievalQuery;
  const memory = { history: history, followUp: rw.followUp, contextRef: rw.contextRef };

  // E-1 问题理解层：在检索之前先理解用户（意图/情绪/主题/策略）
  const analysis = analyzeQuery(query, history);

  // ============================================================
  // ① 意图理解层（通用助手升级）
  //   追问时用「重写后的自足问题」判定，避免「那怎么办？」被判成无领域兜底。
  // ============================================================
  const intentInfo = classifyIntent(rw.followUp ? retrievalQuery : query, history);

  // ============================================================
  // ② 是否需要知识增强 → ③ 条件检索
  //   skip     ：完全不检索（技术/事实/危机），省一次全库扫描，也杜绝硬套经典
  //   optional ：检索但只保留「强相关」（观点讨论，宁缺毋滥）
  //   use      ：正常检索（人生/情绪/成长/关系）
  // ============================================================
  let result = { citations: [], terms: [], totalDocuments: corpus.length, weakRecall: true };
  if (intentInfo.knowledgePolicy !== "skip") {
    result = await retrieve(retrievalQuery, { intentInfo }); // Phase N-5.1：传入意图用于知识路由
    if (intentInfo.knowledgePolicy === "optional") {
      const strong = (result.citations || []).filter(
        (c) => (c.lexicalScore || 0) >= OPTIONAL_LEX_MIN
      );
      result = Object.assign({}, result, { citations: strong, weakRecall: strong.length === 0 });
    }
  }
  const { citations, terms, totalDocuments } = result;
  console.log(
    "[意图] type=" + intentInfo.type +
    " | domain=" + intentInfo.domain +
    " | format=" + intentInfo.format +
    " | needKnowledge=" + intentInfo.needKnowledge +
    " | policy=" + intentInfo.knowledgePolicy +
    " | 命中资料=" + citations.length + "条" +
    " | reason=" + intentInfo.reason
  );

  const enriched = enrichCitations(citations, analysis);

  // E-2 思想路线（用重写后的问题派生，追问也能给出正确路线）
  const route = buildRoute(retrievalQuery, citations);

  // ④ LLM 综合生成（多模型自动切换 + 最近 10 轮上下文）
  const modelRes = await tryModelAnswer(query, citations, opts.models, params, memory, analysis, intentInfo);
  if (modelRes && modelRes.answer) {
    return {
      mode: "model",
      answer: modelRes.answer,
      citations: enriched,
      route,
      analysis,
      intent: intentInfo,
      retrieval: {
        queryTerms: terms,
        totalDocuments,
        minScore: citations.length ? (citations[citations.length - 1].score || 0) : 0,
        retrievalQuery: retrievalQuery,
        followUp: rw.followUp,
        knowledgePolicy: intentInfo.knowledgePolicy,
        skipped: intentInfo.knowledgePolicy === "skip",
      },
      _params: params,
      _modelUsed: modelRes.modelUsed,
      _modelStatus: "ok",
      _modelError: "",
    };
  }

  // 模型不可用（未配置 / 全部失败）→ 回退本地拼写回答，并把原因带上便于排查
  const noConfig = !opts.models || !opts.models.length;
  const reason = noConfig
    ? (opts.modelCfgError || "未配置可用模型。请在管理页填写百炼兼容接口地址和模型 ID，例如 qwen-plus。")
    : (modelRes && modelRes.error ? modelRes.error : "unknown");
  const local = composeLocalAnswer(retrievalQuery, citations, terms, totalDocuments, turn, params, memory, analysis, intentInfo);
  return Object.assign(local, {
    mode: "local",
    route: route,
    analysis,
    intent: intentInfo,
    _params: params,
    _modelStatus: noConfig ? "no_config" : "all_failed",
    _modelError: reason,
    retrieval: Object.assign({}, local.retrieval || {}, {
      retrievalQuery: retrievalQuery,
      followUp: rw.followUp,
      knowledgePolicy: intentInfo.knowledgePolicy,
      skipped: intentInfo.knowledgePolicy === "skip",
    }),
  });
}

module.exports = {
  generateAnswer, retrieve, legacyRetrieve, rankChunks, shapeFromChunk, tokenize,
  inferQueryFrame, rolePrompt, buildRolePrompt, ROLE_PROMPT,
  // Phase E 导出（供测试与内部调用）
  ANSWER_PRESETS, resolveAnswerParams, renderModeInstruction, rewriteQuery, buildRoute,
  // Phase E-v2 导出（问题理解层 + 引用解释层）
  analyzeQuery, enrichCitations, actionLibrary,
  // 通用助手升级导出（意图层 / 动态格式 / 上下文 / user 消息装配）
  classifyIntent, OUTPUT_FORMATS, resolveFormat, composeUserContent, buildPriorMessages,
  MAX_CONTEXT_ROUNDS, OPTIONAL_LEX_MIN,
};
