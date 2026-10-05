# Knowledge Platform Engineering Specification v1.0

## 向晚问思（WenDao）知识平台工程规范

> 阶段：Phase O-0.5（Knowledge Platform Engineering Specification）
> 角色：Chief AI Architect + Software Architect + Knowledge Platform / Engineering Governance / AI Search / RAG Architect
> 状态：**工程规范固化（Engineering Specification）** —— 零代码改动、零知识新增、零生产影响、零 commit、零发布。
> 上游：`docs/62-Knowledge-Platform-v1.0-Standard.md`（本规范是其工程化落地版，把"标准"进一步转译为"可执行的接入规则"）。
> 目标：任何未来开发者 / AI Agent / 知识扩展，**无需理解项目历史**，仅凭本规范即可正确接入平台；任何扩展**不得重新设计架构**。

---

## 1. Executive Summary

`docs/62` 把已验证的能力固化成了**标准（Standard）**。`docs/63` 进一步把它转译为**工程规范（Engineering Specification）**——即"谁来、怎么做、做到什么程度算合格"的可执行契约。

本规范回答四个工程问题：

1. **平台由哪几层组成、每层职责边界在哪？**（§2 Platform Layers）
2. **一个 Knowledge Object 从草稿到下线，必须经历哪些阶段、每阶段能做什么不能做什么？**（§3 Knowledge Lifecycle）
3. **一个开发者要新增一类知识，标准动作是什么？**（§4 Developer Guide / §5 Extension Contract）
4. **平台靠什么保证"加知识不破旧行为"？**（§6 Platform Invariants / §7 Compatibility Matrix / §8 Release Certification / §9 ADR）

**纪律遵守声明（本阶段）：** 未修改任何生产代码（`corpus.json` / `intent.js` / `rag.js` / `knowledgeRouter.js` 均未被改动），未新增知识对象，未 ingest，未 embedding，未改 Prompt / Intent，未 commit，未发布。本文件为**唯一交付物**。

**核心承诺（不可破坏）：** 未来任何知识扩展——哲学、心理学、管理、AI、法律、医学、科学、历史、文学——**不修改 Router、不修改 Prompt、不修改 Intent**，只新增 **Metadata + Policy 行 + Knowledge Object**。

---

## 2. Platform Layers

平台由 **10 个职责层** 组成。每层以「职责 / 输入 / 输出 / 禁止事项 / 依赖」五元组定义，边界清晰、可独立测试、可独立回滚。

### 2.1 层总览

| # | 层 | 代码实体 | 是否本阶段可改 |
|---|---|---|---|
| L1 | Intent Layer | `intent.js: classifyIntent()` | ❌ 冻结 |
| L2 | Knowledge Router Layer | `knowledgeRouter.js: routeQuestion / routerAdj` | ❌ 冻结（仅 Policy 数据可扩） |
| L3 | Knowledge Policy Layer | `routeQuestion` 三分支（标准形态 = Policy Matrix） | 🔧 仅声明式数据可扩 |
| L4 | Metadata Layer | `knowledge_type` + 19 字段契约（§5 引用） | 🔧 新对象强制、旧经典 grandfathered |
| L5 | Retrieval Layer | `rag.js: legacyRetrieve / rankChunks / kbRetrieve` | ❌ 冻结 |
| L6 | Rerank Layer | `rag.js` 内 `+ routerAdj(docType, route)` | ❌ 冻结 |
| L7 | Citation Layer | `rag.js: shapeFromChunk().citation` | ❌ 冻结 |
| L8 | Evaluation Layer | `tests/pilot-n5/{o0-readiness,run-regression}.js` | 🔧 门禁脚本可扩展套件 |
| L9 | Release Gate | `docs/62 §7` + 脚本 | 🔧 标准流程固化 |
| L10 | Governance Layer | Registry / Review / Version（人工 + 元数据） | 🔧 流程治理 |

### 2.2 各层职责（五元组）

