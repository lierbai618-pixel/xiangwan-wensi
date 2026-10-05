# Phase Q2 架构设计冻结 · 三模式智能升级

> 版本：v1.0（设计冻结稿，禁止代码修改）
> 状态：Phase Q2-0（架构设计评审）
> 依据：用户《向晚问思（WenDao）· Phase Q2 联网与三模式智能升级计划书》v1.0
> 关联基线：Phase Q1-B（Freshness B 类反思增强已上线）、Phase R（Capability 时间/天气）、Phase P+（可观测）

---

## 1. 当前架构基线（代码实证）

以下结论基于对 `cloudfunctions/chat/` 实际代码的读取，非假设。

### 1.1 主派发链（index.js）
```
用户输入(message, mode, history)
   │
   ├─[L21] FRESHNESS_ENABLED 开关（默认 false，true 才加载 freshness 模块）
   ├─[L24] FRESHNESS_FACTUAL_ENABLED 开关（默认 false，仅透传门控）
   ├─[L39] CAPABILITY_ENABLED 开关（默认 true）
   │
   ▼ 派发顺序（确定性优先）
  ① Capability 旁路（capabilityMaybeHandle）  —— 时间/天气/计算/位置，命中即返回，绕过 RAG
  ② Freshness 旁路（freshnessMaybeHandle）     —— B/C/D 类接管；返回 null（A类/危机）→ 直落原链路
  ③ Knowledge 兜底（generateAnswer）           —— RAG + 五段式，冻结链路唯一兜底
```

### 1.2 Freshness 现状（freshness/index.js，Q1-B 状态）
- `maybeHandle` 四分类：A（原 RAG，返回 null）/ B（热点思辨）/ C（事实查询）/ D（受限降级）。
- B 类在 `FRESHNESS_FACTUAL_ENABLED=false` 或 `provider=none` 时：**跳过检索**，以 `eventContext:null` 调 `responder.generateFreshnessAnswer` → 产出「诚实边界 + WenDao 反思」（冷降级已升级为思辨增强）。
- **D-a 反幻觉硬闸已在位**：`detectFabrication()` 命中虚构事实签名（如 `2026年出演某作品`）即降级不交付。
- `eventRetriever.getProviderName()` 已存在，当前返回 `none`。
- `citations` 字段已在 result 形状中预留（当前 B/C 为空数组）。

### 1.3 前端模式管线（miniprogram/pages/chat）
- `chat.js` 已定义 `modes = [{key:"plain"},{key:"deep"},{key:"classic"}]`，`data.mode:"plain"`。
- `index.js` 已把 `mode` 透传给 `generateAnswer(message,{mode,...})` → 影响 `rag.js` 的 `ROLE_PROMPT` 动态输出格式（L277 起）。
- **结论：用户可选择的「回答模式」管线已存在**，Q2 的三模式是沿此管线升级语义，而非从零新建。

### 1.4 冻结资产（Q2 全程禁止修改）
`corpus.json` / `intent.js` / `knowledgeRouter.js` / `rag.js`。SHA 以 `Freshness-Q1-B-ImplementationReport.md` 记录的 `4fb2dca4…`（rag.js 实测值）为基线，每次阶段结束比对 4/4 MATCH。

---

## 2. 目标架构：Intelligent Router + 三模式

```
                    用户问题 + answerMode(可选)
                            │
                            ▼
                   Intelligent Router
        （answerMode 显式指定 → 走对应管线；未指定 → 默认 Think）
                            │
     ┌──────────────┬───────┴────────┬──────────────┐
     ▼              ▼                 ▼              ▼
  Capability     Fast 模式        Deep 模式       Think 模式
  (不变)        (快答)           (深思)           (问思)
  时间/天气       Search            RAG               Search
  计算/位置       Provider          only              Provider
  位置能力        ↓                 ↓                 + RAG
                 concise          五段式              + Reasoning
                 +citation        WenDao             Engine
                                   (现有链路)          (事实+知识+思想)
```

### 关键设计决策
**Q2 不替换 Freshness，而是把「是否联网」上升为用户可控的 `answerMode` 维度**，并在后端 `FRESHNESS_FACTUAL_ENABLED=true` 时把真实检索源接入 Freshness 的 B/C 链路。

| 计划书模式 | 映射后端管线 | 与现有代码关系 |
|---|---|---|
| **Fast 快答** | Search Provider → 摘要+引用（不走 RAG） | = Freshness C 事实链路 + 真实 provider，关闭 RAG 深度 |
| **Deep 深思** | RAG only（五段式 WenDao） | = 现有 Category A / `generateAnswer` 链路，等价于「不触发 Freshness」 |
| **Think 问思** | Search + RAG + Reasoning | = Freshness C 事实 + `rag.js` + responder 思辨（D1 升级路径的完整形态） |

---

## 3. 新增模块（Q2-1~Q2-3 落地，本阶段仅设计）

### 3.1 Search Provider Layer（Q2-1）
```
cloudfunctions/chat/providers/search/
   index.js      // 统一接口 + provider 路由 + 缓存/限流/降级
   bing.js       // Azure Bing Web Search（候选）
   tavily.js     // Tavily（候选，专为 LLM 优化）
   serp.js       // SerpAPI（候选）
   mock.js       // 测试用假源（返回固定结构，零外网）
```
统一契约（详见 Search-Policy.md）：
```js
async function search(query, opts) ->
  { ok, results: [ { title, url, snippet, source, time } ], reason, provider }
```

