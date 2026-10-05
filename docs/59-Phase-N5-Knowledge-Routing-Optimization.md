# Phase N-5（二）知识路由优化 · Knowledge Routing Optimization（设计）

> 阶段定位：**Phase 2 — 仅设计**。本文档提出 Knowledge Routed RAG 方案，**不包含任何已落地的代码改动**。所有代码修改以"改动草案"形式给出，待评审通过（Phase 3）才执行。
> 只读分析见 `docs/59-Phase-N5-Architecture-Analysis.md`（含真实代码行号与五大缺口 G1–G5）。
> 前置：Phase N-4 Real Controlled Pilot（docs/58）。

---

## 1. Problem Statement

向晚问思的核心产品意图是「先做人，再引经」——用经典哲学/文学帮用户理解人生问题、形成判断，**经典是启发不是答案**。

Phase N-4 在隔离命名空间真实跑通了第一次知识扩展闭环（Registry→Chunk→Embedding→Index→Retrieval→Citation→Rollback），但 **Regression 未通过**：新增 P-04「确认偏差概念卡」后，经典召回被挤压。

关键案例「朋友犯了错，我要不要指出？」（N-4 Benchmark #48）：
- **Before**：Top-3 = 《论语》等哲学经典。
- **After（Flat Retrieval）**：Top-3 = 确认偏差概念卡，《论语》整条消失。
- **Classic Hit@3**：0.82 → 0.74（−8pp），4 题被概念卡挤出 Top-3。

这不是知识质量问题（N-4 消融实验已证伪"内容污染"假设），而是**检索架构缺失"知识路由"**——系统只会回答"什么知识最像问题"，无法回答"什么知识最适合回答这个问题"。

---

## 2. Root Cause

与 N-4 消融结论一致，并在本阶段只读分析中**精确定位到生产代码层面**：

1. **G1 — 意图在检索边界被丢弃**：`rag.js` L1441 已算出 `intentInfo.domain`，但 L1451 `retrieve(retrievalQuery)` 未传入，检索器对领域完全盲视。
2. **G3 — 打分公式无"知识类型"维度**：当前 `score = lexical + TF余弦*24 + sourcePriority + frameTitles偏置`（rag.js L603），哲学经典与心理学概念卡在**同一公式、同一竞争池**里无差别比拼词面相似度，没有任何"产品意图权重"能把经典优先。
3. **G5 — 无认知心理域**：`intent.js DOMAIN_RULES` 没有心理学/认知偏差类，导致"总认为别人针对我"类问题无法被识别为"应优先心理学"。

> 注：生产当前 `KB_MODE=legacy`，两条路径均用 **TF 词频余弦**（非真实 embedding）；N-4 的真实 DashScope embedding 仅存在于隔离产物。因此本方案设计的"路由层"对**任一 Provider 路径**都适用，且**不依赖更换 embedding**。

---

## 3. Current Retrieval Flow

```
Question
  → rewriteQuery → analyzeQuery
  → classifyIntent → { domain, knowledgePolicy, format }   ★ 此处算出 domain
  → if policy≠skip: retrieve(query)        ← domain 在此被丢弃（G1）
       → legacyRetrieve / kbRetrieve
            → score = lexical + TFcos*24 + sourcePriority + frameTitles偏置(按frame)
            → semantic 准入(lex≥4) → 两级召回 → citations
  → enrichCitations → buildRoute → tryModelAnswer（Prompt 用 domain/format/citations）
```

详细行号与字段说明见分析文档第 2、4 节。

---

## 4. Knowledge Routing Architecture

在 **Intent 与 Retrieval 之间**插入 Router Layer，并在 **Retrieval 之后**增加 Rerank 因子。整体链路：

