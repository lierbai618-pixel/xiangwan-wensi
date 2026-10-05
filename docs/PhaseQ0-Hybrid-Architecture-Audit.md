# Phase Q0 — Hybrid Intelligence Architecture Audit

**文档编号**：HIA-Q0-001
**阶段**：Phase Q0（架构审计阶段）
**依据**：《向晚问思 Hybrid Intelligence Upgrade Plan v1.0》
**角色**：Chief AI Architect / AI System Engineer / RAG Architect
**审计时间**：2026-08-06 16:0x GMT+8
**审计性质**：**只读扫描（Read-Only）**，零代码修改、零部署、零环境变量变更
**冻结基线**：O-0.6 四资产 SHA256 **4/4 MATCH**（审计前后各校验一次，见 §8）

---

## 0. 结论摘要（TL;DR）

**Phase Q0 验收结论：PASS（有条件）——审计完成，但升级计划书 v1.0 在进入 Q1 之前必须先做一次修订。**

三条必须前置说明的判断：

| # | 判断 | 说明 |
|---|---|---|
| **J-1** | **计划书对现状的描述与实测不符，共 4 处** | 计划书假设「当前 = 用户→Intent→RAG→LLM，所有问题都进知识库，统一五段式」。实测：系统已有 **4 个并行分类器**、**3 条旁路**、**4 套动态输出格式**、**22% 的请求根本不进知识库**。基于失真前提做的设计会导致重复建设。详见 §7 事实核查表。 |
| **J-2** | **Q2 / Q4 已存在成熟设计资产，不应重做** | Q2（Web Search Layer）≈ 已完成的 **Phase S0/S1**（79KB 设计 + 实施规格，卡在 S0.5 选型授权）。Q4（人物实体）≈ 已完成的 **PQRA-001 审计**（卡在 D-1~D-6 人工裁决）。重开设计等于把两条已推进到「等签字」的轨道退回原点。 |
| **J-3** | **计划书内部存在硬性自相矛盾，必须人工裁决后才能进 Q1** | 「禁止修改 intent.js / rag.js / knowledgeRouter.js / corpus.json」与 Q1（新增 Intent 类型）、Q4（人物路由）、Q5（回答模式）的目标**不可同时成立**。PQRA-001 §5.1 已量化：完整修复必然触碰其中 3 项。 |

---

## 1. 当前请求链路（实测，非推演）

### 1.1 完整调用链

```
微信小程序 chat 页
    │  wx.cloud.callFunction({ message, history, mode, conversationId, localOnly })
    ▼
┌─────────────────────────────────────────────────────────────────┐
│ cloudfunctions/chat/index.js  exports.main            (L224)    │
└─────────────────────────────────────────────────────────────────┘
    │
    ├─[S1] 入参内容安全  checkTextSafety(message,"in")      (L240)
    │      └─ msgSecCheck → 命中拦截 / 扫描失败按 #004 降级放行
    │         ⚠ 生产实况：errCode -501001，扫描实际离线（OBS-004-A, P1 OPEN）
    │
    ├─[S2] 指令注入护栏  inputGuard.detect()                (L249)
    │      └─ 12 条正则，命中即拒绝
    │
    ├─[S3] 读模型配置    getEnabledModels()                 (L259)
    │      └─ 云库 model_config，enabled=true，order 升序
    │
    ├─[S4] ★ Capability 旁路   capabilities.maybeHandle()   (L268)
    │      └─ CAPABILITY_ENABLED 默认 true（生产已启用）
    │      └─ 命中 → 绕过 RAG，直接返回 mode='capability'
    │      └─ 未命中 → null，继续下行
    │
    ├─[S5] ★ Freshness 旁路    freshness.maybeHandle()      (L281)
    │      └─ FRESHNESS_ENABLED 默认 false（生产未启用，代码已部署）
    │      └─ 当前恒为 null
    │
    ├─[S6] ★ 主链路      rag.generateAnswer()               (L292)
    │      └─ 见 §1.2 展开
    │
    ├─[S7] 出参内容安全  checkTextSafety(answer,"out")      (L297)
    ├─[S8] 观测落库      logObservation()  fire-and-forget  (L307)
    └─[S9] 业务日志      logChat / logQuestion              (L320-321)
```

