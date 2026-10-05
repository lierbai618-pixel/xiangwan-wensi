# docs/64 — Knowledge Platform v1.0 Architecture Freeze (GA)

> **阶段定位**：Phase O-0.6 — Architecture Freeze
> **角色**：Chief AI Architect + Software Architect + Knowledge Platform Architect + Knowledge Governance Architect + RAG Architect + AI Search Architect + Engineering Governance Architect
> **性质**：冻结声明（Freeze Declaration）。本阶段**零代码改动、零知识新增、零测试数据修改、零 commit、零发布**。
> **前置条件**：Phase K / K+ / L / M / N / N-1 / N-2 / N-3 / N-4 / N-5 / N-5.1 / O / O-0.5 全部完成。Knowledge Platform 已具备 Architecture / Engineering / Standard / Engineering Specification 四层资产。
> **上线规则**：本文件签署后，Knowledge Platform v1.0 即为**唯一长期架构基线（GA Baseline）**。任何未来 Phase（O-1 / P / Q …）必须基于此基线，不得重新设计架构。

---

## 1. Executive Summary

向晚问思（WenDao）自 Phase K–N 完成知识扩展体系设计与验证，经 Phase N-4 真实受控 Pilot 暴露「扁平全局向量检索缺域路由」根因，由 Phase N-5 / N-5.1 实现并验证 **Knowledge Router**（Classic Hit@3 `0.74 → 0.82`、Concept Intrusion `0.26 → 0`、Benchmark Hit@3 `1.0`），再经 Phase O 平台标准化、O-0.5 工程规范固化，现已具备完整平台能力。

本阶段将以下资产**正式冻结为 v1.0 GA**：

| 资产类别 | 载体 | 状态 |
|---|---|---|
| Architecture | 检索调用链（Intent → Router → Retrieval → Rerank → Citation → Generation） | **Frozen** |
| Engineering | 接口实现（knowledgeRouter.js / rag.js 接入点 / intent.js） | **Frozen** |
| Standard | docs/62 Knowledge Platform v1.0 Standard | **Frozen** |
| Engineering Spec | docs/63 Engineering Specification | **Frozen** |
| Validation | Phase H 100 + Phase N 50 + Benchmark 20 三套回归基线 | **Frozen** |

**冻结核心结论**：未来任何知识扩展，**只允许新增 Knowledge Object + Metadata + Policy 行**；**禁止重新设计 Router / Metadata Contract / Release Gate / Regression**。

---

## 2. Architecture Freeze Scope

下列每一项均声明为 Frozen。格式：`Frozen` 内容 / `Reason` 冻结理由 / `Future Change Rule` 未来变更规则。

### 2.1 Knowledge Router（knowledgeRouter.js）
- **Frozen**：`routeQuestion({ intentInfo, domain, question })` 的返回结构 `{ priorityDomains, knowledgePriority, preferredTypes, rerankWeights, reason }`；`routerAdj(docType, route)` 的偏置计算逻辑；`ROUTER_ENABLED` 开关语义；`COGNITIVE_PSYCH_RE` 域信号正则；`isClassicPriorityDomain` 域判定表。
- **Reason**：已在 O-0 用 100 题 no-op + 50 题回归 + 20 基准 + 4 挤出题实测验证，全部通过；路由逻辑与底层相似度算法解耦（TF 余弦 / 真实 embedding 同源适用）。
- **Future Change Rule**：**禁止**修改函数签名与返回结构。新增知识域优先级**仅允许**在 `knowledgePriority` 映射表里追加键值（Minor），**禁止**改动三分支控制流（属 Breaking，需 ADR + v2.0.0）。

### 2.2 Metadata Contract（docs/62 §4）
- **Frozen**：19 字段定义（`knowledge_id, knowledge_type, domain, subcategory, authority, evidence_level, citation_type, source_type, version, status, priority, quality_score, copyright, created_at, updated_at, review_status, reviewer, embedding_version, retrieval_policy`）、字段约束、默认值、兼容策略、升级策略。
- **Reason**：已落地 `knowledge_type` 贯穿 `shapeFromChunk` + `routerAdj`，grandfathered 经典默认 `classic` 零改造满足契约。
- **Future Change Rule**：**新增可选字段** = Minor（v1.0.x）；**删除 / 重命名 / 改类型 / 改必填约束** = Breaking（v2.0.0）。