**L1 Intent Layer**
- 职责：判断「是否检索」「输出什么格式」「意图域是什么」。
- 输入：用户问题文本。
- 输出：`{ domain, knowledgePolicy, format, type }`。
- 禁止：判断知识优先级、给知识打分、决定哪类知识优先。
- 依赖：无（最上游）。

**L2 Knowledge Router Layer**
- 职责：把「问题该优先用哪类知识」编码成可计算优先级（Route Decision）。
- 输入：`{ intentInfo, domain, question }`。
- 输出：`RouteDecision = { priorityDomains, knowledgePriority, preferredTypes, rerankWeights, reason }`。
- 禁止：做检索、读知识正文/交叉引用、调云、改 Prompt、分类意图。
- 依赖：L1（消费 `domain`）；被 L5/L6 消费。

**L3 Knowledge Policy Layer**
- 职责：将「域/心理信号 → 知识优先级」表达为可配置的 Policy，而不是硬编码 `if`。
- 输入：Route 触发条件（domain 集合 / `COGNITIVE_PSYCH_RE` 命中）。
- 输出：`knowledgePriority` / `preferredTypes` / `rerankWeights.domainMatch`。
- 禁止：在 Router 代码里写死新的 `if domain === "xxx"`（新增域只改 Policy 数据）。
- 依赖：L2 查表；反向受 L10 治理约束。

**L4 Metadata Layer**
- 职责：为所有 Knowledge Object 提供统一、强约束的描述契约。
- 输入：Knowledge Object 源 + 19 字段。
- 输出：携带完整 Metadata 的候选对象。
- 禁止：出现自由字段（free-form field）；类型拼写漂移。
- 依赖：被 L2/L5/L7 消费（`knowledge_type` 是路由唯一依据）。

**L5 Retrieval Layer**
- 职责：按 query 从候选池召回候选（TF 余弦或 embedding 余弦）。
- 输入：query + 候选池 + `route`（可选）。
- 输出：按 base score 排序的候选。
- 禁止：决定知识优先级（那是 L2/L6 的事）；读 `knowledge_type` 之外的语义。
- 依赖：L4（候选池）；消费 L2 的 `route`。

**L6 Rerank Layer**
- 职责：在 Retrieval 的 base score 上叠加 `routerAdj` 偏置，产出最终排序分。
- 输入：base score + `route`。
- 输出：最终 `rerank_score`。
- 禁止：改变 `routerAdj` 的数学性质（大常数偏置、未知类型中性）。
- 依赖：L2 的 `routerAdj`；与相似度算法解耦。

**L7 Citation Layer**
- 职责：把命中的 chunk 封装为可引用结构（含 `knowledge_type` 透传）。
- 输入：chunk。
- 输出：`{ chunk_id, title, citation, knowledge_type, … }`。
- 禁止：改变引用真实性（不得伪造来源）。
- 依赖：L4（读 `knowledge_type` / `citation_type`）。

**L8 Evaluation Layer**
- 职责：运行回归 / 侵入 / 引用 / no-op 全套度量。
- 输入：候选池 + 三套基准（100/50/20）。
- 输出：度量报告（hit3 / intrusion / no-op mismatch）。
- 禁止：修改候选池之外的生产代码。
- 依赖：L5/L6（复用检索逻辑）。

**L9 Release Gate**
- 职责：把 ①-⑩ 门禁编排为 Go/No-Go 决策。
- 输入：Evaluation 报告 + Metadata 报告。
- 输出：`go` / `no-go`。
- 禁止：绕过任一门禁直接放行。
- 依赖：L8 + L4。

**L10 Governance Layer**
- 职责：类型注册、审核状态、版本管理、回滚信号。
- 输入：Knowledge Object + 审核记录。
- 输出：注册表 / 审核结论 / 回滚指令。
- 依赖：反向约束 L3/L4。

---

## 3. Knowledge Object Lifecycle

每个 Knowledge Object 必须经历以下阶段。**阶段间单向推进，回退须显式授权。**

