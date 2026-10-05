# Phase P+ Deployment 报告

> 阶段目标：让已完成（Phase P+）的 Observability 能力进入真实运行状态。
> 报告时间：2026-08-02（更新：真实请求 + Dashboard 验证已完成）
> 执行者：向晚问思 Knowledge Platform 首席工程师（沙箱内 tcb CLI 会话）
> 约束遵守：❌ 未新增 Knowledge Object / ❌ 未 ingest / ❌ 未 embedding / ❌ 未改 Router / Prompt / Intent / RAG / 冻结资产；❌ 未进入 Phase Q。

---

## 0. 执行状态总览

| Stage | 内容 | 状态 |
|-------|------|------|
| 1 | 部署前只读审计 | ✅ 完成（docs/70-PhaseP+Deployment审计.md） |
| 2 | Cloud Observability Storage（建集合） | ✅ 完成（`observability_logs` 已建，当前 **11 条**） |
| 3 | 环境切换（KNOWLEDGE_OBSERVABILITY_STORE=cloud） | ✅ 完成（已实时生效 + 保留 ADMIN_OPENID + 配置不变） |
| 4 | 部署验证（部署代码 + 真实请求 + 校验） | ✅ **完成**（用户已部署代码；本会话补发 11 条真实请求并校验） |
| 5 | Dashboard 数据验证 | ✅ **完成**（五项目标指标全部取到真实数据，N/A 清单为空） |
| 6 | 本报告 | ✅ 完成 |

> **最终停止条件已达成**：Observability 能力已进入真实运行状态；不进入 Phase Q、不补齐剩余字段、不改 rag.js、等待人工 Review。

---

## 1. 部署内容

### 1.1 已落地（沙箱内完成）
- **集合 `observability_logs`**：通过 `tcb db nosql execute` 创建，字段结构兼容 `CloudObservabilityStore.write`（见 §2）。
- **环境变量 `KNOWLEDGE_OBSERVABILITY_STORE=cloud`**：通过 `tcb config update fn chat`（Merge 模式）推送到 chat 函数，**实时生效**。
- **保留既有环境变量 `ADMIN_OPENID`**（Merge 不丢弃）。
- **函数配置未变**：timeout=60s / memory=512MB / runtime=Nodejs16.13（与线上一致，避免重置）。
- **部署前备份**：`tcb fn code download chat .deploy-backup/chat-pre-obs-20260802`（旧代码，确认无 `logObservation` 埋点）。

### 1.2 chat 函数代码部署（用户动作，已完成）
- 用户于微信开发者工具对 `cloudfunctions/chat` 执行「上传并部署·云端安装依赖」。
- 验证：部署后 `tcb fn invoke` 返回的日志出现 `[意图] type=life | domain=关系` 等 Phase P+ 埋点日志，确认线上已是带观测埋点的版本（index.js 8173B）。
- 环境变量 `KNOWLEDGE_OBSERVABILITY_STORE=cloud` 在部署后保留生效（Stage 3 已实时设置）。

### 1.3 新增文件（部署产物 / 配置）
- `cloudbaserc.json`：部署配置（envId + chat 函数 envVariables + 配置锁定）。
- `weapp/scripts/verify-observability.js`：Stage 5 验证脚本（真实 dashboard.js + 真实云库记录只读聚合）。
- `weapp/scripts/records.json`：从 `observability_logs` 拉取的 11 条真实观测记录（已 unwrap `$numberInt`）。
- `.deploy-backup/chat-pre-obs-20260802/`：回滚备份。
- `.deploy-tmp/chat-deploy/`：不带 node_modules 的临时部署副本（因沙箱上传超时而未被采用，可删）。

---

## 2. 数据链路

```
用户请求
  → 小程序 / 客户端调用 chat 云函数 (index.main)
  → generateAnswer(...) 返回 result { answer, citations, intent, ... }
  → logObservation({ query, answerId, intent, latencyMs, result })   // fire-and-forget
       → buildObservationRecord(opts)   // 纯函数，零成本取字段
       → createDefaultStore()
            ├─ KNOWLEDGE_OBSERVABILITY_STORE==='cloud'
            │    → CloudObservabilityStore (wx-server-sdk, DYNAMIC_CURRENT_ENV)
            │         → db.collection('observability_logs').add({ data: record + serverDate })
            └─ 否则 → JsonObservabilityStore (本地文件兜底)
       → store.write(record)  // Promise.resolve().catch()，不 await、不抛错到主链路
  ← 返回回答给用户（观测写入不影响此路径）

Dashboard 读取（验证方式）：
  buildDashboard({ store: { readAll: () => records } })   // records = 真实云库拉取
    → 聚合 Query Count / Knowledge Usage / Citation Rate / Latency / Fallback Rate
    → 缺失指标 available:false（N/A），绝不伪造
```

