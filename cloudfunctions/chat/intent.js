// ============================================================
// 意图理解层（Intent Layer）
//   位置：用户问题 → 【本模块】 → 是否需要知识增强 → RAG → LLM 综合生成
//
//   动机：升级前的链路是「问题 → RAG → 经典回答」，任何问题都被强行套上经典，
//   于是「Python 的 list 和 tuple 有什么区别」也会被《论语》开头，答非所问。
//   升级后由本模块先判断问题类型，再决定是否调用知识库、用哪种回答格式。
//
//   设计约束：
//   · 纯函数、零依赖（不 require rag.js，避免循环引用），可离线单测。
//   · 只做「分类」，不做「回答」；分类结果由 rag.js 消费。
//   · 判定顺序即优先级，危机信号永远最高。
// ============================================================

// ---------- 危机信号：最高优先级，命中后跳过一切知识增强 ----------
const CRISIS_RE = /(自杀|想死|不想活|活不下去|轻生|结束生命|伤害自己|自残|割腕|跳楼|安眠药自尽|杀了他|同归于尽)/u;

// ---------- 情绪信号：命中即走「情绪支持」，共情优先 ----------
const EMOTION_RE = /(焦虑|抑郁|emo|崩溃|难受|难过|想哭|痛苦|绝望|沮丧|委屈|愤怒|生气|烦躁|内耗|压力大|压力|喘不过气|撑不住|撑不下去|好累|很累|疲惫|无力|孤独|寂寞|害怕|恐惧|不安|慌|自卑|失眠|胡思乱想|提不起兴趣|没动力|一事无成|走不出来|配不上|不想上班|心累|心慌|烦|丧|低落|压抑|空虚|麻木|提不起劲|不如别人|比不上|心堵|堵得慌|俱疲|身心俱疲|不爱我|没安全感|被冷落)/u;

// ---------- 观点讨论：用户在征询看法而非要标准答案 ----------
const OPINION_RE = /(你怎么看|你觉得|你认为|如何看待|怎么看待|有什么看法|你支持|你赞同|谈谈你的|说说你的看法)/u;

// ---------- 抽象追问 vs 个人倾诉 ----------
//   「人为什么会痛苦？」是哲学追问，「我很痛苦」是情绪倾诉。
//   两者都含情绪词，但需要完全不同的回答方式：前者要多角度分析，后者要先共情。
//   判据：出现抽象追问句式且没有第一人称，就不按情绪处理。
const PERSONAL_RE = /(我|自己|咱|俺|本人)/u;
const ABSTRACT_ASK_RE = /(人为什么|人们为什么|人类为什么|为什么人|什么是|的本质|意味着什么|从何而来|如何定义)/u;

