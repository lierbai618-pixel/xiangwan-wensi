# 向晚问思（WenDao）Freshness Layer 实时信息能力 · 架构设计

> 角色：Release Manager + AI Reliability Architect + RAG Architect + Product Architect
> 形态：架构设计 / 路由评审 / 测试方案（**纯设计，零生产代码改动、零数据库改动、零知识库改动、未 commit / deploy**）
> 约束遵循：未修改 `corpus.json` / `intent.js` / `knowledgeRouter.js` / `rag.js`；未改 Prompt；未 ingest / embedding；未触碰 O-0.6 冻结基线。
> 状态：设计完成，**等待人工授权进入实施阶段**。

---

## 0. 总原则与现有架构关系（务必先读）

### 0.1 三条轨道已成型（代码注释即契约）
`cloudfunctions/chat/capabilities/index.js` 顶部已明确定义三层边界：

```
Capability Layer  实时事实   ← 已上线(Phase R)：time/weather/calculation/location，本地确定性计算，绕过 RAG
Freshness Layer   现实事件背景 → 供给五段式思辨（本设计强化的对象）
Knowledge Layer   经典知识     ← 冻结：corpus.json / RAG
```

### 0.2 关键修正（对用户分类的纠偏）
用户将「时间类 / 天气类 / 新闻热点 / 人物动态 / 产品影视活动」全部归为 Freshness Layer。
**架构上这是错误的合并**，原因：

- **时间类、天气类已由 Phase R Capability Layer 实现并上线**（`capabilities/router.js` 的 `time_query` / `weather_query`）。
- `index.js` 的派发顺序是 **Capability → Freshness → Knowledge**（L268→L281→L291）。「现在几点」「北京天气」在 Capability 阶段即被拦截，**根本不会到达 Freshness**。
- 若在 Freshness 再实现一遍时间/天气 = 重复实现 + 路由竞态 + 维护双份逻辑。

**结论：时间类、天气类留在 Capability Layer，本设计不重复实现。Freshness Layer 只强化 Capability 不覆盖的「需联网检索的实时类」。**

### 0.3 不重复造轮子：Phase Q `freshness` 模块已存在
`cloudfunctions/chat/freshness/` 已落地（Phase Q，默认关闭 `FRESHNESS_ENABLED`）：
- `eventClassifier.js`：四分类 A/B/C/D + 用户意图层
- `eventRetriever.js`：检索抽象，**当前 `provider=none`（无法真实取数）**
- `schema.js`：`CATEGORY` / `SOURCE_CONFIDENCE` / `makeEventContext`（带 TTL、强制 unknown_points）
- `responder.js`：五段式生成；`downgrade.js`：降级
- `index.js`：编排器，已接入 `index.js` 主流程

**本设计 = 在现有 Phase Q `freshness` 模块上扩展实时检索能力 + 升级 Category C 为「真实事实回答」，而非新建平行模块。**

---

## 1. 背景
- 真实用户已提出「付航最近怎么样」「某演员最近有什么消息」「今天有什么新闻」「某电影什么时候上映」等需求。
- 当前系统对这类问题要么走 RAG（答非所问），要么在 Phase Q Category C 被**保守降级为「反思邀请」而不给事实**（因 `provider=none`）。
- 产品不应输出「我的知识截止于……」「我无法联网……」——这是能力缺口，不是知识库缺陷。

---

## 2. 问题定义

| 维度 | 是否本质 | 判断 |
|------|----------|------|
| 数据问题 | ⚠️ 部分（缺实时检索通道） | 不是存量数据错了，是「当下事件/人物动态」从未被采集。属**架构/数据缺口**。 |
| 知识库问题 | ❌ 否 | 经典语料正确且无需更新；把新闻塞进永久语料引入时效衰减与偏见。**不修知识库。** |
| RAG 问题 | ❌ 否 | 既有 RAG 对经典检索正常；问题在「检索不到当下」。RAG 不背锅。 |
| Agent 能力问题 | ✅ 是 | 缺「识别实时诉求 → 合规检索 → 生成事实回答」的能力编排。 |
| 产品能力问题 | ✅ 是 | 用户已产生实时信息需求，产品当前不提供。 |

**结论：Agent/产品能力缺口，根因是缺失合规实时检索通道。解法 = 在 Freshness Layer 接入检索源，而非改 corpus/rag。**

