# Phase P+ Deployment 审计（第一阶段 · 只读）

> 阶段目标：部署前只读审计，确认当前 Observability 能力状态、默认存储、cloud 接入方式、回滚方式。
> 审计时间：2026-08-02
> 审计范围：`cloudfunctions/chat/observability/*`、`cloudfunctions/chat/config.json`、chat 云函数线上配置、云数据库、Dashboard 数据读取链路。
> 审计原则：**只读**，未改动任何冻结资产、未改动 Router/Prompt/Intent/RAG、未部署。

---

## 1. 审计结论速览

| 审计项 | 结论 |
|--------|------|
| 当前默认 storage | **JSON（local/file fallback）** |
| cloud storage 接入方式 | `KNOWLEDGE_OBSERVABILITY_STORE=cloud` → `CloudObservabilityStore`（wx-server-sdk → 云库 `observability_logs`） |
| 回滚方式 | `tcb fn code download` 备份（**已执行**，产物 `.deploy-backup/chat-pre-obs-20260802`）；回滚 = 重新部署该备份 |
| 回答流程是否被改动 | 否 — `logObservation` 为 fire-and-forget，不 await、不抛错到主链路 |
| 写入失败是否阻断服务 | 否 — `store.write` 永不抛出，错误仅 `console.error` |
| Dashboard 是否重算检索 | 否 — `dashboard.js` 不 require `rag.js`、不调用 embedding，只读聚合 |

---

## 2. Observability 代码审计（只读）

### 2.1 `observability/observabilityLogger.js`
- **L40-51 `createDefaultStore()`**：当 `process.env.KNOWLEDGE_OBSERVABILITY_STORE === 'cloud'` 时 `require('./cloudObservabilityStore')` 返回 `CloudObservabilityStore`；否则返回 `JsonObservabilityStore`。require cloud 失败时 try/catch 回退 JSON。
- **L54-106 `buildObservationRecord(opts)`**：纯函数，从入参零成本构造记录。已落库字段（docs/62 §9 覆盖 6/12 + 1/12 等效）：
  - 基础：`query` / `answer_id` / `conversation_id` / `openid` / `created_at`
  - 路由：`knowledge_type`（来自 citations）、`router_decision`（只读复算 `knowledgeRouter.routeQuestion`，冻结纯函数）、`fallback_reason`、`router_enabled`、`domain`、`intent`、`policy_name`
  - 检索（标题列表，非 display_text）：`retrieval_result` ◐ 等价 `citation_source`
  - 引用：`citation_count`
  - 性能：`latency_ms`
  - ❌ 未覆盖 5/12（位于冻结 rag.js 内部，推迟至 Phase Q）：`retrieval_mode` / `router_adjustment` / `rerank_score` / `chunk_id` / `vector_score`
- **L113-126 `logObservation(opts)`**：fire-and-forget，`Promise.resolve(store.write(record)).catch(...)` 不 await；外层 try/catch 兜底同步异常。**绝不阻塞/抛错到主链路**。

### 2.2 `observability/cloudObservabilityStore.js`（Phase P+ 已实现）
- **L18**：`this.collection = config.collection || 'observability_logs'` — 目标集合名已固化。
- **L22-36 `_getDb()`**：延迟 `require('wx-server-sdk')`（本地/测试不加载），`cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })`（幂等、try/catch 保护）。
- **L38-47 `write(record)`**：`db.collection(...).add({ data: {...record, createTime: db.serverDate()} })`；**永不抛出**，失败返回 `{ ok: false }`。
- **L49-61 `readAll(limit)`**：`orderBy('createTime','desc').limit(...).get()`，供 Dashboard 读取；失败返回 `[]`。

### 2.3 `observability/jsonObservabilityStore.js`（默认 / fallback）
- 默认存储：`path.join(__dirname,'observability-store.json')`。
- `write()` 追加数组、永不抛出；`readAll()` 读取全部。**本地/测试/降级兜底**。

### 2.4 `cloudfunctions/chat/config.json`
```json
{"permissions":{"openapi":["security.msgSecCheck"]},"timeout":90,"memorySize":512,"runtime":"Nodejs16.13"}
```
> 注意：config.json **无 env 字段**。环境变量 `KNOWLEDGE_OBSERVABILITY_STORE` 需经云函数控制台 / `tcb fn deploy` 的 `envVariables` 注入（见 §4）。

---

## 3. 当前默认 storage（确认）

`createDefaultStore()` 在 `KNOWLEDGE_OBSERVABILITY_STORE` 未设置或 ≠ `'cloud'` 时返回 `JsonObservabilityStore`。
**结论：默认 storage = JSON（local/file fallback）**，符合 Stage 3「默认保持 local/file fallback」要求。

---

## 4. cloud storage 接入方式（确认）