```
Draft ──▶ Candidate ──▶ Review ──▶ Approved Candidate ──▶ Pilot ──▶ Production
                                                                  │
                                                                  ▼
                                                           Deprecated ──▶ Archived
```

### 3.1 阶段定义

| 阶段 | 允许操作 | 禁止操作 | 退出条件（→ 下一阶段） | 回滚条件 |
|---|---|---|---|---|
| **Draft** | 编写源文档、本地试分块 | 入库、调检索、commit 到生产 | 源文档结构完整、可 `splitChunks` | — |
| **Candidate** | 写入 19 字段 Metadata；注册类型；本地 embedding | 进生产候选池 | Metadata 校验通过（§5）`review_status=pending` | 退回 Draft |
| **Review** | Governance 审核内容合规、版权、质量分 | 修改路由/Prompt/Intent | `review_status=approved` | 退回 Candidate（`rejected`） |
| **Approved Candidate** | 注入隔离候选池跑门禁 | 进生产 | 门禁 ①-⑧ 全过 | 退回 Review |
| **Pilot** | 在 `tests/pilot-*` 命名空间验证（真实 embedding / 真实回归） | 接生产流量 | Regression Classic Hit@3≥0.82、Intrusion=0 | 回退 Approved（删除 pilot 产物） |
| **Production** | 正式纳入候选池、带 `knowledge_type` | 改路由行为 | 真机复跑 50 题对齐沙箱 | L1/L2 回滚开关（§8） |
| **Deprecated** | 标记 `status=deprecated`、停止新召回 | 删除资产 | 观察期无引用依赖 | 恢复 Production |
| **Archived** | 移出候选池、保留资产与版本记录 | 重新激活（须走全周期） | — | 重新 Draft |

### 3.2 铁律
- **未过 Review 的知识，不得进入任何候选池**（生产或 pilot）。
- **未过 Pilot 回归门禁的知识，不得 Production**。
- 回退（rollback）不要求代码回退：L1 开关 / L2 类型移除即可（见 §8）。

---

## 4. Developer Guide

> 《新增一个 Knowledge Object》标准流程。任何人（人或 AI）必须严格遵循，不得跳步。

### Step 0 — 前置确认
- [ ] 确认目标 `knowledge_type` 已在 Registry（§5 引用 docs/62 §5）；若不在，**先注册**再继续。
- [ ] 确认不修改 Router / Prompt / Intent（违反则本流程不适用，需走 ADR）。

### Step 1 — Metadata（§5 契约）
编写该对象的 19 字段 Metadata。`knowledge_type` **必填且须为注册值**；`status=draft`；`created_at/updated_at` 填 ISO8601；`embedding_version` 填目标 embedding 模型（如 `dashscope-v3-1024`）。
> ⚠️ 缺失 `knowledge_type` 会被平台视为 `classic` —— 这是经典兜底，不是新类型的正确接入方式。

### Step 2 — Registry（§5）
若 `knowledge_type` 未注册：在 Registry 表登记 `{ 类型, 含义, 路由策略 }`，并在代码中引用常量（非字面量）。**禁止**直接写字符串 `"xxx"`。

### Step 3 — Chunk（分块验证）
用生产 `splitChunks`（只读 require，不修改）切分源文档。**每块必须带 `knowledge_type`**，且**标题各异**（防止重排去重塌缩导致多块同名挤占 Top-3，即 N-4 的失败模式）。
> 校验：每块 `knowledge_type` 存在；块间重叠不超阈。

### Step 4 — Embedding（向量化）
用**与现有池一致**的 `embedding_version` 生成向量（维度匹配）。记录 API 用量与失败数。
> 禁止混用不同 `embedding_version` 的向量入同一池（门禁 ④ 会拦截）。

### Step 5 — Regression（三套基准）
在 `tests/pilot-*` 隔离命名空间注入候选池，跑：
- **100 题 Phase H** no-op（路由 ON/OFF 生产路径逐字节一致，mismatch=0）
- **50 题 Phase N** Classic Hit@3 ≥ 0.82、Intrusion = 0
- **20 题 Phase N 基准** Bench Hit@3 ≥ 0.95
> 重点守护 #48（朋友犯错要不要指出）——路由后经典须召回、概念卡退后排。

