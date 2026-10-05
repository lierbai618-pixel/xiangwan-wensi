# docs/72 · Phase P+ Observation Review（Release Guardian 人工 Review）

| 项 | 内容 |
|----|------|
| 文档 ID | `docs/72-PhaseP+ObservationReview.md` |
| 角色 | Chief AI Architect + Knowledge Platform Architect + Release Manager + **Production Reliability Engineer（Release Guardian）** |
| 日期 | 2026-08-02 |
| 版本基线 | Knowledge Platform v1.0 GA + Operations v1.0 @ **O-0.6** |
| 当前状态 | **FROZEN · Observation Period** |
| 本任务性质 | **人工 Review + 观察期管理**（只读扫描 → 生成报告 → 运行测试 → 等待批准） |
| 最高约束 | ❌ 不修改任何冻结资产/Router/Intent/RAG/Prompt/Metadata/Release Gate/Regression ❌ 不新增 KO/ingest/embedding ❌ 不自动优化/修复/热更新 ❌ 不 commit/push/publish ❌ 不进 Phase Q |

> **Release Guardian 声明**：本报告所有结论均基于**真实生产数据**（`observability_logs` 云库实时拉取）与**只读校验**（哈希/测试）。任何发现仅记录、分类、量化、生成 ADR 候选；**一律不修复、不优化、不进入下一阶段**。

---

## 1. Review Summary

Phase P+ 已完成 Final Freeze（docs/71），系统进入 Observation Period。本次 Review 在冻结后首次执行人工观察复核，确认：

1. **冻结完整性**：4 项核心资产 SHA256 全部 == O-0.6 基线；`tests/phase-p-plus` 仍 **184/184 PASS**；零漂移。
2. **Observability 健康**：`observability_logs` 持续写入（本次拉取 **15 条**，较上次验证的 11 条 **+4 新请求**）；15/15 记录字段完整（15 个预期字段全部存在，0 缺失）；**0 条异常/错误记录**（logObservation 非阻塞设计验证有效）。
3. **生产数据**：classic 引用主导（11/15=73%），psychology 命中持续为 0；Fallback Rate 0.267、Citation Rate 0.733；Latency 均值 6496ms、p99 9723ms。
4. **已知问题**：Issue-001（Psychology Routing Coverage）升级为 **Confirmed**；Issue-002（msgSecCheck）维持 **Escalated**（分派 Phase S-0）。
5. **Phase Q Gate**：A/B/C 三项 FAIL，D 单项 PASS → **ALLOW_PHASE_Q = FALSE**。

**结论**：系统满足长期观察条件（冻结完整 + 观测链路健康），但**证据规模不足**，维持 Observation Period，不启动 Phase Q。

---

## 2. Freeze Integrity

> 格式：`Asset / Path / Expected Hash / Current Hash / Result`

```
Asset: corpus.json
Path:  cloudfunctions/chat/corpus.json
Expected Hash: db01fbc92064cbea3a6688a98160b6a70c9e150259b54063c8e2e96974eabc8b
Current Hash:  db01fbc92064cbea3a6688a98160b6a70c9e150259b54063c8e2e96974eabc8b
Result: PASS

Asset: intent.js
Path:  cloudfunctions/chat/intent.js
Expected Hash: 765ad138ec68c0f159c6f75a60e5268beb02fba152f6d53dbdc539ba1560ca38
Current Hash:  765ad138ec68c0f159c6f75a60e5268beb02fba152f6d53dbdc539ba1560ca38
Result: PASS

Asset: rag.js
Path:  cloudfunctions/chat/rag.js
Expected Hash: 5b380b3f7c68f374e3d4e5127bd7dbeff747849401ca9d0488498dece1408286
Current Hash: 5b380b3f7c68f374e3d4e5127bd7dbeff747849401ca9d0488498dece1408286
Result: PASS

Asset: knowledgeRouter.js
Path:  cloudfunctions/chat/knowledgeRouter.js
Expected Hash: 848908445dbb5ea93a6f52775dc3c8e6922ff971d6cee115547f236ffed0a935
Current Hash: 848908445dbb5ea93a6f52775dc3c8e6922ff971d6cee115547f236ffed0a935
Result: PASS
```

