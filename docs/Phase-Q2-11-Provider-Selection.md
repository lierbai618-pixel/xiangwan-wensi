# Phase Q2-11 — Provider Selection Review（国内搜索 API 选型评估）

> 角色：Release Manager + AI Architect
> 阶段：评估（仅评审，不修改代码 / 不部署 / 不修改 env / 不 commit / 不 push）
> 前置：Phase Q2-10 已完成（domesticApiSearch.js 就绪、searchLayer 完成、225 PASS、四冻结资产 SHA 未变、未部署）
> 产出：本文档（docs/Phase-Q2-11-Provider-Selection.md）
> 下一步：等待人工授权后进入 B1–B5

---

## 0. 评估约束与当前状态（自检）

| 项 | 状态 |
|---|---|
| corpus.json / intent.js / knowledgeRouter.js / rag.js | ✅ SHA 4/4 未变（本阶段复测见 §5） |
| 修改代码 / env / 部署 / commit / push | ⛔ 全程未执行 |
| 适配层 audit | ✅ 见 §1 |
| 冻结资产证明 | ✅ 见 §5 |

---

## 1. 当前 provider-agnostic 搜索适配层审计

### 1.1 代码现状（未改动）

**`providers/search/domesticApiSearch.js`**（135 行，替代废弃的 SearXNG `domesticFreeSearch.js`）
- 注册于 `index.js:33`：`var domesticProvider = require('./domesticApiSearch');`
- `getProviderName()` 允许 `'domestic'`（`index.js:74`）
- `isRealProvider('domestic') === true`（`index.js:80`）→ 计入配额/审计
- `isDomesticProvider('domestic') === true`（`index.js:85`）→ `data_route` 恒定 `'domestic'`（零跨境）

**设计契约**（与 tavily/bing/serp 一致）
- 仅当 `DOMESTIC_API_BASE_URL` 配置时联网；否则 `ok:false, reason:'no_endpoint'`（fail-soft）
- 配置在**调用时读取**（支持部署切换即时生效）
- 复用 `util.httpGetJson` + `util.normalizeResult`，结果统一为 `{title,url,content,source}`
- provider 名固定 `'domestic'`，保证 `data_route=domestic`

**配置驱动、零编造**（核心优势）
- 响应解析由 `DOMESTIC_API_RESULT_PATH`（dot-path）+ `DOMESTIC_API_FIELD_*` 映射驱动
- 省略时自动探测国内常见聚合 API 形状（`results/newslist/result/data/list/Data/articles`）
- 任何国内合规搜索 API 填 env 即可接入，**无需改代码**

### 1.2 架构级发现（决定选型的关键）

⚠️ **当前适配器仅支持 GET 方法**（构造 `?q=...` URL + Header 鉴权）。三大候选里：

| 候选 | 协议 | 是否即插即用当前 GET 适配器 |
|---|---|---|
| 阿里云百炼 联网搜索 | 模型工具(`enable_search`) 或 MCP(Streamable HTTP/JSON-RPC) | ❌ 均非简单 GET |
| 腾讯云联网搜索 API (WSA) | **HTTPS POST**（`/SearchPro` 或 `/v1/search`，Bearer） | ❌ 需 POST 支持 |
| 聚合类（天行/聚合） | **HTTPS GET**（key 在 query/header） | ✅ 零改动即插即用 |

**结论**：当前适配层对「GET 型国内聚合 API」是即插即用；对「POST 型独立搜索 API（腾讯云 WSA）」需在 B1 阶段做**最小扩展**（支持 `DOMESTIC_API_METHOD=POST` + JSON body），对「百炼」则架构不匹配（见 §3）。

### 1.3 适配层待办（B1 阶段，非本阶段）

1. **POST 方法支持**：`domesticApiSearch.search()` 当前硬编码 GET；腾讯云 WSA 为 POST+JSON body，需在 B1 增加 `DOMESTIC_API_METHOD` 分支（或新增专用 `tencentWsa.js` provider，与 tavily/bing 并列，最干净）。
2. **嵌套数组解析**：腾讯云 WSA 返回 `Pages` 是「JSON 字符串数组」（每项需二次 `JSON.parse` 得 `title/site/passage/url`），适配层需增加 `DOMESTIC_API_PARSE=pages_json_strings` 处理；否则当前 `pickResults` 取不到结构化字段。
3. **超时一致性**：provider 第 113 行向 `httpGetJson` 传入固定 `8000ms`，未读取 `SEARCH_TIMEOUT_MS`（政策 ≤3s）。建议 B1 改为读取 `SEARCH_TIMEOUT_MS`，与 searchLayer 外层 `withTimeout` 对齐。

> 以上三点均为 B1 实现项，本阶段仅评审、不动代码。

---

## 2. 三方案横向比较（基于 2026-08-07 检索的现行信息）

### 方案 A：阿里云百炼 联网搜索