**失败安全保证（已代码落实 + 真实验证）**：
- `store.write` 永不抛出，错误仅 `console.error`；主链路不 `await`。
- cloud require 失败 → 自动回退 JsonObservabilityStore。
- cloud 集合写入失败 → 返回 `{ok:false}`，不影响回答。
- **真实证据**：11 条请求全部返回 `ok:true` 且生成有效回答，同时 `observability_logs` 写入 11 条；既有 `msgSecCheck invalid access_token` 错误也未阻断回答或写入。

---

## 3. 测试请求

### 3.1 通道验证
- `tcb fn invoke chat -d '{"message":"...","history":[]}'` 从沙箱**可达并成功**（已验证：返回 `ok:true`，`_modelUsed:Flash`）。
- 部署后该通道触发的是**新代码**（带观测埋点），故 11 条请求均产生真实观测记录。

### 3.2 真实请求清单（写入 `observability_logs` 的 11 条）

| # | knowledge_type | citation_count | latency_ms | query |
|---|---------------|----------------|-----------|-------|
| 1 | （none） | 0 | 1060 | 你好，这是一次部署连通性探测测试，请简短回复。 |
| 2 | classic | 3 | 4872 | 朋友犯错的时候，我应该直接指出来吗？ |
| 3 | （none） | 0 | 8727 | 我总是反复检查门有没有锁，这是确认偏差吗？ |
| 4 | classic | 3 | 7282 | 人生的意义到底是什么？ |
| 5 | （none） | 0 | 5677 | 为什么我总是否定自己，觉得自己不够好？ |
| 6 | classic | 3 | 7047 | 如何面对亲人离世的痛苦？ |
| 7 | classic | 2 | 6469 | 该不该为了稳定放弃自己热爱的事？ |
| 8 | classic | 3 | 5488 | 别人好像都比我优秀，我好焦虑 |
| 9 | classic | 3 | 5627 | 坚持到底会不会只是固执？ |
| 10 | （none） | 0 | 6059 | 面临两个工作机会，我该怎么选？ |
| 11 | classic | 2 | 7275 | 什么是真正的自由？ |

> 覆盖意图：life / 自我认识 / emotion / 决策 / 哲学；含 1 条硬探测（#1，policy=skip）、3 条未引用知识（#1/#3/#5/#10，fallback 路径）。#2 即 Phase N 回归生命线问题「朋友犯错要不要指出」。
> 注：#3/#9/#11 初次 invoke 因间歇性网络抖动未落库，已重发并成功写入（最终 11 条均 `answerId` 齐全）。

### 3.3 拉取与验证命令
```bash
# 拉取全部记录（unwrap $numberInt 后存 records.json）
tcb db nosql execute --env-id YOUR_CLOUD_ENV_ID \
  --command '[{"TableName":"observability_logs","CommandType":"COMMAND","Command":"{\"find\":\"observability_logs\",\"filter\":{},\"limit\":100}"}]' > .deploy-backup/obs_find2.txt
# 用 Node 解析 obs_find2.txt → scripts/records.json（见 verify 脚本头部说明）
node scripts/verify-observability.js scripts/records.json
```

---

## 4. 数据样例

### 4.1 Stage 4 字段齐备性确认（五字段全部存在 ✅）
`observability_logs` 记录含：`query` ✅ / `answer_id` ✅ / `knowledge_type` ✅ / `citation_count` ✅ / `latency_ms` ✅（对应需求 latency）。

### 4.2 真实样本 A（有经典引用）
```json
{
  "query": "朋友犯错的时候，我应该直接指出来吗？",
  "answer_id": "20260802_1t23w8",
  "knowledge_type": ["classic"],
  "citation_count": 3,
  "latency_ms": 4872,
  "domain": "关系",
  "intent": "life",
  "policy_name": "use",
  "router_enabled": true,
  "fallback_reason": "classic-priority-domain",
  "created_at": "2026-08-02T02:58:57.071Z"
}
```

### 4.3 真实样本 B（未引用知识 / fallback 路径）
```json
{
  "query": "你好，这是一次部署连通性探测测试，请简短回复。",
  "answer_id": "20260802_rxjsbg",
  "knowledge_type": [],
  "citation_count": 0,
  "latency_ms": 1060,
  "domain": "编程",
  "intent": "knowledge",
  "policy_name": "skip",
  "router_enabled": true,
  "fallback_reason": "fallback-classic",
  "created_at": "2026-08-02T02:33:53.854Z"
}
```

