# Phase Q2-1-B Implementation Report · 三模式联网能力工程化骨架

> 版本：v1.0
> 状态：**完成（未部署，等待下一阶段授权）**
> 角色：Chief AI Architect / Backend Engineer / RAG Architect / Release Guardian
> 依据：用户《Execution: Phase Q2-1-B》授权 + 计划书 v1.0 + Q2-0 四份设计文档
> 铁律：禁止部署、禁止修改 corpus.json / intent.js / knowledgeRouter.js / rag.js、所有真实搜索保持关闭（SEARCH_PROVIDER=mock）

---

## 1. 概述

在 Phase Q2-0 设计冻结基础上，落地**三模式联网能力的工程化骨架**：Search Provider 抽象层、mock provider、answerMode 路由、ThinkContext 数据结构、离线测试框架。

**核心结论**：本阶段交付的是" plumbing（管线）"——所有真实搜索默认关闭，`FRESHNESS_FACTUAL_ENABLED` 仍为 `false`，`SEARCH_PROVIDER=mock`，因此**生产行为相对 Q1-B 零变化**；测试通过"强制激活"（测试内临时置 `factualEnabled=true` + `SEARCH_PROVIDER=mock`）证明布线连通，但 mock 永不服务真实用户。

---

## 2. 修改文件清单

### 新增文件（8 个，均为非冻结资产）
| 文件 | 作用 |
|---|---|
| `cloudfunctions/chat/providers/search/index.js` | Search Provider 统一抽象层：路由 + 缓存 + fail-soft + `getProviderName()` |
| `cloudfunctions/chat/providers/search/util.js` | 共享工具：`normalizeResult` + Node16 `httpPostJson/httpGetJson`（复用 `eventRetriever.nodeFetch`） |
| `cloudfunctions/chat/providers/search/mock.js` | Mock 检索源（确定性 `[MOCK]` 占位数据，零外网，仅测试/联调） |
| `cloudfunctions/chat/providers/search/bing.js` | Azure Bing 源骨架（无密钥 → `ok:false`，惰性） |
| `cloudfunctions/chat/providers/search/tavily.js` | Tavily 源骨架（无密钥 → `ok:false`，惰性） |
| `cloudfunctions/chat/providers/search/serp.js` | SerpAPI 源骨架（无密钥 → `ok:false`，惰性） |
| `cloudfunctions/chat/answerMode.js` | 三模式路由解析：fast/deep/think，默认 think |
| `cloudfunctions/chat/thinkContext.js` | ThinkContext 请求级 ephemeral 融合上下文（事实层+知识层+思想层） |
| `scripts/test_q21b.js` | 离线验证套件（37 断言） |

### 修改文件（2 个，最小侵入）
| 文件 | 改动 |
|---|---|
| `cloudfunctions/chat/index.js` | ① 新增 `SEARCH_PROVIDER` 只读 const（默认 `mock`）；② 解析 `answerMode`（默认 `think`）；③ 透传 `answerMode`+`searchProvider` 到 `freshnessMaybeHandle` |
| `cloudfunctions/chat/freshness/index.js` | ① 顶部 `require('../providers/search')`；② 读 `searchProvider`/`answerMode`；③ 休眠事实分支改为走 `searchLayer.search()`（默认 `factualEnabled=false` 不触达）并记 `meta.search_provider` |

> 注：`freshness/index.js` 在 git 中为 Phase Q 遗留 untracked 文件；本次仅叠加 3 处编辑，未触碰 B 反思路径（`retriever.getProviderName()` 判定逻辑不变）。

### 冻结资产（4 个，零改动）
`corpus.json` / `intent.js` / `knowledgeRouter.js` / `rag.js` —— **SHA 4/4 MATCH**（见 §5）。

---

## 3. diff 摘要