### 1.2 generateAnswer 内部（rag.js L1428–1535）

```
generateAnswer(query, {turn, models, modelCfgError, mode, history})
    │
    ├─ ① 剥离重复末尾 user 消息                              (L1436)
    ├─ ② rewriteQuery()      追问重写 → retrievalQuery       (L1443)
    ├─ ③ analyzeQuery()      情绪/主题/策略分析               (L1448)
    ├─ ④ classifyIntent()    ★意图层（冻结 intent.js）       (L1454)
    │
    ├─ ⑤ 条件检索  if (knowledgePolicy !== 'skip')           (L1463)
    │      ├─ retrieve() → routeQuestion() 算路由            (rag.js L802/808)
    │      ├─ Provider 分流  KB_MODE                          (L797)
    │      │    ├─ legacy → legacyRetrieve(corpus.json 14条)  (L590)
    │      │    └─ kb     → kbRetrieve(chunks 集合)           (L792)
    │      ├─ 打分 = 词法分 + TF余弦×24 + routerAdj()         (L754)
    │      └─ optional 二次过滤 lexicalScore ≥ OPTIONAL_LEX_MIN (L1465)
    │
    ├─ ⑥ enrichCitations / buildRoute                        (L1483/1486)
    ├─ ⑦ tryModelAnswer()  多模型顺序切换                     (L1489)
    │      ├─ system = buildRolePrompt(params, intentInfo)    (L421)
    │      └─ user   = composeUserContent(...)                (L1317)
    │
    └─ ⑧ 模型全失败 → composeLocalAnswer() 本地兜底           (L1519)
           └─ ★「五段式」实际只存在于这条兜底路径
```

### 1.3 生产开关全集（实测）

| 环境变量 | 默认值 | 生产值 | 作用 | 位置 |
|---|---|---|---|---|
| `CAPABILITY_ENABLED` | `true` | 未配置=启用 | Capability 层熔断 | index.js:36 |
| `FRESHNESS_ENABLED` | `false` | 未配置=关闭 | Freshness 层开关 | index.js:21 |
| `SEC_DEGRADE_ON_API_ERROR` | `true` | 未配置=启用 | #004 降级放行 | index.js:237 |
| `SEC_EMERGENCY_WARN_ONLY` | `false` | 未配置 | 事故止血 | index.js:105 |
| `KB_MODE` | `legacy` | 未配置=legacy | 检索源切换 | rag.js:798 |
| `KB_ROUTER_ENABLED` | `true` | 未配置=启用 | 知识路由熔断 | knowledgeRouter.js:25 |
| `KNOWLEDGE_OBSERVABILITY_STORE` | JSON | **`cloud`** | 观测落库 | observabilityLogger.js:41 |
| `ADMIN_OPENID` | — | **已配置** | 管理员识别 | cloudbaserc.json |
| `WEATHER_PROVIDER` / `_API_URL` / `_API_KEY` | `none` | 未配置 | 天气源 | weather.js:24-26 |
| `FRESHNESS_SEARCH_PROVIDER` / `_URL` / `_KEY` | `none` | 未配置 | 事件检索源 | eventRetriever.js:71 |

> **关键事实**：`WEATHER_PROVIDER` 与 `FRESHNESS_SEARCH_PROVIDER` 双双为 `none`。
> **系统当前不具备任何外部数据获取能力**——两处 provider 抽象已就位，但零真实数据源接入。

---

## 2. 当前 Intent 分类（★ 本次审计最重要的发现）

