# Phase P+ 审计报告（Read-only Audit）

## 向晚问思（WenDao）· Knowledge Platform v1.0.1 Hardening — 第一阶段：只读审计

> **阶段定位**：Phase P+（Knowledge Platform v1.0.1 Hardening）· 第一阶段：只读审计
> **角色**：Chief AI Architect + Knowledge Platform Engineer + RAG Platform Engineer
> **性质**：**纯只读审计** —— 本文件生成过程中未修改任何代码 / 资产 / 文档。所有结论基于文件读取与哈希校验。
> **目标**：盘点 v1.0 冻结资产现状、Phase P 设计与代码的差距、可安全落地范围、风险，并确认冻结资产指纹一致。

---

## 1. 当前 v1.0 资产状态

### 1.1 已冻结能力（GA，docs/64 v1.0.0）

| 能力 | 代码/数据实体 | 状态 |
|---|---|---|
| Knowledge Router | `cloudfunctions/chat/knowledgeRouter.js` | ✅ Frozen |
| Intent 分类 | `cloudfunctions/chat/intent.js` | ✅ Frozen |
| RAG 核心 | `cloudfunctions/chat/rag.js` | ✅ Frozen |
| 知识语料 | `cloudfunctions/chat/corpus.json`（14 经典，grandfathered `classic`） | ✅ Frozen |
| Metadata Contract | `docs/62 §4` 19 字段 | ✅ Frozen（标准） |
| Knowledge Registry 标准 | `docs/62 §5` 15 类型 | ✅ Frozen（标准） |
| Release Gate C1–C8 | `tests/pilot-n5/o0-readiness.js` | ✅ Frozen（脚本） |
| Regression System | 100/50/20 三套基线 | ✅ Frozen（数据+脚本） |
| Observability 字段设计 | `docs/62 §9` 12 字段 | ✅ 已设计（**未落库**） |
| Rollback 机制 | `KB_ROUTER_ENABLED` 开关 | ✅ Frozen |
| 首个知识对象认证 | KO-P-04（`tests/pilot-o1/o1-registry.json`） | ✅ Certified Production Candidate |

### 1.2 云函数入口现状（`cloudfunctions/chat/index.js`，**非冻结**）

`index.js` 已实现两条异步日志链路（fire-and-forget，失败不影响主流程）：
- `logChat` → 写 `logs` 集合（openid/message/answer/mode/titles/safeIn/safeOut）。
- `logQuestion` → 写 `question_logs` 集合，已捕获：openid / question / mode / intent / questionType / questionDomain / answerFormat / needKnowledge / knowledgePolicy / emotion / theme / strategy / category / matchedTitles / books / matchedTags / routeThemes / followUp / answerId / conversationId。

> **关键发现**：`question_logs` 已具备「query / answer_id / conversation_id / retrieval result（matchedTitles）/ route 信号（routeThemes）」的采集能力。Phase P+ Observability 只需**补齐缺失维度**（knowledge_type / fallback_reason / citation_count / latency）并独立落一个面向 Knowledge Platform 的观测集合，不重复造轮子。

### 1.3 冻结资产指纹（本次审计基准）

| 文件 | SHA256（前 64 位） | 与 O-0.6 冻结态 |
|---|---|---|
| `cloudfunctions/chat/corpus.json` | `db01fbc92064cbea3a6688a98160b6a70c9e150259b54063c8e2e96974eabc8b` | ✅ 一致 |
| `cloudfunctions/chat/intent.js` | `765ad138ec68c0f159c6f75a60e5268beb02fba152f6d53dbdc539ba1560ca38` | ✅ 一致 |
| `cloudfunctions/chat/rag.js` | `5b380b3f7c68f374e3d4e5127bd7dbeff747849401ca9d0488498dece1408286` | ✅ 一致 |
| `cloudfunctions/chat/knowledgeRouter.js` | `848908445dbb5ea93a6f52775dc3c8e6922ff971d6cee115547f236ffed0a935` | ✅ 一致 |

→ **四项冻结资产指纹与 O-0.6 / Phase P 冻结态逐字节一致。本阶段所有后续改动不得改变此四项哈希。**

---

## 2. Phase P 设计与代码现状差距

| Phase P 设计项（docs/66） | 代码现状 | 差距 |
|---|---|---|
| Registry 标准（15 类型） | 仅 `docs/62 §5` 标准 + `o1-registry.json` 文件 | ❌ 无**可替换的 Registry 抽象层**（当前直接读 JSON 文件） |
| Observability 12 字段 | 字段设计于 `docs/62 §9`；`question_logs` 已落部分字段 | ❌ 未形成**独立、面向 Knowledge Router 的观测落库**；缺 knowledge_type / fallback_reason / latency |
| Dashboard | 仅概念（docs/66 §2） | ❌ 无实现 |
| Health Score 七维模型 | 仅公式（docs/66 §4） | ❌ 无实现 |
| Maintenance SOP / Monitoring / Alert / Capacity | 仅设计 | 🔧 超出 Phase P+ 范围（留给 Phase R / 后续） |

**结论**：Phase P 完成了「设计」，Phase P+ 的任务是把其中**最小运营闭环**（Registry 抽象 + Observability 落库 + Dashboard MVP + Health Score MVP）从设计变为代码，且**不触碰任何冻结资产**。

---

## 3. 可安全落地范围（Phase P+ 六阶段）

