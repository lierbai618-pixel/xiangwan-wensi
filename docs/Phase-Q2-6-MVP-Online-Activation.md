# Phase Q2-6-MVP：Online Freshness Activation Preparation（在线联网搜索激活准备）

- **角色**：Release Manager + AI Reliability Architect
- **目标**：让「向晚问思」支持联网搜索，但**严格保持知识库冻结**。
- **日期**：2026-08-07
- **状态**：✅ COMPLETE（准备阶段）｜⛔ 未部署 / 未开真实搜索 / 未改生产环境变量 / 未 commit
- **下一步**：等待人工授权进入 L2 灰度或生产激活。

---

## 0. 约束与边界（本次严守）

| 类别 | 要求 |
|---|---|
| 不修改冻结资产 | `corpus.json` / `intent.js` / `knowledgeRouter.js` / `rag.js` |
| 搜索结果定位 | 仅作 **runtime context**，随请求结束即释放 |
| 禁止动作 | ingest / embedding / 写入知识库 / 更新 metadata / 生成长期缓存知识 |
| 复用既有能力 | `privacyGate` · `canaryGate` · `quota(CostGuard)` · `audit` |
| 当前接入 | 仅 **domestic** provider（国内数据路径，零跨境） |
| 禁止动作 | 部署 · 开真实搜索 · 改生产 env · commit/push |

---

## A. 数据流审查：searchLayer → thinkEngine，确认搜索结果不进知识资产

### A.1 调用链（生产代码路径，未改动）

```
用户输入
  → index.js 派发：Capability → Freshness → thinkEngine → generateAnswer(冻结兜底)
        │
        └─ thinkEngine.run(message, opts)
              ├─ answerMode.resolve()            // fast / deep / think
              ├─ searchGate()                    // ① FRESHNESS_FACTUAL_ENABLED ② provider≠none ③ mock 需测试开关
              ├─ gatherFacts()                   // 调 searchLayer.search()
              │     └─ searchLayer.search(query, {openid, __canary})
              │           ├─ privacyGate.resolve()   // 最前端，PII 不出境（fail-closed）
              │           ├─ canaryGate.resolve()    // per-user 灰度（默认关）
              │           ├─ CostGuard.allowed()     // 日配额（仅真实 provider 计费）
              │           ├─ cache / provider 调用（domestic → retriever.nodeFetch）
              │           └─ 返回 { ok, provider, results[], audit }   ← 仅内存，ephemeral
              ├─ factExtractor.extractFacts()     // 结果 → Fact[]，带 _ephemeral=true
              ├─ 组装 answer：
              │     fast   → composeFastAnswer(facts)         // 事实摘要 + 来源
              │     think  → generateAnswer(RAG,只读) + reasoning(facts) + citation
              └─ ThinkContext.toSafeMeta()        // 仅观测元信息，绝不落 corpus
```

### A.2 不进知识资产的证据（代码级）

1. **无持久化写入**：整条 `search → fact → context → answer` 路径**没有任何 `fs.write` / 数据库知识集合写**。搜索结果只存在于 `res.results`（请求栈帧）与 `out.raw/usable`（thinkEngine 局部变量）。
2. **ephemeral 硬标记**：`factExtractor.toEphemeralFacts()` 与 `thinkContext.makeThinkContext()` 均打 `_ephemeral=true`；`thinkContext.toSafeMeta()` 只输出 `{mode, query_len, facts_count, knowledge_count, _ephemeral}`，**不含事实内容**。
3. **audit 仅安全元数据**：`searchLayer._audit()` 仅输出 7 个白名单字段（`provider/latency_ms/cache_hit/downgrade_reason/quota_remaining/canary_blocked/data_route`），**绝不含用户原文 / 脱敏 query / 完整结果 / 个人信息**。
4. **RAG 只读**：think 模式内部调用 `rag.generateAnswer` 为**只读消费**，不回写 corpus；`logQuestion` 写入的 `matchedTitles` 来自 RAG citations（既有知识库引用），**不含搜索事实**。
5. **隔离检查器佐证**：`freshnessRuntimeGuard.verifyAnswerResult()` 对真实联网结果递归扫描，**0 处**疑似知识沉淀结构。

### A.3 结论

✅ 搜索结果**仅作为 runtime context** 进入回答文本与引用展示，**不进入** corpus / embedding / metadata / 任何长期缓存知识。与 Task A 目标一致。

---

## B. Freshness Runtime Context 隔离检查（实现）

新增文件：`cloudfunctions/chat/freshnessRuntimeGuard.js`（非冻结资产，纯函数，零云依赖，Node 16.13 兼容）。

### 提供能力

| 函数 | 作用 |
|---|---|
| `MARKER` / `isEphemeral(obj)` | `_ephemeral` 硬标记常量与判定 |
| `verifyAudit(audit)` | 校验 search.audit 字段白名单 + 不含 URL / 超长原文 |
| `verifyChain(chain)` | 校验「搜索→事实→ThinkContext」容器链均带 ephemeral 标记 |
| `scanLeak(node, path, found)` | 递归扫描 result 中未标 ephemeral 的疑似 KB 写入结构（`corpus/embedding/ingest/kbWrite/persistFact/longTermCache/...`） |
| `verifyAnswerResult(result)` | 综合校验最终返回结果（泄露扫描 + 审计白名单） |
| `makeIsolationReport(result)` | 一次性自检报告，供测试 / CI 消费 |

### 设计要点