系统中**并存 4 个独立分类器**，各有各的类目体系，彼此不共享枚举：

### 2.1 分类器一：`intent.js` `classifyIntent()`（冻结资产）

| 维度 | 取值 |
|---|---|
| **type**（5） | `knowledge` / `life` / `emotion` / `growth` / `opinion` |
| **domain**（16） | 哲学·人生·道德·社会·情绪·关系·成长·职业·编程·数学·科技·健康·**事实**·学习·生活·通用 |
| **knowledgePolicy**（3） | `skip`（不检索）/ `optional`（检索但只留强相关）/ `use`（正常检索） |
| **format**（4） | `technical` / `general` / `philosophy` / `emotion` |
| **crisis** | boolean，最高优先级 |

判定优先级：**危机 → 硬事实域 → 抽象追问 → 情绪 → 观点 → 成长域 → 人生域 → 事实句式 → 兜底 opinion**

### 2.2 分类器二：`capabilities/router.js` `route()`（Phase R，生产启用）

| 能力枚举 | 子类型 |
|---|---|
| `time_query` | time / date / weekday / relative / year |
| `weather_query` | today / forecast |
| `calculation_query` | arithmetic |
| `location_query` | self / nearby |

前置闸门：**危机让位 → 哲学化硬否决（4 组 veto 正则）→ 情绪软信号（不否决，只改语气）→ 命中判定**

### 2.3 分类器三：`freshness/eventClassifier.js`（Phase Q，生产关闭）

四分类 `CATEGORY.A / B / C / D` + `USER_INTENT` + 敏感度分级。当前 `FRESHNESS_ENABLED=false`，**未参与生产判定**。

### 2.4 分类器四：`knowledgeRouter.js` `routeQuestion()`（冻结资产）

三条路由：`cognitive-psychology-signal` / `classic-priority-domain` / `fallback-classic`，输出 `knowledgePriority` 大常数偏置。

### 2.5 结论：计划书的「Intent Router」是第 5 个分类器

```
                    用户问题
                        │
        ┌───────────────┼───────────────┬────────────────┐
        ▼               ▼               ▼                ▼
  capability.route  classifyIntent  eventClassifier  routeQuestion
   (4 类能力)        (5型×16域)      (A/B/C/D，关)    (3 条路由)
        │               │               │                │
   独立正则表        独立正则表       独立正则表       复用 domain
```

> **架构诊断**：这不是「缺一个 Router」，而是**已经有四个 Router，缺一个统一的分类契约**。
> 计划书 Q1 若按字面新增 `fresh_query / wisdom_query / general_chat` 第五套枚举，
> 结果是**五套正则表互相抢词**——而不是计划书设想的「一个清晰的三岔路口」。
>
> **建议改为**：Q1 的产出应是 **Unified Query Classification Contract**（统一分类契约 + 仲裁顺序），
> 把现有四个分类器纳入同一张优先级表，而不是再造一个。

---

## 3. 当前 RAG 流程

### 3.1 Provider 抽象（rag.js L676–820）

| Provider | 数据源 | 状态 | 实测 |
|---|---|---|---|
| **LegacyProvider** | `corpus.json` | **默认启用** | **14 条**，全部先秦经典 + 西方哲学 |
| **KnowledgeBaseProvider** | 云库 `chunks` 集合 | `KB_MODE=kb` 启用 | **count = 0（空集合）** |

### 3.2 检索打分公式

```
score = lexicalScore                      词法命中（tags 12 / 模糊 7 / title 6 / section 5 / summary 4 / text 3）
      + cosine(queryTF, docTF) × 24       TF 词频余弦
      + routerAdj(knowledge_type, route)  知识类型偏置（classic +60 / psychology -200 等）
过滤：score ≥ 4；同书名去重；取 top N
```

### 3.3 ★ 必须纠正的一处术语：**系统里没有 embedding**

