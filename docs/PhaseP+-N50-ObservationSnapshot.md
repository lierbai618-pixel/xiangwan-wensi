# docs/PhaseP+-N50-ObservationSnapshot.md

> **角色**：Release Guardian + Production Reliability Observer + AI System Reliability Auditor
> **阶段**：Phase P+ Observation Period（非开发阶段）
> **冻结基线**：Knowledge Platform v1.0 GA + Operations v1.0 · O-0.6
> **最高约束**：只读观察、只记录不修复、禁止进入 Phase Q、禁止 commit/publish、禁止修改任何冻结资产/代码/Prompt/Metadata
> **创建时间**：2026-08-02T16:03 (GMT+8)
> **里程碑目标**：从 Current Sample = 15 推进至 N=50（需 +35 条真实请求样本）

---

## 1. Current Status（当前状态）

| 维度 | 值 |
|------|-----|
| 项目 | 问道（WenDao）哲学思辨助手 |
| 版本 | O-0.6 Freeze |
| Phase | P+ Observation |
| 冻结资产 SHA256 | **PASS**（本地源 / 部署包 / 已部署生产 三处均一致） |
| 真实样本 N | **15** |
| Phase Q | **BLOCKED**（ALLOW_PHASE_Q = FALSE） |
| N=50 进度 | **15 / 50（30%）— 未达** |

**关键事实**：
- 15 条样本全部落在 `2026-08-02T02:33 → 03:25`（≈52 min）同一窗口，openid 为 `unknown`（连通性探测）或单一管理员 openid；**疑似测试/验证流量，尚未观察到有机用户流量**。
- 项目处于「备案审核中」状态，未公开发布，无有机用户基础。因此 +35 条真实样本的预期来源是**过审发布后的真实用户请求**，观察者无法主动生成（受最高约束限制）。

---

## 2. Freeze Verification（冻结完整性核验）

### 2.1 Freeze Integrity Report（资产级，SHA256 守门）

| Asset | Expected (O-0.6) | Current (Deployed Prod) | Result |
|-------|-----------------|--------------------------|--------|
| corpus.json | `db01fbc92064cbea3a6688a98160b6a70c9e150259b54063c8e2e96974eabc8b` | `db01fbc92064cbea3a6688a98160b6a70c9e150259b54063c8e2e96974eabc8b` | **PASS** |
| intent.js | `765ad138ec68c0f159c6f75a60e5268beb02fba152f6d53dbdc539ba1560ca38` | `765ad138ec68c0f159c6f75a60e5268beb02fba152f6d53dbdc539ba1560ca38` | **PASS** |
| rag.js | `5b380b3f7c68f374e3d4e5127bd7dbeff747849401ca9d0488498dece1408286` | `5b380b3f7c68f374e3d4e5127bd7dbeff747849401ca9d0488498dece1408286` | **PASS** |
| knowledgeRouter.js | `848908445dbb5ea93a6f52775dc3c8e6922ff971d6cee115547f236ffed0a935` | `848908445dbb5ea93a6f52775dc3c8e6922ff971d6cee115547f236ffed0a935` | **PASS** |

**核验方法（三层交叉验证）**：
1. **本地源** `weapp/cloudfunctions/chat/` → 4/4 一致
2. **部署包** `weapp/.deploy-tmp/chat-deploy/`（实际部署载荷）→ 4/4 一致
3. **已部署生产** `tcb fn code download chat`（运行时实际代码）→ 4/4 一致 ✅ 黄金标准

> Final: **PASS** — 运行中的生产代码与 O-0.6 冻结基线字节级一致。

### 2.2 工作树变更扫描（git status 解读）

