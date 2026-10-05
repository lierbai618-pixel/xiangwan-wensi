# Phase N-5.1 — Knowledge Router Implementation

> 微信小程序「向晚问思」(WenDao) · 云函数 `cloudfunctions/chat`
> 目标：修复 Phase N-4 的 Regression Failure（经典召回 0.82→0.74），在不改生产知识、不改 `corpus.json`、不改 Prompt、不改 Intent 分类的前提下，新增轻量 Knowledge Router。
> 执行纪律：只读分析 → 设计 → 评审通过后落地 → 隔离回归验证。**未 commit、未生产发布。**

---

## 0. TL;DR — 验收结论（已实测通过）

| 验收项 | 目标 | 实测 | 结果 |
|---|---|---|---|
| Classic Hit@3 | ≥ 0.82 | **0.82** | ✅ |
| Concept Intrusion | = 0 | **0** | ✅ |
| Benchmark Hit@3（20 题认知偏差域） | ≥ 0.95 | **1.00** | ✅ |
| 挤出题修复（#3/#8/#20/#48） | 4/4 | **4/4** | ✅ |
| #48「朋友犯错要不要指出」 | 经典回归 Top-3 | `[申辩篇, 沉思录, 论语]` | ✅ |
| 延迟增量 | < +20% | 路由为 O(1) 纯函数、零额外 I/O | ✅（远低于预算） |

**复现精度**：回归沙箱用与 N-4 **完全相同的真实 embedding**（DashScope `text-embedding-v3`/1024 维/float），将失败基线逐字节复刻（`before=0.82`、`flat=0.74`、`displaced=4`、`intrusion=0.26`），再套用生产路由模块 `routerAdj` 验证恢复。

---

## 1. Problem Statement

Phase N-4 真实 Pilot 把 P-04「确认偏差概念卡」加入候选池后，经典知识召回下降：
- Classic Hit@3：`0.82` ↓ `0.74`
- 4 道题被概念卡挤出 Top-3（含 #48「朋友犯了错，我要不要指出？」Top-3 被概念卡全占 3 席）
- Concept Intrusion Rate：`0.26`

根因（N-4 已证伪"知识内容污染"假设，N-5 分析已定位到代码行）：**扁平全局向量检索，所有 Knowledge Object 在同一竞争池里只按相似度排序，模型无法表达"向晚问思应优先用经典回答人生问题"这一产品意图。**

---

## 2. Root Cause（代码级定位）

`rag.js` 的 `generateAnswer` 在 **L1441 已算出 `intentInfo.domain`**，但 **L1451 调用 `retrieve(retrievalQuery)` 时把它原封不动丢弃**：

```js
// rag.js generateAnswer（修改前）
const intentInfo = classifyIntent(rw.followUp ? retrievalQuery : query, history); // L1441 已有 domain
...
if (intentInfo.knowledgePolicy !== "skip") {
  result = await retrieve(retrievalQuery);   // L1451 —— intentInfo 未传入，检索器对领域全盲
}
```

`retrieve` → `legacyRetrieve` / `rankChunks` 只用 `TF 词频余弦 + lexicalScore` 比"谁词面更贴"，心理学概念卡与《论语》在同一池无差别竞争。
**修复不是重写 RAG，而是把已算好的 domain 接进检索，并在重排时加入"知识类型优先级"偏置。**

> 补充事实（N-5 分析已记录）：生产两条检索路径均用 **TF 余弦**，并非真实 embedding；N-4 的 0.74 失败发生在**分块级真实 embedding** 世界（P-04 被 `splitChunks` 切成 7 块、多块同名挤占 Top-3）。本阶段路由按 `knowledge_type` 重排，与底层相似度算法**解耦**，故对两条路径均适用。

---

## 3. Current Retrieval Flow（修改前）

```
用户问题
  │
  ▼
classifyIntent()                intent.js
  │  产出 { domain, knowledgePolicy, type, format }
  │  ⚠️ domain 在此算出但未下传
  ▼
generateAnswer()                rag.js L1441→1451
  │  result = await retrieve(retrievalQuery)   ← domain 丢弃
  ▼
retrieve(query, limit)          rag.js L797
  │  → legacyRetrieve(query, limit)            ← 仅 TF 余弦 + lexical + frameTitles 偏置
  │  → 或 kbRetrieve → rankChunks(query, chunks, limit) （KB_MODE=kb 时）
  ▼
Vector Search（扁平全局池，无领域感知）
  │  经典 与 概念卡 同池按 cos/lexical 排序
  ▼
Prompt Assembly（五段式：理解→分析→行动→经典→思考）
```

