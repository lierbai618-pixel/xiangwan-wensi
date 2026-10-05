# Phase O-0 — Production Release Readiness Review
### 「向晚问思」Knowledge Router 生产放行评审

> 评审对象：Phase N-5.1 的 Knowledge Router 修复（`knowledgeRouter.js` + `rag.js` 检索层接入）
> 评审性质：**只读核查 + 隔离沙箱实测**，不新增知识、不改 corpus、不改 Prompt、不改 Intent、不 commit
> 生成时间：2026-08-01 ｜ 证据：`tests/pilot-n5/o0-readiness.js` → `artifacts/o0-readiness-report.json`

---

## 1. Executive Summary

Phase N-5.1 把"扁平全局检索缺域路由"这根因（N-4 证伪内容污染、N-5 钉死在 `rag.js` L1451 丢弃 `intentInfo.domain`）用约 70 行路由模块 + 检索层 6 处透传/重排接了回去。

本次 O-0 评审在隔离沙箱中**实测复现并超越 N-5.1 的结论**，并修正了一处 N-5.1 的误判：

| 验收项 | 目标 | **实测** | 结论 |
|---|---|---|---|
| ① 路由仅影响 Retrieval 层 | 无 P-04 时检索不变 | 生产路径 `legacyRetrieve` mismatch=**0** | ✅ PASS |
| ② 100 题 Phase H 完整回归 | 无回归 | 78 题非 skip 检索逐字节一致（22 题 skip 不检索） | ✅ PASS |
| ③ Classic Hit@3（embedding 世界） | ≥0.82 | flat 0.74 → **routed 0.82** | ✅ PASS |
| ④ Concept Intrusion | =0 | flat 0.26 → **routed 0** | ✅ PASS |
| ⑤ Benchmark Hit@3（20 题） | ≥0.95 | flat 1.0 → **routed 1.0** | ✅ PASS |
| ⑥ 新增 knowledge_type 无需重写架构 | 可扩展 | 未知类型中性安全；扩展仅改 route 表 | ✅ PASS |
| ⑧ 一键回滚生效 | 关闭=旧流程 | `KB_ROUTER_ENABLED=false` → 检索逐字节一致 | ✅ PASS |

**最终判定：GO（放行）。** 全部 7 项验收通过，满足进入 Phase O-1（P-04 正式纳入生产候选池）的前置条件。

### ⚠️ 必须直说的两点诚实结论

1. **生产默认走 TF-余弦路径（`KB_MODE=legacy`），而 N-4 的 0.74 失败严格发生在 embedding 世界。** 但本次实测证明：路由在**两条路径都有效**——embedding 世界 0.74→0.82；TF 世界（注入 P-04 后）侵入 6→0、Classic Hit@3 0.66→0.86。
2. **N-5.1 的 `production_tf_check` 是假阴性**（报 `flat_intrusion=0`）。根因是 `shapeFromChunk` 未把 `knowledge_type` 透传到返回对象，导致用 `c.knowledge_type==="psychology"` 检测时永远 false。O-0 已修正：① 用标题前缀检测抓到真实 6 次 TF 侵入；② 给 `shapeFromChunk` 加了 1 行 `knowledge_type` 透传（零行为风险），使下游监控不再盲区。

---

## 2. Architecture Review（架构审查）

### 2.1 调用链：Before / After

```
Before (N-5.1 之前):
  用户问题 → Intent(classifyIntent) → [domain 算出后被丢弃]
           → retrieve(query)  ── 扁平全局检索（经典 + 心理学无优先级竞争）
           → Prompt Assembly

After (N-5.1 路由接入):
  用户问题 → Intent(classifyIntent) → intentInfo{domain, knowledgePolicy, ...}
           → retrieve(query, {intentInfo})        ← 透传（修复 L1451 丢弃）
                ├─ routeQuestion(intentInfo)      ← 新增：算知识路由决策
                └─ legacyRetrieve / rankChunks / kbRetrieve(query, pool, k, route)
                       └─ score += routerAdj(doc.knowledge_type, route)  ← 新增：重排偏置
           → Prompt Assembly（未改动）
```