| 维度 | 现状 |
|---|---|
| 形态 | 两种：(1) 模型工具——在 DashScope Chat/Responses API 加 `enable_search:true`，**由模型自主检索并综合回答**；(2) 联网搜索 **MCP**——`https://dashscope.aliyuncs.com/api/v1/mcps/WebSearch/mcp`（Streamable HTTP，JSON-RPC 协议） |
| 返回 | 形态(1) 不返回原始结果数组，模型直接生成回答；形态(2) MCP 协议返回，需 MCP 客户端 |
| 价格 | MCP：前 2000 次免费，之后 **29 元/千次**；搜文计费另计（Generic 950ms / LiteAdvanced 500ms / Deep 6s） |
| 合规 | 阿里云国内，数据留境 ✅ |
| 微信适配 | 需 MCP 客户端或重构生成链路，**与「结果数组→thinkEngine」设计冲突** |

**致命问题**：百炼联网搜索是「模型工具」，检索与综合由模型一体完成。这会**绕过 WenDao 的事实隔离控制**——我们无法拿到干净的结果数组喂给 `factExtractor(_ephemeral)`，也无法在搜索失败时干净回退 RAG；模型自行综合实时事实，**违背「禁止编造 / 搜索结果仅作 runtime context」原则**。

### 方案 B：腾讯云联网搜索 API（WSA, Web Search API）

| 维度 | 现状 |
|---|---|
| 形态 | **独立搜索 API**，HTTPS POST，Bearer 鉴权，返回 JSON 结果数组 |
| 端点 | `api.wsa.cloud.tencent.com`（路径 `/SearchPro` 或 `/v1/search`） |
| 返回结构 | `Pages` 数组，每项含 `title / site / passage(摘要) / url`（注：Pages 为 JSON 字符串数组，需二次解析） |
| 价格 | **轻量版 18 元/千次 / 标准版 46 元/千次 / 尊享 60 / 旗舰 80**（后付费日结）；资源包：标准版 5 万次=1998 元。个人实名可开轻量/标准版 |
| 来源 | 搜狗搜索 + 腾讯内容生态（腾讯新闻/搜狗百科/企鹅号），千亿级网页索引 |
| 延迟 | 官方称最快 **300ms**（边缘节点缓存），毫秒级 |
| 合规 | 腾讯云国内，数据留境，内容生态合规友好 ✅ |
| 微信适配 | 独立 results API + Bearer，仅需在适配器加 POST 支持；`api.wsa.cloud.tencent.com` 加微信 request 白名单即可 |

**契合点**：独立 results API → 完美匹配「结果数组→thinkEngine→RAG 兜底」设计；Bearer 鉴权复用 `domesticApiSearch` 默认 `authMode=bearer`；我们有 `DOMESTIC_API_*` 体系，改动极小；延迟低、合规强、价格低于百炼 MCP。

### 方案 C：聚合类 API（天行数据 tianapi / 聚合数据 juhe）

| 维度 | 现状 |
|---|---|
| 形态 | REST API，**HTTPS GET**，key 鉴权（query 或 header） |
| 典型接口 | 天行「新闻」/「微信」；聚合「新闻头条」 |
| 返回结构 | `{code,msg,newslist:[{title,url,description,...}]}` 类形状 → 命中当前适配器自动探测 |
| 价格 | **极便宜 / 多有免费额度**（聚合新闻头条有每日免费次数；天行按次低费） |
| 覆盖 | 以**新闻/头条/垂类**为主，**非全网实时搜索** |
| 延迟 | 一般，取决于小厂商，无边缘加速 |
| 合规 | 国内，但小厂商数据治理/隐私条款弱于大厂 |
| 微信适配 | **GET + key，当前 generic 适配器零改动即插即用** ✅ |

**契合点**：**上线最快**——零代码改动即可在 L2 canary 跑通。
**硬伤**：覆盖仅新闻/头条，对「实时时间/普通知识/经典问题」覆盖不全；小厂商稳定性、字段漂移、停服风险高于大厂。适合做 canary 快路径，不宜做长期主源。

---

## 3. 七维度评分卡（1–5，5 最优；满分 35）

| 维度 | A 阿里云百炼 | B 腾讯云 WSA | C 聚合类 |
|---|:---:|:---:|:---:|
| 国内访问稳定性 | 5 | 5 | 3 |
| 微信小程序适配 | 2 | 4 | 5 |
| 成本 | 3 | 4 | 5 |
| 合规风险 | 5 | 5 | 4 |
| 延迟 | 4 | 5 | 3 |
| 长期维护成本 | 3 | 4 | 2 |
| 与 WenDao 定位匹配度 | 2 | 5 | 3 |
| **合计** | **24** | **32** | **25** |

### 维度说明