**测试状态**：`tests/phase-p-plus/run-tests.js` → **184 passed, 0 failed (322ms)**（5 套件全绿：Registry 22/22 · Observability 36/36 · Dashboard 56/56 · Health Score 45/45 · Frozen-hash 25/25）。

**Frozen Asset Drift**：**NONE**（四项核心资产与 O-0.6 逐字节一致；测试套件 Test-5 双重互锁未告警）。

**Freeze Integrity 结论**：✅ **PASS** — 冻结基线完整，无漂移，可安全进入长期观察。

---

## 3. Production Observation Metrics

> 数据源：`observability_logs` 云库实时拉取（find limit 200），**非模拟、非重算检索、未调用 RAG**。当前 **15 条**真实记录，时间跨度 `2026-08-02T02:33:53Z` → `2026-08-02T03:25:28Z`。

### 3.1 Observability 健康检查

| 检查项 | 结果 |
|--------|------|
| 持续写入 | ✅ 是（11 → 15，观察窗口内 +4 新请求） |
| 字段完整性 | ✅ 15/15 记录，15 个预期字段全部存在，**0 缺失** |
| 异常失败 | ✅ **0 条**错误记录（logObservation 非阻塞设计有效） |
| Latency 分布 | min 1060 / **mean 6496** / p50 7047 / p90 8727 / **p99 9723** / max 9723 ms |
| Fallback 分布 | **4/15 = 0.267**（较上次 0.364 下降） |
| Citation 分布 | **11/15 = 0.733**（较上次 0.636 上升）；直方图 {0:4, 1:2, 2:2, 3:7} |

### 3.2 核心指标（重点观察项）

| 指标 | 当前值 | 较上次（11条） | 说明 |
|------|--------|---------------|------|
| Query Count | **15** | 11 → 15 | 观察窗口内新增 4 条 |
| Knowledge Usage | **none=4 / classic=11** | none=4 / classic=7 | classic 占比升至 73% |
| Citation Rate | **0.733** | 0.636 | 上升 |
| Fallback Rate | **0.267** | 0.364 | 下降 |
| Latency (mean) | **6496 ms** | 5962 ms | 略升（新请求偏慢） |
| Latency (p99) | **9723 ms** | — | ≈9.7s，接近体验红线 |

### 3.3 分布分析

- **Intent 分布**：knowledge 1 / life 5 / opinion 4 / emotion 4 / growth 1
- **Domain 分布**：编程 1 / 关系 2 / 通用 6 / 人生 2 / 情绪 2 / 成长 1 / 职业 1
- **Fallback 域分布**：编程 1 / 通用 2 / 职业 1（通用占 fallback 半数，但未高度集中）
- **各 Intent Fallback 率**：knowledge 1/1 · life 1/5 · opinion 2/4 · emotion 0/4 · growth 0/1

### 3.4 Production Data Analysis（A–D 问答）

**A. Knowledge coverage 是否稳定？**
> classic 主导（11/15=73%），psychology 持续为 0。覆盖率形态在 15 条样本内一致（classic-centric），但样本量仍小，**稳定性待 ≥100 条确认**。当前趋势：classic 覆盖稳定，psychology 缺口恒定。

**B. fallback 是否集中在某些 domain？**
> 否高度集中。Fallback 落在 编程/通用/职业 三域，通用占 2/4。值得注意：**通用（generic）域 fallback 率最高（opinion 类 2/4）**，且唯一的 psychology 信号 query 也在通用域。建议观察期持续监控通用域。