| 计划书表述 | 实测事实 |
|---|---|
| 「禁止重建 embedding」 | 系统**从未有过 embedding**。所谓「向量」是 `termFrequency()` 词频向量 + `cosine()`，属**词袋 TF 余弦**，非语义向量。 |
| 「Vector RAG」 | 准确说法是 **Lexical + TF-Cosine Retrieval**。 |
| 「搜索结果 ❌ 写 embedding」 | 该禁令在当前系统中**不可执行也无需执行**——没有 embedding 管线可污染。 |

> 这不是文字游戏。若 Q3 按「升级 embedding metadata」设计，会发现**没有可升级的对象**；
> 真正需要决策的是「要不要引入真语义向量」，这是一个独立的、成本远高于 metadata 扩展的决定。

### 3.4 知识资产实况

| 检查项 | 结果 |
|---|---|
| `corpus.json` 条目 | 14 |
| 含 `knowledge_type` 字段的条目 | **0**（缺失一律视为 `classic`） |
| `knowledge_type` 已定义枚举 | 仅 `classic` / `psychology` |
| 云端 `chunks` 集合 | **空** |
| 人物 / 实体类数据 | **零**（全仓 grep 无实现） |

---

## 4. 当前 Prompt 结构

### 4.1 System 侧（rag.js L217–440）

`buildRolePrompt(params, intentInfo)` 按序拼装 **9 段**：

```
ROLE_PROMPT.system      最高约束 5 条（定位/经典地位/边界/免责/危机优先）
ROLE_PROMPT.identity    身份
ROLE_PROMPT.mission     目标
ROLE_PROMPT.workflow    回答原则 8 条
ROLE_PROMPT.safety      引用纪律 4 条
intentLine              本轮判定（类型/领域/知识增强开关）★动态
fmt.contract            输出结构契约          ★动态，4 选 1
fmt.lengthHint          长度提示              ★动态
renderModeInstruction() 回答方式（depth / classic_weight / example_level）★动态
```

### 4.2 ★ 必须纠正：**当前不是「统一五段式」，而是 4 套动态格式**

| format | 触发条件 | 输出结构 |
|---|---|---|
| `technical` | 硬事实域（编程/数学/科技/健康/事实） | 无固定分段，**明令禁止引经典、禁止哲学化** |
| `general` | 生活/职业/观点 | 【回答】【分析】【建议】【延伸思考】 |
| `philosophy` | 哲学/人生/社会/道德 + 抽象追问 | 【理解】【分析】【经典观点】【思考】（+可选【建议】） |
| `emotion` | 情绪信号 | 【理解】【分析】【建议】【思考】（共情优先，禁止「《论语》说」开头） |

`ANSWER_PRESETS` 另有三预设 `plain / deep / classic`，底层参数化为 `depth 1-3` × `classic_weight 0-1` × `example_level`。

**「理解→分析→行动→经典→思考」五段式**仅存在于 `composeLocalAnswer()`（rag.js L1187），即**模型全部失败时的本地兜底**。生产 99% 请求走 `mode='model'`，不经过它。

> **对 Q5 的直接影响**：计划书 Q5 写「当前五段式，保留，增加模式选择」。
> 实测**模式选择机制已经存在且已生产运行**（4 format × 3 preset）。
> Q5 的真实任务不是「增加模式」，而是「为新增的 search / person 路径补两套 format 契约」——工作量少一个数量级。

### 4.3 User 侧（rag.js L1317–1380）三分支

| 分支 | 条件 | 注入内容 |
|---|---|---|
| ① **skip** | `policy==='skip'` | 「本轮未启用经典知识库……请依据你自己的通用知识**直接、准确地回答**」 |
| ② 有资料 | `citations.length > 0` | 资料清单 + 4 条使用规则（不得编造、不相关就不用） |
| ③ 检索为空 | `citations.length === 0` | 「未检索到相关素材……**不要编造任何经典引用**」 |