| 阶段 | 交付 | 是否触碰冻结资产 |
|---|---|---|
| ② Registry Provider 抽象 | 新增 `registry/registryProvider.js` + `registry/jsonRegistryProvider.js` | ❌ 全为**新增文件**；旧 JSON 读取结果 100% 一致 |
| ③ Observability 落库 | 新增 `observability/observabilityLogger.js` + `jsonObservabilityStore.js`；**调用** `knowledgeRouter.routeQuestion`（只读，非改）；`index.js` 增加 fire-and-forget 调用（index.js 非冻结） | ❌ 不修改 router/rag/intent/corpus |
| ④ Dashboard MVP | 新增 `dashboard/dashboard.js`（只读聚合 Registry/Observability/Regression 产物） | ❌ 不重算检索逻辑 |
| ⑤ Health Score MVP | 新增 `knowledgeHealthScore.js`（实现 docs/66 §4 公式，缺失维显示 N/A） | ❌ 纯计算，无资产依赖 |
| ⑥ 测试 | 新增 `tests/phase-p-plus/`；含**冻结资产哈希保护测试** | ❌ 只读校验 |
| ⑦ 文档 | 新增 `docs/67/68/69` | ❌ 纯新增 |

**明确禁止边界**（本阶段不做的）：
- ❌ 新增 Knowledge Object / ingest / embedding / 扩充 corpus
- ❌ 修改 Router / Prompt / Intent / RAG 核心 / Metadata Contract / Release Gate / Regression 标准 / 架构重构
- ❌ 修改四项冻结资产（corpus/intent/rag/knowledgeRouter）

---

## 4. 风险分析

| 风险 | 等级 | 缓解措施 |
|---|---|---|
| 修改 `index.js` 引入回归 | 低 | 仅**追加**一个 fire-and-forget 调用（`logObservation(...).catch(()=>{})`），不改动既有 `logChat`/`logQuestion`；包在 try/catch，失败不阻断回答 |
| Observability 依赖 `knowledgeRouter` | 低 | 仅 `require` + **调用纯函数** `routeQuestion`（读取意图与问题，非修改）；该模块已 Frozen，调用行为稳定 |
| 落库失败影响主流程 | 低 | Logger 全程 try/catch + 异步非阻塞；存储层（JSON/Cloud）写入失败仅 console.error，绝不抛到主链路 |
| 云环境存储依赖 | 中 | 默认 `jsonObservabilityStore`（本地文件，零依赖、可测）；Cloud 存储（写 `observability_logs` 集合）作为**可选**实现，仅在云端 env 显式开启时加载，不强制 |
| 测试需要既有产物 | 低 | 依赖 `o1-registry.json` / `regression-report.json` / `o0-readiness-report.json` / `corpus.json` 均已在仓库；测试用相对路径加载 |
| 冻结资产被意外改动 | 低 | Phase ⑥ 哈希保护测试断言四项 SHA256 等于本审计基准；CI/手动运行即拦截 |

---

## 5. 修改文件清单

### 5.1 新增文件（全部为新增，无覆盖）

**运行时代码（`cloudfunctions/chat/`）**
- `registry/registryProvider.js` —— Registry 抽象接口 + 工厂
- `registry/jsonRegistryProvider.js` —— JSON 文件实现（读取 `o1-registry.json` + corpus 经典，100% 兼容）
- `observability/observabilityLogger.js` —— 观测记录构建 + 异步落库（非阻塞、失败安全）
- `observability/jsonObservabilityStore.js` —— JSON 文件存储（默认，可测）
- `observability/cloudObservabilityStore.js` —— Cloud DB 存储（可选，云端开启）
- `dashboard/dashboard.js` —— 只读指标聚合（Registry/Observability/Regression）
- `dashboard/printDashboard.js` —— CLI 打印（演示用）
- `knowledgeHealthScore.js` —— 七维健康分（缺失维 N/A）

**测试**
- `tests/phase-p-plus/test.js` —— 五项测试（Registry / Observability / Dashboard / HealthScore / 冻结哈希）
- `tests/phase-p-plus/observability-store.json` —— 观测存储示例（运行时生成）

**文档**
- `docs/67-PhaseP+审计报告.md`（本文件）
- `docs/68-Observability落库设计.md`
- `docs/69-PhaseP+实现报告.md`

### 5.2 修改文件（非冻结，安全）

- `cloudfunctions/chat/index.js` —— **仅追加** `logObservation` 调用（fire-and-forget）。该文件**不在冻结清单**，且改动为纯增量 instrumentation，不触碰 RAG 核心逻辑、不重构架构。

### 5.3 不触碰文件（冻结，哈希不变）

- `cloudfunctions/chat/corpus.json`
- `cloudfunctions/chat/intent.js`
- `cloudfunctions/chat/rag.js`
- `cloudfunctions/chat/knowledgeRouter.js`
- 以及：Metadata Contract / Release Gate / Regression 标准 / Prompt / 已认证对象 KO-P-04

---

## 6. 审计结论

✅ v1.0 冻结资产完整、指纹一致，可作为 Phase P+ 的不可变基线。
✅ Phase P 已设计但未落地的「最小运营闭环」可在**不触碰任何冻结资产**的前提下安全实现：
- Registry 抽象层（不升级数据库，仅加抽象）；
- Observability 真实落库（复用 `knowledgeRouter.routeQuestion` 只读调用 + 独立观测集合）；
- Dashboard / Health Score 只读 MVP。
⚠️ 唯一允许的「修改」是 `index.js` 的增量 instrumentation（非冻结文件），已通过 fire-and-forget + try/catch 将风险降至最低。
🛑 本阶段不新增知识、不 ingest、不 embedding、不 commit；完成后停止，等待人工 Review。

---

> *文档生成：Phase P+ 第一阶段（只读审计）。生成过程零资产改动；所有哈希于本阶段开始时采集，作为后续阶段的保护基准。*