### 3.2 answerMode Router（Q2-2）
新增 `cloudfunctions/chat/answerMode.js`：
- 输入 `answerMode`（fast/deep/think）+ `query` + `intent`。
- 输出「管线指令」：`{ pipeline: 'search'|'rag'|'search+rag', useRAG, useSearch }`。
- 未指定 `answerMode` 时默认 `think`（风险策略 §风险2）。
- 与现有自动路由的关系：当 `answerMode` 显式指定，**覆盖** Freshness 自动分类的 B/C 决策（例如用户选 Fast 问「庄子怎么看自由」，仍走 search——但此场景罕见，可在前端用文案引导「该问题更适合深思」）。

### 3.3 问思融合引擎（Q2-3）
```
Search Result → Fact Extractor → Knowledge Retrieval(rag) → Reasoning Prompt → Answer
新增：事实摘要 / 冲突检测 / 引用管理 / 幻觉检测（复用 D-a fabrication gate）
```
- Fact Extractor：复用 `freshness/factExtractor.js`（已存在 `extractFacts`）。
- Knowledge Retrieval：复用 `rag.js` 的检索（不改，只调用）。
- Reasoning Prompt：在 `responder` 现有「事实+反思」模板上扩展为「事实层 / 知识层 / 思想层」三段（不修改 `rag.js` 的 `ROLE_PROMPT` 常量，由 `freshness/responder.js` 组合）。

---

## 4. answerMode 与现有 mode 字段的关系（必须澄清）

当前前端 `mode`（plain/deep/classic）是 **RAG 回答深度**维度；Q2 的 `answerMode`（fast/deep/think）是 **是否联网**维度。二者正交。

**设计取舍（待 Q2-2 确认）**：
- 方案 A（推荐）：新增独立请求字段 `answerMode`（fast/deep/think）作为顶层模式；现有 `mode`（plain/deep/classic）保留为 Deep/Think 模式下的「RAG 深度」子开关。
- 方案 B：直接复用 `mode` 字段，键集改为 fast/deep/think，丢弃 plain/classic 语义。

→ 推荐 **方案 A**：向后兼容现有 `mode` 管线，新维度不污染已稳定的 RAG 深度逻辑；前端选择器展示 `answerMode`，Deep/Think 内部可再展开深度档（Q2-2 二期）。

---

## 5. 与双开关的关系

| 开关 | 当前 | Q2 角色 |
|---|---|---|
| `FRESHNESS_ENABLED` | 默认 false | L1 总闸：false 时整层摘除，三模式退化为纯 RAG（Deep）。 |
| `FRESHNESS_FACTUAL_ENABLED` | 默认 false | 事实源闸：**true 时** Search Provider 才被 Freshness C / Think 调用。Q2-1  wiring 完成后方可置 true。 |
| `SEARCH_PROVIDER`（新增，Q2-1） | `none` | 选择 bing/tavily/serp/mock；`none` 时维持 Q1-B 的「无事实源反思」行为。 |

> 铁律：Q2-0 不修改任何开关值、不写环境变量、不部署。

---

## 6. 端到端数据流（Think 模式示例）

```
用户选「问思」→ 前端发 { message, answerMode:"think", mode:"deep", history }
  → index.js 收到 answerMode
  → answerMode.js 解析 → { useSearch:true, useRAG:true }
  → 若 Capability 命中(时间/天气) → 仍走 Capability（不联网查天气，沿用 R-001 修复）
  → 否则：
      ① Search Provider.search(query) → 事实结果（请求级，不落 KB）
      ② rag.js 检索经典知识（只读调用）
      ③ Reasoning Prompt 组合「事实+知识+思想」→ 生成
      ④ D-a fabrication gate 校验
      ⑤ 引用(citations) 注入 result
  → 出参安全检测(checkTextSafety) → 观测落库(logObservation，citations 进 observability_logs，不进 corpus)
```

---

## 7. 冻结资产边界与回滚

- **禁止修改**：corpus.json / intent.js / knowledgeRouter.js / rag.js / embedding / 现有 Prompt 常量。
- **可修改（Q2-1 起）**：`index.js`（新增 `SEARCH_PROVIDER` 读取 + answerMode 解析）、`freshness/index.js`（C 类在 `factualEnabled` 时进真实检索）、新增 `providers/`、`answerMode.js`、`freshness/responder.js`（扩展三段模板，不改 rag.js）。
- **回滚层级**：L0 文件级 `.bak`；L1 `FRESHNESS_ENABLED=false` 或 `FRESHNESS_FACTUAL_ENABLED=false` 免部署熔断；L2 部署回滚；L3 重建。

---

## 8. 风险与开放决策（进入 Q2-1 前必须人工确认）

| 项 | 状态 | 阻塞 Q2-1？ |
|---|---|---|
| 搜索供应商选择 + API 密钥 | **未定**（P1 OPEN） | 是 |
| 跨境数据/内容合规（备案审核中状态） | 需法务/平台确认 | 是 |
| 搜索成本预算与限流配额 | 未定 | 否（可先 mock） |
| 前端选择器方案 A/B | 待确认 | 否（设计层可定 A） |
| 默认模式 = Think | 已定（计划书 §风险2） | 否 |

> 结论：本阶段（Q2-0）仅冻结设计。Q2-1 开发在「供应商+密钥+合规」三项确认前**不得开始**——否则将出现无凭证的伪集成。
