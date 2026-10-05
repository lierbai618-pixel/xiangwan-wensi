# Phase N-5（一）架构分析 · Architecture Analysis（只读）

> 阶段定位：**Phase 1 — 只读分析**。本文件仅描述 `cloudfunctions/chat/` 的**真实**检索链路，未修改任何代码、未提交、未 ingest、未 embedding。
> 配套主交付：`docs/59-Phase-N5-Knowledge-Routing-Optimization.md`（Phase 2 设计）。
> 前置：Phase N-4 Real Controlled Pilot（docs/58）。

---

## 0. 零扰动声明

| 文件 | 本次操作 | 状态 |
|---|---|---|
| `cloudfunctions/chat/intent.js` | 只读 | 未改 |
| `cloudfunctions/chat/rag.js` | 只读 | 未改 |
| `cloudfunctions/chat/corpus.json` | 只读 | 未改（含 Phase G 遗留未提交 tags 扩展，非本阶段引入）|
| `cloudfunctions/chat/index.js` | 未读取 | — |
| 任何云函数 / 知识库 | 未部署 | — |

本阶段**不触碰生产资产**。所有结论来自对当前 `git` 工作区文件的逐行读取。

---

## 1. 代码资产清单（含行号，便于复核）

| 文件 | 行数 | 关键符号 | 角色 |
|---|---|---|---|
| `intent.js` | 292 | `classifyIntent()` · `DOMAIN_RULES` · `HARD_FACT_DOMAINS` · `KNOWLEDGE_DOMAINS` · `PHILO_FORMAT_DOMAINS` | **意图理解层**：问题 → `domain` / `knowledgePolicy`(skip·optional·use) / `format` |
| `rag.js` | 1534 | `generateAnswer()` · `retrieve()` · `legacyRetrieve()` · `kbRetrieve()` · `rankChunks()` · `frameTitles` · `inferQueryFrame()` · `lexicalScore()` · `getProviderMode()` | **检索 + 回答层**：编排意图→检索→Prompt→LLM |
| `corpus.json` | 16（14 条）| `tags` · `question_bridge` · `source` · `title` | **经典语料**（legacy 路径数据源）|
| `actionLibrary.js` | — | 行为库（本阶段不涉及）| — |

---

## 2. 当前检索流程（真实还原）

用户问题进入 `generateAnswer(query, opts)`（rag.js L1415）后，实际执行顺序如下：

```
用户问题 query
  │
  ├─ rewriteQuery(query, history)              [E-1 追问重写]
  │     → retrievalQuery（自足检索句）
  │
  ├─ analyzeQuery(query, history)              [问题理解层]
  │     → analysis（情绪/主题/策略，供 Prompt 使用）
  │
  ├─ classifyIntent(rw.followUp ? retrievalQuery : query, history)   ★ intent.js
  │     → intentInfo = { type, domain, knowledgePolicy, format, keywords, crisis, reason }
  │
  ├─ if intentInfo.knowledgePolicy !== "skip":
  │     result = await retrieve(retrievalQuery)   ★★★ 注意：只传 query，未传 intentInfo
  │       │
  │       └─ getProviderMode()  → 默认 "legacy"（KB_MODE 未设为 kb）
  │             │
  │             ├─ legacyRetrieve(query, limit)        【当前激活路径】
  │             │     ├─ tokenize(query) → baseTerms
  │             │     ├─ bridgeTerms(query) → bridged（概念桥扩展）
  │             │     ├─ terms = base ∪ bridged
  │             │     ├─ inferQueryFrame(query) → frame（7 类）
  │             │     ├─ preferredTitles = frameTitles[frame]
  │             │     └─ 对每篇 corpus 文档打分：
  │             │           score = lexical + vectorScore*24 + sourcePriority + preferredBoost
  │             │           （preferredBoost = 命中 frameTitles ? 100 : 0）
  │             │           semantic = lexical >= 4   ← 引用准入门槛（只看词面）
  │             │           vectorScore = TF 余弦（termFrequency(tokenize(text))，非真实 embedding）
  │             │
  │             └─ kbRetrieve(query, limit)           【未激活，需 KB_MODE=kb】
  │                   └─ fetchAllChunks()（云库 chunks 集合）
  │                         → rankChunks()：score = lexical + vectorScore*24
  │                           （同样 TF 余弦，无 frameTitles 偏置、无 sourcePriority）
  │
  ├─ if knowledgePolicy === "optional":
  │       仅保留 lexicalScore >= 12 的强相关（宁缺毋滥）
  │
  ├─ enrichCitations(citations, analysis)
  ├─ buildRoute(retrievalQuery, citations)
  └─ tryModelAnswer(query, citations, ..., intentInfo)   [Prompt 组装 + 多模型]
        → 最终回答（含 5 段式 / format 决定的结构）
```