### 3.1 `index.js`（3 处 Q2-1-B 增量）
```js
// (1) 新增开关
const SEARCH_PROVIDER = (process.env.SEARCH_PROVIDER || "mock").toLowerCase();

// (2) 解析 answerMode（与 RAG 深度子开关 mode 正交）
const answerMode = (event && event.answerMode) || "think";

// (3) 透传 opts
result = await freshnessMaybeHandle(message, {
  turn, models: useModels, modelCfgError, mode, history,
  factualEnabled: FRESHNESS_FACTUAL_ENABLED,
  answerMode: answerMode,            // ← 新增
  searchProvider: SEARCH_PROVIDER,   // ← 新增
});
```
> 说明：`git diff` 显示的其余 index.js 差异来自前序阶段（CR-002/Phase P+/Phase Q/R）未 commit 的遗留，非本阶段引入。

### 3.2 `freshness/index.js`（3 处 Q2-1-B 增量）
```js
// (1) require 新抽象层
var searchLayer = require('../providers/search');

// (2) 读取三模式 + 检索源（opts 优先，回退 env）
var searchProvider = opts.searchProvider || (process.env.SEARCH_PROVIDER || "mock").toLowerCase();
var answerMode = opts.answerMode || "think";

// (3) 休眠事实分支改走 searchLayer（原 retriever.retrieveEventFacts 替换为统一层）
var retrieval = await searchLayer.search(cls.eventMention, { answerMode: answerMode });
meta.search_provider = retrieval.provider;
if (!retrieval.ok || !retrieval.results || !retrieval.results.length) { /* 诚实降级 */ }
```
- B 类反思路径（Q1-B 已上线）**未改动**：判定仍用 `retriever.getProviderName()`，`eventContext:null` 反思路径不变。
- 事实分支仅在 `factualEnabled=true` 时进入；本阶段默认 `false`，故**休眠**。

---

## 4. 测试结果

`node --check` 全 11 文件通过；`scripts/test_q21b.js` **37/37 PASS**；存量 `test_freshness.js` **32/32（分类准确率 100%，120/120）零回归**。

| 组 | 项 | 结果 |
|---|---|---|
| [1] Search Provider | mock 统一形状/字段/可解析 url/`[MOCK]` 标记 | ✓ |
| | 缓存命中 `cached=true` | ✓ |
| | normalizeResult 有效/无效 | ✓ |
| | bing/tavily/serp 无密钥 → `ok:false reason=no_api_key` | ✓ |
| | none → `ok:false reason=no_provider` | ✓ |
| [2] answerMode | fast→search / deep→rag / think→search+rag / 默认 think / 非法回退 / 大小写容错 | ✓ |
| [3] ThinkContext | `_ephemeral=true` / facts&knowledge 过滤 / 默认 think / isFresh 初值&过期 / toSafeMeta 仅计数 | ✓ |
| [4] 数据隔离 | corpus.json SHA 检索前后一致 | ✓ |
| [5] 冻结资产 | corpus/intent/knowledgeRouter/rag 4/4 MATCH | ✓ |
| [6] 默认零回归 | factualEnabled=false：B 仍进 freshness、citations 空、无 search_provider 标记 | ✓ |
| [7] 激活布线 | factualEnabled=true+mock：事实分支确实调用 searchLayer（`search_provider=mock`） | ✓ |
| | 激活后 corpus.json SHA 仍一致 | ✓ |

---

## 5. 冻结资产 SHA（4/4 MATCH）

| 资产 | SHA256（前 64 位） | 状态 |
|---|---|---|
| corpus.json | `db01fbc92064cbea3a6688a98160b6a70c9e150259b54063c8e2e96974eabc8b` | ✅ 一致 |
| intent.js | `765ad138ec68c0f159c6f75a60e5268beb02fba152f6d53dbdc539ba1560ca38` | ✅ 一致 |
| knowledgeRouter.js | `848908445dbb5ea93a6f52775dc3c8e6922ff971d6cee115547f236ffed0a935` | ✅ 一致 |
| rag.js | `4fb2dca42597a277911472a3cf1e8411f9f5c08988c2712e38d260d58fc2b503` | ✅ 一致 |