**C. psychology knowledge miss 是否重复出现？**
> 当前样本仅 **1 条** psychology 信号 query（「我总是反复检查门有没有锁，这是确认偏差吗？」），且 **100% 未命中**（router 信号正确 `cognitive-psychology-signal` + `psychology:60`，但 `knowledge_type=[]`、`citation=0`）。**机制已 Confirmed，但重复频率证据不足（n=1）**，需更多 psychology 相关 query 才能判定「稳定重复」。

**D. classic citation 是否准确？**
> 结构上：7 条 3 引用、2 条 2 引用、2 条 1 引用，检索结果均列经典文本（如「道德经/论语/孟子/沉思录」）。**日志无法判定语义准确性**。发现疑似越界样本：事实/历史类问题「世界大战怎么爆发的」获得了 classic 引用（cit=1）——可能属 classic 过宽匹配。**建议观察期做抽样人工核查（spot-check），不推断、不改代码**。

### 3.5 Observation Report（Metric / Current / Trend / Risk / Recommendation）

| Metric | Current Value | Trend | Risk Level | Recommendation（仅观察建议） |
|--------|---------------|-------|------------|------------------------------|
| Query Count | 15 | ↑ 11→15 | Low | 继续累积至 ≥100；确认是否为有机用户流量 |
| Knowledge Usage (classic) | 11/15 (73%) | 稳定 classic-centric | Medium | 观察；关注 psychology 缺口持续性 |
| Knowledge Usage (psychology) | 0/15 (0%) | 恒定 0% | Medium | Confirmed Issue-001；收集更多 psychology query 确认重复 |
| Citation Rate | 0.733 | ↑ 0.636 | Low | 持续监控；做引用相关性抽样核查 |
| Fallback Rate | 0.267 | ↓ 0.364 | Low-Medium | 观察通用域集中度 |
| Latency mean | 6496 ms | ↑ 5962 | Medium-High | 监控 p99 趋势；必要时开可靠性调查轨（非 Phase Q） |
| Latency p99 | 9723 ms | 高 | **High** | 用户侧延迟近 10s；观察趋势，独立可靠性轨跟进 |
| Field Completeness | 100% | 稳定 | Low | 无需动作 |
| Write Health | 写入正常 / 0 错误 | 稳定 | Low | 无需动作 |

---

## 4. Known Issues

> 状态机仅允许：`Observed` / `Confirmed` / `Escalated` / `Resolved`（**禁止使用**）。本 Review 只更新 Severity / Frequency / Evidence / Status，**不修复**。

### Issue-001 · Psychology Knowledge Routing Coverage
| 字段 | 内容 |
|------|------|
| **Severity** | **Medium**（知识已认证但未服务，用户得不到心理学引用） |
| **Frequency** | psychology 信号 query **1/15（6.7%）**；该信号触发时 **100% miss（1/1）** |
| **Evidence** | 真实记录 #3「我总是反复检查门有没有锁，这是确认偏差吗？」：`router_decision.reason=cognitive-psychology-signal`、`knowledgePriority.psychology=60`、`preferredTypes=[psychology]`，但 `knowledge_type=[]`、`citation_count=0`（详见 docs/71 §3.4） |
| **Status** | **Confirmed**（机制已明：KO-P-04 为 Certified Production Candidate **未 Published** → 未进检索索引 → 路由信号正确但检索层为空；根因在「资产未发布」非「Router 逻辑错」） |

### Issue-002 · msgSecCheck access_token
| 字段 | 内容 |
|------|------|
| **Severity** | **Medium**（内容安全检查降级，安全合规风险） |
| **Frequency** | **持续**（每次调用日志均报 `msgSecCheck 调用失败: invalid wx openapi access_token`） |
| **Evidence** | chat 云函数运行日志：`msgSecCheck 调用失败: invalid wx openapi access_token`；函数已优雅降级，`ok:true` 不受影响 |
| **Status** | **Escalated**（已分派独立轨 **Phase S-0 Security Hardening**，与 Knowledge Platform 主线解耦） |

---

## 5. Risk Assessment