```
Question
  │
  ▼
Intent Classification  (intent.js · classifyIntent)   ← 复用，不新建
  │  产出 intentInfo: { domain, knowledgePolicy, format, keywords }
  ▼
Knowledge Policy Router                                ← 复用 knowledgePolicy(skip/optional/use)
  │  仍决定是否检索、检索后过滤强度
  ▼
Domain Gate  (新增 · router.js)                        ← 检索前策略层
  │  输入: intentInfo.domain + query
  │  ① 认知心理检测器(补 G5) → 判定是否 psych-domain
  │  ② 查 Priority Matrix → 产出 admissibleTypes 及每类权重 KnowledgePriority
  │  ③ (可选) 读 corpus.question_bridge.user_phrases → 主动映射命中经典(活化 G4)
  ▼
Vector / Lexical Retrieval  (legacyRetrieve / kbRetrieve)   ← 复用，仅多收一个 intentInfo
  │  打分追加一项: + KnowledgePriorityBoost(typeOf(doc))
  ▼
Rerank  (新增因子，不重写引擎)                          ← 排序阶段
  │  FinalScore = Sim + IntentMatch + DomainMatch + KnowledgePriority + CitationAuthority
  ▼
Citation Planner  (复用 enrichCitations / buildRoute)
  ▼
Answer Generation  (复用 tryModelAnswer + ROLE_PROMPT + format)   ← 不改 Prompt/模板
```

**设计纪律（对应最高原则）：**
- ✅ 修改路由逻辑 → Domain Gate 即路由逻辑。
- ✅ 增加检索前策略层 → Domain Gate 在检索前。
- ✅ 增加 rerank 规则 → FinalScore 追加因子。
- ✅ 使用已有 metadata → Router Registry 用 `title`/`source`（及可选的 `question_bridge`）派生知识类型，**不改 corpus.json 内容**。
- ❌ 不删 P-04、不改 corpus 内容、不大规模重构 RAG、不换 embedding、不重建知识库。
- ✅ 复用 `intent.js.knowledgePolicy` 与 `rag.js.frameTitles`——**不新建平行系统**。

---

## 5. Priority Matrix（知识优先级矩阵）

> 原则：**不是屏蔽知识，而是排序**。每一行给出该领域下各知识类型的优先级与路由权重。
> 权重用于 `score += KnowledgePriorityBoost`；不在 admissibleTypes 的类型给**最低基线**（可仍被 psych-domain 问题召回，但在人生/关系/道德域被排至底部，从而保证 Intrusion=0）。

| 问题领域（domain / 检测） | P1（最高） | P2 | P3 | 不在表内类型（如 psych 概念卡） |
|---|---|---|---|---|
| 人生 / 关系 / 道德 / 哲学（默认经典优先） | 哲学经典 +60 | 文学人生 +30 | 案例 +10 | 心理学理论 **−200**（排底，不屏蔽）|
| 认知偏差 / 心理学（G5 检测命中） | 心理学理论 +60 | 哲学经典 +30 | 案例 +10 | 哲学经典仍保留 +30（不屏蔽）|
| 情绪支持（emotion） | 哲学经典 +40 | 心理学理论 +20 | 文学人生 +10 | — |
| 成长 / 学习 | 哲学经典 +30 | 心理学理论 +20 | 案例 +10 | — |
| 观点讨论（optional / 兜底） | 依命中 lexical 决定，不强制类型权重 | — | — | 宁缺毋滥（沿用 OPTIONAL_LEX_MIN=12）|

**说明：**
- "哲学经典" = 论语/道德经/庄子/孟子/中庸/沉思录/爱比克泰德/申辩篇/尼各马可。
- "心理学理论" = P-04 确认偏差概念卡及后续心理学知识对象（由 Router Registry 按 `title`/`source` 识别）。
- "文学人生" = 预留给后续文学类知识（本期无，矩阵先占位）。
- "案例" = 预留给实例型知识。
- 权重是**相对偏置**，叠加在既有 `lexical + TF余弦*24 + frameTitles` 之上；当某经典与问题词面相关（lex≥4）时，+60 确保它压倒 psych 卡的词面分，从而恢复经典 Top-3 且不挤占 psych-domain 场景。