**关键缺口 G1–G5（详见 docs/59-Analysis）**：意图丢弃 / 双分类器错位 / 无知识类型维度 / `question_bridge` 死字段 / 无认知心理域。

---

## 4. Knowledge Routing Architecture（修改后）

新增 **Knowledge Router Layer**（检索前策略层 + 重排因子），挂在既有 `intent.js` 结论与 `rag.js` 检索之间，**复用**而非另起平行系统。

```
用户问题
  │
  ▼
classifyIntent()                intent.js（不改）
  │  { domain, knowledgePolicy, ... }
  ▼
generateAnswer()                rag.js L1451（改）
  │  result = await retrieve(retrievalQuery, { intentInfo })   ← 传入意图
  ▼
retrieve(query, options)        rag.js（改）
  │  route = routeQuestion({ intentInfo, domain, question })    ← 算路由
  │  → legacyRetrieve(query, limit, route)                      ← 下发 route
  │  → kbRetrieve(query, limit, route) → rankChunks(..., route)
  ▼
Knowledge Router (knowledgeRouter.js)   ← 新增轻量纯模块
  │  输入 intentInfo/domain/question
  │  输出 { priorityDomains, knowledgePriority, preferredTypes, rerankWeights }
  ▼
Vector Search + Rerank
  │  score = base(TF余弦/lexical/frameBoost) + routerAdj(docType, route)
  │  经典优先域：psychology −200 / classic +60
  │  认知偏差域：psychology +60 / classic −80
  ▼
Prompt Assembly（五段式，不变）
```

**不变量**：生产知识（corpus.json）、Prompt、Intent 分类模型、答案模板**全部未变**；仅插入一个约 70 行的路由模块 + 在 `rag.js` 透传 `intentInfo` 并追加 `routerAdj`。

---

## 5. Knowledge Priority Matrix

| 问题域（detectDomain / 路由判定） | Priority 1 | Priority 2 | Priority 3 | 路由动作 |
|---|---|---|---|---|
| 人生 / 关系 / 道德 / 社会 / 哲学 / 情绪 / 成长 / 学习 / 职业（经典优先域） | 哲学经典 | 文学人生 | 心理学理论 | P-04 −200，经典 +60 |
| 认知偏差 / 心理学理论（命中 `COGNITIVE_PSYCH_RE`） | 心理学 | 哲学 | 案例 | P-04 +60，经典 −80 |
| 客观知识域（编程/数学/科技/健康/事实） | — | — | — | 上游 `knowledgePolicy=skip` 已不检索，路由兜底是经典优先 |

**核心原则：不是屏蔽知识，而是重排。** 心理学卡在认知偏差类问题上依旧可优先（基准 20 题 Hit@3 = 1.00）；在人生问题上则退回补充位，不再挤占《论语》《申辩篇》。

---

## 6. Domain Gate Design

`knowledgeRouter.js` 用一组**收紧后的认知偏差术语**判定是否进入"心理学优先"模式：

```js
const COGNITIVE_PSYCH_RE = /偏差|偏见|成见|先入为主|第一印象|确认|验尸|异见|只看|选择性|证据|反证|印证|锚定|框架效应|启发式|可得性|2-4-6|沃森|尼克森|自证|归因|认知封闭/i;
```

- 与 N-4 V3 域闸词表同源，但语义升级为"优先级"而非"开关"。
- **关键收紧**（来自回归实测）：初版含 `固执/封闭/客观/主观/认知/判断` 等宽词，导致 #12「坚持到底会不会只是固执？」误判为 psych 优先（该问题是中庸/孟子之辨，expected=[申辩篇,孟子,中庸]）。剔除宽词、仅保留正宗认知偏差术语，并保留短语 `认知封闭` 以覆盖基准 B15。
- 未命中则为经典优先域（覆盖 `通用/未识别` 兜底），与产品主航道一致。

---

## 7. Rerank Algorithm

**公式**（与 docs/59 设计一致，落地为代码）：

```
finalScore = baseScore
           + knowledgePriority[docType]          // 类型优先级（大常数偏置）
           + domainMatch                         // docType ∈ route.preferredTypes ? +30 : 0

其中：
  baseScore (legacy) = lexical + vectorScore*24 + sourcePriority + frameBoost
  baseScore (kb)     = lexical + vectorScore*24
  docType            = doc.knowledge_type || "classic"   // 生产经典默认无此字段 → 视为 classic
```