### 2.3 Knowledge Type Registry（docs/62 §5）
- **Frozen**：15 初始类型 `classic, psychology, management, history, law, science, literature, ai, programming, case, concept, framework, faq, paper, manual`。
- **Reason**：`routerAdj` 对未知类型中性安全（返回 0），已验证扩展性。
- **Future Change Rule**：**新增类型** = 兼容（v1.1.0，仅需 Registry 表追加 + 在 Policy 中声明优先级）；**禁止**任何代码写裸字符串类型（必须注册）。

### 2.4 Knowledge Policy（docs/62 §6）
- **Frozen**：`routeQuestion` 三分支 = 声明式 Policy Matrix（classic-priority-domain / cognitive-psychology-signal / fallback-classic）。
- **Reason**：等价 Policy Matrix，逻辑可审计、可测试。
- **Future Change Rule**：当前 Policy 内嵌于 `routeQuestion` 函数体（**已知技术债**，见 §10）。**新增域零代码改动**需先完成 §10 Migration（抽成 `knowledgePolicyMatrix.js` 声明式数据）后方可实现；在此之前，扩展域优先级**仅允许**修改 `knowledgePriority` 映射（Minor）。

### 2.5 Release Gate（o0-readiness.js）
- **Frozen**：10 阶段门禁（Admission → Metadata Validation → Chunk Validation → Embedding Validation → Retrieval Benchmark → Regression → Citation Audit → Intrusion Check → Release Readiness → Go/No-Go）。
- **Reason**：O-0 实测 GO/NO-GO = true，覆盖 100 + 50 + 20 题。
- **Future Change Rule**：**禁止**删减门禁阶段。新增校验维度 = Minor（追加阶段，不影响既有流程）。

### 2.6 Regression Platform（docs/62 §8）
- **Frozen**：三套基线数据（Phase H 100 题 / Phase N 50 题 / Benchmark 20 题）及其指标体系（Classic Hit@3 / Benchmark Hit@3 / Citation / Intrusion）。
- **Reason**：已固化验收门槛（Classic ≥ 0.82 / Intrusion = 0 / Benchmark ≥ 0.95）。
- **Future Change Rule**：**禁止**绕过或删减任何回归项。新增 Baseline 集 = Minor（追加，不替代既有）。

### 2.7 Observability（docs/62 §9）
- **Frozen**：12 监控字段（`knowledge_type, domain, intent, retrieval_mode, router_enabled, router_adjustment, rerank_score, citation_source, chunk_id, vector_score, policy_name, fallback_reason`）。
- **Reason**：字段均映射到现有代码变量，可采集、可审计。
- **Future Change Rule**：**新增字段** = Minor；**禁止**删除既有字段（Breaking）。

### 2.8 Rollback（docs/62 §10）
- **Frozen**：`KB_ROUTER_ENABLED=false` 一键回滚语义（等价 N-5.1 之前旧检索流程）；`routerAdj` 恒 0。
- **Reason**：O-0 已验证关闭后 `legacyRetrieve` no-op mismatch = 0，逐字节恢复旧行为。
- **Future Change Rule**：**禁止**移除回滚开关。新增 Feature Flag 必须支持相同关闭语义。

### 2.9 Developer Guide & Engineering Specification（docs/63）
- **Frozen**：《新增 Knowledge Object》七步 runbook（Metadata → Registry → Chunk → Embedding → Regression → Gate → Production）；Extension Contract；Platform Invariants；Compatibility Matrix；Certification Checklist（C1–C8）；6 条 ADR。
- **Reason**：已具备「任何未来开发者 / AI 无需理解项目历史即可接入」的可执行规范。
- **Future Change Rule**：文档随 Minor 版本补充，不影响代码契约。

---

## 3. Stable API

平台对外的稳定接口契约。每个接口声明 `Input / Output / Compatibility / Breaking Rule`。

