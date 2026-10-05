# Freshness Layer — Phase Q1-A 实施前审计与实施计划

> **阶段定位**：Phase Q1-A = 实施前代码审计 + 实施计划设计（**只产出本文件，零代码/数据库/知识库/Prompt/环境变量改动，不 commit/push/deploy**）。
> **前置已闭环**：CR-009 → VOID（logs 健康，非事实丢失）；Observation-SOP.md 已建立；Freshness-Layer-Design.md 已通过 A1/D1/P1/R1 决策。
> **本文件作用**：确认现有 `cloudfunctions/chat/freshness/` 是否满足扩展，给出修改文件预清单、双开关设计、B/C 实施方案、测试矩阵、回滚方式、风险与禁止事项。
> **冻结遵守**：corpus.json / intent.js / knowledgeRouter.js / rag.js 零改动（SHA256 守门，改前/后必比对）。

---

## 0. 决策基线（来自用户授权）

| 决策 | 结论 | 本阶段影响 |
|------|------|-----------|
| **A1** | 时间/天气继续属 Capability Layer，不并入 Freshness | 路由无需为时间/天气新增分支；Freshness 只接 B/C/D |
| **D1** | Category C 从「纯思辨邀请」升级为「事实 + 思辨增强」 | C 在事实源开启时走全链路；事实源关闭时维持诚实边界 |
| **P1** | 检索源选型接入 = Phase Q2 OPEN，**本阶段不实施** | 不接真实搜索 API；`FRESHNESS_FACTUAL_ENABLED` 初始 false |
| **R1** | 位置隐私 BLOCKED，不为天气重开 | Freshness 不触碰 location；Capability 天气不动；R-003 仍 BLOCK |
| **双开关** | `FRESHNESS_ENABLED=true` + `FRESHNESS_FACTUAL_ENABLED=false` 初始态 | 先验证路由/格式/隔离，再接事实源 |

---

## 1. 当前架构确认（代码实证，非假设）

### 1.1 三层派发顺序（index.js L258–293）
```
用户请求
  → msgSecCheck(入参)
  → ① Capability Layer   capabilityMaybeHandle()   [L268]  时间/天气/计算/位置
       命中 → 返回 result（绕过 RAG）；未命中 → null
  → ② Freshness Layer    freshnessMaybeHandle()     [L281]  B/C/D 类
       null（A类/危机/异常）→ 直落 RAG；接管 → result
  → ③ Knowledge Layer    generateAnswer()           [L292]  冻结 RAG 链路（唯一兜底）
  → answerId → msgSecCheck(出参) → logObservation(含 freshness/capability 字段) → logs
```
**结论**：A1 已天然满足。时间/天气在 ① 即被拦截，Freshness（②）永不收到「现在几点」类输入。

### 1.2 现有开关（index.js）
- `FRESHNESS_ENABLED`（L21）：`=== "true"` 才 `require('./freshness')`。**关闭时 `freshnessMaybeHandle=null`，整模块不加载、零行为变化** → 即 L1 熔断点。
- `CAPABILITY_ENABLED`（L36）：默认 true，Capability 层熔断开关（已上线）。
- **缺失**：`FRESHNESS_FACTUAL_ENABLED` 当前不存在 → 本计划新增。

### 1.3 Freshness 模块现状（9 文件，全部非冻结、属 Phase Q 自有代码）
| 文件 | 职责 | 本轮是否改 | 备注 |
|------|------|-----------|------|
| `index.js` | 编排器 maybeHandle | **改** | 增 B 思辨增强路径 + C 事实门控 |
| `eventClassifier.js` | A/B/C/D 四分类 + 用户意图层 | 改（可选·低风险） | 补「人物动态」信号，确保 B 不误判为 A |
| `boundaryCheck.js` | normal/sensitive/restricted 三级闸门 | 不改 | 直接复用 |
| `eventRetriever.js` | 检索源抽象（none/http）+ Node16 nodeFetch | 不改 | 已 provider 门控，P1 不接真实源 |
| `factExtractor.js` | 事实/观点/不确定/冲突 隔离抽取 | 不改 | 复用 |
| `contextBuilder.js` | event_context 状态机 + TTL(6h) | 不改 | 复用 |
| `responder.js` | 五段式 + Freshness 护栏 + 输出硬检 | 不改 | **已支持 `eventContext=null` → 产出「无核实事实、只做普遍原则讨论」** |
| `downgrade.js` | 三动作降级（邀请/转向人性/诚实边界） | 不改 | 复用 |
| `schema.js` | 枚举/结构/强制校验 | 不改 | 无需新增枚举 |