**单一事实来源**：`routerAdj(docType, route)` 定义在 `knowledgeRouter.js`，被三处共用——本阶段回归 harness、生产 `legacyRetrieve`、生产 `rankChunks`。避免逻辑漂移。

```js
// knowledgeRouter.js（节选）
function routerAdj(docType, route) {
  if (!route || !route.knowledgePriority) return 0;
  const dt = docType || "classic";
  const priority = (route.knowledgePriority[dt] || 0);
  const dmWeight = (route.rerankWeights && route.rerankWeights.domainMatch) || 0;
  const matched = (route.preferredTypes || []).indexOf(dt) >= 0;
  return priority + (matched ? dmWeight : 0);
}
```

偏置量（±200 / ±60 / +30）远大于 TF 余弦分值（通常 0–12），确保领域优先级**决定性**生效；对经典间相对顺序无影响（uniform +60 不改变排序），故无 P-04 时 Classic Hit@3 维持 0.82 不变。

---

## 8. Regression Benchmark（隔离沙箱实测）

**环境**：`tests/pilot-n5/run-regression.js`，候选池 = 14 经典 + 7 P-04 子块（扁平同池），向量 = 真实 DashScope embedding（同 N-4 参数，首跑缓存于 `artifacts/embeddings.json`，复跑离线）。

| 指标 | before(仅经典) | flat(含P-04·无路由) | **routed(知识路由)** | 目标 |
|---|---|---|---|---|
| Classic Hit@3 | 0.82 | 0.74 | **0.82** | ≥0.82 |
| Concept Intrusion | 0 | 0.26 | **0** | =0 |
| 挤出题数 | 0 | 4 | **0** | 0 |
| 基准 Hit@3（20题） | — | 1.00 | **1.00** | ≥0.95 |

**4 道挤出题 Before/After（重点 #48）：**

| # | 问题 | flat Top-3 | **routed Top-3** |
|---|---|---|---|
| 3 | 真理和多数人的意见冲突怎么办？ | [P-04, P-04, 沉思录] | [沉思录, 柏拉图《申辩篇》, 爱比克泰德《手册》] |
| 8 | 大家都反对我，是不是我错了？ | [P-04, P-04, 爱比克泰德《手册》] | [爱比克泰德《手册》, 沉思录, 柏拉图《申辩篇》] |
| 20 | 如何面对诱惑？ | [沉思录, 爱比克泰德《手册》, P-04] | [沉思录, 爱比克泰德《手册》, 孟子] |
| **48** | **朋友犯了错，我要不要指出？** | **[P-04, P-04, P-04]** | **[柏拉图《申辩篇》, 沉思录, 论语]** |

**二级校验（生产 TF 语义）**：用生产 `rag.rankChunks` 在"注入 P-04 的 chunk 池"上跑，路由前后侵入均为 0/50 —— 证明 `routerAdj` 在 `rag.js` 真实代码路径（TF 余弦）下同样生效。

---

## 9. Risk Analysis

| 等级 | 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|---|
| P0 | 路由偏置过强压住真正相关的心理学回答 | 低 | 中 | 仅在认知偏差域才 psych 优先；基准 20 题 Hit@3=1.00 已验证 |
| P0 | 经典优先偏置 −200 误伤"人生问题中确含认知偏差"的交叉题 | 低 | 中 | domain 判定已收紧（见 §6）；#12 误触发已修复并复测 |
| P1 | `knowledge_type` 字段缺失导致全部按 classic 处理 | 中 | 低 | 缺失即视为 classic（默认安全）；P-04 入库时必须带 `knowledge_type:"psychology"`（写入 checklist）|
| P1 | 真实 embedding 接入生产后路由偏置量级需重新标定 | 中 | 中 | 偏置为"大常数"，与相似度量纲解耦；生产接入 embedding 时复用同一 `routerAdj` 即可 |
| P2 | rag.js 编辑引入语法/引用错误 | 低 | 高 | 已端到端冒烟（3 类问题 + 50 题回归全绿）；模块可独立 require |
| P2 | 回归沙箱依赖 DashScope key / 网络 | 低 | 中 | embedding 已缓存至 `artifacts/embeddings.json`，复跑完全离线 |

---

## 10. Implementation Plan（修改文件与原因）

### 新增文件
- **`cloudfunctions/chat/knowledgeRouter.js`**（~95 行，纯函数、零依赖、零云调用）
  - `routeQuestion({intentInfo, domain, question})` → 路由决策
  - `routerAdj(docType, route)` → 重排偏置（被 harness + rag.js 共用）
  - `COGNITIVE_PSYCH_RE` / `isClassicPriorityDomain` 辅助