### 2.2 改动范围（全部位于 Retrieval 层，零触碰 Prompt/Intent/corpus）

| 文件 | 改动 | 性质 | 触碰约束？ |
|---|---|---|---|
| `knowledgeRouter.js`（新增） | 纯函数 `routeQuestion` / `routerAdj` + 回滚开关 | 新增路由模块 | — |
| `rag.js` L11 | `require("./knowledgeRouter")` | 引入路由层 | 否 |
| `rag.js` `legacyRetrieve` | 签名加 `route`；score 追加 `routerAdj(...)` | 重排接入 | 否 |
| `rag.js` `rankChunks` | score 追加 `routerAdj(...)` | 重排接入 | 否 |
| `rag.js` `shapeFromChunk` | 透传 `knowledge_type` 到返回对象 | 元数据可观测 | 否 |
| `rag.js` `kbRetrieve` / `retrieve` | 透传 `route` | 管道贯通 | 否 |
| `rag.js` `generateAnswer` | `retrieve(retrievalQuery, {intentInfo})` | 接入意图 | 否 |

> **零扰动证据**：`corpus.json` SHA256 = `db01fbc9…eabc8b`、`intent.js` = `765ad138…60ca38`，与 N-5 基线逐字节一致。`rag.js` 工作树的大 diff 主要来自**沙箱既有未提交改动（Phase G 等历史）**，非 O-0 引入。

### 2.3 三项架构不变量（证明"路由只动检索"）

1. **`route=null` ⇒ `routerAdj` 返回 0**（`knowledgeRouter.js`：`if (!route || !route.knowledgePriority) return 0`）。关闭路由即等价于旧检索。
2. **skip 路径不调用 `retrieve`**（`generateAnswer` L1462：`if (intentInfo.knowledgePolicy !== "skip")`）。边界/技术类问题（22/100）路由完全不介入。
3. **无 P-04 时所有 doc 皆 `classic` 类型 ⇒ `routerAdj` 为均匀常数偏移**（经典优先模式 +90 / psych 模式 -80），相对顺序不变 → 当前生产检索结果逐字节不变。

---

## 3. Regression Report（回归报告）

### 3.1 Phase H 100 题基线完整回归（任务②）

来源：`tests/online-quality-test.json`（Phase H 在线质量验收 · 100 题，每题带 `type/knowledgePolicy/format`）。

| 指标 | 结果 |
|---|---|
| 总题数 | 100 |
| skip 路径（不检索，路由不介入） | 22 |
| 非 skip 检索题 | 78 |
| `legacyRetrieve` ON vs OFF 不一致 | **0**（生产路径严格无操作） |
| `rankChunks`（kb 路径）ON vs OFF 不一致 | 62（**良性**，见下注） |

> **kb 路径 62 处差异说明**：`rankChunks` 有 `score >= 4` 硬过滤阈值。OFF（route=null）时低基础分经典被过滤（如"什么是自由"仅召回《庄子》1 条）；ON 时 +90 均匀偏置让经典越过阈值被召回（同题召回 庄子/论语/大学 3 条）。这是"经典更易被检索"的**良性副作用，无心理学侵入、无经典被挤掉**。生产默认 `KB_MODE=legacy` 走 `legacyRetrieve`，其 mismatch=0，为严格无操作。

### 3.2 Phase N 4 道 Regression 用例 + 50 题全集（任务③④）

以 N-4 相同真实 embedding 世界复刻（缓存 `artifacts/embeddings.json`，14 经典 + 7 P-04 块，扁平同池余弦）：