### 1.4 关键既有能力（决定 B 思辨增强几乎零新代码）
- `responder.generateFreshnessAnswer({ eventContext: null })`：
  - `buildFreshnessGuardrails(null,…)` → 「本轮没有可核实的事件信息：不得陈述任何具体事实，只做普遍性原则讨论。」
  - `buildFreshnessUserContent(null,…)` → 「【事件信息】本轮没有可核实的事件事实。」
  - `guardOutput` 仍执行（归因断定/站队/未证实指控/未知承认硬检）。
- 结论：**B 类在「无事实源」时产出 WenDao 反思式回答，所需代码已就绪**，只需在 `index.js` 编排层让 B 跳过检索、直奔 responder。

### 1.5 观测字段（Observation-SOP 交叉验证 backbone，已存在）
`observabilityLogger.js` 已写入 `result.freshness.{category,user_intent,event_status,source_confidence,downgraded,downgrade_reason,boundary,guard_violations}` 与 `result.capability.{name,sub_type,…}`。三集合（logs/question_logs/observability_logs）同一次请求同步写入 → 满足 SOP 单集合异常交叉验证。

---

## 2. 修改范围预测（代码层，最小侵入）

### 2.1 `cloudfunctions/chat/index.js`（非冻结，已多次改动）
**(a) 新增双开关读取**（紧邻 L21 之后）：
```js
// Phase Q1-A：事实源开关（独立于模块总开关）。
//   true  → B/C 尝试真实检索（需 Phase Q2 配置 FRESHNESS_SEARCH_PROVIDER）。
//   false → B 走思辨增强（无事实），C 走诚实边界。默认关 = 安全。
const FRESHNESS_FACTUAL_ENABLED =
  (process.env.FRESHNESS_FACTUAL_ENABLED || "").toLowerCase() === "true";
```
**(b) 透传开关** 到 Freshness 调用（L283 opts 内追加）：
```js
result = await freshnessMaybeHandle(message, {
  turn, models: useModels, modelCfgError, mode, history,
  factualEnabled: FRESHNESS_FACTUAL_ENABLED,   // ← 新增
});
```

### 2.2 `cloudfunctions/chat/freshness/index.js`（maybeHandle）
**(a) Category C 事实门控**（改写 L112–121）：
```js
// Category C：事实查询。事实源关闭时维持诚实边界（D1 下限）；
// 事实源开启时（未来）不在此 return，落到下方全链路做「事实+思辨」。
if (cls.category === CATEGORY.C && !opts.factualEnabled) {
  var dgC = downgrade.buildDowngrade({
    reason: cls.confidence === 'low' ? DOWNGRADE_REASON.NO_CLEAR_EVENT
                                     : DOWNGRADE_REASON.NO_RELIABLE_FACT,
    userIntent: ui.intent === USER_INTENT.REFLECTION ? USER_INTENT.INFORMATION : ui.intent,
    query: query,
  });
  meta.downgraded = true; meta.downgrade_reason = 'category-C-guidance';
  return wrapDowngrade(dgC, meta);
}
```
**(b) B 类思辨增强路径**（插入在 L135 低置信澄清 return 之后、L138 检索之前）：
```js
// ---- B 类思辨增强（事实可选）----
// 事实源未启用（FRESHNESS_FACTUAL_ENABLED=false 或 provider=none）时，
// B 不再硬降级为「帮不上忙」，而是产出 WenDao 反思式回答（事实层为空，护栏禁止编造）。
if (cls.category === CATEGORY.B) {
  var providerName = retriever.getProviderName();
  if (!opts.factualEnabled || providerName === 'none') {
    meta.downgraded = false; meta.downgrade_reason = '';
    meta.event_status = ''; meta.source_confidence = '';
    var genB = await responder.generateFreshnessAnswer({
      query: query, category: CATEGORY.B, userIntent: ui.intent,
      eventContext: null, models: opts.models || [], history: opts.history || [],
    });
    if (!genB || !genB.answer) {
      var dgB = downgrade.buildDowngrade({
        reason: DOWNGRADE_REASON.NO_RELIABLE_FACT, userIntent: ui.intent, query: query,
      });
      meta.downgraded = true; meta.downgrade_reason = 'model_unavailable';
      return wrapDowngrade(dgB, meta);
    }
    return {
      mode: 'freshness', answer: genB.answer, citations: [],
      route: { dimensions: [], books: [], core: '' },
      retrieval: { queryTerms: [], totalDocuments: 0, minScore: 0, freshness: true },
      freshness: meta, intent: intentInfo || undefined,
      _modelUsed: genB.modelUsed, _modelStatus: 'ok', _modelError: '',
    };
  }
  // factualEnabled + provider=http → 继续下方既有 B 全链路（L138–228 不变）
}
```
**(c) 既有 B/C 全链路（L138–228）保持不变** —— 事实源开启时的「事实+思辨」主路径，无需重写。