| 环节 | 机制 |
|------|------|
| 开关 | `process.env.KNOWLEDGE_OBSERVABILITY_STORE === 'cloud'` |
| 实现 | `CloudObservabilityStore` 延迟加载 `wx-server-sdk` |
| 目标集合 | `observability_logs`（collection 名已固化于 L18） |
| 初始化 | `cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })`（与函数入口一致） |
| 环境注入 | 云函数控制台「配置 → 环境变量」或 `tcb fn deploy` 读取 `cloudbaserc.json` 的 `functions[].envVariables` |
| 失败行为 | cloud require 失败 → 回退 JSON；`write` 失败 → 返回 `{ok:false}`，不阻断 |

---

## 5. 云数据库配置方式（确认）

- 环境：`YOUR_CLOUD_ENV_ID`（CloudBase 个人版，状态 Normal）。
- 集合创建：`tcb db nosql execute --command '[{"TableName":"observability_logs","CommandType":"COMMAND","Command":"{\"create\":\"observability_logs\"}"}]'`。
- 权限：云函数经 `wx-server-sdk`（admin）写入/读取，**绕过集合权限规则**，故集合默认权限不影响云函数读写。
- 已验证：`observability_logs` 集合 **已创建、当前 0 条文档**（count `n=0`）。

---

## 6. Dashboard 数据读取链路（确认）

`dashboard/dashboard.js` → `buildDashboard(config)`：
1. `config.store` 优先；缺省 `new JsonObservabilityStore(...)`。
2. `observations = store.readAll()`（L371-372）— 云环境传入 `CloudObservabilityStore` 实例即可读取 `observability_logs`。
3. `buildObservabilityMetrics(observations)`（L224-284）：
   - `queryCount.value = observations.length`
   - `knowledgeUsage.value = knowledge_type 频次`
   - `latency.value = 均值`（来自 `latency_ms`）
4. `buildCitationMetrics`：`runtime_citation_present_rate = citation_count>0 占比`。
5. **N/A 诚实**：`storeAvailable=false` 或 `observations.length===0` → `na('...')`（`available:false, value:null`），**绝不伪造**。

> 沙箱内 `wx-server-sdk` 不可用，故 Stage 5 验证将以「`tcb db nosql` 拉取真实云库记录 → 本地用真实 `dashboard.js` + 适配 store 聚合」方式完成，使用真实代码 + 真实数据，不改动任何文件。

---

## 7. 回滚方式（确认）

- **备份已执行**：`tcb fn code download chat .deploy-backup/chat-pre-obs-20260802`
  - 产物：`actionLibrary.js` / `config.json` / `corpus.json` / `index.js`（7542B，确认**无** `logObservation` 埋点，即部署前基线）/ `intent.js` / `node_modules` / `package-lock.json`。
  - 线上函数当前配置：timeout=60、memory=512、runtime=Nodejs16.13、env=`ADMIN_OPENID=YOUR_ADMIN_OPENID...`、auto-install deps=TRUE。
- **回滚操作**（二选一）：
  1. `tcb fn code update chat .deploy-backup/chat-pre-obs-20260802` —— 直接还原代码（推荐，最快）。
  2. 或将 `KNOWLEDGE_OBSERVABILITY_STORE` 改回非 `cloud`（保留新代码但关闭云写入，降级到 JSON fallback）。
- **回滚安全性**：Observability 为 fire-and-forget 旁路，回滚不影响既有回答链路；`observability_logs` 中已写入记录保留（只读，无害）。

---

## 8. 部署前风险与对策

| 风险 | 对策 |
|------|------|
| 部署时 `envVariables` 整体覆盖，误删 `ADMIN_OPENID` | `cloudbaserc.json` 中**显式保留** `ADMIN_OPENID` + 新增 `KNOWLEDGE_OBSERVABILITY_STORE` |
| 部署重置函数配置（timeout/memory/runtime） | `cloudbaserc.json` 锁定 timeout=60（线上实际值，非 config.json 的 90）、memory=512、runtime=Nodejs16.13 |
| 集合未建导致首写失败 | 已先行创建 `observability_logs`（count=0 验证通过） |
| 云写入失败影响用户回答 | 不可能 — `write` 永不抛出，主链路不 await |
| 本地无 `wx-server-sdk` 致 Dashboard 无法直连云库 | Stage 5 用「拉取真实记录 + 真实 dashboard.js 聚合」替代，不依赖本地 SDK |

---

## 9. 审计签署

- 只读审计完成，未发现需修改冻结资产/路由/Prompt/Intent/RAG 之处。
- Observability 代码（Phase P+ 已交付）满足部署前置条件：失败安全、fire-and-forget、storage 可切换、Dashboard 只读聚合。
- 备份产物就位，回滚路径明确。
- **建议进入第二阶段（Cloud Observability Storage）与第三阶段（环境切换）的实际执行。**