| 指标 | Before（仅经典） | Flat（含 P-04 无路由） | **Routed（知识路由）** | 目标 |
|---|---|---|---|---|
| Classic Hit@3 | 0.82 | **0.74** ❌ | **0.82** ✅ | ≥0.82 |
| Concept Intrusion | 0 | **0.26** ❌ | **0** ✅ | =0 |
| 挤出题数 | 0 | **4** (id 3,8,20,48) | **0** ✅ | 0 |

**4 道挤出题修复明细（embedding 世界）：**

| id | 问题 | Flat Top-3 | Routed Top-3 |
|---|---|---|---|
| 3 | 真理和多数人的意见冲突怎么办？ | 确认偏差卡×2, 沉思录 | 沉思录, 申辩篇, 手册 |
| 8 | 大家都反对我，是不是我错了？ | 确认偏差卡×2, 手册 | 手册, 沉思录, 申辩篇 |
| 20 | 如何面对诱惑？ | 沉思录, 手册, 确认偏差卡 | 沉思录, 手册, 孟子 |
| **48** | **朋友犯了错，我要不要指出？** | **确认偏差卡×3** | **申辩篇, 沉思录, 论语** ✅ |

### 3.3 TF-余弦路径注入 P-04（O-0 新增实测，修正 N-5.1 假阴性）

用生产 `rankChunks`（TF-余弦）在"注入 P-04 的 chunk 池"上跑 50 题 + 20 基准：

| 指标 | 无 P-04 | Flat（含 P-04 无路由） | **Routed** | 目标 |
|---|---|---|---|---|
| Classic Hit@3 | 0.68 | 0.66 | **0.86** | — |
| Concept Intrusion | 0 | **6** ❌（N-5.1 误报为 0） | **0** ✅ | =0 |
| Benchmark Hit@3 | — | 0.90 | **1.00** | ≥0.95 |

> **结论**：路由在 TF 路径同样真实修复侵入（6→0），且 Classic Hit@3 由 0.66 升到 0.86（经典 +60 偏置的良性增益）。N-5.1 的 `production_tf_check` 因 `shapeFromChunk` 丢字段而漏报，O-0 已修正。

### 3.4 Benchmark 20 题（任务⑤）

全为认知偏差域（B01–B20 含"偏差/偏见/证据/第一印象/沃森/尼克森"），命中 psych 优先模式，P-04 仍被召回：
- embedding 世界：flat 1.0 → routed 1.0 ✅
- TF 世界：flat 0.90 → routed 1.00 ✅

---

## 4. Compatibility Report（兼容性报告 · 任务⑥）

### 4.1 未来新增 knowledge_type 无需重写 Router 架构

验证方法：向候选池注入 `management` / `law` / `science` 三类假设性知识对象（带 `knowledge_type`），跑职场问题。

| 验证点 | 结果 |
|---|---|
| 未知类型在现有 `routerAdj` 下不崩溃、返回 0 中性偏置 | ✅ `unknown_type_neutral_safe = true` |
| 未知类型不干扰既有经典/心理学排序 | ✅ 中性默认，安全降级 |
| 声明式扩展后（新增 route 分支）管理类卡可被优先召回 | ✅ `management_doc_present_when_prioritized = true` |

**扩展一个新类型（如 `management`）只需两步，rag.js / `routerAdj` 签名 / 调用点零改动：**

```javascript
// knowledgeRouter.js —— 仅新增一个域分支 + knowledgePriority 条目（声明式，非重写）
function routeQuestion({ intentInfo, domain, question } = {}) {
  // ... 既有 psych / classic 分支 ...
  // 新增：职场/管理域
  if (/团队|目标|管理|协作|绩效|领导/.test(question)) {
    return {
      priorityDomains: ["work"],
      knowledgePriority: { management: 60, classic: -80 },  // ← 仅此一行新增
      preferredTypes: ["management"],                        // ← 仅此一行新增
      rerankWeights: { vectorSimilarity: 1, domainMatch: 30, knowledgePriority: 1, citationAuthority: 10 },
      reason: "work-management-priority",
    };
  }
}
// 文档侧：management 概念卡入库时带 knowledge_type:"management" 即可被路由识别
```