### Step 6 — Release Gate（§8）
全部 ①-⑧ 通过 → ⑨ Readiness 通过 → ⑩ Go。任一失败 → No-Go，**不得上线**。

### Step 7 — Production
正式纳入生产候选池，文档带 `knowledge_type`。真机复跑 50 题回填 `actual_books` 与沙箱对齐。
> 上线后保留 L1 开关可独立关闭（回滚默认）。

---

## 5. Extension Contract

任何扩展（新增 `knowledge_type` / `domain` / `policy` / `metadata` / `citation`）必须遵循以下契约。**禁止自由发挥。**

### 5.1 新增 `knowledge_type`
- MUST：在 Registry 注册（docs/62 §5）。
- MUST：代码中引用 Registry 常量，非字面量。
- MUST：该类型所有对象 Metadata 携带此 `knowledge_type`。
- MUST：在 Policy Matrix（§2 L3）声明其优先级行（否则走 fallback-classic 中性）。
- MUST：过 Extension Invariant（§6）——未知类型 `routerAdj=0` 不崩溃。

### 5.2 新增 `domain`
- MUST：若意图域需新值，在 `intent.js` 的 `KNOWLEDGE_DOMAINS` / `DOMAIN_RULES` 扩展（**此步允许改 intent.js 的域枚举，但禁止改其分类逻辑**）。
- MUST：在 Policy Matrix 配置该 domain 的 `knowledgePriority`。
- MUST NOT：在 Router 代码写死 `if domain === "newX"`（应走 Policy 数据）。

### 5.3 新增 `policy`
- MUST：以 Policy Matrix 一行表达（trigger → priorityDomains / knowledgePriority / preferredTypes / domainMatch）。
- MUST NOT：在 `routeQuestion` 增加硬编码分支（除非先走 ADR 证明声明式不可表达）。
- MUST：`classic` 永远出现在兜底行（不丢失经典）。

### 5.4 新增 `metadata`
- MUST：归入 §5（docs/62 §4）19 字段之一，或经 Governance 评审新增字段并入契约。
- MUST NOT：出现自由字段（free-form）。
- MUST：类型/枚举符合约束；默认值可推导。

### 5.5 新增 `citation`
- MUST：符合 `citation_type` 枚举（book / paper / concept-card / case / manual）。
- MUST NOT：伪造来源；`source_type` 合法。
- MUST：Citation Layer 透传 `knowledge_type`（供下游识别）。

---

## 6. Platform Invariants

以下不变量**任何扩展不得破坏**，由 Release Gate（§8）与 Evaluation Layer（§2 L8）守护。

| ID | 不变量 | 形式化 | 破坏后果 |
|---|---|---|---|
| INV-1 | **Router 关闭 = 旧行为一致** | `KB_ROUTER_ENABLED=false` ⇒ `routerAdj ≡ 0` ⇒ 检索结果逐字节不变 | 回归漂移、no-op 失败 |
| INV-2 | **Classic 无 `knowledge_type` = 默认 classic** | `docType` 缺失 ⇒ `"classic"` | 经典被当未知类型中性、偏置失效 |
| INV-3 | **未知 `knowledge_type` = Neutral** | `routerAdj(unknown, route) = 0` | 未知类型崩溃 / 偏置异常 |
| INV-4 | **Policy 缺失 = Fallback Classic** | 无匹配行 ⇒ `fallback-classic: {classic:+60, psychology:-200}` | 经典召回下降 |
| INV-5 | **Classic 永在兜底** | 任意 Route 的 `knowledgePriority` 含 `classic` | 经典丢失 |
| INV-6 | **不屏蔽只重排** | `psychology` 升权行 `classic` 非负即 0（不强制删除） | 概念卡在相关域不被召回 |
| INV-7 | **路由与算法解耦** | `routerAdj` 是大常数偏置，TF/embedding 同套 | 换相似度算法需改路由 |
| INV-8 | **路由零云依赖** | `routeQuestion` 不 require rag/intent/cloud | 循环依赖 / 部署耦合 |
| INV-9 | **Intrusion 锁死 0** | 非相关域 Top-3 不含概念卡 | 产品定位退化（如 #48） |
| INV-10 | **回滚默认开启** | 任何新能力自带 Feature Flag | 无法快速止损 |