`git status` 显示部分文件为 `M`（corpus.json、rag.js、index.js 等）或 `??`（intent.js、knowledgeRouter.js、docs/*、observability/、dashboard/、registry/、cloudbaserc.json 等）。

**重要判定**：
- 这些 git 标记是 **Phase G 遗留未提交工作 + 本阶段新增的运维/可观测性脚手架（dashboard、registry、observability 模块、文档）**，属于**冻结期允许的只读/观测类产物**。
- 经 SHA256 守门验证，**4 个冻结资产的字节内容无任何漂移**——git 的 `M`/`??` 不等于冻结资产内容变更。
- **不存在**：冻结资产内容修改 ✅ / 新增知识资产内容 ✅ / Router 逻辑变化 ✅ / Prompt 变化 ✅ / Intent 逻辑变化 ✅ / RAG 逻辑变化 ✅ / Metadata 变化 ✅。

> 结论：工作树虽"脏"，但脏在冻结期允许的非资产产物；冻结资产完整性未被破坏。

---

## 3. Sample Metrics（样本指标，N=15）

> 数据来源：`scripts/records-milestone.json`（于部署会话期从 `observability_logs` 云库真实拉取的 15 条记录副本，与 docs/73 基线文档内部一致；最新记录时间戳 `2026-08-02T03:25:28Z`）。
> 注：本会话尝试用 `tcb db nosql execute` 实时复核计数，但该 CLI 构建（3.6.4）的 RunCommands 解析器拒绝 `find`/`query`/`count`/`aggregate` 全部标准 MgoCommand 键（CLI 版本限制，非数据问题），故实时重查受阻；指标以下方已验证快照为准。

### 3.1 分布

**Domain 分布（7 类）**：
| 编程 | 关系 | 通用 | 人生 | 情绪 | 成长 | 职业 |
|------|------|------|------|------|------|------|
| 1 | 2 | 6 | 2 | 2 | 1 | 1 |

**Intent 分布（5 类）**：
| knowledge | life | opinion | emotion | growth |
|-----------|------|---------|---------|--------|
| 1 | 5 | 4 | 4 | 1 |

### 3.2 核心比率

- **Fallback Rate** = fallback_count / total = 4 / 15 = **0.267**（knowledge_type=[]：记录 #1 连通性探测、#3 psych 信号、#5 自我否定、#10 职业抉择）
- **Citation Rate** = answers_with_citation / total = 11 / 15 = **0.733**（citation_count > 0）
- **Coverage**：classic = 11 (73.3%) / none = 4 (26.7%) / psychology = 0 (0%)

### 3.3 Latency（端到端，ms）

| mean | p50 | p90 | p95 | p99 |
|------|-----|-----|-----|-----|
| **6496** | **7047** | **8727** | **9723** | **9723** |

特征：`p99 == p95 == 9723ms` → 存在**固定高成本子集**（尾部不随样本扩散），逼近 10s 用户侧红线。

### 3.4 Usage（Knowledge 使用分布）

- **none = 4**（fallback，无知识注入）
- **classic = 11**（经典知识引用）
- **psychology = 0**（psych 信号触发 1 次但命中率 0%，见 Issue-001）

### 3.5 错误与 Psych 信号

- 错误记录：**0**
- Psych signal 触发：1/15 (6.7%)，query「我总是反复检查门有没有锁」→ `router_decision.reason=cognitive-psychology-signal`，但 `knowledge_type=[]`、`citation_count=0`（100% miss，n=1）

---

## 4. Issue Registry（问题登记册）

> 状态机仅允许：`Observed` / `Confirmed` / `Escalated`（**禁止使用 Resolved**）。所有发现只记录、不修复。

### Issue-001 · Psychology Knowledge Routing Coverage
| 字段 | docs/73 值 | 本快照 | 说明 |
|------|-----------|--------|------|
| 状态 | Confirmed | **Confirmed（非系统性）** | 机制已确认（信号正确），**禁止升级为系统性问题** |
| Sample | 15 | **15** | 观察样本总量未变 |
| Frequency | 1/15 (6.7%) | **1/15 (6.7%)** | 触发 cognitive-psychology-signal 占比，无新增 |
| Psych Miss | 1/1 (100%) | **1/1 (100%)** | 唯一 psych 事件 kt=[]、cit=0 |
| Confidence | Low | **Low** | n=1，不足以判定系统性 |
| 根因（记录） | P-04 概念卡 Certified 未 Published | 同 | 非 Router 逻辑错误 |
| 处理 | 留待 Phase Q | 留待 Phase Q | 须 A/B/C/D 满足后授权 |

**判定**：Issue-001 为 **Confirmed 但非 Systemic**。无新增证据 → **不升级**（遵守约束）。

### Issue-002 · msgSecCheck access_token
| 字段 | 值 |
|------|-----|
| 状态 | **Escalated**（维持） |
| 现象 | `invalid wx openapi access_token` |
| 影响 | 内容安全检查降级（函数已优雅降级，不影响回答） |
| 处理 | 分派 **Phase S-0 Security Hardening**（独立轨，非 Phase Q） |

### Issue-003 · Latency p99 Observation
| 字段 | 值 |
|------|-----|
| 状态 | **Observed**（维持） |
| Sample | 15（单一样本窗口） |
| Frequency | 持续指标（非事件）→ N/A；p99 在 15 样本中稳定 = 9723ms |
| Confidence | **Low**（样本窗口单一、疑似测试流量） |
| Evidence | mean=6496 / p95=9723 / p99=9723ms；p99==p95 提示固定高成本子集 |
| 当前状态 | 仅记录症状；根因需分轨调查（见 §5） |
| 处理 | 独立 Reliability Observation Track（docs/74），**只观察不修复** |

---

## 5. Latency Observation（可靠性观察轨）

> 关联 docs/74。原则：**无埋点 → 只能记录症状，不能下结论**。所有假设标记 `Unverified`。

| 假设 | 内容 | 需观察数据 | 当前状态 |
|------|------|------------|----------|
| **H1** LLM Provider Latency | 大模型服务商生成延迟 | provider 调用前后计时 span | `Unverified`（需埋点，观察期禁止） |
| **H2** CF Cold Start | 云函数冷启动一次性开销 | 冷/热调用延迟对比、平台冷启动指标 | `Unverified` |
| **H3** Retrieval Pipeline | 知识检索耗时（语料仅 15 条，理论 <100ms） | `retrieve()` 计时 span | `Unverified`（低可能性瓶颈） |
| **H4** Network | chat→provider 跨网络往返 + SSL | egress 计时、provider 响应头时间戳 | `Unverified` |
| **H5** Database | 日志写入/查询延迟（异步非阻塞） | DB write/read 计时 span | `Unverified`（低可能性瓶颈） |

**观察结论**：最可能根为 **H1（LLM Provider）**，但**当前无任何数据可确认**——分解各阶段耗时所需的 instrumentation 在 Observation Period 被最高约束禁止。

**数据缺口声明**：Reliability Track 处于「数据饥饿」状态。H1–H5 验证均依赖代码埋点 / 平台监控指标，二者在观察期均不可得。本轨只能：记录症状 + 维护假设 + 标注未来数据需求。

---

## 6. Risk Summary（风险摘要）

| 风险 | 等级 | 状态 | 处置 |
|------|------|------|------|
| Issue-001 psych routing miss | 低（非系统性，n=1） | Confirmed | 观察，留待 Phase Q |
| Issue-002 msgSecCheck token | 中（安全降级） | Escalated | Phase S-0 独立轨 |
| Issue-003 p99≈9.7s | 中（长尾体验风险） | Observed | Reliability Track 观察 |
| 有机流量缺失 | 高（里程碑瓶颈） | 进行中 | 等过审发布累积真实请求 |
| 冻结漂移 | 无 | PASS | 三层 SHA256 已确认 |

---

## 7. Next Milestone（下一观察节点）

### N=50 Milestone（目标：count(observability_logs) >= 50）
- **当前**：15 / 50（30%）
- **需补充**：**+35 条真实请求样本**（须来自过审发布后的有机用户流量；观察者不可生成）
- **达点后检查项（docs/73 §2.1）**：
  1. Fallback Rate 是否仍集中特定 domain/intent
  2. Citation Rate 是否稳定（基线 0.733）
  3. Knowledge Coverage 分布变化（none/classic 占比）
  4. Latency p50/p90/p95/p99 是否恶化
  5. Issue-001 是否再次复现及命中率
- **输出物**：`Observation Snapshot @ N=50`（本次文档为该框架的 N=15 基线版）

### 后续里程碑
- **N=100**：Phase Q Gate 前置检查点（A/B/C/D 重判，仅判断不启动）
- **N=500**：长期稳定性检查

---

## 8. Phase Q Gate Preview（仅预览，不进入 Phase Q）

| 条件 | 内容 | 当前 | 判定 |
|------|------|------|------|
| **A** | Sample >= 100 | 15 < 100 | **FAIL** |
| **B** | Reliability Evidence sufficient | 数据饥饿，假设全 Unverified | **FAIL** |
| **C** | ADR completed | 无 ADR | **FAIL** |
| **D** | Freeze Integrity | 三处 SHA256 一致 | **PASS** |

```
ALLOW_PHASE_Q = FALSE
```

---

## 9. 约束遵守声明

- ❌ 未修改任何代码（rag.js / intent.js / knowledgeRouter.js / corpus.json 及全部云函数均未动）
- ❌ 未修改 Prompt / Metadata Contract / Release Gate / Regression
- ❌ 未新增 Knowledge Object / 未 ingest / 未 embedding
- ❌ 未热更新 / 未 commit / 未 publish / 未进入 Phase Q
- ✅ 仅：只读扫描 + 三层 SHA256 冻结核验 + 统计真实指标（已验证快照）+ 更新 Observation 文档 + 更新 Issue Registry（只记录）+ 建立/维护假设
- ✅ 所有优化机会已记录为「Potential Future Improvement」，等待独立批准

> **I confirm:**
> **No code changed.**
> **No assets changed.**
> **No Phase Q entered.**
> **Observation only.**

---

*生成者：Release Guardian + Production Reliability Observer + AI System Reliability Auditor*
*本快照为 Phase P+ N=50 里程碑的 N=15 基线版，仅观察、不修复、不决策。*