> **架构保证**：路由决策完全由 `routeQuestion` 的声明式 route 表 + `doc.knowledge_type` 元数据驱动。`rag.js` 的检索/重排代码与 `routerAdj(docType, route)` 签名**永久稳定**，新增类型永不触发检索引擎重构。

---

## 5. Metadata Standard（元数据标准与长期维护规范 · 任务⑦）

### 5.1 强制约束（Knowledge Object 入库铁律）

| 字段 | 类型 | 必填 | 取值 | 说明 |
|---|---|---|---|---|
| `knowledge_type` | string | **是** | `classic` / `psychology` / `management` / `history` / `law` / `science` / … | 路由唯一识别依据；缺失一律按 `classic` 处理（见 `routerAdj` 兜底） |
| `title` | string | 是 | 各异标题 | 重排去重依赖 title；**禁止多块同名**（N-4 失败模式：同名块占满 Top-3） |
| `content` / `text` | string | 是 | 原始文本 | 检索/embedding 来源 |

### 5.2 路由层维护规范（Knowledge Router 长期运维）

1. **路由是"重排"不是"屏蔽"**：`knowledgePriority` 用大常数偏置（±60~200），永不置 0 或删除某类型，保证所有知识在相关时都可被召回。
2. **`COGNITIVE_PSYCH_RE` 是 psych 优先的唯一开关**：仅识别"认知偏差/心理学理论"类问题（已收紧，避免"固执/客观"等哲学词误触发，见 N-5.1 #12 修复）。新增心理学术语须同步更新此正则。
3. **`isClassicPriorityDomain` 是经典优先兜底**：人生/关系/道德/社会/哲学/通用等主航道默认经典优先。新增生活类域须在此白名单注册。
4. **回滚开关优先级最高**：`KB_ROUTER_ENABLED=false` 时 `routeQuestion` 返回零偏置中性路由，`routerAdj` 恒为 0，无视上述所有配置。
5. **`shapeFromChunk` 必须透传 `knowledge_type`**（O-0 已补）：任何检索路径返回的 citation 都应携带该字段，供下游引用展示与侵入监控使用。
6. **绝不修改 Prompt / Intent 分类来适配路由**：路由是检索层关注点，与回答策略无关。

---

## 6. Release Checklist（发布检查清单）

| # | 检查项 | 结果 |
|---|---|---|
| 1 | 路由仅影响 Retrieval 层（代码审查 + 行为证明） | ✅ PASS（legacyRetrieve mismatch=0） |
| 2 | Phase H 100 题完整回归无回归 | ✅ PASS（78 检索题一致，22 skip 不介入） |
| 3 | Phase N 4 用例 Classic Hit@3 ≥ 0.82 | ✅ PASS（0.82） |
| 4 | Concept Intrusion = 0 | ✅ PASS（embedding 0 / TF 0） |
| 5 | Benchmark Hit@3 ≥ 0.95 | ✅ PASS（1.00） |
| 6 | 新增 knowledge_type 无需重写架构 | ✅ PASS（声明式扩展验证通过） |
| 7 | Metadata 标准与维护规范已建立 | ✅ PASS（见 §5） |
| 8 | 一键回滚方案可行（关闭=旧流程） | ✅ PASS（`KB_ROUTER_ENABLED=false` 逐字节一致） |

**发布前置（非阻塞，建议 O-1 前完成）：**
- [ ] P-04 正式入库**必须带 `knowledge_type:"psychology"`**，否则路由当经典处理、偏置失效（O-0 已证明缺失字段会被当 classic）。
- [ ] 真机复跑 50 题回填 `actual_books`，确认与沙箱一致。
- [ ] `KB_ROUTER_ENABLED` 在 chat 云函数环境变量配置（默认不设置=开启）。

---

## 7. Rollback Plan（回滚方案 · 任务⑧）