---

## 3. 路由设计

### 3.1 三层派发（与现有代码一致）
```
用户输入
   │
   ▼ [1] Capability Layer（Phase R，已上线，最先判定）
   │     命中 time/weather/calculation/location → 本地确定性回答，绕过 RAG
   │     未命中 → null
   ▼ [2] Freshness Layer（Phase Q 模块，本设计扩展；FRESHNESS_ENABLED 控制）
   │     命中需联网实时类（新闻/人物/产品影视活动/热点思辨）→ 检索+生成
   │     未命中 / Category A / 危机 → null
   ▼ [3] Knowledge Layer（冻结 RAG）
         经典知识 → 五段式回答
```

### 3.2 实时问题分类（归属修正后）

| 类别 | 归属 | 处理 | 现状 |
|------|------|------|------|
| 时间类（现在几点/今天几号） | **Capability** | 本地计算 | ✅ 已上线，不动 |
| 天气类（北京天气/冷吗） | **Capability** | 本地+天气源（R-003 位置隐私为前置） | ✅ 已上线，不动 |
| 新闻热点（今天有什么新闻/某事件最新进展） | **Freshness** | 检索 + 事实回答（Category C 升级） | 🆕 本设计新增 |
| 人物动态（付航最近怎么样/某演员新作品） | **Freshness** | 检索 + 事实回答 | 🆕 本设计新增 |
| 产品/影视/活动动态（某电影上映/某活动最新） | **Freshness** | 检索 + 事实回答 | 🆕 本设计新增 |
| 热点思辨（XX事件说明了什么） | **Freshness** | 检索 + 五段式思辨（Category B） | 🟡 已有壳，待 provider |
| 经典/人生/哲学问题 | **Knowledge** | RAG + 五段式 | ✅ 冻结，不动 |

### 3.3 Freshness 内部子分类（在现有四分类上演进）
现有 `eventClassifier`：`A 原RAG` / `B 热点思辨` / `C 事实查询(当前降级)` / `D 敏感(安全降级)`。

本设计对分类器的扩展点（**仅设计，不在此阶段改代码**）：
1. **扩展锚点信号**，识别人物动态与产品影视活动：
   - 人物动态：`(付航|某演员|某明星|近况|动态|新作品|新剧|新综艺|新歌|巡演|签约|结婚|分手)` + 时间锚（最近/今年/近期）
   - 产品影视活动：`(电影|电视剧|综艺|专辑|演唱会|发布会|赛事|展览|开播|定档|上映|首映|开票)` + 时间锚
2. **Category C 升级为「事实检索+回答」**（核心变更，见 §3.4）。
3. Category B（热点思辨）保持五段式；Category D（敏感）保持安全降级。

> ⚠️ **待授权决策点 D1**：Phase Q0 政策原将 Category C 定为「事实边界+反思邀请（不给事实）」。本设计将其升级为「检索并给出事实回答」。这是产品策略转向（从「只思辨不给事实」到「也给事实」），需用户在实施授权时明确签字。C 类检索失败仍降级为反思邀请（不编造）。

### 3.4 Category C 升级行为（设计态）
```
用户事实查询（付航最近怎么样 / 某电影什么时候上映）
   │
   ▼ eventClassifier → Category C（事实检索子类）
   ▼ eventRetriever.retrieveEventFacts(mention)   ← 接真实 provider
   │     失败/无源 → downgrade（反思邀请 + 不编造）
   ▼ factExtractor.extractFacts（Fact/Interpretation 隔离）
   ▼ responder.generateFactualAnswer（"根据最新公开信息…" 格式，见 §6）
   ▼ 返回 result { mode:'freshness', freshness:{category:'C',...} }
```

### 3.5 与现有模块的集成点（实施阶段落点，本阶段仅标注）
| 改动点 | 文件 | 说明 |
|--------|------|------|
| 分类器扩展 | `freshness/eventClassifier.js` | 新增人物/产品影视锚点；Category C 标记 `factual` 子类 |
| 检索源接入 | `freshness/eventRetriever.js` | `provider` 由 none → 合规搜索/新闻 API（Phase Q2 选型） |
| 事实回答生成 | `freshness/responder.js` | 新增 `generateFactualAnswer`（区别于 `generateFreshnessAnswer` 思辨） |
| 主流程开关 | `index.js` | 复用 `FRESHNESS_ENABLED`；建议新增 `FRESHNESS_FACTUAL_ENABLED` 子开关，单独控 C 类事实回答，便于灰度 |
| 观测 | `observability/observabilityLogger.js` | **已具备** `freshness` 字段（category/event_status/source_confidence/downgraded…），无需改 |

