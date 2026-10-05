# docs/73 · Phase P+ Observation Milestones

> **角色**：Release Guardian + Production Reliability Observer
> **阶段**：Observation Period（非开发阶段）
> **冻结基线**：Knowledge Platform v1.0 GA + Operations v1.0 · O-0.6
> **最高约束**：只读观察、只记录不修复、禁止进入 Phase Q、禁止 commit/publish
> **创建时间**：2026-08-02

---

## 0. 文档目的

在 Final Freeze（docs/71）与 Observation Review（docs/72）之后，建立**结构化的观察里程碑框架**，使后续真实流量的积累有清晰的评审节点与判定标准。本文档**不修改任何代码、不触发任何优化、不启动 Phase Q**。

所有指标均来自 `observability_logs` 云库真实记录（只读拉取），Dashboard 聚合逻辑 `readonly=true / recomputes_retrieval=false`，无模拟数据。

---

## 1. 当前基线快照（文档创建时真实数据）

| 指标 | 值 | 来源 |
|------|-----|------|
| 真实样本数 | **15** | `observability_logs` count |
| 时间窗 | 2026-08-02T02:33 → 03:25（≈52 min） | created_at |
| Fallback Rate | 0.267 (4/15) | knowledge_type=[] |
| Citation Rate | 0.733 (11/15) | citation_count>0 |
| Knowledge Usage | none=4, classic=11 | knowledge_type 分布 |
| Latency mean / p50 / p90 / p95 / p99 | 6496 / 7047 / 8727 / 9723 / 9723 ms | latency_ms 分布 |
| 错误记录 | 0 | error 字段 |
| Psych signal 触发 | 1/15 (6.7%) | router_decision.reason=cognitive-psychology-signal |
| 冻结资产 | 4/4 == O-0.6 | SHA256 复核 |

**关键观察**：15 条全部落在同一 ~52 分钟窗口，疑似人工/测试流量；**尚未观察到有机用户流量**。这是达成 N=50/100 里程碑的主要瓶颈——需要在小程序正式发布/过审后累积真实用户请求。

---

## 2. Observation Milestone Framework

三个观察节点，按样本规模递进。每个节点只做**快照与判定**，不做任何改动。

### 2.1 Milestone N=50（目标：累计真实 observability_logs >= 50）

**触发条件**：`count(observability_logs) >= 50`

**检查项**：
1. **Fallback Rate** — 是否仍集中在特定 domain/intent
2. **Citation Rate** — classic 引用率是否稳定（基线 0.733）
3. **Knowledge Coverage** — knowledge_type 分布（none/classic 占比变化）
4. **Latency distribution** — mean / p50 / p90 / p95 / p99 是否恶化
5. **Issue-001 是否再次出现** — psych signal 触发次数与命中率

**输出物**：`Observation Snapshot @ N=50`
- 上述 5 项指标的真实值 + 与基线（N=15）的 delta
- Issue-001 复现计数与频率更新
- 是否触发进一步观察建议（仅建议，不改动）

**当前进度**：15 / 50（30%）— 未达。

---

### 2.2 Milestone N=100（Phase Q Gate 前置检查点）

**触发条件**：`count(observability_logs) >= 100`

**必须重新判断 Phase Q Gate 四条件**（注意：**仅判断，不启动 Phase Q**）：

| 条件 | 判定内容 | 数据来源 |
|------|----------|----------|
| **A** | observability_logs >= 100 | count |
| **B** | 是否存在稳定问题模式（如 psych 持续 miss、特定 domain fallback 集中） | 跨样本统计 |
| **C** | ADR 是否需要启动（针对已确认问题是否需形成架构决策记录） | Issue Registry |
| **D** | 影响范围是否明确（问题是否清晰界定、是否破坏 O-0.6） | Issue 分析 |

**输出物**：`Phase Q Readiness Review @ N=100`
- 四条件逐项 PASS/FAIL
- `ALLOW_PHASE_Q = TRUE / FALSE`
- 若 FALSE：明确哪些条件未满足，列出仍需观察的数据

**当前进度**：15 / 100（15%）— 未达。当前预判 `ALLOW_PHASE_Q = FALSE`（A 未达、B 样本不足、C 无 ADR）。

---

### 2.3 Milestone N=500（长期稳定性检查）

**触发条件**：`count(observability_logs) >= 500`