> **★ 护栏盲区（PQ-002，P1 OPEN）**：反幻觉护栏写在分支②③，**分支①没有**。
> skip 路径不但不给知识，还显式指示模型「准确地回答」。
> 对任何库外专名（人名/机构名/产品名/地名），这等同于**定向授权编造**。
> 「房主任是谁」只是第一个被发现的样本——**这是一类问题，不是一个问题**。

---

## 5. 可插入位置（Insertion Points）

| ID | 位置 | 范式 | 触碰冻结资产 | 已验证 |
|---|---|---|---|---|
| **IP-1** | `index.js` 主链路旁路点（S4/S5 之间或之后） | `maybeHandle()` 返回 `null` 即透明 | **0 项** | ✅ Phase R 已生产验证 |
| **IP-2** | 新建 `cloudfunctions/chat/search/` | 独立模块，flag 控制 | **0 项** | 📋 Phase S1 §11.1 已规划 |
| **IP-3** | 新建独立人物数据源（新集合/新文件） | 不并入 corpus.json | **0 项** | 📋 PQRA-001 L0 建议 |
| **IP-4** | `observability/observabilityLogger.js` 扩展字段 | 增量字段，向后兼容 | **0 项** | ✅ Q/R 两次已用 |
| **IP-5** | `capabilities/router.js` CAPABILITY 枚举扩展 | 非冻结资产 | **0 项** | ✅ R-001 已用 |
| **IP-6** | `intent.js` DOMAIN_RULES / 新增实体意图 | — | **1 项（intent.js）** | ❌ 需 CR |
| **IP-7** | `knowledgeRouter.js` 新增 person 分支 | — | **1 项** | ❌ 需 CR |
| **IP-8** | `rag.js` skip 分支护栏 / 新 format | — | **1 项** | ❌ 需 CR |
| **IP-9** | `corpus.json` 结构升级 | — | **1 项** | ❌ 需 CR，强烈不建议 |

> **IP-1 是本项目最有价值的架构资产**：Phase R 用它在 **零冻结改动**下修复了实时事实缺陷，
> 生产实测 8606ms → 175ms（约 35 倍），且人格未被侵蚀。任何新能力应优先尝试 IP-1~IP-5。

---

## 6. 风险点登记

### 6.1 计划书自身的风险（★ 需人工裁决）

| 编号 | 风险 | 等级 | 说明 |
|---|---|---|---|
| **HQ-001** | **Phase 编号冲突** | **P0** | 项目中 `Phase Q` 已被 **Freshness Layer** 占用（`PhaseQ0-Freshness-Policy.md`、`PhaseQ1-Freshness-Architecture.md`、`PhaseQ-CompletionReport.md`、代码 `chat/freshness/`）。新计划复用 Q0~Q8 会造成文档与代码注释永久性歧义。**建议改用 Phase T（Hybrid Intelligence）**。 |
| **HQ-002** | **禁改清单与升级目标不可兼得** | **P0** | 禁止改 `intent.js`/`rag.js`/`knowledgeRouter.js`，但 Q1（新 Intent）、Q4（人物路由）、Q5（回答模式）**必然**触碰。PQRA-001 §5.1 已量化为 3 项。**必须先裁决：是放宽禁令走 CR，还是限定范围只做 IP-1~IP-5 旁路。** |
| **HQ-003** | **Q2 与 Phase S 重复建设** | **P1** | Phase S0（48KB 架构）+ S1（31KB 实施规格）+ S-Pre（72KB 就绪包）+ S0.3 fixtures（22KB）已完成，含 Search Router 三触发器、Evidence Gate、七条反幻觉禁令、Provider 抽象、隔离硬约束。**卡点是 S0.5 选型授权，不是设计缺失。** |
| **HQ-004** | **Q4 与 PQRA-001 重复建设** | **P1** | 人物查询已完成四层根因审计，产出 L0-L3 修复层级依赖图与 6 项待裁决事项（D-1~D-6）。**卡点是产品决策与隐私裁决，不是技术分析缺失。** |
| **HQ-005** | **Q8「灰度上线」与「禁改生产环境变量」互斥** | **P2** | 本项目的灰度机制就是 feature flag 环境变量（`*_ENABLED`）。禁改环境变量 = 无法灰度，只能全量或不上。 |
| **HQ-006** | **Q7 测试集 100 条与既有 184 条测试无衔接说明** | **P2** | 现有 `test_capabilities.js` 75/75、`test_freshness.js` 32/32、`test_security_hardening.js`、`phase-f-100-test.json`、`phase-g-regression-test.json` 均为回归护栏。新增 100 条须声明是**叠加**而非**替换**。 |

