# Phase Q2-10：国内搜索 API Provider（provider-agnostic）实施报告

- **角色**：Release Manager + AI Architect
- **日期**：2026-08-07
- **目标**：为「向晚问思」增加联网搜索能力，放弃 SearXNG 自建，改用 **provider-agnostic 国内搜索 API 适配层**
- **状态**：✅ 代码设计完成 + 离线测试全绿（225 PASS / 0 FAIL）｜⛔ **未部署 / 未改生产环境变量 / 未 commit / 未开放全量用户**
- **约束遵守**：corpus.json / intent.js / knowledgeRouter.js / rag.js 零改动（SHA 4/4 不变）；无 ingest；无 embedding 更新；搜索结果仅作 request runtime context

---

## 1. 方案概述

放弃此前 Q2-9 的 SearXNG 自托管方案（运维重、需国内部署+备案域名+反向代理鉴权），改为**通用国内搜索 API 适配器**：

- 新增 `providers/search/domesticApiSearch.js` —— 一个**配置驱动**的 provider，任何国内合规搜索/资讯 REST API 均可经环境变量接入，**无需改代码**。
- 沿用既有 `searchLayer` 的 `domestic` 槽位（provider 名固定 `'domestic'` → `data_route` 恒定 `'domestic'`，零跨境）。
- 完整保留：`privacyGate` / `canaryGate` / `quota` / `audit` / `freshnessRuntimeGuard`，调用链与 fail-soft 行为不变。
- 删除已废弃的 `domesticFreeSearch.js`（SearXNG 专用）。

**零编造原则落地**：不硬编码任何具体 API 的字段。响应解析由 `DOMESTIC_API_RESULT_PATH` + `DOMESTIC_API_FIELD_*` 配置驱动；省略时自动探测国内常见聚合 API 形状。你后续接入哪家（天行/聚合/腾讯云/自建）都只需填 env。

---

## 2. 代码设计

### 2.1 新增 `providers/search/domesticApiSearch.js`

导出统一契约 `search(query, opts, nodeFetch)` → `{ ok, provider:'domestic', results, reason }`，与既有 tavily/bing/serp 一致。

关键逻辑：
1. `DOMESTIC_API_BASE_URL` 为空 → 立即 `{ok:false, reason:'no_endpoint'}`（fail-soft，不联网）。
2. 构造 GET URL：`BASE?QUERY_PARAM=enc(q)` + 可选 `EXTRA_PARAMS` + 可选 `key=`（仅 `auth=query` 模式）。
3. 鉴权头：`bearer`→`Authorization: Bearer`；`x-api-key`→`X-Api-Key`；`query`→URL 参数。
4. `util.httpGetJson` 发出；传输/HTTP 错误抛出让 `searchLayer.withRetry` 重试（5xx/网络/超时重试，4xx 不重试）。
5. 响应解析：`RESULT_PATH` 指定 dot-path 取数组；否则自动探测 `results/newslist/result/data/list/Data/articles/result.list/data.list`。
6. 每条经 `util.normalizeResult`（字段映射 `FIELD_TITLE/URL/SNIPPET/SOURCE`）标准化，剥离追踪参数、补全 source。
7. 无可用结果 → `{ok:false, reason:'no_results'}`（确定性，不重试）。

Node 16.13 兼容（无可选链 / 空值合并）。

### 2.2 配置变量（替代原 `SEARXNG_*`）