---

## 7. Compatibility Matrix

未来各知识域如何兼容平台。**「改」= 需要动作；「禁」= 绝对不允许。**

| 域 | Metadata | Policy | Router 代码 | Prompt | Intent 分类 | 说明 |
|---|---|---|---|---|---|---|
| **哲学** (classic) | 现状已满足（grandfathered） | 无需（走 fallback-classic） | 🚫 禁改 | 🚫 禁改 | 🚫 禁改 | 默认主航道 |
| **心理学** (psychology) | 须带 `knowledge_type:"psychology"` | 已有认知偏差行 | 🚫 禁改 | 🚫 禁改 | 🚫 禁改（Router 自带 `COGNITIVE_PSYCH_RE`） | P-04 已验证 |
| **管理** (management) | 须注册 + 带类型 | ✏️ 在 Matrix 加一行 `management:+60, classic:-80` | 🚫 禁改 | 🚫 禁改 | 🚫 禁改 | 仅 Policy 数据 |
| **AI** (ai) | 须注册 + 带类型 | ✏️ Matrix 加一行 `ai:+60, classic:-80` | 🚫 禁改 | 🚫 禁改 | 🚫 禁改 | 科技域升权 |
| **法律** (law) | 须注册 + 带类型 | ✏️ Matrix 加一行 `law:+60, classic:-80` | 🚫 禁改 | 🚫 禁改 | 🚫 禁改 | 法律域升权；注意合规审核 |
| **医学** (science/health) | 须注册 + 带类型 | ✏️ Matrix 加一行（health 若不被 skip） | 🚫 禁改 | 🚫 禁改 | ⚠️ 若走客观域可能被 `skip`（不检索）——需评估是否另设域 | 健康域上游可能 skip |
| **科学** (science) | 须注册 + 带类型 | ✏️ Matrix 加一行 `science:+60, classic:-80` | 🚫 禁改 | 🚫 禁改 | 🚫 禁改 | 科学域升权 |
| **历史** (history) | 须注册 + 带类型 | ✏️ Matrix 加一行 `history:+60, classic:-40` | 🚫 禁改 | 🚫 禁改 | 🚫 禁改 | 历史域升权（经典降权小） |
| **文学** (literature) | 须注册 + 带类型 | ✏️ Matrix 加一行 `literature:+60, classic:-40` | 🚫 禁改 | 🚫 禁改 | 🚫 禁改 | 文学人生域升权 |

**铁律：** 所有「✏️ 在 Matrix 加一行」均属 **Policy 数据变更**（L3），**不触碰 Router 函数体**（L2）。任何域扩展都**不得**修改 Prompt / Intent 分类逻辑 / Router 代码。

---

## 8. Release Certification

> Platform Certification Checklist。新增知识**必须全部通过**，否则不得上线。

| # | 认证项 | 输入 | 通过条件 | 失败条件 |
|---|---|---|---|---|
| C1 | Metadata 认证 | 19 字段 | 全部符合 §5（docs/62 §4）约束 | 字段缺失 / 类型违例 |
| C2 | Chunk 认证 | 分块列表 | 每块含 `knowledge_type`；标题各异 | 缺类型 / 块塌缩 |
| C3 | Embedding 认证 | 向量 | `embedding_version` 与池一致；维度匹配 | 版本错配 / 维度不符 |
| C4 | Regression 认证 | 50 题 | Classic Hit@3 ≥ 0.82 | < 0.82 |
| C5 | Citation 认证 | Top-3 + 引用 | 引用完整、`source_type` 合法、无伪造 | 缺 `citation` / 伪造 |
| C6 | KQS 认证 | 知识质量分 | `quality_score` 达标（可测维度全过，无数据维度标 N/A） | 质量分低于门限 |
| C7 | Rollback 认证 | L1/L2 开关 | `KB_ROUTER_ENABLED=false` 等价旧流程；类型可移除恢复 Classic Only | 开关无效 / 有副作用 |
| C8 | Release Gate 认证 | ①-⑩ | Go | No-Go |