### 2.3 `cloudfunctions/chat/freshness/eventClassifier.js`（可选·低风险增强）
新增「人物/动态」信号，确保「付航最近怎么样」「某演员最近有什么作品」等**稳定落入 B**（而非依赖 intent.js 回落到 C）：
```js
var PERSON_UPDATE_RE = /(最近怎么样|近况|最近在(做|忙)|最近有(什么|哪些)|有什么新(作品|消息|动态|进展|安排)|最近(在|有).{0,6}(消息|动态|演出|活动))/u;
```
在 `classifyCategory` 中：若命中 `PERSON_UPDATE_RE` 且无显式 factOnly 框架，则**升权为 B**（在 ② 无锚点之后的分支里优先判 B）。
⚠️ **回归铁律**：纯哲学句（「论语如何看待学习」「人生迷茫怎么办」）无时间锚点 → 必为 A；现有 `test_freshness.js` 的「A 类零误判」断言须 100% 通过，否则阻断合并。

### 2.4 测试文件
- 扩展或新增 `scripts/test_freshness_q1.js`（离线，零云依赖，同 `test_freshness.js` 风格），覆盖 §6 测试矩阵。
- 可选：`scripts/test_freshness_q1_integration.js`（mock HTTP provider，验证事实源开启路径，仅本地跑，不接真实 API）。

---

## 3. FRESHNESS_ENABLED 使用方式（既有，重申）

| 值 | 行为 |
|----|------|
| `true` | 模块加载；B/C/D 接管，A/危机/异常 → null → RAG；事实源由 `FRESHNESS_FACTUAL_ENABLED` 决定 |
| 非 `true`（含未设） | `freshnessMaybeHandle=null`，index.js 跳过 Freshness，**100% 原行为** |

→ 即**一键熔断 / L1 回滚点**：生产异常时置为非 true，无需重新部署即恢复。

---

## 4. FRESHNESS_FACTUAL_ENABLED 设计（新增）

| 属性 | 说明 |
|------|------|
| 读取 | `process.env.FRESHNESS_FACTUAL_ENABLED === "true"` |
| 默认 | **false（安全）** |
| 依赖 | 仅在 `FRESHNESS_ENABLED=true` 时有意义 |
| false 行为 | B → 思辨增强（无事实）；C → 诚实边界/反思邀请（无事实） |
| true 行为 | B & C → 全链路事实检索 + 事实+思辨（需 `FRESHNESS_SEARCH_PROVIDER` 已配，属 Phase Q2） |
| 初始生产态 | `FRESHNESS_ENABLED=true` + `FRESHNESS_FACTUAL_ENABLED=false` |

**与 P1 的关系**：本开关只是「是否允许尝试检索」的总闸；真正接源（API 合规/密钥/配额/引用机制/内容责任）是 Phase Q2 独立任务，**本阶段不接真实搜索 API**。

---