| 变量 | 必填 | 默认 | 说明 |
|---|---|---|---|
| `DOMESTIC_API_BASE_URL` | ✅ | 空 | API 根地址（可含 `?token=` 等查询），空即不联网 |
| `DOMESTIC_API_KEY` | ❌ | 空 | 鉴权密钥 |
| `DOMESTIC_API_AUTH` | ❌ | `bearer` | `bearer` / `x-api-key` / `query` |
| `DOMESTIC_API_QUERY_PARAM` | ❌ | `q` | 查询参数名 |
| `DOMESTIC_API_EXTRA_PARAMS` | ❌ | 空 | 附加 URL 参数，如 `type=news&size=10` |
| `DOMESTIC_API_RESULT_PATH` | ❌ | 自动探测 | 响应 JSON 中结果数组 dot-path，如 `newslist` / `data.list` |
| `DOMESTIC_API_FIELD_TITLE` | ❌ | `title` | 结果项标题字段 |
| `DOMESTIC_API_FIELD_URL` | ❌ | `url` | 结果项链接字段 |
| `DOMESTIC_API_FIELD_SNIPPET` | ❌ | `content` | 结果项摘要字段（缺失回退 summary/description） |
| `DOMESTIC_API_FIELD_SOURCE` | ❌ | `source` | 结果项来源字段（可选） |

> 复用既有全局变量：`SEARCH_MAX_RESULTS` / `SEARCH_TIMEOUT_MS` / `SEARCH_DAILY_QUOTA`（配额与缓存逻辑不变）。

### 2.3 `searchLayer`（index.js）改动（极小、非冻结）

- `require('./domesticFreeSearch')` → `require('./domesticApiSearch')`（行 33），注释更新为「provider-agnostic 国内搜索 API 适配层」。
- `data_route` 注释中「SearXNG 实例限定为国内上游引擎」改为「所接入 API 为国内合规服务」。
- `domestic` 注册分支、`isRealProvider` / `isDomesticProvider` / `dataRouteOf` 均**未改**，护栏链路不变。

### 2.4 已删除 `domesticFreeSearch.js`

SearXNG 专用、已废弃。删除前确认仅被 `index.js:33` 引用（已切换），无残留引用。

---

## 3. 安全与边界（设计即保证）

| 要求 | 实现 |
|---|---|
| 默认关闭真实搜索 | `SEARCH_PROVIDER` 默认 `mock`；`FRESHNESS_FACTUAL_ENABLED`/`PRIVACY_GATE_ENABLED`/`SEARCH_CANARY_ENABLED` 均默认 `false`；`DOMESTIC_API_BASE_URL` 默认空 → 不联网 |
| 只允许 canary 用户 | `canaryGate`：开启且 `SEARCH_PROVIDER=domestic` 时，仅 `SEARCH_CANARY_OPENIDS` 内用户走真实 domestic，其余强制 `mock`（确定性降级，无外呼） |
| 搜索失败必须回退 RAG | 三层兜底：① provider `no_endpoint/no_results` → 上层诚实边界+反思；② 网络异常/超时 → `withRetry` 后 fail-soft；③ `think` 模式引擎内部 RAG 兜底、`fast` 模式派发器回退 RAG |
| 禁止编造 | 检索结果仅作 runtime context 注入回答；无检索时维持「诚实边界+反思」，绝不生成虚拟事实 |
| 仅 runtime context | 搜索结果仅存请求栈帧（`_ephemeral`）；`audit` 仅 7 个安全白名单字段，不含 query/用户/URL/全文；RAG 只读 |

---

## 4. 离线测试结果（`scripts/test_q29.js`）

**运行**：`node scripts/test_q29.js`　**结果：225 PASS / 0 FAIL**（零真实网络，fakeFetch 模拟国内搜索 API）

### 4.1 适配器通用性单测（证明零编造）
- ✅ (a) 天行形状 `{code, newslist:[...]}` + 字段映射 → 解析成功
- ✅ (b) 聚合形状 `{error_code, result:[...]}` + 字段映射 → 解析成功
- ✅ (c) 自动探测 `{results:[...]}`（无 RESULT_PATH）→ 解析成功
- ✅ (d) 无 `DOMESTIC_API_BASE_URL` → `no_endpoint`（不联网）

### 4.2 护栏在线（验证项 5/6 支撑）
- ✅ PII 查询 → `pii_blocked`，**零外呼**，`data_route=blocked`（数据未出境）
- ✅ 非白名单 openid → `canary_blocked`，provider 降级 `mock`，`data_route=domestic`
- ✅ 配额耗尽 → `quota_exceeded`，`data_route=domestic`