### 3.1 Router Interface
- **Input**：`routeQuestion({ intentInfo, domain, question })`
  - `intentInfo`：`intent.js.classifyIntent` 返回（含 `domain, knowledgePolicy`）
  - `domain`：`string`（可选，缺省取自 intentInfo.domain）
  - `question`：`string`
- **Output**：`{ priorityDomains, knowledgePriority, preferredTypes, rerankWeights, reason }`
- **Compatibility**：输出结构追加键 = Minor；函数签名不变。
- **Breaking Rule**：修改返回结构键名 / 修改 `routerAdj` 计算语义 = Breaking（v2.0.0）。

### 3.2 Metadata Interface
- **Input**：Knowledge Object 文档（须含 `knowledge_type`；缺失默认 `classic`）。
- **Output**：`shapeFromChunk` 透传 `knowledge_type` 至 citation 对象。
- **Compatibility**：新增可选字段 = Minor。
- **Breaking Rule**：修改 `knowledge_type` 必填约束 / 删除字段 = Breaking（v2.0.0）。

### 3.3 Policy Interface
- **Input**：`routeQuestion` 内部 `knowledgePriority` 映射。
- **Output**：偏置量（经 `routerAdj` 加进 base score）。
- **Compatibility**：追加 `knowledgePriority` 键值 = Minor（v1.1.0）。
- **Breaking Rule**：修改三分支控制流 / 改 `rerankWeights` 结构 = Breaking（v2.0.0）。

### 3.4 Registry Interface
- **Input**：`knowledge_type` 字符串（须注册于 15 类型表）。
- **Output**：`routerAdj` 对未知类型返回 0（Neutral 安全）。
- **Compatibility**：新增类型 = 兼容（v1.1.0）。
- **Breaking Rule**：重命名 / 删除已注册类型 = Breaking（v2.0.0）。

### 3.5 Release Gate Interface
- **Input**：候选 Knowledge Object + 三套回归基线。
- **Output**：`{ acceptance: {...}, goNoGo: boolean, report }`。
- **Compatibility**：追加门禁阶段 = Minor。
- **Breaking Rule**：删减既有门禁阶段 = Breaking（v2.0.0）。

### 3.6 Regression Interface
- **Input**：候选池 + 问题集（100 / 50 / 20）。
- **Output**：`{ classicHit3, benchmarkHit3, intrusion, displaced }`。
- **Compatibility**：追加 Baseline 集 = Minor。
- **Breaking Rule**：修改既有指标定义（如 Classic Hit@3 口径）= Breaking（v2.0.0）。

### 3.7 Observability Interface
- **Input**：每次检索事件的字段采集。
- **Output**：12 字段监控记录。
- **Compatibility**：新增字段 = Minor。
- **Breaking Rule**：删除既有字段 = Breaking（v2.0.0）。

### 3.8 Rollback Interface
- **Input**：`process.env.KB_ROUTER_ENABLED = "false"`。
- **Output**：`routerAdj` 恒 0，检索逐字节恢复旧流程。
- **Compatibility**：新增开关须保留此关闭语义。
- **Breaking Rule**：移除回滚开关 = Breaking（v2.0.0）。

---

## 4. Compatibility Policy

向后兼容原则（Backward Compatibility Policy）：

| 变更类型 | 分类 | 版本影响 | 说明 |
|---|---|---|---|
| 新增 `knowledge_type` | **Compatible** | v1.1.0 | Registry 表追加 + Policy 声明优先级 |
| 新增 Policy（域优先级） | **Compatible** | v1.1.0 | 追加 `knowledgePriority` 键值 |
| 新增 Metadata 字段（可选） | **Minor** | v1.0.x | 不破坏既有对象解析 |
| 修改文档 / 补充 Guide | **Minor** | v1.0.x | 不影响代码契约 |
| 新增回归 Baseline 集 | **Minor** | v1.0.x | 不替代既有基线 |
| **删除 Metadata 字段** | **Breaking** | v2.0.0 | 需 ADR + Major |
| **修改 Router Interface 签名/结构** | **Breaking** | v2.0.0 | 需 ADR + Major |
| **修改 Metadata Contract 约束** | **Breaking** | v2.0.0 | 需 ADR + Major |
| **修改 Release Gate 阶段** | **Breaking** | v2.0.0 | 需 ADR + Major |
| **修改 Regression 指标定义** | **Breaking** | v2.0.0 | 需 ADR + Major |
| **删除 Rollback 开关** | **Breaking** | v2.0.0 | 需 ADR + Major |