## 5. B 类思辨增强实施方案

**目标**：无事实源时，B 类用户（「付航最近怎么样」「某电影什么时候上映」）得到 **WenDao 风格反思回答**，而非冷掉的「帮不上忙」。

**机制**（见 §2.2b）：
1. 分类为 B 且事实源关闭 → **跳过 `eventRetriever`**。
2. 以 `eventContext=null` 调 `responder.generateFreshnessAnswer` → 产出「无核实事实 + 普遍原则讨论 + 未知承认」回答（护栏已内置，禁止编造具体事件细节）。
3. `guardOutput` 仍硬检；违规 → 降级文案（宁降级不违规）。
4. meta：`mode:'freshness'`、`downgraded:false`、`source_confidence:null`、`event_status:''` → 观测可识别「B 思辨增强（无事实）」。

**答复格式**（与 Freshness-Layer-Design §六一致）：
```
根据最新公开信息，我目前没有可核实的渠道确认这件事的具体进展。
（不得陈述任何具体事实）

从个人成长角度看：……
如果从长期发展来看：……（开放问题）
```
→ 即「Freshness Fact（空） + WenDao Reflection」，符合产品差异化。

---

## 6. C 类事实回答预留方案（未来，事实源开启时）

**目标**（D1）：C 类（「付航最近有什么消息」事实意图）在事实源开启时产出「事实层 + 思辨层」。

**机制**（见 §2.2a 门控反转）：
- `FRESHNESS_FACTUAL_ENABLED=true` 时，C **不再**在 L112 提前 return，而是落入既有 B/C 全链路（L138–228）：
  `retrieveEventFacts → extractFacts → buildEventContext(grounded/ambiguous) → responder`。
- `responder.js` L73–75 已有 `category==='C'` 护栏：「简短克制地回答事实边界，然后邀请其转向思考」→ 天然实现「事实 + 思辨」。
- 事实层来自 `event_context`（TTL 6h，ephemeral），**绝不进 corpus/embedding**。

**本阶段动作**：仅完成门控代码（§2.2a），**不配置 `FRESHNESS_SEARCH_PROVIDER`**，故生产默认仍走诚实边界。事实源真正开启留待 Phase Q2。

---

## 7. 测试计划

### 7.1 离线单测（`scripts/test_freshness_q1.js`，扩展现有 harness）
| 编号 | 用例 | 预期 | 验证点 |
|------|------|------|--------|
| F1 | 付航最近怎么样？ | Freshness / B / 无事实思辨 | 路由正确 + 不编造 |
| F2 | 今天有什么新闻？ | Freshness / B | 路由正确 |
| F3 | 某电影什么时候上映？ | Freshness / B | 路由正确 |
| F4 | 某演员最近有什么作品？ | Freshness / B | PERSON_UPDATE 信号生效 |
| F5 | 某事件最新进展？ | Freshness / B（或 C 诚实边界） | 路由正确 |
| R1 | 庄子怎么看自由？ | **RAG**（mode 非 freshness） | A 类零误判 |
| R2 | 论语如何看学习？ | **RAG** | A 类零误判 |
| R3 | 人生迷茫怎么办？ | **RAG** | A 类零误判 |
| C1 | 现在北京时间 / 今天天气 | **Capability**（非 Freshness） | A1 边界 |
| S1 | 某政治人物最近怎么样 | D 类降级（非思辨） | 敏感闸门优先 |
| I1 | `FRESHNESS_ENABLED=false` | 模块不加载，RAG 兜底，answer 正常 | L1 熔断 |
| I2 | B 无事实 → `guardOutput` 通过且回答**不含**具体事件名/数字事实 | 不编造 | 反幻觉 |
| I3 | corpus.json SHA256 改前==改后 | 知识库零污染 | 隔离铁律 |
| I4 | 无新 db.collection 写入 / event_context 不持久化 | 隔离 | 不落库 |