---

## 6. Domain Gate Design

**位置**：`retrieve(query, limit, intentInfo)` 内、打分之前（检索前策略层）。

**输入**：`intentInfo.domain` + `query` 文本。
**输出**：`routingProfile = { typeBoost: {哲学经典:+60, 心理学理论:−200, …}, psychDomain: bool }`。

**逻辑草案：**

```javascript
// router.js（新增，纯函数、零依赖，可单测）
const KNOWLEDGE_TYPES = {
  "哲学经典": ["论语","道德经","庄子","孟子","中庸","沉思录","爱比克泰德《手册》","柏拉图《申辩篇》","尼各马可伦理学"],
  "心理学理论": ["确认偏差概念卡"],                 // 后续心理学对象在此追加
  // "文学人生": [...], "案例": [...] 预留
};

// G5 补丁：认知心理检测器（intent.js 无此域，故在 router 内补）
const PSYCH_RE = /(偏差|偏见|成见|先入为主|第一印象|确认|证实|选择性|只看|支持自己|别人针对|针对我|主观|客观|证据|反证|印证|固执|封闭|认知|判断自己|自己想法)/;

function knowledgeTypeOf(doc) {
  const key = (doc.title || "") + "||" + (doc.source || "");
  for (const [type, names] of Object.entries(KNOWLEDGE_TYPES)) {
    if (names.some((n) => key.includes(n))) return type;
  }
  return "未知";
}

function buildRoutingProfile(intentInfo, query) {
  const psychDomain = PSYCH_RE.test(query);
  // 领域 → 权重表（与第 5 节矩阵一致）
  const MATRIX = {
    default:  { "哲学经典": 60,  "文学人生": 30, "案例": 10, "心理学理论": -200 },
    psych:    { "心理学理论": 60, "哲学经典": 30, "案例": 10 },
    emotion:  { "哲学经典": 40,  "心理学理论": 20, "文学人生": 10 },
    growth:   { "哲学经典": 30,  "心理学理论": 20, "案例": 10 },
  };
  const bucket = psychDomain ? "psych"
    : (intentInfo.domain === "情绪" ? "emotion"
    : (intentInfo.domain === "成长" || intentInfo.domain === "学习" ? "growth"
    : "default"));
  return { typeBoost: MATRIX[bucket], psychDomain, bucket };
}
```

**与既有 `knowledgePolicy` 的协作（不冲突）：**
- `skip` → 不进检索（危机/技术/事实），gate 不参与。
- `optional` → 仍先经 gate 排序，再用 `OPTIONAL_LEX_MIN=12` 过滤强相关（沿用既有逻辑）。
- `use` → gate 全量生效。

**活化 G4（可选增强，B 阶段）**：若 `query` 命中某经典 `question_bridge.user_phrases`，对该经典额外 +15，实现"用户日常语言→经典"的主动映射，无需改 corpus 内容（字段已存在）。

---

## 7. Rerank Algorithm

**目标**：在保留既有 `lexical + TF余弦` 基础上，把"产品意图"编码进排序。

**最终分（FinalScore）：**

```
FinalScore = Sim                       // 既有 lexical + vectorScore*24
           + IntentMatch               // knowledgePolicy 一致性（skip/optional/use 已外部处理）
           + DomainMatch               // 命中的 admissibleTypes 与领域相关度（由 gate 产出）
           + KnowledgePriority         // ★ 新增：typeBoost[knowledgeTypeOf(doc)]
           + CitationAuthority         // 既有 sourcePriority + frameTitles 偏置（保留）
```

**最小改动落地**：KnowledgePriority 直接并入现有 `score` 公式，作为**一个加法项**，不重写引擎：