// ============================================================
// 领域识别（domain）
//   顺序敏感：先命中的优先。哲学专名必须排在「什么是 XX」这类知识句式之前，
//   否则「什么是仁？」会被判成知识咨询而跳过知识库。
// ============================================================
const DOMAIN_RULES = [
  {
    key: "哲学",
    // 思想传统、经典专名、哲学概念。这些问题必须走知识库。
    re: /(哲学|论语|孔子|孟子|老子|庄子|道德经|大学之道|中庸|荀子|王阳明|朱熹|苏格拉底|柏拉图|亚里士多德|申辩篇|斯多葛|沉思录|爱比克泰德|尼各马可|存在主义|儒家|道家|佛家|禅|仁|仁义|礼|君子|良知|性善|性恶|浩然之气|知行合一|格物致知|明明德|慎独|无为|逍遥|天命|中庸之道|形而上|本体论|认识论|尼采|叔本华|康德|黑格尔|弗洛伊德|马克思|虚无主义|功利主义|契约论|辩证法|现象学|目的论|二元论)/u,
  },
  {
    key: "人生",
    re: /(人生|活着|生命的意义|生活的意义|意义是什么|存在的意义|价值观|人生观|幸福|死亡|生死|命运|自由意志|自由|真理|智慧|人性|苦难|自我|我是谁|成功|理想|信念|虚无|活得|追求什么|什么样的生活|怎样的生活|生活|生活方式|人生目标|意义感|归属感|价值感)/u,
  },
  {
    key: "道德",
    re: /(道德|善恶|对错|正义|公平|良心|底线|原则|该不该做|诚实|说谎|背叛|责任|义务|伦理|善|恶|勇敢|节制|宽容|虚伪|正直|自私)/u,
  },
  {
    key: "社会",
    re: /(社会|群体|集体|共同体|国家|文明|制度|秩序|规则|法律|公共|阶层|内卷|竞争|合作|分工|人类为什么)/u,
  },
  {
    key: "情绪",
    re: EMOTION_RE,
  },
  {
    key: "关系",
    re: /(朋友|friend|同事|同学|室友|父母|家人|亲戚|恋爱|异地|另一半|对象|伴侣|婚姻|结婚|催婚|分手|相处|人际|社交|沟通|吵架|闹矛盾|冲突|误解|拒绝别人|领导|上司|老板|孤立|攀比|关系)/u,
  },
  {
    key: "成长",
    re: /(成长|提升|变好|改变自己|自律|习惯|坚持|拖延|半途而废|复盘|长期主义|技能|进步|克服|培养|计划|目标)/u,
  },
  {
    key: "职业",
    re: /(工作|职业|职场|辞职|跳槽|转行|创业|升职|加班|裁员|失业|简历|面试|副业|收入|老家发展|事业)/u,
  },
  {
    key: "编程",
    re: /(代码|编程|程序|报错|bug|debug|闭包|python|javascript|java\b|golang|typescript|函数|变量|数组|数据库|sql|mysql|redis|api|接口|前端|后端|服务器|部署|编译|框架|react|vue|小程序|云函数|git\b|http|https|json|list|tuple|正则)/iu,
  },
  {
    key: "数学",
    re: /(数学|方程|求解|概率|统计|微积分|导数|积分|几何|面积|体积|周长|公式|矩阵|向量|排列组合|质数|计算.*结果|等于多少)/u,
  },
  {
    key: "科技",
    re: /(人工智能|ai\b|机器学习|深度学习|神经网络|大模型|量子|芯片|半导体|区块链|元宇宙|5g|6g|新能源|电池|自动驾驶|航天|火箭|基因|生物技术|相对论|物理|化学|熵增|光速|宇宙|黑洞|碳中和)/iu,
  },
  {
    key: "健康",
    re: /(感冒|发烧|吃药|抗生素|症状|医院|医生|体检|减肥|健身|营养|维生素|睡眠时长|疾病|治疗|疫苗)/u,
  },
  {
    key: "事实",
    re: /(天气|气温|几点|多少钱|汇率|股价|哪一年|谁发明|是谁|在哪里|首都|人口|距离多远|排名|通货膨胀|复利|财务报表|gdp|经济|历史上)/iu,
  },
  {
    key: "学习",
    re: /(学习|读书|阅读|看书|背书|记不住|学不进|复习|考试|考研|考公|上课|听课|笔记|刷题|英语|知识点|专注力|专注|忘|遗忘|效率|逻辑|思维|认知|理解力|记忆力)/u,
  },
  {
    key: "生活",
    re: /(做饭|菜谱|旅行|旅游|租房|买房|搬家|宠物|穿搭|购物|理财|保险|驾照|装修|带娃|育儿)/u,
  },
];

// 知识咨询句式：问定义、原理、区别、方法（客观答案存在）
const FACTUAL_PATTERN = /(什么是|是什么|什么意思|有什么区别|区别是什么|原理是什么|怎么工作|怎么实现|如何计算|怎么计算|等于多少|等于几|等于什么|定义|介绍一下|解释一下|科普)/u;