- **国内访问稳定性**：大厂（A/B）多节点稳定；C 小厂商偶发限流。
- **微信小程序适配**：指「是否契合当前 GET 适配器 + 易加白名单」。A 需 MCP/重构（2）；B 需加 POST 支持但协议标准（4）；C GET 即插即用（5）。
- **成本**：A 29 元/千次(MCP) 偏高；B 18–46 元/千次且资源包优惠；C 近乎免费。
- **合规风险**：A/B 大厂留境合规强（5）；C 国内但治理弱（4）。
- **延迟**：A 500–950ms(Deep 6s)；B 最快 300ms；C 一般（3）。
- **长期维护成本**：A 绑定模型工具/MCP 协议演进，适配重（3）；B 官方 SaaS+稳定 SLA（4）；C 小厂商 API 易变、需持续盯（2）。
- **与 WenDao 定位匹配度**：核心判据是「能否把结果数组作为 runtime context 喂 thinkEngine、失败回退 RAG、不编造」。A 模型自综合→失控（2）；B 独立 results→完全契合（5）；C 即插即用但覆盖弱（3）。

---

## 4. 唯一推荐方案

### ✅ 推荐：方案 B — 腾讯云联网搜索 API（WSA）

**理由（一句话）**：唯一同时满足「独立结果数组 API + 低延迟 + 强合规 + 可控事实隔离（不编造）+ 长期稳定」的方案，与 WenDao「搜索结果仅作 runtime context、失败回退 RAG、知识库冻结」的架构原则**天然契合**。

**B1 落地要点（待授权后实施，本阶段不动）**
1. 适配器扩展：新增 `DOMESTIC_API_METHOD=POST`（或在 `providers/search/` 下加 `tencentWsa.js` 专用 provider，与 tavily/bing 并列，最干净）；
2. 响应解析：增加 `DOMESTIC_API_PARSE=pages_json_strings` 处理 `Pages` 二次 `JSON.parse`；
3. env（写进 cloudbaserc.json）：`SEARCH_PROVIDER=domestic` / `DOMESTIC_API_BASE_URL=https://api.wsa.cloud.tencent.com/SearchPro` / `DOMESTIC_API_AUTH=bearer` / `DOMESTIC_API_METHOD=post` / `DOMESTIC_API_RESULT_PARSE=pages_json_strings` / `FRESHNESS_ENABLED=true` / `FRESHNESS_FACTUAL_ENABLED=true` / `PRIVACY_GATE_ENABLED=true` / `SEARCH_CANARY_ENABLED=true` / `SEARCH_CANARY_OPENIDS=<真实测试openid>` / `SEARCH_MAX_RESULTS=5` / `SEARCH_TIMEOUT_MS=3000` / `SEARCH_DAILY_QUOTA=500`；
4. 微信 request 合法域名白名单加 `api.wsa.cloud.tencent.com`（控制台手动，B2）；
5. 部署：`tcb fn deploy chat --force`（B3，须先读 cloudbaserc.json 避免静默覆盖生产 env）。

### 🟡 可选快路径：方案 C（聚合类）用于 L2 canary 最先上线

若你希望**以最小改动先跑通真实联网灰度**，可先用天行/聚合（GET 即插即用，零代码改动）做 L2 canary，待腾讯云 WSA 的 POST 适配（B1 小改）完成后再切换为主源。覆盖弱点是其固有局限，canary 阶段可接受。

### ❌ 不推荐：方案 A（阿里云百炼）

架构不匹配——联网搜索是「模型工具」，检索与综合由模型一体完成，会绕过 WenDao 的事实隔离控制、无法干净回退 RAG、存在模型自行综合实时事实的编造风险，与「禁止编造 / 结果仅作 runtime context」原则冲突。除非未来重构生成链路，否则不采用。

---

## 5. 冻结资产证明（本阶段复测，2026-08-07）

```
corpus.json:        db01fbc92064cbea3a6688a98160b6a70c9e150259b54063c8e2e96974eabc8b
intent.js:          765ad138ec68c0f159c6f75a60e5268beb02fba152f6c53dbdc539ba1560ca38
knowledgeRouter.js: 848908445dbb5ea93a6f52775dc3c8e6922ff971d6cee115547f236ffed0a935
rag.js:             4fb2dca42597a277911472a3cf1e8411f9f5c08988c2712e38d260d58fc2b503
```
四冻结资产 SHA 与 Q2-10 基线**完全一致（4/4 MATCH）**；corpus 条目数（embedding 数量代理）= 14，未变。本阶段**未读取/写入任何冻结文件**。

---

## 6. 结论与下一步

- **唯一推荐**：腾讯云联网搜索 API（WSA），评分 32/35，契合 WenDao 事实隔离架构。
- **canary 快路径（可选）**：聚合类（天行/聚合）GET 即插即用，零改动先跑 L2 灰度。
- **不推荐**：阿里云百炼（模型工具，架构不匹配）。
- **本阶段产物仅此文档**，未改代码/env、未部署、未 commit。
- **等待人工授权后**进入 B1（选定方案 + 适配器 POST 扩展 / 或聚合类快路径）→ B2（微信域名白名单）→ B3（写 env + deploy）→ B4（备案 B1）→ B5（真实测试 openid 做 canary 联调）。