### 6.2 系统既存风险（与本计划交叉）

| 编号 | 风险 | 等级 | 状态 | 与 Phase Q 的交叉 |
|---|---|---|---|---|
| **OBS-004-A** | msgSecCheck `-501001 invalid access_token`，**内容安全扫描生产实际离线** | P1 | OPEN | 新增联网内容 = 新增不可控外部文本入链，**在安全扫描离线期间引入外部搜索，风险叠加** |
| **PQ-002** | skip 路径幻觉护栏盲区，对**所有**库外专名生效 | P1 | OPEN | Q4 的真正止血点；**独立于 Q4 即可生效** |
| **PQ-001** | 人物实体能力四层皆无 | P1 | OPEN | = Q4 |
| **PQ-003** | 私域人物档案 = 个人信息处理，与 CR-006 隐私口径交叉 | P1 | OPEN | Q4 前置合规 |
| **R-003** | 位置授权分支回答含地址 → 落 `logs` 集合（当前前端不传 location 故不可达） | P2 | 潜伏 | 若 Q 阶段前端开始传 location 即激活 |
| **#003** | 延迟 p99 数据饥饿（H1-H5 全 Unverified） | P2 | Observed | 联网将显著抬高 p99，**基线未建立即变更 = 无法归因** |
| **观察期未完成** | Phase R 观察期有效真实样本 **3 / 50** | — | 进行中 | 计划书未提及观察期；在观察期内叠加大改会**永久污染 R 的归因基线** |

### 6.3 技术约束（硬性，不可协商）

| 约束 | 说明 |
|---|---|
| 运行时锁定 **Nodejs16.13** | 无原生 `fetch`；HTTP 必须走 `rag.js` 内置 `nodeFetch` 或 `https` 模块 |
| 主包体积 | 云函数包当前 11.2MB；新增依赖需评估 |
| 域名白名单 | 任何新外部 API 域名须在小程序后台 + 云函数出网配置登记 |
| 备案状态 | 小程序备案审核中，**引入外部内容源可能触发新一轮合规审查** |
| 部署方式 | `tcb fn deploy chat --force` 可在沙箱内完成；**部署前必读 `cloudbaserc.json`**，否则会静默覆盖生产环境变量 |

---

## 7. 事实核查表：计划书假设 vs 实测