---

## 4. 数据隔离（实时结果生命周期）
**铁律（与 Phase Q 一致，须在执行态强化）：**
- 实时数据**只用于当前回答**，回答结束即结束。
- **禁止**写入 `corpus.json`；**禁止** embedding；**禁止**进入长期知识库；**禁止**改变经典资料权重。
- 事实以 `event_context`（带 TTL，默认 6h）临时存在于单次会话上下文，**过期即失效，绝不沉淀**。
- 现有 `schema.makeEventContext` 已强制 `unknown_points` 必填 + `status`/`sources` 校验，是防编造的结构性保障，本设计沿用。

```
用户问题 → 检索 → 生成回答 → 结束
（event_context 仅会话内 ephemeral，不入语料、不入向量库）
```

---

## 5. 隐私边界
1. **出站脱敏**：用户 query 在发往外部检索源前，须经 `security/piiScrub.mask()` 脱敏（复用现有函数，不新增）。严禁明文 openid / 手机号 / 身份证进入第三方。
2. **入站不落原始响应**：外部检索返回的原始网页/摘要文本**不得**写入 `logs` / `question_logs` / `observability_logs`。落库只保留：`event_id` / `status` / `source_confidence` / **来源 URL 列表** / 经抽取的中立事实摘要（无 PII）。
3. **位置隐私（R-003 硬性前置）**：天气类已在 Capability，其位置分支依赖客户端授权；前端 `chat.js` 当前不传 location，故 Phase R 天气位置分支不可达。Freshness 不引入新位置采集。
4. **合规降级**：政治、悲剧消费、未核实谣言等（Category D / boundaryCheck RESTRICTED）禁止检索、禁止生成 event_context，走安全降级。对「备案审核中」的小程序尤为关键。
5. **`logs` 既有敞口（OBS-009-C，待 CR-006 处置）**：`logs` 存明文 openid + 明文提问 + 明文完整答案，是标识与原文同表共存的最严重实例。本设计不扩大其采集范围，且 Freshness 回答同样经 `piiScrub.mask` 后落 `logs`（与现状一致），不在本阶段新增风险。

---

## 6. 回答风格要求
### 6.1 事实类（Category C：新闻/人物/产品影视）
- **禁止**输出模型能力限制说明：「我的知识截止于……」「我无法联网……」一律不得出现。
- **采用**「根据最新公开信息……」框架，结构：
  1. 最新事实摘要（2-4 句，可核实，引用来源）
  2. 时间说明（信息截至时间）
  3. 信息来源时间（来源发布时间 / 检索时间）
  4. 必要的不确定性说明（若来源弱/冲突/过期，明确标注「信息可能不完整，以近期官方渠道为准」）
- 示例（用户原问「付航最近怎么样？」）：
  > 根据最新公开信息，付航在《喜剧之王单口季》之后持续参与单口喜剧相关演出与综艺活动。关于 2026 年的最新演出与作品安排，公开渠道信息有限，以上梳理基于近一年可查的公开报道，具体以近期官方票务与工作室发布为准。

### 6.2 思辨类（Category B：热点事件「说明了什么」）
- 保留五段式（理解→分析→行动→经典→思考）。
- 事实仅作入口，经典映照为主体；不对可识别个人做道德定性；多视角、不站队。
- 仍须标注信息来源与时间（§6.1 的 2/3/4 同样适用）。

### 6.3 全局护栏（沿用 Phase Q）
- 事实只能来自检索源（带 source/url），**禁止从模型参数记忆生成事件**；无来源 → 澄清反问/降级，不编造。
- 低置信 / 信息冲突 / 过期 → 降级并提示，绝不陈述为确定事实。

---

## 7. 测试方案
### 7.1 预期路由矩阵（按修正后架构）