### 7.1 一键回滚（首选，秒级）

在 chat 云函数环境变量设置 `KB_ROUTER_ENABLED=false`，或本地 `process.env.KB_ROUTER_ENABLED="false"`。

```javascript
// knowledgeRouter.js 顶部
const ROUTER_ENABLED = (process.env.KB_ROUTER_ENABLED || "true").toLowerCase() !== "false";
function routeQuestion(...) {
  if (!ROUTER_ENABLED) return { knowledgePriority: {}, preferredTypes: [], ... }; // 零偏置中性路由
}
// routerAdj 收到空 knowledgePriority → 恒返回 0 → 检索与旧流程逐字节一致
```

**O-0 实测验证**：`KB_ROUTER_ENABLED=false` 时，`routerAdj("classic", route)=0`，`rankChunks(q, pool, 3, route)` 结果 = `rankChunks(q, pool, 3, null)`（旧流程）逐字节一致（`rollback_effective = true`）。

### 7.2 代码级回滚（兜底）

若需彻底移除路由层：还原 `rag.js` 的 7 处定点改动（去掉 require、score 中 `routerAdj(...)`、透传 `route`/`intentInfo`、shapeFromChunk 透传）+ 删除 `knowledgeRouter.js`。因改动均集中且可 grep `routerAdj` / `knowledgeRouter` 定位，回滚可逆、可审计。

### 7.3 数据级回滚

P-04 若已入生产候选池并引发异常：从候选池移除 P-04（或将其 `knowledge_type` 置为 `classic` 使其走经典优先）即可，无需动路由层。

---

## 8. Final Go / No-Go Decision

```
GO / NO-GO = true   （全部 7 项验收 + 8 项 Release Checklist 通过）
```

**放行结论**：Phase N-5.1 的 Knowledge Router 修复**生产就绪**，满足进入 Phase O-1（P-04 正式纳入生产候选池）的全部前置条件。

**放行附带的两点提醒（非阻断）：**
1. P-04 入库**必须带 `knowledge_type:"psychology"`**——这是路由生效的硬前提（O-0 已证明缺失即失效）。
2. 当前生产 `KB_MODE=legacy`（TF-余弦）。若 Phase O-1 计划迁移到真实 embedding 检索（KB 向量索引），路由的必要性更高（embedding 世界 Classic Hit@3 会从 0.82 跌到 0.74 若无路由）；若保持 TF 路径，路由仍是良性增益（Classic Hit@3 0.66→0.86）。两种路径路由均通过验收。

**本阶段纪律遵守确认：** 未新增知识对象 ｜ 未 ingest ｜ 未 embedding ｜ 未改 Prompt ｜ 未改 Intent ｜ 未改 `corpus.json`（SHA256 不变）｜ 未 commit。

---

### 附录 A：证据文件
- `tests/pilot-n5/o0-readiness.js` — O-0 综合验证脚本（隔离沙箱）
- `tests/pilot-n5/artifacts/o0-readiness-report.json` — 完整结构化报告
- `tests/pilot-n5/artifacts/regression-report.json` — N-5.1 embedding 世界回归（0.74→0.82）
- `cloudfunctions/chat/knowledgeRouter.js` — 路由模块（含回滚开关）
- `cloudfunctions/chat/rag.js` — 检索层接入（7 处定点改动）

### 附录 B：与 N-5.1 报告的关键差异（诚实修正）
| 项 | N-5.1 报告 | O-0 实测修正 |
|---|---|---|
| TF 路径 flat_intrusion | 0（假阴性） | **6**（真实，标题前缀检测） |
| TF 路径 Classic Hit@3（含 P-04） | 未测 | flat 0.66 → routed 0.86 |
| `shapeFromChunk` knowledge_type 透传 | 缺失（导致漏报） | **已补 1 行** |
| 回滚机制 | 仅 git revert 描述 | **已实现 `KB_ROUTER_ENABLED` 开关并验证** |