**关注维度**：
- **domain 分布** — 是否有新 domain 涌现、分布是否均衡
- **knowledge_type 分布** — classic / psychology / none 长期占比
- **fallback 收敛** — Fallback Rate 是否随知识扩展而下降
- **latency P95/P99** — 长期尾延迟趋势（关联 docs/74 Reliability Observation）
- **citation quality** — 引用准确性人工抽样（不推断语义，仅记录抽样结果）

**输出物**：`Long-term Stability Report @ N=500`
- 与 N=50 / N=100 的趋势对比
- 是否建议进入知识扩展 / Router 优化（仅建议）

**当前进度**：15 / 500（3%）— 未达。

---

## 3. Issue Registry（本次更新）

> 状态机仅允许：`Observed` / `Confirmed` / `Escalated` / `Resolved`（**禁止使用 Resolved**）。
> 所有发现只记录、不修复。

### Issue-001 · Psychology Knowledge Routing Coverage

| 字段 | 上次（docs/72） | 本次更新 | 说明 |
|------|----------------|----------|------|
| 状态 | Confirmed | **Confirmed** | 机制已确认（信号正确），但**禁止升级为系统性问题** |
| Sample Count | 11 | **15** | 观察样本总量增长 |
| Current Frequency | 1/11 (9.1%) | **1/15 (6.7%)** | 触发 cognitive-psychology-signal 的 query 占比 |
| Psych Miss（命中率） | 1/1 (100% miss) | **1/1 (100% miss)** | 唯一 psych 信号 query（"我总是反复检查门有没有锁"）kt=[]、cit=0 |
| Confidence | Low | **Low** | n=1 psych 事件，不足以判定系统性；维持 Low |
| 根因（记录） | P-04 概念卡为 Certified Candidate 未 Published，未进检索索引 | 同 | 非 Router 逻辑错误 |
| 处理 | 留待 Phase Q | 留待 Phase Q | 待 A/B/C/D 满足后授权 |

**判定**：Issue-001 为 **Confirmed 但非 Systemic**（样本不足）。当前频率 6.7% 偏低，且 miss 100% 仅基于单一样本。维持观察，不升级。

### Issue-002 · msgSecCheck access_token

| 字段 | 值 |
|------|-----|
| 状态 | **Escalated**（维持） |
| 现象 | `invalid wx openapi access_token` |
| 影响 | 内容安全检查降级（函数已优雅降级，不影响回答） |
| 处理 | 分派 **Phase S-0 Security Hardening**（独立轨，非 Phase Q） |

### Issue-003 · Latency p99 Observation（新增）

| 字段 | 值 |
|------|-----|
| 状态 | **Observed**（新增） |
| 现象 | p99 latency = **9723 ms**，逼近 10s 用户侧红线 |
| 影响 | 长尾用户体验风险；p99≈p95 提示存在固定高成本子集 |
| Evidence | mean=6496 / p95=9723 / p99=9723（15 样本） |
| 当前状态 | 仅记录症状；根因需分轨调查（见 docs/74） |
| 处理 | 独立 Reliability Observation Track（docs/74），**只观察不修复** |

---

## 4. Observation Status（本节点）

```
Current Samples:        15
Phase Q Gate (now):     A=FAIL(15<100) / B=FAIL(样本不足) / C=FAIL(无ADR) / D=PASS
                        => ALLOW_PHASE_Q = FALSE
Risk Summary:           Issue-001 Confirmed(non-systemic) / Issue-002 Escalated / Issue-003 Observed(p99≈9.7s)
Next Review Point:      Milestone N=50（需再 +35 真实请求）；或人工触发重审
```

---

## 5. 约束遵守声明

- ❌ 未修改任何代码（rag.js / intent.js / knowledgeRouter.js / corpus.json 均未动）
- ❌ 未修改 Prompt / Metadata Contract / Release Gate / Regression
- ❌ 未新增 Knowledge Object / 未 ingest / 未 embedding
- ❌ 未 commit / 未 publish / 未进入 Phase Q
- ✅ 仅读取云库真实数据 + 文档化里程碑框架 + 更新 Issue Registry（只记录）

> **Release Guardian 立场**：保护 O-0.6 基线，积累真实证据，等待数据驱动决策。下一阶段（含 Phase Q 或 Reliability 调查轨）须由人工显式授权方可启动。