**Certification 结论判定：** C1–C8 **全过** ⇒ **Certified（可上线）**；任一不过 ⇒ **Not Certified（禁止上线）**，退回对应生命周期阶段（§3）。

---

## 9. Architecture Decision Record (ADR)

记录关键决策**为什么这样定**，避免未来重复争论。

### ADR-1：Intent 不负责知识优先级
- **背景**：`intent.js` 已产出 `domain / knowledgePolicy / format`。
- **决策**：知识优先级交由 Router（L2/L3），Intent 只管「是否检索 + 输出格式 + 意图域」。
- **理由**：① 职责单一，Intent 不膨胀；② Router 可独立测试、独立回滚；③ 心理学信号（`COGNITIVE_PSYCH_RE`）是 Router 自有的检索后信号，Intent 无此域（避免改 Intent 分类模型）。
- **后果**：Router 必须自行补认知心理信号；这是有意为之，非遗漏。

### ADR-2：Router 不负责分类
- **背景**：可作「Router 内再做一次意图分类」。
- **决策**：Router 只读 `intentInfo.domain` + 问题文本正则，不新建分类器。
- **理由**：复用 `intent.js` 结论（docs/59 原则），避免平行分类器漂移与循环依赖（Router 零依赖 INV-8）。
- **后果**：若未来需要更细分类，应在 Intent 层扩展域枚举（§5.2），而非 Router 内部分类。

### ADR-3：Metadata 必须强约束
- **背景**：早期 `corpus.json` 仅有 `title/section/content/tags`，无 `knowledge_type`。
- **决策**：所有未来对象须满足 19 字段契约；自由字段禁止。
- **理由**：① `knowledge_type` 是路由唯一依据，缺失即失效（§4 Step1 铁律）；② 强约束使治理/审计/回滚可机械化；③ N-4 消融证明「内容交叉引用」无法解决优先级问题，元数据才是正确杠杆。
- **后果**：旧 14 经典 grandfathered 为 `classic`，零改造满足。

### ADR-4：Policy 必须声明式
- **背景**：当前 `routeQuestion` 把优先级编码在三分支 `if`。
- **决策**：标准形态 = Policy Matrix（数据）；代码应查表而非硬编码。
- **理由**：① 新增域只改数据不碰代码（满足「未来扩展零代码改动」）；② 声明式可被测试/审计/可视化；③ 防止 `if domain==="xxx"` 在 Router 内蔓延。
- **后果**：当前为代码形态（等价），**迁移项**为抽 `knowledgePolicyMatrix.js`（docs/62 §13.2），本阶段不执行以守纪律。

### ADR-5：回滚必须 Feature Flag 默认开启
- **背景**：N-4 的 Regression 失败曾冻结扩展闸门。
- **决策**：L1 `KB_ROUTER_ENABLED` 默认开启、可关闭即旧流程；L2 类型可移除恢复 Classic Only。
- **理由**：① 任何新能力上线前必须确认可独立关闭（INV-10）；② 关闭即旧行为一致（INV-1）使止损无需代码回退/重部署。
- **后果**：O-0 已实证 `KB_ROUTER_ENABLED=false` 等价旧流程。

### ADR-6：路由与相似度算法解耦
- **背景**：生产用 TF 余弦（legacy/rankChunks），N-4 验证用真实 embedding 余弦。
- **决策**：`routerAdj` 是大常数偏置，两套算法共用。
- **理由**：① 单一事实来源，杜绝逻辑漂移；② 未来换 embedding 不影响路由；③ 离线沙箱（embedding 世界）与生产（TF 世界）可用同一 `routerAdj` 验证。
- **后果**：路由修复在两条路径均有效（O-0 实证）。

