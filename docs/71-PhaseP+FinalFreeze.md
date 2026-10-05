# docs/71 · Phase P+ Final Freeze + Observation Plan

| 项 | 内容 |
|----|------|
| 文档 ID | `docs/71-PhaseP+FinalFreeze.md` |
| 版本 | v1.0.0（Freeze 基线，等价于 Knowledge Platform v1.0 GA + Operations v1.0） |
| 日期 | 2026-08-02 |
| 作者角色 | 首席 AI 架构师 + Knowledge Platform Architect + Release Manager |
| 状态 | **FROZEN · 等待人工 Review** |
| 关联基线 | O-0.6（Architecture Freeze GA）、docs/64（Freeze 范围）、docs/62（Platform 标准） |
| 本任务性质 | **文档封存**（非开发）；全程零代码改动、零 ingest、零 embedding、零 commit、零发布 |

---

## 1. Phase P+ 总结

Phase P+ 是 Knowledge Platform v1.0 从「设计」走向「生产可观测」的收口阶段。它**没有新增任何知识资产、没有修改任何冻结核心**，而是把 v1.0 已经具备但停留在设计态的运营能力，**实现、部署、并用真实流量验证**。

### 1.1 从 Design 到 Production Observation 的完整链路

| 阶段 | 产物 | 状态 |
|------|------|------|
| Knowledge Platform Design（docs/40–62） | Router / Metadata Contract / Release Gate / Regression / Observability 契约（docs/62 §9） | 设计完成 |
| Phase O | Knowledge Object 认证体系 + 首个真实 KO-P-04 认证 | 完成 |
| Phase P | Knowledge Platform Operations 设计（12 章，docs/66） | 设计完成 |
| **Phase P+** | 把 P 的设计落地为可运行、可观测、已用真实流量验证的运营闭环 | **本次冻结** |

### 1.2 完成的四件事（设计 → 实现 → 部署 → 验证）

1. **设计（继承 Phase P / docs/62）**
   运营能力接口已在 docs/62 §9（Observability 12 字段契约）、§8（Release Gate C1–C8）、§7（Regression 三套基准）中定义。

2. **实现（Phase P+ 七阶段）**
   - Registry Provider 抽象（可替换存储后端，replaceability 已用 `MemoryRegistryProvider` 实测证明）
   - Observability Logger（§9 契约覆盖从 2/12 提升到 **6/12 + 1/12 等效**，余 5/12 用测试断言锁定待 Phase Q）
   - Dashboard MVP（只读聚合，8 指标，N/A 诚实，绝不重算检索）
   - Health Score MVP（七维权重，缺失维度 N/A + 重归一化，反伪造断言）
   - Phase P+ 测试体系（零依赖 harness，5 套件，184 断言）

3. **部署（Phase P+ Deployment）**
   - `observability_logs` 集合创建
   - `KNOWLEDGE_OBSERVABILITY_STORE=cloud` 环境变量实时生效（保留 `ADMIN_OPENID`，timeout=60 / memory=512 / runtime 不变）
   - chat 云函数重新部署（带观测埋点）
   - 回滚备份就位（`.deploy-backup/chat-pre-obs-20260802`）

4. **真实验证（非模拟）**
   - 11 条真实请求落库 `observability_logs`
   - Dashboard 五指标全部取得真实值（详见 §3）
   - 184/184 测试通过

---

## 2. 已冻结能力清单

> **Frozen 含义的两层**：
> - **Core Layer**：密码学冻结——SHA256 锁定于 O-0.6 基线，任何字节改动都会被 `test-5-frozen-assets.js` 双重互锁捕获（测试常量 vs `docs/67`）。
> - **Operations Layer**：策略冻结——Phase P+ 实现已完成并验证，后续任何改动必须走 Phase Q + ADR，不可在冻结期热改。

### 2.1 Core Layer（密码学冻结 · O-0.6）