**关键事实：**

1. **意图在检索前被丢弃**。L1441 算出的 `intentInfo`（含 `domain`/`knowledgePolicy`）在 L1451 调用 `retrieve(retrievalQuery)` 时**未传入**。`retrieve` 的签名是 `retrieve(query, limit)`，内部 `legacyRetrieve`/`kbRetrieve` 完全看不到 domain。→ **检索器对意图/领域是盲的**，这正是"知识竞争问题"的结构性根因之一。
2. **存在两套并行的"意图分类器"，且不对齐**：
   - `intent.js.classifyIntent` 产出 `domain`（15 类：哲学/人生/道德/社会/情绪/关系/成长/职业/编程/数学/科技/健康/事实/学习/生活）。
   - `rag.js.inferQueryFrame` 另起炉灶，用不同正则产出 `frame`（7 类：emotion/longTerm/investigation/learning/contradiction/practice/general）。
   两者无任何共享映射，`frame` 用于 `frameTitles` 偏置，`domain` 仅用于 Prompt 格式与是否检索的开关——**domain 从未进入打分**。
3. **两条 Provider 路径都用 TF 余弦，均非真实 embedding**：
   - legacy：`vectorScore = cosine(queryVector, item.vec)`，其中 `item.vec = termFrequency(tokenize(text))`（L527）。
   - kb：`cosine(queryVector, termFrequency(tokenize(chunkSearchText(chunk))))`（L748）。
   - 即 Phase N-4 所说的"扁平全局向量检索"在**生产态实际是 TF 词频余弦**；N-4 pilot 的真实 DashScope embedding 仅存在于隔离产物 `tests/pilot-n4/`，未接入生产。
4. **唯一"优先级"机制是 `frameTitles` 的 +100 偏置**（L602），它是**按查询形态（frame）**而非**按知识类型/领域**赋权的。它与"人生关系类应优先哲学经典"这种产品意图无关。

---

## 3. 意图层现状（intent.js）

`classifyIntent` 返回结构（L159-173 注释 + L267-277 实现）：

| 字段 | 取值 | 当前用途 |
|---|---|---|
| `type` | knowledge / life / emotion / growth / opinion | 回答类型标签 |
| `domain` | 15 类之一 或 "通用" | **仅**决定 `format` 与是否进入知识增强开关 |
| `knowledgePolicy` | `skip` / `optional` / `use` | 是否检索 + 检索后过滤强度 |
| `format` | technical / general / philosophy / emotion | 输出结构（5 段 or 4 段）|
| `keywords` | string[] | 日志/扩展 |
| `crisis` | boolean | 危机拦截 |

**缺口 A — 无"心理学/认知偏差"域**：`DOMAIN_RULES`（L36-98）覆盖了哲学、人生、道德、社会、情绪、关系、成长、职业、编程、数学、科技、健康、事实、学习、生活，**唯独没有认知心理学 / 认知偏差域**。因此"为什么我总认为别人针对我？""我是不是有确认偏差？"这类问题，当前无法被识别为"应优先心理学理论"的域——最多落到 `人生`/`情绪`/`通用`，最终走哲学经典优先。这是 Domain Gate 必须补的检测器。

**缺口 B — `domain` 不进检索**：如上，domain 只用于 Prompt 开关，打分函数收不到。

---

## 4. 检索评分现状（legacyRetrieve，L587-670）

逐行拆解当前 `score`（L603）：

```
score = lexical
      + vectorScore * 24          // TF 余弦，仅同帧内排序参考，非引用准入
      + sourcePriority(doc)       // imported ? 2 : 0（公版经典恒为 0）
      + preferredBoost            // frameTitles[frame] 命中 ? 100 : 0
```

- `lexicalScore`（L552-565）：遍历 `queryTerms`，对 `doc.doc.tags` 精确命中 +12 / 部分命中 +7，再对 `title`+6 / `section`+5 / `summary`+4 / `text`+3 / 全文 +1。**只读取 `tags`，不读 `question_bridge`**。
- 引用准入：`semantic = lexical >= 4`（L608），低于此的文档即使被 `frameTitles` 偏置 +100 也**不能**进入 `relevant` 池（L624），仅能在不足 `limit` 时以 `lex>=2` 补位（L642，且明确排除 lex=0 纯偏置项）。
- 两级召回：先 `preferredRanked`（命中 frameTitles）再 `fallbackRanked`（L625-627）。