| ID | 风险 | 等级 | 当前证据 | 缓解（观察期动作，非修复） |
|----|------|------|----------|----------------------------|
| R1 | Psychology 知识缺口 | Medium | Issue-001 Confirmed，1/1 psych 信号 miss | 持续收集 psych query；若 ≥3 独立重复全 miss → 升级为稳定模式 |
| R2 | Latency p99 ≈9.7s | **Medium-High** | p99=9723ms，max=9723ms | 周监控 p99 趋势；若持续 >8s，开独立可靠性调查轨（**非 Phase Q 范围**） |
| R3 | 样本量不足 / 流量低 | Medium | 15 条集中在 ~52min 窗口，疑似手动/测试流量，无明确有机用户流量 | 待小程序过审发布后累积有机流量；设 50/100 里程碑重审 |
| R4 | 引用相关性不确定 | Low-Medium | 「世界大战怎么爆发」获 classic 引用，疑似过宽匹配 | 观察期人工抽样核查 5–10 条回答的引用恰当性 |
| R5 | msgSecCheck 降级 | Medium（独立轨） | Issue-002 Escalated | Phase S-0 修复，不占用 Phase Q |

**总体风险等级**：**Medium**（无阻断性风险；冻结完整、观测健康；主要不确定性在流量规模与延迟尾部）。

---

## 6. Phase Q Gate Status

> Phase Q **不启动**，仅判定四条件。

```
Condition A: observability_logs >= 100
  Current: 15
  Result:  FAIL  ❌（差距 85 条）

Condition B: 稳定问题模式出现
  Current: Issue-001 仅 1 次出现（机制 Confirmed 但频率证据不足）；
           Latency 趋势需更多数据；无 ≥3 次稳定重复
  Result:  FAIL  ❌

Condition C: ADR 是否完成
  Current: 未撰写任何 ADR
  Result:  FAIL  ❌

Condition D: 影响范围是否明确
  Current: Issue-001 影响清晰（psychology 知识未服务）；
           但 Phase Q 全部 5 候选方向的整体影响范围尚未经 ADR 界定
  Result:  PASS  ✅（已知问题影响明确；整体范围待 ADR）

══════════════════════════════════
ALLOW_PHASE_Q = FALSE
══════════════════════════════════
```

**判定**：A∧B∧C∧D 未全真 → **ALLOW_PHASE_Q = FALSE**。维持 Observation Period。

---

## 7. Next Observation Actions

> 全部为**观察/记录/计划**动作，禁止任何代码修改、优化、ingest、embedding、热更新。

1. **持续被动观察 + 里程碑重审**：在 N≥50、N≥100 时重跑本 Review（docs/72），刷新 Freeze Integrity 与 Metrics。
2. **流量计划（需人工批准）**：当前 15 条疑似手动/测试流量，有机用户流量近乎为零（小程序或尚未过审发布）。建议在发布后监控有机流量累积；若长期 <10 条/日，需设计受控观察方案（仅发请求、不改代码）。
3. **Latency 尾部监控**：周级别记录 p50/p90/p99；若 p99 持续 >8s，开**独立可靠性调查轨**（不在 Phase Q 知识/路由范畴内）。
4. **Citation 相关性抽样核查**：每月人工抽检 5–10 条随机回答，验证 classic 引用是否贴切（如「世界大战」类疑似越界），仅记录不修复。
5. **Issue Registry 维护**：仅更新 Severity/Frequency/Evidence/Status；Issue-001 若达 ≥3 次独立重复 miss 则升级为「稳定模式」→ 触发 Condition B。
6. **ADR 候选起草（仅草稿）**：为 Issue-001（Router Coverage）及 Phase Q 5 候选方向起草 ADR 草稿，**不执行、不评审通过**。
7. **等待人工批准**：本 Review 完成后停止，等待人工 Review 决策；不自动进入任何下一阶段。

---

**Release Guardian 签名**：O-0.6 基线受保护 ✅ · 生产观察数据真实 ✅ · 证据不足，维持 Observation Period ✅ · Phase Q 未启动 ✅。