**铁律**：任何 Breaking 变更**必须**伴随 ADR 记录 + Major 版本号提升 + 全量回归复跑，否则视为非法变更。

---

## 5. Semantic Version

Knowledge Platform Version Policy：

| 版本 | 含义 | 允许变更 |
|---|---|---|
| **v1.0.0** | **Architecture Freeze（本阶段）** | 冻结基线确立，首次 GA |
| **v1.0.x** | Documentation / Bug Fix | 文档补丁、非接口缺陷修复、新增可选 Metadata 字段、新增回归集 |
| **v1.1.0** | 扩展兼容（Minor） | 新增 `knowledge_type`、新增 Policy 域优先级、新增 Registry 条目 |
| **v2.0.0** | Breaking Change | 修改 Router Interface / Metadata Contract / Release Gate / Regression 定义 / 删除 Rollback |

**版本锚点**：
- 当前冻结版本 = **v1.0.0**
- 代码 artifact 标识：`knowledgeRouter.js`（含 `ROUTER_ENABLED`）+ `rag.js`（检索接入点）+ `intent.js`（分类，未改）
- 文档资产版本：`docs/62`（Standard v1.0）+ `docs/63`（Engineering Spec v1.0）+ `docs/64`（Freeze v1.0.0）

---

## 6. Architecture Decision Freeze

下列 ADR 正式冻结，未来**禁止重复讨论**其反向结论：

| ADR | 决策 | 冻结理由 |
|---|---|---|
| **ADR-1** | **Intent 不负责知识优先级** | `intent.js` 只管「是否检索 + 输出格式」；优先级是 Router 职责。避免分类器膨胀。 |
| **ADR-2** | **Router 不负责 Intent 分类** | Router 复用 `intent.js.domain`，不新建平行分类器，避免双分类器错位（N-5 分析 G2）。 |
| **ADR-3** | **Metadata 必须强约束** | `knowledge_type` 是路由唯一依据（O-0 反复强调）；自由字段会导致偏置失效、监控盲区。 |
| **ADR-4** | **Policy 必须声明式**（目标态） | 当前 Policy 内嵌于 `routeQuestion` 函数体，迁移目标是抽成 `knowledgePolicyMatrix.js` 数据驱动，实现「新增域零代码改动」。 |
| **ADR-5** | **Classic 默认 `knowledge_type`** | 生产 14 条经典缺失该字段，一律视为 `classic`，零改造满足契约（grandfathering）。 |
| **ADR-6** | **Unknown Type = Neutral** | `routerAdj` 对未知类型返回 0，确保新类型未配置 Policy 时不影响既有排序，安全降级。 |
| **ADR-7** | **Router Disabled = 旧行为一致** | `ROUTER_ENABLED=false` ⇒ `routerAdj` 恒 0，O-0 实测 `legacyRetrieve` no-op mismatch = 0。 |
| **ADR-8** | **Intrusion 锁死 0** | Concept Intrusion 验收门槛 = 0（`docs/60` / `docs/61` 实测达成），任何扩展不得使该值回升。 |

---

## 7. Platform Capability Matrix