// 这些领域属于「客观知识域」：有相对确定的答案，硬套经典就是灾难。
const HARD_FACT_DOMAINS = ["编程", "数学", "科技", "健康", "事实"];

// 这些领域适合哲学式展开（【理解】【分析】【经典观点】【思考】）
const PHILO_FORMAT_DOMAINS = ["哲学", "人生", "社会", "道德"];

// 这些领域需要知识增强（用户口径：人生/价值/情绪/关系/成长/道德/选择）
const KNOWLEDGE_DOMAINS = ["哲学", "人生", "道德", "社会", "情绪", "关系", "职业", "学习", "成长"];

const TYPE_LABEL = {
  knowledge: "知识咨询",
  life: "人生思考",
  emotion: "情绪支持",
  growth: "学习成长",
  opinion: "观点讨论",
};

// ---------- 关键词抽取（供检索扩展与日志分析） ----------
const KEYWORD_STOP = new Set([
  "什么", "怎么", "为什么", "怎样", "如何", "可以", "应该", "一个", "一种",
  "这个", "那个", "现在", "自己", "没有", "不是", "就是", "还是", "或者",
  "我们", "他们", "有些", "很多", "非常", "真的", "到底", "究竟",
]);

function extractKeywords(query, domainKey) {
  const text = (query || "").replace(/[\p{P}\p{S}]/gu, " ");
  const out = [];
  if (domainKey) out.push(domainKey);
  const grams = text.match(/[\p{Script=Han}]{2,6}/gu) || [];
  for (const g of grams) {
    if (KEYWORD_STOP.has(g)) continue;
    if (out.indexOf(g) < 0) out.push(g);
    // 长词再切 2-gram，提升与知识库标签的对接概率
    if (g.length > 4) {
      for (let i = 0; i + 2 <= g.length; i += 1) {
        const sub = g.slice(i, i + 2);
        if (!KEYWORD_STOP.has(sub) && out.indexOf(sub) < 0) out.push(sub);
      }
    }
  }
  (text.match(/[a-zA-Z][a-zA-Z0-9+#.]{1,15}/g) || []).forEach((w) => {
    const lw = w.toLowerCase();
    if (out.indexOf(lw) < 0) out.push(lw);
  });
  return out.slice(0, 20);
}

function detectDomain(text) {
  for (const rule of DOMAIN_RULES) {
    if (rule.re.test(text)) return rule.key;
  }
  return "";
}

// ============================================================
// classifyIntent(query, history)
//   返回：
//   {
//     type            : knowledge | life | emotion | growth | opinion
//     typeLabel       : 中文标签
//     needKnowledge   : boolean          是否需要知识增强
//     knowledgePolicy : skip | optional | use
//                        skip     完全不检索，直接回答（技术/事实/危机）
//                        optional 检索但只在强相关时提供（观点讨论）
//                        use      检索并作为思想素材提供（人生/情绪/成长/关系）
//     domain          : 哲学|人生|道德|社会|情绪|关系|职业|学习|成长|编程|数学|科技|健康|事实|生活|通用
//     format          : technical | general | philosophy | emotion  （决定输出结构）
//     keywords        : string[]
//     crisis          : boolean
//   }
// ============================================================
function classifyIntent(query, history) {
  const q = (query || "").toString().trim();
  // 上下文只用于辅助判断情绪延续，不参与领域判定（避免历史话题污染当前问题）
  const recent = Array.isArray(history)
    ? history.slice(-2).map((m) => (m && m.content) || "").join(" ")
    : "";

  // ① 危机信号：最高优先级，直接返回，不检索、不引经据典
  if (CRISIS_RE.test(q)) {
    return {
      type: "emotion",
      typeLabel: TYPE_LABEL.emotion,
      needKnowledge: false,
      knowledgePolicy: "skip",
      domain: "情绪",
      format: "emotion",
      keywords: extractKeywords(q, "情绪"),
      crisis: true,
      reason: "crisis",
    };
  }

  const domain = detectDomain(q) || "";
  const isHardFact = HARD_FACT_DOMAINS.indexOf(domain) >= 0;
  const hasEmotion = EMOTION_RE.test(q) || (!!recent && EMOTION_RE.test(q + " " + recent) && q.length <= 12);
  const isOpinion = OPINION_RE.test(q);
  const isFactualAsk = FACTUAL_PATTERN.test(q);

  // 抽象追问 vs 个人倾诉：
  //   「人为什么会痛苦？」「什么是自由？」含情绪词但本质是思辨追问，应先多角度分析；
  //   「我很痛苦」「我总是焦虑」有第一人称，是真实情绪倾诉，应先共情。
  //   判据：命中抽象追问句式且无第一人称 → 走哲学/思辨，不按情绪处理。
  const abstractInquiry = ABSTRACT_ASK_RE.test(q) && !PERSONAL_RE.test(q);

  let type;
  let reason;

  if (isHardFact) {
    // 客观知识域一律走知识咨询——「人工智能未来会怎样」也属此列，
    // 由通用知识回答，不做哲学化包装。
    type = "knowledge";
    reason = "hard-fact-domain";
  } else if (abstractInquiry) {
    // 抽象追问：无第一人称的哲学/思辨问题，正常分析即可，不强行共情。
    // 知识政策用 use（人文话题有经典可佐），输出哲学式结构。
    type = "life";
    reason = "abstract-inquiry";
  } else if (hasEmotion || domain === "情绪") {
    type = "emotion";
    reason = "emotion-signal";
  } else if (isOpinion) {
    type = "opinion";
    reason = "opinion-marker";
  } else if (domain === "学习" || domain === "成长") {
    type = "growth";
    reason = "growth-domain";
  } else if (PHILO_FORMAT_DOMAINS.indexOf(domain) >= 0 || domain === "关系" || domain === "职业") {
    type = "life";
    reason = "life-domain";
  } else if (isFactualAsk) {
    // 无明确领域但问的是定义/原理 → 当作知识咨询直接答
    type = "knowledge";
    reason = "factual-pattern";
  } else {
    // 兜底：当作观点讨论，检索但不强求引用（既不硬套经典，也不放弃知识增强）
    type = "opinion";
    reason = "fallback";
  }

  // ---- 是否需要知识增强 ----
  let knowledgePolicy;
  if (type === "knowledge") {
    knowledgePolicy = "skip";
  } else if (type === "opinion") {
    // 观点讨论：人文话题给素材，客观话题不给
    knowledgePolicy = KNOWLEDGE_DOMAINS.indexOf(domain) >= 0 || domain === "" ? "optional" : "skip";
  } else {
    knowledgePolicy = "use";
  }

  // ---- 输出格式 ----
  let format;
  if (type === "knowledge") {
    format = "technical";
  } else if (type === "emotion") {
    format = "emotion";
  } else if (abstractInquiry || PHILO_FORMAT_DOMAINS.indexOf(domain) >= 0) {
    // 抽象追问一律哲学式结构（即便其 domain 误落到情绪）
    format = "philosophy";
  } else {
    format = "general";
  }

  return {
    type,
    typeLabel: TYPE_LABEL[type],
    needKnowledge: knowledgePolicy !== "skip",
    knowledgePolicy,
    domain: domain || "通用",
    format,
    keywords: extractKeywords(q, domain),
    crisis: false,
    reason,
  };
}

module.exports = {
  classifyIntent,
  // 导出内部规则供测试与调参
  CRISIS_RE,
  EMOTION_RE,
  OPINION_RE,
  DOMAIN_RULES,
  HARD_FACT_DOMAINS,
  PHILO_FORMAT_DOMAINS,
  KNOWLEDGE_DOMAINS,
  TYPE_LABEL,
  extractKeywords,
};