**结论**：当前系统里，"优先哪类知识"的唯一旋钮是 `frameTitles`（按查询形态），它**完全不知道知识对象的类型**（哲学经典 vs 心理学理论 vs 案例）。这正是 N-4 中 P-04 概念卡能挤掉《论语》的结构性原因——两者在同一 `score` 公式里用同一套 `lexical + TF余弦`，谁词面更贴近谁就上，没有任何"产品意图权重"。

---

## 5. corpus.json 元数据结构

每条 entry 字段（以 `daxue` 为例，L4）：

| 字段 | 示例 | 是否被检索使用 |
|---|---|---|
| `id` / `title` / `year` / `source` / `section` | `大学` / 《大学》·经 | `title`/`section` 参与 `lexicalScore`；`source` 不进打分 |
| `text` / `summary` | 原文 + 现代释义 | 参与 `lexicalScore`（+3/+4）与 TF 向量 |
| `tags` | `["修身","自律","成长",…]` | **核心打分字段**（精确+12/部分+7）|
| `modernUsage` / `caution` | 现代用法/提醒 | 仅进 `documentText`（L511），间接影响 TF 向量 |
| `question_bridge` | `{concepts, user_phrases, maps_to}` | **死字段**：`lexicalScore` 不读取（L556-557 仅遍历 `doc.doc.tags`）。Phase G 加入，至今未被任何代码消费 |

**关键事实：**
- corpus.json **没有任何 `knowledge_type` / `category` 字段**来区分「哲学经典 / 心理学理论 / 文学人生 / 案例」。知识类型只能从 `title`/`source`（如 "论语"=哲学经典、"确认偏差概念卡"=心理学理论）**派生**。
- 因此 Phase N-5 的 **Knowledge Priority Matrix 不能依赖 corpus 内容改动**（最高原则禁止改 corpus.json），而必须建立在**新增的路由配置（Router Registry）**上——用 `title`/`source`（既有 metadata）映射到知识类型。**这正好落在"允许：使用已有 metadata / 增加检索前策略层"的范围内。**

---

## 6. 五大架构缺口（Routing Gap 总结）

| # | 缺口 | 位置 | 对 N-4 回归的影响 |
|---|---|---|---|
| G1 | **意图在检索前被丢弃** | rag.js L1451 `retrieve(retrievalQuery)` 未传 `intentInfo` | 检索器无法按 domain 偏置，经典与概念卡等同竞争 |
| G2 | **双分类器错位** | `intent.domain`（15类）vs `rag.inferQueryFrame`（7类 frame）无映射 | frameTitles 偏置与产品意图（"人生关系优先经典"）错配 |
| G3 | **无知识类型属性** | corpus.json 无 `knowledge_type`；score 公式无 type 维度 | 无法表达"哲学经典 > 心理学理论"的优先级 |
| G4 | **死字段未利用** | `question_bridge` 不被 `lexicalScore` 读取 | 既有主动映射能力闲置（可作为 router 的输入之一）|
| G5 | **无认知心理域** | `intent.js DOMAIN_RULES` 缺心理学/认知偏差类 | "总认为别人针对我"无法路由到心理学优先 |

---

## 7. 结论（导向 Phase 2 设计）

Phase N-4 的 Regression 失败，根因确为 **Flat / Domain-Blind Retrieval**（与消融实验结论一致），但在**生产代码层面**它更精确地表现为：**意图层已算出 domain，却在检索边界被丢弃（G1），且检索公式无任何知识类型维度（G3）**，导致 P-04 概念卡与哲学经典在同一 `lexical + TF余弦` 池里无差别竞争。

修复方向（不违反最高原则）：
- **复用** `intent.js.classifyIntent` 的 `domain` + `knowledgePolicy` 作为路由输入（不新建平行系统）。
- **复用** `rag.js.frameTitles` 的偏置机制，将其从"按 frame"升级为"按 domain × knowledge_type"的 Priority Matrix。
- **新增** Router Layer（检索前策略层）：把 `intentInfo` 透传到 `retrieve`→打分，并补齐 G5 的认知心理检测器；用 Router Registry（config，不改 corpus）把 `title`/`source` 映射为知识类型。
- **新增** Rerank 因子 `KnowledgePriority`（不重写打分引擎，仅在现有 `score` 上追加一项）。

详见 `docs/59-Phase-N5-Knowledge-Routing-Optimization.md`。