| 能力 | Implemented | Frozen | Extensible |
|---|:---:|:---:|:---:|
| Architecture（调用链） | ✅ | ✅ | ❌（禁重设计） |
| Engineering（接口实现） | ✅ | ✅ | ❌（禁改签名） |
| Knowledge Router | ✅ | ✅ | ⚠️ 仅映射表 Minor |
| Metadata Contract | ✅ | ✅ | ⚠️ 仅加字段 Minor |
| Knowledge Policy | ✅ | ✅ | ⚠️ 仅加键值 Minor |
| Type Registry | ✅ | ✅ | ✅ 加类型 v1.1.0 |
| Retrieval（TF/embedding） | ✅ | ✅ | ❌（禁改算法接口） |
| Evaluation（Regression） | ✅ | ✅ | ⚠️ 仅加 Baseline Minor |
| Governance（Lifecycle/ADR） | ✅ | ✅ | ⚠️ 仅加阶段 Minor |
| Release Gate | ✅ | ✅ | ⚠️ 仅加阶段 Minor |
| Certification（C1–C8） | ✅ | ✅ | ⚠️ 仅加项 Minor |
| Rollback（Feature Flag） | ✅ | ✅ | ❌（禁移除开关） |
| Observability | ✅ | ✅ | ⚠️ 仅加字段 Minor |

> ✅ = 已具备 / 已冻结；⚠️ = 冻结但允许受控 Minor 扩展；❌ = 冻结且禁止变更（须 Major）。

---

## 8. Extension Boundary

明确未来修改边界：

### 允许修改（Extensible）
- **Metadata**：新增可选字段（Minor v1.0.x）、填充既有字段值。
- **Policy**：在 `knowledgePriority` 映射表追加键值（Minor v1.1.0）。
- **Knowledge Object**：新增候选知识文档（须带 `knowledge_type`、过 Release Gate）。
- **Citation**：新增 `citation_type` 取值（须注册于 Metadata Contract）。
- **Registry**：新增 `knowledge_type`（v1.1.0）。

### 禁止修改（Frozen / Breaking）
- **Router**：函数签名、返回结构、`routerAdj` 语义、`COGNITIVE_PSYCH_RE`、`isClassicPriorityDomain`。
- **Prompt**：五段式输出契约（`outputContract`）。
- **Intent**：`classifyIntent` 分类模型与 `knowledgePolicy` 产出。
- **Release Gate**：既有 10 阶段门禁。
- **Regression**：既有指标定义与三套基线。
- **Metadata Contract**：字段约束、必填项、删除字段。

### 强制升级路径（若必须修改禁止项）
**ADR 记录 + Major 版本（v2.0.0）+ 全量回归复跑（100 + 50 + 20 题）+ 重新签署 Freeze**。三条件缺一不可，否则变更非法。

---

## 9. Release Declaration

### Knowledge Platform v1.0 GA — 正式声明

**Scope（范围）**
- 检索架构：Intent → Knowledge Router → Vector Retrieval → Rerank → Citation Planner → Generation。
- 知识治理：Metadata Contract（19 字段）+ Type Registry（15 类型）+ Policy Matrix + Lifecycle（8 阶段）。
- 质量保障：Release Gate（10 阶段）+ Regression Platform（100/50/20）+ Certification（C1–C8）。
- 可观测与回滚：Observability（12 字段）+ `KB_ROUTER_ENABLED` 一键回滚。

**Capability（能力）**
- 经典优先 / 心理学优先双模式路由，与底层相似度算法解耦。
- Classic Hit@3 ≥ 0.82、Concept Intrusion = 0、Benchmark Hit@3 ≥ 0.95（O-0 实测）。
- 100 题生产检索 no-op（路由对无 P-04 场景逐字节不变）。

**Limitation（限制）**
- Policy 当前内嵌于 `routeQuestion` 函数体（技术债），扩展域优先级需先完成 §10 Migration 方可「零代码改动」。
- 生产实际检索路径为 TF 余弦（`KB_MODE=legacy`），真实 embedding 仅存在于隔离验证产物；路由对两条路径均适用。
- `intent.js` 无认知心理 / 管理 / 法律域，相关信号由 Router 自持正则补充（职责分离，非缺陷）。

**Future Roadmap（路线图）**
- **v1.1.0**：Policy 声明式抽取（Migration）、新增域（管理 / AI / 法律 / 医学 / 科学 / 历史 / 文学）逐域接入。
- **v1.0.x**：文档补丁、Bug Fix、新增可选 Metadata 字段、新增回归集。
- **v2.0.0**：仅当确需 Breaking 变更时，经 ADR + Major + 全量回归后启动。