### 7.2 集成测试（mock provider，可选，`test_freshness_q1_integration.js`）
- 本地起 HTTP mock 返回伪造新闻 JSON；设 `FRESHNESS_SEARCH_PROVIDER=http` + `FRESHNESS_SEARCH_URL=本地` + `FRESHNESS_FACTUAL_ENABLED=true`。
- 验证 B/C 产出「事实+思辨」；`fact_summary` 可映射 `sources` URL；`guardOutput` 通过；`unknown_points` 非空。
- **仅本地跑，绝不指向真实外部 API**。

### 7.3 冻结资产回归
- 实施前后对 corpus.json / intent.js / knowledgeRouter.js / rag.js 跑 SHA256，必须 4/4 恒定。
- `node --check` 全部改文件；原有 `test_freshness.js`（120/120）、`test_capabilities.js`（75/75）须全绿。

---

## 8. 回滚方案

| 层级 | 触发 | 操作 | 是否需重部署 |
|------|------|------|-------------|
| **L0** | 每次改文件前 | `cp file file.preQ1.bak`（项目惯例） | 否（预防性） |
| **L1** | 生产异常 | 置 `FRESHNESS_ENABLED` ≠ true → 模块卸载，100% 原行为 | 否（改环境变量面板即生效） |
| **L2** | B 思辨引发问题 | 置 `FRESHNESS_FACTUAL_ENABLED=false`（或删） → 退回无事实态 | 否（env 面板）／是（若走代码默认） |
| **L3** | 严重回归 | `git revert` 相关改动 + `tcb fn deploy chat --force` 回退上一包 | 是 |

> 注：本阶段（Q1-A）**不执行任何 env 改动 / 部署**；L1/L2 的 env 操作是后续部署阶段的动作，此处仅记录。

---

## 9. 风险

| ID | 风险 | 缓解 |
|----|------|------|
| R-A | B 无事实回答被误读为「在回答却无信息」 | 护栏禁止具体事实陈述；I2 断言无编造；guard 失败即降级 |
| R-B | 新增 PERSON_UPDATE 信号致边界句误入 B | 「A 类零误判」断言 100% 通过为合并门禁 |
| R-C | `eventContext=null` 引用 `.unknown_points` | 代码已用 `eventContext && (...)` 守卫（responder L58/92），安全 |
| R-D (R1) | 位置隐私 | Freshness 不碰 location；Capability 天气不动；R-003 仍 BLOCK |
| R-E | answer_id 连续性 | L294 已对所有路径统一打 answerId，安全 |
| R-F | 出站检索泄露 PII（未来 P1） | **硬性要求**：调用外部 provider 前必须对 `eventMention` 跑 `piiScrub.mask`；本阶段不接源，留作 Phase Q2 验收项 |

---

## 10. 禁止事项（来自授权，刚性）

- ❌ 修改 corpus.json / intent.js / knowledgeRouter.js / rag.js（冻结四资产）
- ❌ 修改 embedding / RAG 检索逻辑
- ❌ 修改 Prompt（rag.js `ROLE_PROMPT` 仅只读复用，不新增系统 prompt 文件）
- ❌ 修改数据库（无新集合 / 无新写入）
- ❌ 接入真实搜索 API（仅 mock / 预留）
- ❌ 部署生产
- ❌ 修改生产环境变量（env 改动属部署阶段动作）
- ❌ commit / push

---

## 11. 进入实施阶段的授权清单（待用户确认）

满足以下全部方可进入 Q1-B（真实编码）：
1. 用户确认双开关初始态（`FRESHNESS_ENABLED=true` / `FRESHNESS_FACTUAL_ENABLED=false`）。
2. 用户确认 §2.3 的 PERSON_UPDATE 信号增强（可选，但建议做以稳住 B 路由）。
3. 用户确认「B 无事实→思辨增强」的回答话术（§5）符合产品调性。
4. 确认 env 改动与部署动作归入独立授权的部署阶段，不在 Q1-B 内执行。
5. 确认 Phase Q2（P1 检索源）仍独立排期，不随本阶段捆绑。

---

*本文档为 Phase Q1-A 交付物。代码审计结论：**现有 `freshness/` 模块结构满足扩展，仅需编排层小改 + 一个新增开关 + 可选分类信号增强，即可实现 B 思辨增强与 C 事实预留，且全程不触碰冻结资产与知识库。***