| # | 问题 | 预期路由 | 说明 |
|---|------|----------|------|
| F1 | 现在是什么时间？ | **Capability**（time_query） | 已在 Phase R 上线，非 Freshness |
| F2 | 今天有什么新闻？ | **Freshness**（Category C 事实） | 🆕 本设计新增 |
| F3 | 付航最近怎么样？ | **Freshness**（Category C 事实） | 🆕 本设计新增；当前被误降级 |
| F4 | 某电影什么时候上映？ | **Freshness**（Category C 事实） | 🆕 需扩展产品影视锚点 |
| F5 | XX 事件说明了什么？ | **Freshness**（Category B 思辨） | Phase Q 已有壳 |
| R1 | 庄子怎么看自由？ | **Knowledge**（RAG） | 冻结路径 |
| R2 | 论语如何看学习？ | **Knowledge**（RAG） | 冻结路径 |
| R3 | 如何面对失败？ | **Knowledge**（RAG） | 冻结路径 |
| C1 | 时间的意义是什么？ | **Knowledge**（RAG） | Capability 硬否决（veto），不透传工具层 |

### 7.2 Freshness 测试集（目标断言）
- **F1~F5** 均不应进入 RAG，不应触发知识检索（`retrieval.totalDocuments` 在 capability/freshness 路径应为 0）。
- **F2~F4** 回答须含「根据最新公开信息」且含来源时间说明；**禁止**出现「知识截止/无法联网」。
- **F5** 回答须为五段式且含经典映照。
- 检索失败（provider 异常/无源）时，F2~F4 须**降级为反思邀请**，不得编造事实。

### 7.3 RAG 测试集（目标断言）
- **R1~R3** 必须命中 RAG（corpus 召回），五段式保持，answer 来自经典语料。
- 知识问题**不得**调用外部搜索（Freshness 路径 `freshness == null`）。

### 7.4 隔离验证（核心不变量）
- **实时问题不进入知识库**：连续运行 F 集后，校验 `corpus.json` SHA256 不变、`rag.js` 不新增 embedding 调用。
- **知识问题不调用搜索**：运行 R 集时，检索源 mock 须记录 0 次出站调用。
- **PII 不泄露**：向检索源发出的 query 经 mask，断言不含明文手机号/身份证；落库观测记录不含外部原始响应。

### 7.5 回归保护
- 既有 Capability 75/75 用例、Phase Q 32/32 + 120/120 用例须全绿（本设计不改这些路径）。
- 冻结四资产 SHA256 全程恒定。

---

## 8. 实施限制与待授权项（本阶段不执行）
**本阶段仅设计。** 进入实施前需用户逐项授权：
- **A1**：是否同意「时间/天气留在 Capability，不并入 Freshness」（架构纠偏）。
- **D1（§3.3）**：是否同意 Category C 从「反思邀请」升级为「检索+事实回答」。
- **P1（Phase Q2 遗留）**：检索源选型与接入（合规搜索/新闻 API、密钥、配额、成本）——属独立实施任务，需单独授权与配置，**不在本设计内实现**。
- **R1（R-003）**：天气位置隐私前置仍 BLOCKED，Freshness 不新增位置采集，故不受影响。
- **开关策略**：复用 `FRESHNESS_ENABLED`；建议新增 `FRESHNESS_FACTUAL_ENABLED` 子开关，先开放 B（思辨）后开放 C（事实），控制爆炸半径。
- **冻结资产**：实施若需微调分类规则，仍只改 `freshness/*` 与 `capabilities/*`（均非四冻结资产）；`corpus/intent/rag/router` 保持 SHA 不变，除非单独授权。

---

## 9. 不变量与冻结资产声明
- 四冻结资产（`corpus.json` / `intent.js` / `knowledgeRouter.js` / `rag.js`）本设计**零改动**，SHA256 守门持续有效。
- 经典语料在 Freshness 路径被**复用**（检索+引用），不被改写、不被新闻污染。
- 任何生产落地须遵循 CR 立项规范（Observation-SOP §3）：Hypothesis → Evidence → Decision，禁止基于「疑似」直接实施。
- 本文件为架构设计产物，未改动任何代码 / Prompt / 资产 / 数据库，未执行 commit / deploy。

---
*关联文档：Observation-SOP.md（观测方法修正）、CR-009-DiagnosisReport.md（logs 健康证据）、PhaseQ-FreshnessLayer-Design.md（Phase Q 原始设计）、docs/PhaseR-*（Capability Layer 上线记录）。*
