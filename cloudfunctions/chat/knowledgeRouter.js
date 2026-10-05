// ============================================================
// Knowledge Router — 知识路由层（Phase N-5.1）
//   位置：Intent 分类之后、Vector Retrieval 之前。
//   职责：把「这个问题该优先用哪类知识回答」编码成可计算的优先级，
//         交给检索/重排层使用。本身不做检索、不改写知识、不碰云。
//
//   设计原则（与 docs/59 对齐）：
//   · 纯函数、零依赖（不 require rag.js / intent.js，避免循环引用）。
//   · 复用 intent.js 的 domain 结论，不新建平行分类器。
//   · 只是「重排」知识，绝不「屏蔽」知识 —— 心理学卡在认知偏差类问题上依旧可优先。
//   · 路由调整量（routerAdj）是「大常数偏置」，与底层相似度算法解耦：
//     无论生产用 TF 余弦（legacy/rankChunks）还是真实 embedding 余弦，
//     同一套 routerAdj 都适用，单一事实来源。
//
//   输入：routeQuestion({ intentInfo, domain, question })
//   输出：{ priorityDomains, knowledgePriority, preferredTypes, rerankWeights }
//   重排：routerAdj(docType, route) —— 回归/重排层直接调用，加进 base score。
// ============================================================

// ---------- 一键回滚开关（Phase O-0 新增，安全控制，非新功能） ----------
//   生产默认开启：KB_ROUTER_ENABLED 不设置 = 开启（与 N-5.1 行为一致）。
//   设为 "false" 后 routeQuestion 返回零偏置中性路由，routerAdj 恒为 0，
//   等价 N-5.1 之前的旧检索流程 —— 即「关闭 Router = 恢复旧流程」的一键回滚。
//   云端在 chat 云函数环境变量配置；本地测试用 process.env.KB_ROUTER_ENABLED。
const ROUTER_ENABLED = (process.env.KB_ROUTER_ENABLED || "true").toLowerCase() !== "false";

// ---------- 认知心理信号：命中即走「心理学优先」 ----------
//   与 N-4 消融实验 V3 的域闸词表同源，但语义升级为「优先级」而非「开关」。
//   只识别「认知偏差 / 心理学理论」类问题，不覆盖全部心理学。
//   注意收紧：避免哲学语境词（固执/封闭/客观/主观/认知/判断）误触发 psych 优先，
//   例如「坚持到底会不会只是固执？」本质是 中庸/孟子 之辨，应走经典优先。
//   「认知封闭」作为短语保留，以覆盖 B15 这类认知偏差专题。
const COGNITIVE_PSYCH_RE = /偏差|偏见|成见|先入为主|第一印象|确认|验尸|异见|只看|选择性|证据|反证|印证|锚定|框架效应|启发式|可得性|2-4-6|沃森|尼克森|自证|归因|认知封闭/i;

// ---------- 经典优先域：人生/关系/道德/社会/哲学等「向晚问思」主航道 ----------
//   这些域的提问，产品意图是「用经典启发思考」，心理学理论只是补充。
//   默认值即经典优先（覆盖通用/未识别情况），与 docs/59 Priority Matrix 一致。
function isClassicPriorityDomain(domain) {
  // KNOWLEDGE_DOMAINS（人生/道德/社会/情绪/关系/职业/学习/成长）+ 哲学 + 通用兜底
  return ["哲学", "人生", "道德", "社会", "情绪", "关系", "职业", "学习", "成长", "通用", ""].indexOf(domain) >= 0;
}

// ============================================================
// routeQuestion({ intentInfo, domain, question })
//   返回路由决策。所有字段均为纯数据，便于测试与日志审计。
// ============================================================
function routeQuestion({ intentInfo, domain, question } = {}) {
  if (!ROUTER_ENABLED) {
    // 回滚模式：零偏置中性路由，routerAdj 恒为 0，等价于旧检索流程。
    return {
      priorityDomains: [domain || "general"],
      knowledgePriority: {},
      preferredTypes: [],
      rerankWeights: { vectorSimilarity: 1, domainMatch: 0, knowledgePriority: 1, citationAuthority: 10 },
      reason: "router-disabled",
    };
  }
  const q = (question || "").toString();
  const dom = domain || (intentInfo && intentInfo.domain) || "";
  const isPsych = COGNITIVE_PSYCH_RE.test(q);

  if (isPsych) {
    // 认知偏差 / 心理学理论类问题：心理学优先，经典降权但不屏蔽。
    //   psychology +60：让概念卡在相关时可上浮；
    //   classic    -80：避免经典在纯心理问题上抢位（如「为什么我总认为别人针对我」）。
    return {
      priorityDomains: ["cognitive-psychology"],
      knowledgePriority: { psychology: 60, classic: -80 },
      preferredTypes: ["psychology"],
      rerankWeights: {
        vectorSimilarity: 1,
        domainMatch: 30,
        knowledgePriority: 1,
        citationAuthority: 10,
      },
      reason: "cognitive-psychology-signal",
    };
  }

  if (isClassicPriorityDomain(dom)) {
    // 人生/关系/道德/社会/哲学等：经典优先，心理学概念卡大幅降权。
    //   psychology -200：确保概念卡不会在人生问题上挤掉《论语》《申辩篇》等；
    //   classic     +60：统一抬升经典（均匀偏置，不改变经典间相对顺序）。
    return {
      priorityDomains: [dom || "general"],
      knowledgePriority: { psychology: -200, classic: 60 },
      preferredTypes: ["classic"],
      rerankWeights: {
        vectorSimilarity: 1,
        domainMatch: 30,
        knowledgePriority: 1,
        citationAuthority: 10,
      },
      reason: "classic-priority-domain",
    };
  }

  // 客观知识域（编程/数学/科技/健康/事实）：由上游 knowledgePolicy=skip 已不检索，
  // 此分支仅为防御性兜底，默认经典优先。
  return {
    priorityDomains: [dom || "general"],
    knowledgePriority: { psychology: -200, classic: 60 },
    preferredTypes: ["classic"],
    rerankWeights: {
      vectorSimilarity: 1,
      domainMatch: 30,
      knowledgePriority: 1,
      citationAuthority: 10,
    },
    reason: "fallback-classic",
  };
}

// ============================================================
// routerAdj(docType, route)
//   重排层唯一需要调用的函数。返回加进 base score 的调整量：
//     = knowledgePriority[docType]   （类型优先级，大常数偏置）
//     + domainMatch                  （doc 类型命中 route.preferredTypes 时 +30）
//   docType 取自 doc.knowledge_type；缺失一律视为 'classic'（生产经典默认无此字段）。
// ============================================================
function routerAdj(docType, route) {
  if (!route || !route.knowledgePriority) return 0;
  const dt = docType || "classic";
  const priority = (route.knowledgePriority[dt] || 0);
  const dmWeight = (route.rerankWeights && route.rerankWeights.domainMatch) || 0;
  const matched = (route.preferredTypes || []).indexOf(dt) >= 0;
  const domainMatch = matched ? dmWeight : 0;
  return priority + domainMatch;
}

module.exports = {
  routeQuestion,
  routerAdj,
  COGNITIVE_PSYCH_RE,
  isClassicPriorityDomain,
};