---

## 10. Migration Guide

从「当前代码形态」到「v1.0 完全平台化」的迁移路线（**建议项，非本阶段执行**）。

| 项 | 现状 | 目标 | 动作（不破坏 no-op） |
|---|---|---|---|
| Router 接口 | 5 字段输出 | 7 字段（含 `excludedKnowledgeTypes` / `fallbackStrategy`） | 向后兼容扩展，默认空/兜底 |
| Policy | 三分支 `if` | 声明式 `knowledgePolicyMatrix.js` | 抽数据不改行为（ADR-4） |
| Metadata | 仅 `knowledge_type` 落地 | 19 字段强制 | 新对象强制；旧经典 grandfathered |
| Registry | 代码字面量 | 显式枚举常量 | 引用常量防拼写漂移 |
| Observability | 字段可推导 | 12 字段落日志（docs/62 §9） | 在 `retrieve`/`generateAnswer` 注入 |

**兼容性承诺：** 任何迁移不删已有代码、不改既有检索行为（no-op 由 §8 Gate 守护）；`classic` 永远兜底。

---

## 11. Future Evolution

平台后续演进方向（均不破坏本规范）：

1. **Policy 声明式抽取**（ADR-4 迁移项）：让「新增域零代码改动」从标准变现实。
2. **多类型混合重排**：单个问题可同时偏好 `classic + psychology`（如人生问题含认知维度），`preferredTypes` 支持多值加权。
3. **域词表治理化**：`COGNITIVE_PSYCH_RE` 与域词表纳入 Governance 配置，可热更新不部署。
4. **真实 embedding 接入生产**：当前生产走 TF 余弦；未来接 DashScope 真实向量时，`routerAdj` 无需改动（ADR-6）。
5. **KQS 全维度可测**：Usage / Feedback 维度补齐后，质量分从 75% 覆盖到 100%。

---

## 12. Final Recommendation

### 12.1 工程化证明矩阵
| 验收项 | 是否已工程化 | 证据 |
|---|---|---|
| Platform Layers 定义 | ✅ | §2 十层五元组 |
| Knowledge Lifecycle | ✅ | §3 八阶段 + 铁律 |
| Developer Guide | ✅ | §4 七步 runbook |
| Extension Contract | ✅ | §5 五类扩展契约 |
| Platform Invariants | ✅ | §6 十条 INV（门禁守护） |
| Compatibility Matrix | ✅ | §7 九域兼容表 |
| Release Certification | ✅ | §8 C1–C8 |
| ADR | ✅ | §9 六条决策记录 |

### 12.2 结论
**Knowledge Platform 不仅具备 Architecture Standard（docs/62），且已具备 Engineering Specification（docs/63）。** 任何未来开发者 / AI Agent / 知识扩展，无需重读项目历史，仅凭本规范 §4 Developer Guide + §5 Extension Contract + §8 Certification 即可正确、合格地接入平台；任何扩展**不修改 Router / Prompt / Intent**，只新增 Metadata + Policy 行 + Knowledge Object。

### 12.3 纪律声明
- ✅ 零代码改动（`corpus.json` / `intent.js` / `rag.js` / `knowledgeRouter.js` 均未被本阶段修改；其既有 `M` / `??` 状态来自更早阶段，非本次引入）。
- ✅ 零知识新增、零 ingest、零 embedding、零生产影响、零 commit、零发布。
- ⛔ **本阶段完成后停止，等待人工 Review，不进入 Phase O-1。**

---

*文档生成：Phase O-0.5 · 只读分析 → 抽象 → 固化 → 文档。所有条款锚定 `cloudfunctions/chat/{knowledgeRouter,intent,rag}.js`、`tests/pilot-n5/o0-readiness.js` 真实实现，以及上游标准 `docs/62-Knowledge-Platform-v1.0-Standard.md`。*