```javascript
// legacyRetrieve / rankChunks 内，score 计算处追加：
const routing = buildRoutingProfile(intentInfo, query);   // 新增
const kType = knowledgeTypeOf(doc);
const knowledgePriorityBoost = (routing.typeBoost[kType] || 0);
const score = lexical + vectorScore * 24 + sourcePriority(doc) + preferredBoost + knowledgePriorityBoost;
```

- **向量相似度（Sim）**：沿用，仍只作同帧内排序参考，不作引用准入（既有 SEMANTIC_LEX_MIN=4 不变）。
- **DomainMatch / IntentMatch**：由 `routingProfile` 与 `knowledgePolicy` 体现，已蕴含在 `typeBoost` 中，不另设独立阈值。
- **CitationAuthority**：沿用 `sourcePriority` + `frameTitles` 偏置，保证既有长尾抬升（Phase G）不被破坏。

**为什么能恢复经典且不伤心理学价值**：在 `default` 桶（人生/关系/道德/哲学），心理学概念卡被 −200 排底——当问题词面相关一个经典（lex≥4）时，经典 +60 必然胜出，Top-3 回到经典；而在 `psych` 桶（"总认为别人针对我"），心理学 +60 领先，概念卡正常上位。**同一套数据，两套优先级，靠 domain 切换，而非删除。**

---

## 8. Regression Benchmark

**复用 Phase N-4 失败数据**（docs/58 + `tests/pilot-n4/artifacts/regression-report.json`），不重新采集。

**重点题集（N-4 被挤出的 4 题，尤其 #48）：**
- #48「朋友犯了错，我要不要指出？」— Before Top-3 全经典，After 全概念卡。
- 其余 3 题（N-4 报告记录）：同属"人生/关系/道德"域被 psych 卡挤占。

**复用 50 题回归集**（`phase-g-regression-test.json`，结构 `{_meta, records}`，遍历 `records`）计算 Classic Hit@3。

**指标与验收阈值（来自用户第 13 节）：**

| 指标 | Before（Flat） | 目标（Routing） | 说明 |
|---|---|---|---|
| Classic Hit@3 | 0.74（N-4 After）| **≥ 0.82** | 恢复经典召回 |
| Concept Intrusion Rate | — | **0** | 人生/关系/道德域 Top-3 不得出现 psych 概念卡 |
| Benchmark Hit@3（20 题 pilot）| 0.95 | **≥ 0.95** | 心理学价值不降 |
| Citation Accuracy | 基线 | **不下降** | 引用仍 grounded |
| Latency 增量 | — | **< 20%** | gate 为纯正则/查表，开销极小 |

**验证方式（Phase 3 执行）**：在隔离命名空间 `tests/pilot-n5/` 内，对 `retrieve` 注入 `intentInfo` 跑通 routing 版本，复用 N-4 的 50 题回归 + 4 道挤出题 + 20 题 Benchmark，对比 Before/After，产出 `regression-n5.json`。**不改动生产 corpus / 不重新 ingest / 不重新 embedding。**

---

## 9. Risk Analysis

| 等级 | 风险 | 缓解 |
|---|---|---|
| P1 | 权重调参不当，把 psych 卡在某个域误伤/误放 | 先在隔离命名空间跑 50 题回归 + 4 挤出题，确认 Intrusion=0 且 Classic Hit@3≥0.82 才放行 |
| P1 | `knowledgeTypeOf` 靠 `title`/`source` 字符串匹配，新增知识对象易漏识别 | Router Registry 集中配置；漏识别→落入"未知"类型→给 0 偏置（不破坏既有行为），可观测日志发现 |
| P2 | 双分类器（domain vs frame）仍并存，frameTitles 偏置与 gate 权重可能叠加失真 | gate 的 `default` 桶已隐含经典优先，可逐步把 frameTitles 的"经典偏置"收敛进 Matrix；本期保留 frameTitles 不动，仅追加 typeBoost |
| P2 | Latency 因多一次 `buildRoutingProfile` 微增 | 纯正则 + 查表，O(1)，预估 < 1ms，远低于 20% 阈值 |
| P2 | `question_bridge` 活化（G4）误触发导致错配经典 | 列为 B 阶段可选；如启用需单独回归验证 |
| P3 | intentInfo 透传改动面（retrieve 签名）波及 legacy/kb 两路径 | 改动极小且向后兼容（intentInfo 缺省走旧行为）；见 Rollback |