| 能力 | 载体 | SHA256 (O-0.6) | 状态 |
|------|------|----------------|------|
| Router | `cloudfunctions/chat/knowledgeRouter.js` | `848908445dbb5ea93a6f52775dc3c8e6922ff971d6cee115547f236ffed0a935` | 🔒 Frozen |
| Intent | `cloudfunctions/chat/intent.js` | `765ad138ec68c0f159c6f75a60e5268beb02fba152f6d53dbdc539ba1560ca38` | 🔒 Frozen |
| RAG | `cloudfunctions/chat/rag.js` | `5b380b3f7c68f374e3d4e5127bd7dbeff747849401ca9d0488498dece1408286` | 🔒 Frozen |
| Metadata Contract | 19 字段契约（docs/62 §4） | 声明式，由 Corpus/Router 实现 | 🔒 Frozen |
| Release Gate | C1–C8（docs/62 §7） | 声明式，由测试门禁实现 | 🔒 Frozen |
| Regression | 100/50/20 三套基准 | 数据集冻结 | 🔒 Frozen |

### 2.2 Operations Layer（策略冻结 · Phase P+ 完成）

| 能力 | 载体 | 说明 | 状态 |
|------|------|------|------|
| Registry Provider | `registry/registryProvider.js` + `jsonRegistryProvider.js` | 可替换存储后端抽象；`getRaw()` 100% 等价原生 `JSON.parse` | 🔒 Frozen |
| Observability | `observability/observabilityLogger.js` + `jsonObservabilityStore.js` + `cloudObservabilityStore.js` | §9 契约覆盖 6/12 + 1/12 等效；写入永不抛出、失败自动降级 | 🔒 Frozen |
| Dashboard | `dashboard/dashboard.js` + `printDashboard.js` | 只读聚合 8 指标；`readonly=true`、`recomputes_retrieval=false`、N/A 诚实 | 🔒 Frozen |
| Health Score | `knowledgeHealthScore.js` | 七维权重，缺失维度 N/A + 重归一化，反伪造断言 | 🔒 Frozen |

### 2.3 测试与文档（验证资产，非生产运行时）

| 资产 | 路径 | 状态 |
|------|------|------|
| Phase P+ 测试 | `tests/phase-p-plus/`（5 套件 + harness + runner） | 184/184 PASS |
| 审计报告 | `docs/67-PhaseP+审计报告.md` | 冻结基线来源 |
| Observability 设计 | `docs/68-Observability落库设计.md` | Frozen |
| 实现报告 | `docs/69-PhaseP+实现报告.md` | Frozen |
| 部署审计 + 报告 | `docs/70-PhaseP+Deployment审计.md` / `docs/70-PhaseP+Deployment报告.md` | Frozen |

---

## 3. 生产验证证据

> **⚠️ 真实性声明**：以下全部数据来自 `observability_logs` 云数据库集合的真实记录（`scripts/records.json` 为 11 条原始记录 unwrap `$numberInt` 后的副本），**非模拟、非单元测试桩**。Dashboard 指标由 `verify-observability.js` 用真实 `dashboard.js` 对真实记录只读聚合得出。

### 3.1 真实请求规模

- **11 条**真实请求（`KNOWLEDGE_OBSERVABILITY_STORE=cloud` 已生效，写入链路打通）。
- 覆盖意图分布：`life` ×4、`opinion` ×3、`emotion` ×2、`growth` ×1、`knowledge` ×1。

### 3.2 Dashboard 真实指标（`readonly=true / recomputes_retrieval=false`）

| 指标 | 真实值 | 计算口径 |
|------|--------|----------|
| Query Count | **11** | 观测记录数 |
| Knowledge Usage | **classic=7 / none=4** | 按 `knowledge_type` 非空计数 |
| Citation Rate | **0.636** (7/11) | 有引用的请求占比 |
| Average Latency | **5962 ms** | `latency_ms` 均值（1060–8727 区间） |
| Fallback Rate | **0.364** (4/11) | `knowledge_type=[]` 占比 |
| N/A 清单 | **空** | 上述 5 项均取得真实数据，无伪造 |

### 3.3 日志字段（真实落库结构）