| # | 计划书表述 | 实测 | 判定 |
|---|---|---|---|
| 1 | 「当前：用户→Intent→RAG→LLM」 | 实际 9 阶段，含 2 道安全闸、2 条旁路、1 条观测支路 | ❌ **失真** |
| 2 | 「所有问题都进入知识库」 | `knowledgePolicy=skip` 已存在；N=37 观测样本中 **skip 8 / optional 8 / use 21**，约 **22% 不进知识库** | ❌ **失真** |
| 3 | 「实时信息能力不足」 | Phase R Capability Layer **已上线**（2026-08-05 16:15），时间/日期/星期/相对日期生产验证 3/3 PASS | ◐ **部分过时**（天气/位置确实仍缺数据源） |
| 4 | 「人物、新闻、时间类问题错误率高」 | **时间类已修复**；人物类确认缺失（PQ-001）；新闻类由 Freshness 覆盖但未启用 | ◐ **部分过时** |
| 5 | 「哲学问题和事实问题混杂」 | 已有 `HARD_FACT_DOMAINS` + `format=technical` 分流；真正问题是**反向**的——skip 路径成了幻觉盲区（PQ-002） | ❌ **方向相反** |
| 6 | 「知识库无法区分长期/短期信息」 | 属实。`knowledge_type` 仅 `classic`/`psychology`，无时效维度 | ✅ **成立** |
| 7 | 「当前五段式：理解/分析/行动/经典/思考」 | 生产走 4 套动态 format；五段式仅存于本地兜底 | ❌ **失真** |
| 8 | 「禁止重建 embedding」 | 系统无 embedding，是 TF 词法余弦 | ❌ **对象不存在** |
| 9 | 原则1「实时信息不进入知识库」 | **已实现并在代码层强制**（`capabilities/index.js` L14-16、`freshness` 全链路） | ✅ **已达成，非升级目标** |
| 10 | 原则2「经典知识永远优先」 | **已实现**（`knowledgeRouter` classic +60 / psychology -200；capability 层哲学化硬否决） | ✅ **已达成，非升级目标** |
| 11 | 原则3「知识生命周期隔离」 | **架构已实现**（三层轨道定型），但 metadata 层未落 TTL 字段 | ◐ **部分达成** |
| 12 | 「CR-002 #004 为冻结基线」 | #004 处于 **DEPLOYED + OBSERVATION**，且带 1 项 P1 OPEN（OBS-004-A）。称其为「冻结基线」会掩盖一个开放缺陷 | ⚠ **表述需修正** |

**核查结论：12 项中 5 项失真、3 项部分过时、2 项已达成、1 项表述需修正、1 项成立。**

---

## 8. 审计合规声明

| 项 | 状态 |
|---|---|
| 修改代码 | ❌ 未执行 |
| 修改 Prompt | ❌ 未执行 |
| 修改知识库 | ❌ 未执行 |
| 修改环境变量 | ❌ 未执行 |
| commit / push | ❌ 未执行 |
| deploy | ❌ 未执行 |
| ingest / embedding | ❌ 未执行 |
| 云端调用 | ❌ 未执行（本次审计**零云端调用**，全部为本地文件只读） |
| 生产流量污染 | ✅ 无 |
| 新增文件 | 仅本报告 1 个（`docs/PhaseQ0-Hybrid-Architecture-Audit.md`） |

**冻结四资产 SHA256 复核（2026-08-06 审计时实测）：**

| 资产 | SHA256 | 与 O-0.6 基线 |
|---|---|---|
| `corpus.json` | `db01fbc92064cbea3a6688a98160b6a70c9e150259b54063c8e2e96974eabc8b` | ✅ MATCH |
| `intent.js` | `765ad138ec68c0f159c6f75a60e5268beb02fba152f6d53dbdc539ba1560ca38` | ✅ MATCH |
| `rag.js` | `5b380b3f7c68f374e3d4e5127bd7dbeff747849401ca9d0488498dece1408286` | ✅ MATCH |
| `knowledgeRouter.js` | `848908445dbb5ea93a6f52775dc3c8e6922ff971d6cee115547f236ffed0a935` | ✅ MATCH |

**4/4 MATCH。** 冻结基线自 Phase Q / R / R-001 / CR-002 / #004 五轮迭代保持逐字节恒定。

---

## 9. Phase Q0 验收结果

| 计划书要求的输出项 | 状态 | 对应章节 |
|---|---|---|
| 当前请求链路 | ✅ 完成 | §1 |
| 当前 Intent 分类 | ✅ 完成 | §2 |
| 当前 RAG 流程 | ✅ 完成 | §3 |
| 当前 Prompt 结构 | ✅ 完成 | §4 |
| 可插入位置 | ✅ 完成 | §5（IP-1~IP-9） |
| 风险点 | ✅ 完成 | §6（HQ-001~006 + 既存 7 项） |