---

## 10. Implementation Plan（草案 · 本阶段不执行）

> 以下为 Phase 3 待执行的精确改动点。**当前未写入任何文件。**

1. **新增 `router.js`**（cloudfunctions/chat/）：实现 `KNOWLEDGE_TYPES`、`PSYCH_RE`、`knowledgeTypeOf()`、`buildRoutingProfile()`。纯函数、零依赖、可单测。
2. **`rag.js` 改动（最小化）：**
   - `retrieve(query, limit, intentInfo)`：透传 `intentInfo` 到 `legacyRetrieve` / `kbRetrieve`（缺省 `intentInfo` 时行为不变，向后兼容）。
   - `legacyRetrieve(query, limit, intentInfo)`：在 score 计算处（L603 附近）`require('./router')` 并追加 `knowledgePriorityBoost`。
   - `rankChunks(query, chunks, limit, intentInfo)`：同步追加（KB 路径一致）。
   - 不改 `lexicalScore` / `frameTitles` / `SEMANTIC_LEX_MIN` / Prompt。
3. **`rag.js` `generateAnswer`（L1451）**：`retrieve(retrievalQuery)` → `retrieve(retrievalQuery, undefined, intentInfo)`。
4. **`intent.js`（可选，B 阶段）**：在 `DOMAIN_RULES` 追加心理学/认知偏差域，使 `domain` 原生携带 psych 信号（与 router 的 `PSYCH_RE` 二选一或并存）。
5. **部署**：5 个云函数重新上传并部署（用户易漏步骤，runbook 已记录）。

**改动量估计**：新增 1 文件（router.js，约 60 行）+ rag.js 改 3 处（约 +10 行）+ generateAnswer 改 1 行。完全符合"最小修改原则"。

---

## 11. Rollback Plan

- **改动性质**：全部为**加法**（新文件 + 函数参数透传 + 一个加法项），**不删除/不修改既有知识、不改 corpus.json、不换 embedding**。
- **回滚步骤**：
  1. `git revert` 或手动撤销 rag.js 3 处改动 + generateAnswer 1 行；删除 `router.js`。
  2. 重新部署 chat 云函数。
  3. 验证：`retrieve` 恢复 `retrieve(query, limit)` 旧签名，行为完全回到 Phase N-5 之前。
- **数据零风险**：无任何知识库 / 向量索引 / corpus 改动，回滚即"回到改动前"，无残留。
- **灰度建议**：Phase 3 先在隔离命名空间 `tests/pilot-n5/` 验 Regression，再小流量（或全量但可秒级 revert）上线。

---

## 12. Final Recommendation

1. **根因已坐实**：检索缺"知识路由"（G1 意图丢弃 + G3 无类型维度 + G5 无心理域），非知识质量问题，与 N-4 消融一致。
2. **方案可行且最小**：复用 `intent.js.knowledgePolicy` + `rag.js.frameTitles`，仅新增 Router Layer（检索前 Domain Gate）+ Rerank 因子（KnowledgePriority），把"产品意图"编码进排序，**不屏蔽任何知识，只重排**。
3. **预期达标**：`default` 桶把 psych 卡 −200 排底、经典 +60 优先 → 恢复 Classic Hit@3≥0.82 且 Intrusion=0；`psych` 桶把 psych 卡 +60 优先 → Benchmark Hit@3 维持 ≥0.95，心理学价值不损。
4. **执行纪律**：本阶段只分析与设计，**代码改动待评审通过（Phase 3）才落地**，且先在隔离命名空间用 N-4 的 50 题回归 + 4 挤出题（尤 #48）复验。
5. **建议下一步**：进入 Phase 3 —— 实现 `router.js` + rag.js 三处透传/追加，在 `tests/pilot-n5/` 跑 Regression，确认 Classic Hit@3≥0.82 / Intrusion=0 / Benchmark≥0.95 后，再考虑放行第二个知识对象（此前 N-4 因 Regression 失败保持 Pilot Testing，本方案正是其放行前提）。