基础：`_id` / `query` / `answer_id` / `conversation_id` / `openid` / `created_at` / `createTime`
路由：`router_enabled` / `router_decision{priorityDomains, knowledgePriority, preferredTypes, reason}` / `knowledge_type` / `fallback_reason`
检索：`retrieval_result`（§9 契约 `retrieval_mode`/`retrieval_count` 待 Phase Q 补）
引用：`citation_count`
性能：`latency_ms`
意图上下文：`domain` / `intent` / `policy_name`

> §9 契约剩余的 5/12 字段（`retrieval_mode` / `router_adjustment` / `rerank_score` / `chunk_id` / `vector_score`）**当前未落库**——它们需要冻结 `rag.js` 内部埋点，已用 `test-2-observability.js` 断言锁定为「确实缺失」，留待 Phase Q，本冻结期不补。

### 3.4 数据样例（两条最具代表性的真实记录）

**样本 A — 经典引用命中（Citation 生效）**
```json
{
  "query": "朋友犯错的时候，我应该直接指出来吗？",
  "answer_id": "20260802_1t23w8",
  "domain": "关系", "intent": "life", "policy_name": "use",
  "router_decision": { "priorityDomains": ["关系"], "knowledgePriority": {"psychology":-200,"classic":60}, "preferredTypes": ["classic"], "reason": "classic-priority-domain" },
  "knowledge_type": ["classic"],
  "retrieval_result": ["道德经", "柏拉图《申辩篇》", "论语"],
  "citation_count": 3, "latency_ms": 4872,
  "created_at": "2026-08-02T02:58:57.071Z"
}
```

**样本 B — 心理学信号触发但未命中（Issue-001 铁证）**
```json
{
  "query": "我总是反复检查门有没有锁，这是确认偏差吗？",
  "answer_id": "20260802_rccelf",
  "domain": "通用", "intent": "opinion", "policy_name": "optional",
  "router_decision": {
    "priorityDomains": ["cognitive-psychology"],
    "knowledgePriority": {"psychology": 60, "classic": -80},
    "preferredTypes": ["psychology"],
    "reason": "cognitive-psychology-signal"
  },
  "knowledge_type": [], "retrieval_result": [], "citation_count": 0, "latency_ms": 8727,
  "created_at": "2026-08-02T03:00:22.214Z"
}
```
> 注意：样本 B 的 `router_decision` 显示路由器**正确识别**了认知心理信号（`psychology` 优先级 +60、`classic` −80、`preferredTypes:[psychology]`），但 `knowledge_type=[]`、`citation_count=0`——**路由信号正确，但检索层没有返回心理学知识**。根因：KO-P-04 概念卡为「Certified Production Candidate（未 Published）」，未进入检索索引。详见 §5 Issue-001。

---

## 4. 当前系统能力边界

### 4.1 当前可以做（✅ In Scope）

| 能力 | 机制 | 是否改代码 |
|------|------|-----------|
| 新增知识对象 | Registry + Metadata 驱动，新增 `knowledge_type` 资产 + 注册即可，无需改 Router/RAG | 否 |
| 知识对象认证 | KO 认证流程（docs/62/64），产出 O-1 certificate | 否 |
| 回归测试 | Phase H/N 基准（100/50/20），`tests/phase-p-plus` 门禁 | 否 |
| 运行质量观察 | Dashboard + Observability 实时 read-only 聚合 | 否 |
| 回滚 | `KB_ROUTER_ENABLED=false` 一键回滚（逐字节一致） | 否 |

### 4.2 当前不能做（❌ Out of Scope · 冻结期禁止）

| 能力 | 原因 | 解锁条件 |
|------|------|----------|
| 自动治理（Auto-governance） | 无自愈/自动调参机制 | 需 Phase Q 设计 |
| 自动扩展（Auto-expansion） | 知识入库仍依赖人工 ingest/embed | 需 Phase Q + 工具链 |
| 自动优化 Router | Router 为策略冻结核心，热改会破坏 O-0.6 基线 | 需 Phase Q + ADR + 回归门禁 |

---

## 5. 已知问题登记（Known Issues）

> 本节为诚实登记。**不处理、不优化**，仅观测与分派。

