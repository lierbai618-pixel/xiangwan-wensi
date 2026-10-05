# Phase Q2-13：Qwen Provider Adapter（阿里云百炼 / DashScope，基于现有中转 API）

- **角色**：Release Manager + Search Infrastructure Engineer
- **状态**：✅ 代码设计 + 离线测试全绿（**225 + 104 + 124 = 453 断言 0 失败**）｜⛔ **未部署 / 未改生产环境变量 / 未 commit / 未扩大用户范围**
- **约束遵守**：corpus.json / intent.js / knowledgeRouter.js / rag.js 零改动；RAG 逻辑零改动；无 ingest、无 embedding 更新、无知识库写入；搜索结果仅作 request runtime context
- **四冻结资产 SHA**：4/4 = 基线（见 §4）

---

## 1. 背景与决策

用户当前**仅有阿里云百炼（DashScope）API**，据此要求实现 Qwen 联网搜索 Provider Adapter，复用现有 searchLayer，不改动 RAG。

此方向与 **Phase Q2-11 评估结论**存在表面冲突：Q2-11 指出百炼联网搜索是「模型工具（`enable_search`）」架构，若直接采用模型综合回答会**绕过事实隔离、存在模型自行综合实时事实的编造风险**，故当时不推荐。

**本 Phase 的化解方式（核心架构决策）**：
> 百炼 `enable_search` 响应**同时**返回两部分——
> - (a) `choices[0].message.content` —— 模型综合后的回答
> - (b) `choices[0].message.extended.search_info.search_results` —— 结构化检索结果数组
>
> `qwenSearch.js` **只提取 (b) 作为 runtime context 喂给 fact extraction**，**绝不读取/采用 (a)**。
> 因此事实隔离与 `tencent` / `domestic` 完全一致，Q2-11 关切被结构性消除。RAG 仅作为失败回退路径，逻辑未被触碰。

---

## 2. 实现内容

### 2.1 新增 `cloudfunctions/chat/providers/search/qwenSearch.js`

- **Provider contract**：`search(query, opts, nodeFetch)` → `{ ok, provider, results, reason }`，`provider` 固定 `'qwen'` → `data_route=domestic`（阿里云国内节点，零跨境）。
- **请求**：POST + `Authorization: Bearer` + JSON body（OpenAI 兼容）：
  ```json
  { "model": "<QWEN_SEARCH_MODEL>", "messages": [{"role":"user","content":"<query>"}], "enable_search": true, "stream": false }
  ```
- **解析**：从 `choices.0.message.extended.search_info.search_results` 抽取结果数组（dot-path 可配；含常见百炼/DashScope 形状兜底探测），经 `util.normalizeResult` 标准化。
- **事实隔离硬约束（代码层保证）**：适配器内**没有任何读取 `message.content` 的路径**——`pickResults()` 仅遍历 `search_results` 候选 dot-path；即使响应带 `content`，也绝不进入 `results` 或任何下游。
- **Fail-soft**：`QWEN_SEARCH_BASE_URL` 为空 → 立即 `ok:false / reason=no_endpoint`，不联网；传输/HTTP 错误抛给 `searchLayer` 的 `withRetry` 重试。
- **配置驱动、零编造**：所有 API 形状（结果路径、字段名、模型名）均经环境变量注入，无硬编码百炼专属字段。

### 2.2 `index.js` 注册（`domestic` / `tencent` 路径零改动）

| 位置 | 改动 |
|---|---|
| require | 新增 `var qwenProvider = require('./qwenSearch');` |
| `getProviderName()` | 允许值列表加 `'qwen'` |
| `isRealProvider()` | 加 `'qwen'`（计费/审计） |
| `isDomesticProvider()` | 加 `'qwen'`（→ `data_route=domestic`） |
| `search()` dispatch | 新增 `else if (provider === 'qwen') ...` |

---

## 3. 环境变量（部署时写入 `cloudbaserc.json`，本阶段仅提供草案）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `SEARCH_PROVIDER` | `mock` | 切 `qwen` 才走真实源 |
| `FRESHNESS_ENABLED` | `false` | 总闸（须 `true` 加载 freshness 层） |
| `FRESHNESS_FACTUAL_ENABLED` | `false` | 事实源闸（须 `true`） |
| `PRIVACY_GATE_ENABLED` | `false` | 隐私闸门（建议 `true`） |
| `SEARCH_CANARY_ENABLED` | `false` | 灰度（先 `true` + 限定 openid） |
| `SEARCH_CANARY_OPENIDS` | — | 真实测试微信号 openid |
| `QWEN_SEARCH_BASE_URL` | 空 | **中转 API 的 chat/completions 端点（必填）** |
| `QWEN_SEARCH_API_KEY` | 空 | 中转 Bearer（中转已代持可留空） |
| `QWEN_SEARCH_MODEL` | `qwen-plus` | 模型名 |
| `QWEN_SEARCH_ENABLE_SEARCH` | `true` | 开启联网 |
| `QWEN_SEARCH_RESULTS_PATH` | `choices.0.message.extended.search_info.search_results` | 结果数组 dot-path |
| `QWEN_SEARCH_FIELD_TITLE/URL/SNIPPET/SOURCE` | `title`/`url`/`content`/`title` | 字段映射 |
| `QWEN_SEARCH_EXTRA_BODY` | 空 | 附加 body（JSON 字符串，适配中转特殊参数） |
| `SEARCH_MAX_RESULTS` | `5` | 单查询上限 |
| `SEARCH_TIMEOUT_MS` | `3000` | 单次检索硬超时 |
| `SEARCH_DAILY_QUOTA` | `500` | 日配额 |