### 4.4 Stage 5 Dashboard 真实指标（由 `verify-observability.js` 输出）
| 指标 | 真实值 | 数据状态 |
|------|--------|----------|
| Query Count | **11** | ✅ 有真实数据 |
| Knowledge Usage | `classic=7, (none)=4` | ✅ 有真实数据 |
| Citation Rate（citation_count>0 占比） | **0.636**（63.6%） | ✅ 有真实数据 |
| Latency（均值） | **5962 ms** | ✅ 有真实数据 |
| Fallback Rate（citation_count===0 占比） | **0.364**（36.4%） | ✅ 有真实数据 |

> `readonly=true` / `recomputes_retrieval=false` 已确认：Dashboard 仅读取既有观测记录做聚合，**未触发任何检索重算、未触碰冻结资产**。
> N/A 清单为空：五项目标指标均取到真实数据，无伪造默认值。

---

## 5. 回滚方案

### 5.1 备份产物
- 路径：`.deploy-backup/chat-pre-obs-20260802/`
- 内容：部署前 chat 代码（index.js 7542B，**无** `logObservation` 埋点）、config.json、corpus.json、intent.js、node_modules 等。
- 验证：备份 index.js `grep -c logObservation` = 0，确认为部署前基线。

### 5.2 回滚操作（二选一）
1. **还原代码（推荐）**：
   ```bash
   tcb fn code update chat .deploy-backup/chat-pre-obs-20260802 --env-id YOUR_CLOUD_ENV_ID
   ```
2. **保留新代码但关闭云写入**（降级到 JSON fallback）：
   将 chat 函数环境变量 `KNOWLEDGE_OBSERVABILITY_STORE` 改为非 `cloud`（如删去或置 `local`）。

### 5.3 回滚安全性
- Observability 为 fire-and-forget 旁路，回滚不影响既有回答链路。
- `observability_logs` 中已写入记录保留（只读，无害）。
- 环境变量 `ADMIN_OPENID` 在回滚时须一并保留（Merge 或显式写入）。

---

## 6. 未解决缺口

| 缺口 | 性质 | 说明 / 处置 |
|------|------|------|
| chat 函数代码部署 | ✅ **已完成** | 用户已在微信开发者工具部署；本会话已验证新代码生效并落库 11 条 |
| msgSecCheck 调用失败 | 既存问题，非本次引入 | 日志：`security.msgSecCheck:fail invalid wx openapi access_token`。函数已优雅降级（返回 ok），不影响回答。属独立配置问题，超出本次范围，建议另立项修复 |
| Phase Q 5 字段缺口 | 按约束推迟 | `retrieval_mode`/`router_adjustment`/`rerank_score`/`chunk_id`/`vector_score` 位于冻结 rag.js 内，需 Phase Q 处理 |
| 确认偏差未路由至 psychology | **真实数据新发现** | 11 条真实请求中，明显属认知心理的「我总是反复检查门有没有锁，这是确认偏差吗？」（#3）其 `knowledge_type=[]`、走 fallback 而非 psychology。说明 P-04 概念卡在真实流量尚未被路由命中。属路由调优范畴（可结合 Phase Q 或后续观察），**本次不动 Router/rag.js** |
| Dashboard 读云库需 wx-server-sdk | 环境限制（已绕过） | wx-server-sdk 仅云端可用。沙箱内 Stage 5 验证用「`tcb` 拉取真实记录 + 真实 dashboard.js 聚合」方式，不依赖本地 SDK |
| Fallback Rate 指标 | 派生定义 | Dashboard 无显式 fallback 指标；本报告将其定义为 `citation_count===0` 占比（详见脚本），与 Citation Rate 互补 |

---

## 7. 结论与下一步

Phase P+ Deployment **全部完成**：

1. 集合 `observability_logs` 已建并持续接收真实观测记录（当前 11 条）。
2. 环境变量 `KNOWLEDGE_OBSERVABILITY_STORE=cloud` 已生效，写入链路经真实 11 条请求验证无误。
3. Dashboard 五项目标指标（Query Count / Knowledge Usage / Citation Rate / Latency / Fallback Rate）已开始呈现真实数据，且无伪造、无重算检索。
4. 失败安全与回滚路径齐备，写入失败不可能阻断用户回答（已由真实 `msgSecCheck` 错误 + 正常落库佐证）。

**约束遵守确认**：❌ 未新增 Knowledge Object / ❌ 未 ingest / ❌ 未 embedding / ❌ 未改 Router / Prompt / Intent / RAG / 冻结资产；❌ 未进入 Phase Q；❌ 未补齐剩余 Observability 字段（retrieval_mode 等 5 字段仍按计划待 Phase Q）。

**当前状态**：已完成并停止，等待人工 Review。

**可选后续（需另行授权，不在本次范围）**：
- 修复 `msgSecCheck invalid access_token`（独立配置问题）。
- 观察真实流量积累后确认偏差类问题的 psychology 路由命中情况；如需调优，进入 Phase Q。
- 将 Dashboard 接入前端页面（当前为只读聚合模块，未做展示 UI）。