### Issue-001 · Psychology Knowledge Routing Coverage

| 字段 | 内容 |
|------|------|
| **现象** | 认知心理问题触发 `cognitive-psychology-signal` 路由信号（`knowledgePriority.psychology=60`），但 `knowledge_type=[]`、`citation_count=0`，心理学知识未被检索命中。真实样本：「我总是反复检查门有没有锁，这是确认偏差吗？」 |
| **影响** | P-04 概念卡已认证但**未 Published/未进检索索引**——知识存在但未生效。11 条真实请求中，明显属认知心理的该条走了 fallback，未引用任何知识 |
| **状态** | `Observed`（已在 §3.4 样本 B 固化证据） |
| **处理** | 留待 **Phase Q** 分析（候选方向 #1 Knowledge Routing Coverage 优化）。冻结期不做任何改动 |
| **关联** | 根因在「资产未发布」而非「Router 逻辑错误」——Router 信号本身正确，说明问题在知识发布/检索接入环节，而非路由算法 |

### Issue-002 · msgSecCheck access_token

| 字段 | 内容 |
|------|------|
| **现象** | 函数日志持续出现 `msgSecCheck 调用失败: invalid wx openapi access_token` |
| **影响** | 内容安全检查降级；函数已优雅降级，**不影响回答生成**（回答正常返回 `ok:true`） |
| **状态** | `Separate Track`（与 Knowledge Platform 主线解耦，非 Phase P+ 引入） |
| **处理** | 分派至 **Phase S-0 Security Hardening** 独立立项修复，不在本冻结/Phase Q 范围内 |
| **关联** | 属微信开放接口鉴权配置问题，需在公众平台/云函数侧修复 access_token 获取链路 |

---

## 6. Observation Period 计划

> 原则：**Observe before Change**。在真实流量下收集证据，禁止在观察期内主动优化。

### 6.1 目标

- 收集 **100–500 条**真实请求（当前 11 条，差一个数量级）。
- 数据来源：保持 `KNOWLEDGE_OBSERVABILITY_STORE=cloud` 运行，由真实用户流量自然累积（不人为灌量）。

### 6.2 观察维度

| 维度 | 当前基线（11 条） | 观察目标 |
|------|------------------|----------|
| Fallback Rate | 0.364 | 随流量增大是否收敛/发散 |
| Knowledge Coverage | classic 主导，psychology=0 命中 | psychology 是否持续 0 命中（验证 Issue-001 普遍性） |
| Citation Accuracy | 0.636 | 引用是否正确、有无误引 |
| Latency | 均值 5962ms（区间 1060–8727） | P95/P99 分布，是否触及体验红线 |
| User Feedback | 暂无采集通道 | 需另设计反馈回路（不在本冻结范围） |

### 6.3 禁止项

- ❌ 观察期内**不**改 Router / RAG / Prompt / Intent / Metadata Contract / Release Gate / Regression。
- ❌ 观察期内**不**新增 Knowledge Object、不 ingest、不 embedding。
- ❌ 观察期内**不**补齐 Observability 剩余 5/12 字段（属 Phase Q）。

### 6.4 数据出口

- Dashboard（只读聚合）持续可用：`scripts/verify-observability.js` 可对 `observability_logs` 快照做离线验证。
- 回滚产物 `/ 备份`：`.deploy-backup/chat-pre-obs-20260802` 保留至观察期结束。

---

## 7. Phase Q 启动条件

> Phase Q **不自动启动**。必须**同时满足**以下四条件，方可授权进入。

| 条件 | 判定标准 | 当前状态 |
|------|----------|----------|
| **A. 观察数据达到规模** | `observability_logs` ≥ 100 条（建议 100–500）真实请求 | ❌ 未达（当前 11） |
| **B. 发现稳定问题模式** | 如 Psychology routing 持续 miss、Latency P99 越线等，在 ≥100 样本上复现 | ❌ 未确认（样本不足） |
| **C. 完成 ADR 分析** | 针对待改项产出 Architecture Decision Record，含影响面/回归策略 | ❌ 未启动 |
| **D. 明确影响范围** | 改动不破坏 O-0.6 冻结基线，或经 Release Manager 审批的受控突破 | ❌ 未定义 |