> ⚠️ 禁用任何跨境 provider（tavily/bing/serp 一律不启用）。

---

## 4. 测试与冻结资产证明

### 4.1 `scripts/test_q31.js`（新增，零真实网络，fakeFetch 模拟百炼中转）

**124 PASS / 0 FAIL**，关键项：

1. Contract 形状（含 `provider='qwen'`）
2. POST + Bearer + body 含 `messages[0].content` 与 `enable_search:true`
3. `search_results` 数组解析（含字段映射）
4. **事实隔离**：仅取 `search_results`，结果中绝不含模型综合 `content` 标记（单元级直接证明）
5. `no_endpoint`（fail-soft 不联网）
6. `no_results`
7. `searchLayer` 路由 → `data_route=domestic`、审计干净
8. `thinkEngine` 端到端：
   - 在线检索结果（`search_results`）进入回答 ✅
   - **回答中不含模型综合内容标记**（`【事实隔离】` 逐条 + 汇总均通过）✅
   - 检索失败回退 RAG ✅
   - `data_route` 全程 `domestic`（7/7，零 cross_border）✅
   - 审计零泄露（query / openid / URL / 全文 / 综合内容均不在 audit）✅
   - 四冻结资产 SHA + mtime 前后一致、corpus 条目数=14 不变（无 ingest）✅

### 4.2 回归（确认 `index.js` 注册未扰动既有路径）

- `test_q29.js`：**225 PASS / 0 FAIL**（domestic 路径）
- `test_q30.js`：**104 PASS / 0 FAIL**（tencent 路径）

### 4.3 四冻结资产 SHA 4/4 = 基线

| 文件 | SHA256 |
|---|---|
| corpus.json | `db01fbc92064cbea3a6688a98160b6a70c9e150259b54063c8e2e96974eabc8b` |
| intent.js | `765ad138ec68c0f159c6f75a60e5268beb02fba152f6d53dbdc539ba1560ca38` |
| knowledgeRouter.js | `848908445dbb5ea93a6f52775dc3c8e6922ff971d6cee115547f236ffed0a935` |
| rag.js | `4fb2dca42597a277911472a3cf1e8411f9f5c08988c2712e38d260d58fc2b503` |

---

## 5. 上线前置（仍阻塞，须授权才推进）

- **B1** 在现有中转服务上开通百炼联网搜索（`enable_search`），取得中转 chat/completions 端点
- **B2** 微信公众平台 → 开发设置 → 服务器域名 → request 合法域名，添加该中转域名（须已 ICP 备案）
- **B3** 将 §3 环境变量写入 `cloudbaserc.json`（与现网 runtime/timeout/memory 对齐，避免 deploy 静默覆盖生产 env）
- **B4** `tcb fn deploy chat --force` 部署新代码
- **B5** 真实测试 openid 做 L2 canary 联调
- **B6** 小程序备案 B1 通过后扩大用户范围

> 备注：Q2-9 的 `infra/searxng/` 部署包现已废弃（用户改走百炼中转），可后续清理；本阶段未删除。

---

## 6. 约束符合性自检

| 约束 | 符合 |
|---|---|
| 不修改 corpus.json / intent.js / knowledgeRouter.js / rag.js | ✅ SHA 4/4 不变 |
| 不改变 RAG | ✅ rag.js 零改动；搜索结果仅作 runtime context，RAG 仅回退路径 |
| 不进行 ingest / 不生成 embedding | ✅ corpus 条目数=14 不变，无写入 |
| 搜索结果仅作 request runtime context | ✅ 结果存于请求栈帧，结束即释放 |
| 默认关闭真实搜索 | ✅ `SEARCH_PROVIDER=mock` 默认；需显式切 `qwen` |
| 仅 canary 用户可访问 | ✅ `SEARCH_CANARY_ENABLED` + `SEARCH_CANARY_OPENIDS` 控制 |
| 搜索失败回退 RAG | ✅ 三层回退均已验证 |
| 禁止编造 | ✅ 配置驱动零硬编码；事实隔离保证不采用模型综合答案 |
| 不部署 / 不改生产 env / 不 commit | ✅ 本阶段仅代码+测试+报告 |