---

## 附录 A · Router Registry 草案（不写入生产，供 Phase 3 参考）

```javascript
// router.js（Phase 3 新增）
const KNOWLEDGE_TYPES = {
  "哲学经典": ["论语","道德经","庄子","孟子","中庸","沉思录","爱比克泰德《手册》","柏拉图《申辩篇》","尼各马可伦理学"],
  "心理学理论": ["确认偏差概念卡"],
};
const PSYCH_RE = /(偏差|偏见|成见|先入为主|第一印象|确认|证实|选择性|只看|支持自己|别人针对|针对我|主观|客观|证据|反证|印证|固执|封闭|认知|判断自己|自己想法)/;
const MATRIX = {
  default: { "哲学经典": 60, "文学人生": 30, "案例": 10, "心理学理论": -200 },
  psych:   { "心理学理论": 60, "哲学经典": 30, "案例": 10 },
  emotion: { "哲学经典": 40, "心理学理论": 20, "文学人生": 10 },
  growth:  { "哲学经典": 30, "心理学理论": 20, "案例": 10 },
};
function knowledgeTypeOf(doc) { /* 见第 6 节 */ }
function buildRoutingProfile(intentInfo, query) { /* 见第 6 节 */ }
module.exports = { knowledgeTypeOf, buildRoutingProfile, KNOWLEDGE_TYPES };
```

## 附录 B · rag.js 改动 diff 草案（Phase 3 才应用）

```diff
--- a/cloudfunctions/chat/rag.js
+++ b/cloudfunctions/chat/rag.js
@@ const { classifyIntent } = require("./intent");
+const { buildRoutingProfile, knowledgeTypeOf } = require("./router");

-function legacyRetrieve(query, limit) {
+function legacyRetrieve(query, limit, intentInfo) {
   ...
-  const score = lexical + vectorScore * 24 + sourcePriority(item.doc) + preferredBoost;
+  const routing = buildRoutingProfile(intentInfo, query);
+  const kBoost = routing.typeBoost[knowledgeTypeOf(item.doc)] || 0;
+  const score = lexical + vectorScore * 24 + sourcePriority(item.doc) + preferredBoost + kBoost;
   ...
 }

-async function retrieve(query, limit) {
-  if (getProviderMode() === "kb") { ... return legacyRetrieve(query, limit); }
-  return legacyRetrieve(query, limit);
+async function retrieve(query, limit, intentInfo) {
+  if (getProviderMode() === "kb") { ... return legacyRetrieve(query, limit, intentInfo); }
+  return legacyRetrieve(query, limit, intentInfo);
 }

 // generateAnswer 内：
-    result = await retrieve(retrievalQuery);
+    result = await retrieve(retrievalQuery, undefined, intentInfo);
```

## 附录 C · 验收指标对照（用户第 13 节）

| # | 验收项 | 阈值 | 本方案机制 |
|---|---|---|---|
| 1 | Classic Hit@3 | ≥ 0.82 | default 桶 经典+60 / psych −200 |
| 2 | Concept Intrusion | 0 | 人生/关系/道德域 psych 卡排底 |
| 3 | Benchmark Hit@3 | ≥ 0.95 | psych 桶 psych+60 保留价值 |
| 4 | Citation 不下降 | — | 不改引用组装/准入逻辑 |
| 5 | Latency 增量 | < 20% | gate 为 O(1) 正则+查表 |