**验收：PASS**

---

## 10. 进入 Q1 前必须人工裁决的事项

> **审计员立场：在下列 5 项裁决完成前，不建议启动 Q1。**
> 理由是 HQ-001/HQ-002 属 P0，任一未决都会让 Q1 的产出在评审时被推翻重做。

| 编号 | 裁决事项 | 为何必须人工决定 | 建议倾向 |
|---|---|---|---|
| **HD-1** | Phase 编号：沿用 Q 还是改 T？ | 与已上线的 Phase Q(Freshness) 冲突，影响全部文档与代码注释 | **改 Phase T** |
| **HD-2** | 冻结禁令是否放宽？<br>① 严守禁令 → 范围收缩到 IP-1~IP-5 纯旁路<br>② 放宽 → 走 CR 流程分别授权 | 决定 Q1/Q4/Q5 是否可行；不裁决就设计=必返工 | **② 走 CR**，逐项授权 |
| **HD-3** | Q2 是否合并进已有 Phase S？ | 避免 79KB 设计资产作废与两套 Search 架构并存 | **合并**，Q2 改为「S0.5 选型授权决议」 |
| **HD-4** | Q4 是否合并进 PQRA-001 / CR-008？ | PQRA D-1~D-6 已在等裁决，重开设计等于退回原点 | **合并**，先答 D-1~D-6 |
| **HD-5** | **PQ-002（skip 幻觉盲区）是否抽出来单独优先？** | 影响面覆盖所有库外专名，**改动面最小、止血价值最高、不依赖任何数据建设** | **强烈建议先做**，作为 Phase T-0 |

### 10.1 审计员建议的替代路线（供参考，不构成决定）

```
T-0  PQ-002 止血：skip 分支补不确定性护栏        ← 1 项冻结资产，独立生效，最高性价比
  │
T-1  Unified Query Classification Contract       ← 统一现有 4 个分类器，不造第 5 个
  │      （替代原 Q1）
  ├──────────────┬──────────────┐
  ▼              ▼              ▼
S0.5 选型授权   CR-008 人物     Q3 知识生命周期
（替代 Q2）     （替代 Q4）      metadata（TTL/confidence）
  │              │              │
  └──────────────┴──────────────┘
                 ▼
         T-5 回答格式补契约（替代 Q5，工作量远小于预估）
                 ▼
         T-6/7/8 实施 / 测试 / 灰度
```

---

## 11. 附：本次审计扫描清单

**代码（只读）**：`index.js` · `intent.js` · `rag.js`(74KB, 分段读取) · `knowledgeRouter.js` · `corpus.json` · `capabilities/{index,router}.js` · `freshness/index.js` · `observability/observabilityLogger.js` · `security/*` · `config.json` · `package.json` · `cloudbaserc.json`

**文档（只读）**：`PersonQueryRoutingAudit.md`(PQRA-001) · `PhaseS0-ExternalSearchLayer-ArchitectureDesign.md` · `PhaseS1-SearchLayerImplementationSpecification.md` · `PhaseS0.5-*` · `CR-ChangeRequestInitiationRecord.md` · `PhaseQ-CompletionReport.md` · `PhaseR-ProductionDeploymentRecord.md` 等

**未扫描（本阶段不需要）**：`miniprogram/` 前端 · `archive/` 归档 · `node_modules/`

---

*报告编号：HIA-Q0-001 ｜ 生成于 2026-08-06 ｜ 状态：Q0 PASS ✅｜ HD-1~HD-5 已裁决（改 Phase T / 走 CR / 合并 S+PQRA / T-0 优先）｜ 进入 Phase T 设计阶段（见 HIA-T-PLAN-001、CR-008）*