### 4.3 20 条真实问题主流程（4 类各 5；Q18-20 为失败回退组）
- ✅ **验证1**：17 条在线问题联网结果进入回答文本（`【L2联网】` 标记入答）
- ✅ **验证2**：3 条失败回退 RAG（Q18 think 内部兜底 / Q19+Q20 fast 派发器兜底）
- ✅ **验证6**：20/20 `data_route=domestic`，**全程零 cross_border**
- ✅ **验证5**：逐条 + 汇总审计零泄露（query / openid / URL / 全文均不在 audit；guard 白名单通过）

### 4.4 冻结资产与知识库完整性
- ✅ **验证3**：corpus.json / intent.js / knowledgeRouter.js / rag.js 的 **SHA256 前后一致（4/4 = 基线）** 且 mtime 未变（未被写入）
- ✅ **验证4**：corpus 条目数前后一致（=14，派生 embedding 向量数不变，无 ingest）

> 基线 SHA：corpus `db01fbc9…abc8b` / intent `765ad138…0ca38` / knowledgeRouter `84890844…0a935` / rag `4fb2dca4…fc2b503`

---

## 5. 上线前置（仍阻塞，须逐道授权）

| # | 前置项 | 责任方 | 当前状态 |
|---|---|---|---|
| B1 | 选定并开通国内合规搜索 API，获取 `DOMESTIC_API_BASE_URL` / `KEY` / 响应形状 | 你 | 待定（通用适配器已就绪，填 env 即可） |
| B2 | 微信公众平台 → 开发设置 → 服务器域名 → request 合法域名，添加该 API 域名（须 ICP 备案） | 你（控制台） | 未配置 |
| B3 | 将下方 env 补丁写入 `cloudbaserc.json` 的 `envVariables`（与现网 runtime/timeout/memorySize 对齐，避免 deploy 静默覆盖） | 你授权后做 | 未写 |
| B4 | `tcb fn deploy chat --force` 部署新代码 | 你授权后做 | 未部署 |
| B5 | 提供真实测试微信号 openid（替 `SEARCH_CANARY_OPENIDS`），先做真实 canary 联调 | 你 | 待提供 |

### 上线 env 补丁草案（B3 用，GO 前不写）

```
FRESHNESS_ENABLED=true
SEARCH_PROVIDER=domestic
FRESHNESS_FACTUAL_ENABLED=true
PRIVACY_GATE_ENABLED=true
SEARCH_CANARY_ENABLED=true
SEARCH_CANARY_OPENIDS=<真实测试openid>
SEARCH_MAX_RESULTS=5
SEARCH_TIMEOUT_MS=3000
SEARCH_DAILY_QUOTA=500
DOMESTIC_API_BASE_URL=<国内合规API根地址>
DOMESTIC_API_KEY=<可选>
DOMESTIC_API_AUTH=bearer
DOMESTIC_API_QUERY_PARAM=q
DOMESTIC_API_RESULT_PATH=<如 newslist，省略自动探测>
DOMESTIC_API_FIELD_TITLE=title
DOMESTIC_API_FIELD_URL=url
DOMESTIC_API_FIELD_SNIPPET=content
```

> ⚠️ 仍**禁用** tavily / bing / serpapi / 任何跨境 provider。

---

## 6. 不部署声明

本阶段**仅完成代码设计 + 离线测试**，未执行任何不可逆操作：
- ❌ 未 `tcb fn deploy`
- ❌ 未修改生产环境变量 / `cloudbaserc.json`
- ❌ 未 commit / push
- ❌ 未开放全量用户（仍为 canary 限定）
- ✅ 四冻结资产 SHA 4/4 不变，知识库零改动

下一步需你授权推进 B1–B5（选 API + 域名白名单 + 写 env + 部署 + 真实 canary），我不会主动越界。