- **不修改任何冻结资产与生产代码**：隔离检查器为独立模块，由离线测试与（可选）运行时自检调用，零行为副作用。
- **双保险**：结构层（`verifyAnswerResult` 递归扫描）+ 资产层（测试对 4 冻结资产做 SHA/mtime 断言），两层共同锁定「零污染」不变量。
- **可扩展**：疑似键表 `SUSPECT_KB_KEYS` 与审计白名单 `AUDIT_SAFE_KEYS` 集中声明，未来新增能力时一处维护。

---

## C. 测试结果（scripts/test_q26.js）

**运行**：`node scripts/test_q26.js`（零网络，fakeFetch 注入，绝不触网）
**结果**：**31 PASS / 0 FAIL**

### 用户要求的 5 项断言（全部 ✅）

| # | 断言 | 验证方式 | 结果 |
|---|---|---|---|
| 1 | 网络结果进入回答 | fast 模式走真实 `searchLayer`（domestic+fakeFetch）→ 回答含联网事实标记 | ✅ |
| 2 | corpus hash 不变 | `corpus.json` SHA256 全流程前后一致 | ✅ `db01fbc9…abc8b` |
| 3 | embedding 数量不变 | corpus 条目数（派生 embedding 向量数）前后均为 **14** | ✅ |
| 4 | 知识库文件无修改 | 4 冻结资产 **mtime + SHA** 前后完全一致 | ✅ 4/4 |
| 5 | 搜索失败自动回退 RAG | think 模式搜索失败 → 回答来自 RAG；fast 模式失败 → 返回 null 由派发器回退 RAG | ✅ |

### 附加隔离检查单元（6 项，全部 ✅）

- 真实联网结果经 `verifyAnswerResult` → 通过（0 泄露 / 0 审计违规）
- `think.context._ephemeral === true`
- 正常 result → 通过；含 `corpus` 写入结构 → 判泄露；审计含 URL → 不通过；审计含未授权字段 → 不通过

---

## D. 激活准备结论与上线前置

### D.1 本阶段交付物

- `cloudfunctions/chat/freshnessRuntimeGuard.js` — 隔离检查器（Task B）
- `scripts/test_q26.js` — 集成 + 隔离测试（Task C，31 PASS）
- 本报告（Task D）

### D.2 冻结资产完整性（激活准备基线，4/4 MATCH）

| 文件 | SHA256（前 16 位） | 状态 |
|---|---|---|
| corpus.json | `db01fbc92064cbea3a6688a98160b6a70c9e150259b54063c8e2e96974eabc8b` | ✅ 未改 |
| intent.js | `765ad138ec68c0f159c6f75a60e5268beb02fba152f6d53dbdc539ba1560ca38` | ✅ 未改 |
| knowledgeRouter.js | `848908445dbb5ea93a6f52775dc3c8e6922ff971d6cee115547f236ffed0a935` | ✅ 未改 |
| rag.js | `4fb2dca42597a277911472a3cf1e8411f9f5c08988c2712e38d260d58fc2b503` | ✅ 未改 |

### D.3 上线前置（仍未满足，须人工授权后逐项操作）

| 前置 | 当前 | 说明 |
|---|---|---|
| 真实搜索激活 | ❌ 关 | 需 `FRESHNESS_FACTUAL_ENABLED=true` + `SEARCH_PROVIDER=domestic` |
| 国内部署 SearXNG | ❌ 待运维 | `SEARXNG_BASE_URL` + 仅国内引擎（`SEARXNG_ENGINES`）保证零跨境 |
| 微信 request 域名白名单 | ❌ 待配 | 真机须把 SearXNG 域名加 API 白名单 |
| 灰度闸门 | ⛔ 默认关 | `SEARCH_CANARY_ENABLED` 建议 L2 先开白名单用户 |
| 备案合规 | ⏳ 审核中 | 小程序备案通过后方可正式开放对外联网能力 |
| 部署 | ⛔ 未部署 | 本次仅准备，未 `tcb fn deploy` |

### D.4 风险与缓解

- **数据出境**：domestic 路径的零跨境正确性**依赖运维**（SearXNG 仅启用国内引擎 + 国内部署）。隔离检查器已对 `data_route=domestic` 做断言，但真值在运维侧。
- **配额滥用**：`CostGuard` 日配额默认 500，真实源计费用尽即 `quota_exceeded` 降级，不影响 RAG。
- **PII 出境**：`privacyGate` 默认关；上线前须确认 `PRIVACY_GATE_ENABLED=true` 以在源码层拦截高风险 PII。

### D.5 下一步授权候选

1. 数据源择定（SearXNG 自托管 vs 腾讯云 WSA）与运维前置（国内部署 + 限定国内引擎）
2. 合规收尾（B1 备案通过 + 隐私政策 + `PRIVACY_GATE_ENABLED=true`）
3. L2 灰度授权（开 `SEARCH_CANARY_ENABLED` + 白名单，`FRESHNESS_FACTUAL_ENABLED=true`，domestic 源）
4. 生产部署（仅在上述全部满足后）

---

## 附：禁止项核对

- ⛔ 未部署（无 `tcb fn deploy`）
- ⛔ 未开真实搜索（`FRESHNESS_FACTUAL_ENABLED` / `SEARCH_PROVIDER` 生产态仍为默认）
- ⛔ 未改生产环境变量
- ⛔ 未 commit/push
- ✅ 4 冻结资产零改动（SHA 4/4 MATCH，mtime 不变）
- ✅ 搜索结果仅作 runtime context，KB 零污染