> 与 `Freshness-Q1-B-ImplementationReport.md` 记录的 rag.js 实测基线一致（旧 MEMORY.md 中 `5b380b3f…` 为 stale，已在 Q1-B 校准）。

---

## 6. 数据隔离验证

- `providers/search` 检索结果仅存在于请求内存（`searchContext`/ThinkContext），随函数返回被 GC；测试断言 `corpus.json` 文件 SHA 在完整检索管线（mock + answerMode + thinkContext）前后**完全一致**。
- ThinkContext 硬编码 `_ephemeral=true` 标记；`toSafeMeta()` 仅输出计数，不含事实内容，绝不进 corpus。
- 硬性禁止清单（Phase-Q2-Data-Isolation.md §5）本阶段未被违反：未 ingest、未 embedding、未改 metadata、未写 history。

---

## 7. 回滚方案

| 层级 | 方式 | 动作 |
|---|---|---|
| **L0** | 文件级备份 | `index.js.preQ21B.bak` / `freshness/index.js.preQ21B.bak` 已生成（12KB/16KB）。问题→`cp` 还原。 |
| **L1** | 免部署熔断 | 生产环境变量 `FRESHNESS_ENABLED=false` → 整层摘除，三模式退化为纯 RAG（Deep），秒级生效。`FRESHNESS_FACTUAL_ENABLED` 本阶段恒 `false`，事实分支不触达，本身零风险面。 |
| **L2** | 部署回滚 | 若曾部署，回滚到改动前备份（需重新部署）。 |
| **L3** | 重建 | 极端情况重建云函数。 |

> 本阶段**未部署**，L2/L3 仅为预案。

---

## 8. 风险与开放决策（进入 Q2-2/Q2-3 前必须人工确认）

| 项 | 状态 | 阻塞？ |
|---|---|---|
| 搜索供应商 + API 密钥（bing/tavily/serp） | 未提供（P1 OPEN 遗产） | 是（真实源激活前提） |
| 跨境数据/内容合规（备案审核中状态） | 需法务/平台确认 | 是 |
| 前端三模式选择器（🌐📚🌅） | 本阶段未改前端（Q2-2 范围） | 否 |
| 默认模式 = think | 已落地（answerMode 默认 think） | 否 |
| 问思融合引擎（Reasoning Pipeline） | 骨架已备 ThinkContext，Q2-3 填充 | 否 |

> 铁律重申：Q2-1-B 绝不接真实搜索、不改环境变量、不部署。真实源接入 = 独立授权事件。

---

## 9. 禁止事项遵守情况

- ❌ 未部署 / 未 commit / 未 push
- ❌ 未修改 corpus.json / intent.js / knowledgeRouter.js / rag.js（4/4 SHA 一致）
- ❌ 未修改 embedding / 现有 Prompt 常量 / 数据库结构
- ❌ 未接真实搜索 API / 外部网络（mock 零外网，bing/tavily/serp 无密钥惰性）
- ❌ 未修改环境变量（仅代码中读取，`SEARCH_PROVIDER` 默认 `mock`）

---

## 10. 下一步建议

等待人工授权进入：
- **Phase Q2-2**：前端三模式选择器（复用 `chat.js` 现有 `mode` 管线，新增 `answerMode` 字段）+ 后端 `answerMode` 实际驱动 Fast/Deep/Think 分支（当前已解析并透传，待前端发字段即生效）。
- **Phase Q2-3**：问思融合引擎（Fact Extractor + RAG 检索 + Reasoning Prompt + 引用管理 + 幻觉检测），复用 `freshness/factExtractor`、`rag.js` 只读检索、`detectFabrication` 硬闸。
- **Phase Q2-4**：质量观察（来源准确率 / 搜索成功率 / 事实准确率 / 思考深度 / 幻觉率）。
- **真实源激活前置**：提供供应商选择 + API 密钥 + 合规结论后，方可在 `FRESHNESS_FACTUAL_ENABLED=true` 时将 `SEARCH_PROVIDER` 从 `mock` 切到真实源。