**进入门槛**：A ∧ B ∧ C ∧ D 全部为真 → 授权 Phase Q。任一为假，维持 Observation Period。

---

## 8. Phase Q 候选方向（仅记录，不执行）

> 全部标记 **Future**。本冻结期不展开、不排期、不实现。

| # | 候选方向 | 关联问题 | 备注 |
|---|----------|----------|------|
| 1 | **Knowledge Routing Coverage 优化** | Issue-001 | 优先：先确认 P-04 是否应 Published，再评估 Router 信号→检索接入链路 |
| 2 | **Observability Trace 增强** | §9 剩余 5/12 字段 | 在冻结 `rag.js` 内埋点 `retrieval_mode` / `router_adjustment` / `rerank_score` / `chunk_id` / `vector_score` |
| 3 | **Policy 声明式抽取** | docs/62 §6 | 将 `routeQuestion` 三分支矩阵抽为 `knowledgePolicyMatrix.js` 声明式数据，达成「新增域零代码改动」 |
| 4 | **Registry 存储升级** | Phase P+ Registry Provider | 从 JSON 文件后端升级为云数据库后端（保持 `getRaw()` 契约不变） |
| 5 | **Embedding Queue** | Knowledge 扩展瓶颈 | 解耦 ingest 与 embedding，支撑规模化知识入库 |

---

## 附：Final Freeze 保护检查记录

### A. 测试状态（生成本报告前执行）
```
tests/phase-p-plus/run-tests.js → 184 passed, 0 failed (317ms)
5 套件全绿：Registry 22/22 · Observability 36/36 · Dashboard 56/56 · Health Score 45/45 · Frozen-hash 25/25
```

### B. 冻结资产哈希（独立重验，与 O-0.6 基线逐字节一致）
```
OK  corpus.json            db01fbc92064cbea3a6688a98160b6a70c9e150259b54063c8e2e96974eabc8b
OK  intent.js              765ad138ec68c0f159c6f75a60e5268beb02fba152f6d53dbdc539ba1560ca38
OK  rag.js                 5b380b3f7c68f374e3d4e5127bd7dbeff747849401ca9d0488498dece1408286
OK  knowledgeRouter.js     848908445dbb5ea93a6f52775dc3c8e6922ff971d6cee115547f236ffed0a935
==> 四项冻结资产全部与 O-0.6 基线一致
```

### C. 代码改动声明（本冻结任务）
- **本任务（Phase P+ Final Freeze）零代码改动**：仅新增 `docs/71-PhaseP+FinalFreeze.md`（本文件，untracked）。
- 仓库中存在的 `M` 状态文件（`corpus.json` / `index.js` / `rag.js` 等）为 **Phase G / Phase P+ 遗留未提交改动**，其工作树内容经 SHA256 核验等于 O-0.6 基线（corpus/rag 未漂），`index.js` 非冻结资产、其改动为既有观测埋点，均非本任务引入。
- 未执行 commit、未执行 publish、未进入 Phase Q。

### D. 交付物清单（Phase P+ 全周期）
```
docs/67-PhaseP+审计报告.md            ✅ 冻结基线来源
docs/68-Observability落库设计.md       ✅ §9 覆盖度拆分
docs/69-PhaseP+实现报告.md             ✅ 七阶段实现总结
docs/70-PhaseP+Deployment审计.md       ✅ 部署前只读审计
docs/70-PhaseP+Deployment报告.md       ✅ 真实部署验证
docs/71-PhaseP+FinalFreeze.md         ✅ 本文件（Final Freeze + Observation Plan）
tests/phase-p-plus/                   ✅ 184/184
scripts/verify-observability.js      ✅ 真实数据验证脚本
scripts/records.json                 ✅ 11 条真实观测记录副本
```

---
**冻结签名（逻辑）**：Knowledge Platform v1.0 GA + Operations v1.0 = `FROZEN @ O-0.6`，待人工 Review 后进入 Observation Period。