**Support Boundary（支持边界）**
- 任何基于 v1.0 的新知识扩展，**默认受本 Freeze 保护**：只需 Metadata + Policy + Knowledge Object，无需架构评审。
- 任何试图修改禁止项（Router / Prompt / Intent / Gate / Regression / Contract）的 PR，**自动拒绝**，除非携带 v2.0.0 ADR 与全量回归报告。

---

## 10. Future Version Strategy

### 10.1 v1.1.0 推荐路径（Policy 声明式迁移）
当前 Policy 内嵌于 `routeQuestion` 三分支（已知技术债，ADR-4）。建议 v1.1.0 完成以下**非 Breaking** 迁移：
1. 抽取 `knowledgePolicyMatrix.js`：以数据表描述「domain → priority 序列」。
2. `routeQuestion` 改为查表，旧三分支逻辑等价保留为默认行。
3. 迁移后，新增域**仅编辑数据表**（零代码改动），彻底实现 docs/62 §6 的「新增域不修改 Router」。

### 10.2 扩展域接入示例（兼容 v1.1.0）
| 新域 | 操作 | 是否改 Router 代码 |
|---|---|---|
| 管理（management） | Registry 加类型 + Policy 表加 `management` 优先级行 | ❌ 否 |
| 法律（law） | 同上 | ❌ 否 |
| AI（ai） | 同上 | ❌ 否 |
| 医学（science/medical） | 同上 | ❌ 否 |

> 九域兼容矩阵详见 docs/63 §7：所有领域仅需「✏️ 改 Policy 数据」，🚫 禁改 Router / Prompt / Intent。

### 10.3 Major 触发条件
仅当以下情形**确属必要**时启动 v2.0.0：
- Router Interface 必须破坏性调整（如多向量融合）。
- Metadata Contract 必须破坏性调整（如字段语义重构）。
- Release Gate 必须删减 / 重构。
任一情形须：ADR 新立 → Major 提升 → 全量回归（100 + 50 + 20）→ 重新签署 Freeze（docs/64 v2.0.0）。

---

## 11. Final Recommendation

### 验收标准达成证明

| 验收项 | 证明 | 状态 |
|---|---|---|
| 平台已正式冻结 | 本文件 §2 声明 9 项 Frozen + §5 版本锚定 v1.0.0 | ✅ |
| 未来不得重新设计架构 | §8 Extension Boundary 明确禁止修改 Router/Retrieval/Gate | ✅ |
| 未来不得重新设计 Router | §3.1 / §8 冻结 `routeQuestion`/`routerAdj` 签名与语义 | ✅ |
| 未来不得重新设计 Metadata | §3.2 / §8 冻结 Contract 约束 | ✅ |
| 未来不得重新设计 Release Gate | §3.5 / §8 冻结 10 阶段门禁 | ✅ |
| 只允许新增 Knowledge Object / Metadata / Policy | §8 Extensible 三项 + §4 Compatibility（Compatible / Minor） | ✅ |

### 结论

**Knowledge Platform v1.0 正式 GA，作为向晚问思唯一长期架构基线。**

向晚问思已从「拥有 RAG 的知识问答小程序」升级为「拥有 Knowledge Router + Metadata Contract + Knowledge Policy + Release Gate + Regression + Observability + Governance 的 Knowledge Platform v1.0」。

任何未来 Phase O-1 / P / Q 的知识扩展，**全部复用本平台能力**，不得另起标准、不得重设计架构。

---

> **执行纪律确认**：本阶段**零代码改动、零知识新增、零测试数据修改、零 commit、零发布**。生产资产（`corpus.json` / `intent.js` / `rag.js` / `knowledgeRouter.js`）SHA256 与 N-5 基线逐字节一致（其 `M`/`??` 状态为历史阶段遗留，非本阶段引入）。本文件为**冻结声明**，完成后系统停止，等待人工 Review，**不进入 Phase O-1**。
>
> 关联文档：`docs/59`（N-5 设计）、`docs/60`（N-5.1 实现）、`docs/61`（O-0 放行）、`docs/62`（Platform Standard）、`docs/63`（Engineering Spec）、`docs/64`（本文件，Freeze v1.0.0）。