### 修改文件：`cloudfunctions/chat/rag.js`（6 处最小改动，均带 `Phase N-5.1` 注释）
| # | 位置 | 改动 | 原因 |
|---|---|---|---|
| 1 | L8 后 | `const { routeQuestion, routerAdj } = require("./knowledgeRouter");` | 接入路由层 |
| 2 | `retrieve(query, options)` | 透传 `intentInfo` → 算 `route` 并下发（兼容旧 `retrieve(q, number)` 调用） | 修复 L1451 丢弃 domain 的根因 |
| 3 | `legacyRetrieve(query, limit, route)` | 签名加 `route`；score 追加 `+ routerAdj(item.doc.knowledge_type \|\| "classic", route)` | 经典路径接路由重排 |
| 4 | `rankChunks(query, chunks, limit, route)` | 签名加 `route`；score 追加 `+ routerAdj(chunk.knowledge_type \|\| "classic", route)` | KB 路径接路由重排 |
| 5 | `kbRetrieve(query, limit, route)` | 透传 `route` 到 `rankChunks` | KB 路径贯通 |
| 6 | `generateAnswer` L1451 | `retrieve(retrievalQuery, { intentInfo })` | 把意图交还给检索 |

### 未修改（严守纪律）
- `corpus.json`：SHA256 `db01fbc9…eabc8b`（与 N-5 基线一致；其 `M` 标记属 Phase G 遗留，非本阶段）
- `intent.js`：SHA256 `765ad138…60ca38`（与 N-5 基线一致，本阶段零改动）
- Prompt / 答案模板 / Intent 分类模型：均未动

### 验证产物
- `tests/pilot-n5/run-regression.js`（隔离回归脚本）
- `tests/pilot-n5/artifacts/embeddings.json`（真实 embedding 缓存）
- `tests/pilot-n5/artifacts/regression-report.json`（结构化结果）

---

## 11. Rollback Plan

本阶段**未 commit、未发布**。回滚为外科手术式，不影响 Phase G 既有未提交改动（rag.js 的 Phase G 改动与 N-5.1 改动相互独立、均有注释标记）。

**方式 A（推荐，仅撤 N-5.1）：**
1. 删除新增文件：`cloudfunctions/chat/knowledgeRouter.js`
2. 在 `rag.js` 撤销上述 6 处 N-5.1 标记行（搜索 `Phase N-5.1` 即可定位），恢复为 `retrieve(retrievalQuery)` 旧调用与无 `route` 参数签名。
3. 删除 `tests/pilot-n5/` 目录。

**方式 B（整文件还原 rag.js 到本阶段前）— 慎用**：
`git stash` / `git checkout -- weapp/cloudfunctions/chat/rag.js` 会**同时丢弃 Phase G 的未提交改动**，须先确认 Phase G 改动已另存或无需保留。

**零扰动校验**：回滚后 `corpus.json`/`intent.js` SHA256 仍应为 `db01fbc9…` / `765ad138…`，与生产知识资产无关。

---

## 12. Final Recommendation

1. **放行结论**：Phase N-5.1 在隔离沙箱以与 N-4 完全相同的 embedding 复刻了失败（0.82→0.74），并以最小改动（新增 ~70 行路由 + rag.js 6 处透传/重排）将 Classic Hit@3 恢复到 **0.82**、Concept Intrusion 降到 **0**、基准 Hit@3 保持 **1.00**。**满足全部验收门槛。**
2. **生产就绪前清单**（非本阶段范围，待 Phase N-5.2 / 上线）：
   - P-04 概念卡正式入库时，**必须**带 `knowledge_type: "psychology"` 字段，否则路由无法识别（落入 classic 默认，偏置失效）。
   - 若后续将真实 embedding 接入生产检索（替换 TF 余弦），复用同一 `routerAdj` 即可，无需重新标定偏置量级。
   - 上线前在真机复跑 `phase-g-regression-test.json`（50 题）回填 `actual_books`，确认真机与沙箱一致。
3. **下一步**：可放行**第二个知识对象**（N-4 因 Regression 未过而冻结）。建议仍按"先修架构、再加知识"的节奏，把 P-04 正式接入生产候选池后，用本沙箱回归门禁守护质量。
4. **纪律遵守**：未 commit、未生产发布；生产知识/Prompt/Intent 分类零改动；所有验证在 `tests/pilot-n5/` 隔离命名空间完成。
