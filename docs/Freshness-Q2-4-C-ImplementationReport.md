# 向晚问思 · Phase Q2-4-C 实现报告（真实源激活前最后一道灰度安全层）

> **角色**：Release Manager + AI Reliability Engineer + Privacy Architect
> **目标**：在真实 Search Provider 激活前，落地 per-user 灰度安全层（canary gate）+ 审计元数据。
> **严格边界（本阶段全部遵守）**：
> - ⛔ 禁止部署　⛔ 禁止修改生产环境变量　⛔ 禁止开启 `FRESHNESS_FACTUAL_ENABLED`
> - ⛔ 禁止调用真实搜索 API（仅 fakeFetch 注入离线验证）　⛔ 禁止修改 corpus/rag/intent/knowledgeRouter
> - ⛔ 禁止 commit/push
> - ✅ 允许：新增灰度模块 / 新增测试 / 新增 observability metadata / 修改非冻结编排文件

---

## 1. 修改文件列表

### 新增
| 文件 | 说明 |
|---|---|
| `cloudfunctions/chat/providers/search/canaryGate.js` | **灰度安全层核心**：`SEARCH_CANARY_ENABLED`（默认 false）+ `SEARCH_CANARY_OPENIDS`；`resolve(openid, requested, cfg)` 返回 `{provider, canaryBlocked, active}`。命中白名单放行真实源，未命中强制 mock，无身份 fail-closed。仅做相等比较，绝不记录 openid。 |
| `cloudfunctions/chat/scripts/test_q24c.js` | 离线测试（fakeFetch 注入），37 断言，覆盖 A–G 全部要求项。 |

### 修改（均为非冻结编排文件）
| 文件 | 改动 |
|---|---|
| `cloudfunctions/chat/providers/search/index.js` | `search()` 接入 canary（默认关闭零影响）；新增 `_audit()` 审计元数据；canary 拦截时**早返回、不调用任何 provider、无 `[MOCK]` 生成**。 |
| `cloudfunctions/chat/think/thinkEngine.js` | `gatherFacts` 向 `searchFn` 透传 `openid` 与 `__canary`；捕获 `res.audit` 上挂 `think.searchAudit`（fast/think 双路径）。 |
| `cloudfunctions/chat/freshness/index.js` | 检索调用透传 `opts.openid`；`meta.search_audit` 挂载审计元数据。 |
| `cloudfunctions/chat/index.js` | 向 `freshnessMaybeHandle` 与 `thinkEngineRun` 的 opts 各追加 `openid`（仅相等比较，不记录）。 |

> 冻结四资产（corpus/intent/knowledgeRouter/rag）**零改动**。

---

## 2. 设计要求落地

### A. SEARCH_CANARY_GATE
- **开关**：`SEARCH_CANARY_ENABLED`（默认 `false`，关闭时 `resolve` 原样返回，零行为变化）。
- **白名单**：`SEARCH_CANARY_OPENIDS`（逗号分隔 openid）。
- **规则**：
  - 闸门关闭 → 不介入，真实源按全局总闸 `FRESHNESS_FACTUAL_ENABLED` 决定。
  - 闸门开启 + 请求 **mock/none** → 不受影响（只对真实源做灰度）。
  - 闸门开启 + 请求 **真实源**：
    - openid 命中白名单 → 放行（provider 不变）。
    - openid 缺失/`unknown`/未命中 → **强制 mock**（fail-closed，宁可不给真实源也不误放）。
- **与总闸关系**：`FRESHNESS_FACTUAL_ENABLED`（事实源总闸，最高）↘ 开启后，`SEARCH_CANARY_ENABLED` 作为 per-user 子闸，仅白名单真正打到真实源，其余诚实降级。

### B. Search Audit Metadata
仅记录安全字段，附在每次 `search()` 结果的 `audit` 中并上行至 `think.searchAudit` / `freshness.meta.search_audit`：

| 字段 | 含义 |
|---|---|
| `provider` | 实际生效 provider（含被 canary 强制为 mock 的情况） |
| `latency_ms` | 本次检索耗时 |
| `cache_hit` | 是否命中进程内缓存 |
| `downgrade_reason` | 降级原因（empty_query/no_provider/quota_exceeded/canary_blocked/timeout/all_filtered/…） |
| `quota_remaining` | 当日配额余量（非真实源为 `-1`） |
| `canary_blocked` | 是否因灰度拦截 |

**禁止记录**（已通过测试 F 验证）：用户原文、完整搜索结果（含 snippet）、openid 等个人信息。canary 闸门仅做相等比较，不存储 openid。

### C. 测试覆盖（`test_q24c.js`，37 断言全绿）
1. **白名单命中** — canary 放行，provider 保持真实源。
2. **白名单拒绝** — 强制 mock；检索层**零 provider 调用**（验证 `fetchCalls=0`，无真实外呼）。
3. **quota 熔断** — 日配额耗尽 → `ok:false, reason=quota_exceeded`。
4. **timeout fallback** — 硬超时 → `reason=timeout`，fail-soft 不抛未捕获异常。
5. **mock 泄漏检测** — canary 拒绝经 thinkEngine 回退 RAG，用户可见 `answer` 无 `[MOCK]`；真实源结果本身不含 `[MOCK]`。
6. **ephemeral 隔离检测** — 审计字段严格限于白名单；审计/结果序列化不含用户原文与完整 snippet；canary 不留存 openid；全流程 `corpus.json` SHA 不变（KB 零污染）。
7. **默认安全态** — canary 关闭时无任何行为变化。

---

## 3. 测试结果

```
Phase Q2-4-C 测试结果: 37 PASS / 0 FAIL
```

**全量回归（本阶段 + 历史）全部通过：**

| 测试 | 结果 |
|---|---|
| test_q24c（本阶段） | 37 / 0 |
| test_q24a（Q2-4-A） | 51 / 0 |
| test_q23（Q2-3） | 84 / 0 |
| test_q21b | 37 / 0 |
| test_freshness_q1 | 31 / 0 |
| test_freshness | 32 / 0 |
| test_capabilities | 75 / 0 |
| test_pipeline | 16 / 0 |
| test_security_hardening | 24 / 0 |
| **合计** | **387 断言全绿** |

> 新增 `audit` / `searchAudit` 字段未破坏任何既有断言（thinkEngine / search 层测试仍全绿）。

---

## 4. SHA 检查（代码完整性）

本阶段改动的模块均通过 `node --check` 语法校验。关键模块摘要：
- `canaryGate.js`、`providers/search/index.js`、`think/thinkEngine.js`、`freshness/index.js`、`index.js` 语法校验 OK。
- 测试与运行时逻辑经 387 断言验证，无不一致。

---

## 5. 冻结资产确认

```
db01fbc92064cbea3a6688a98160b6a70c9e150259b54063c8e2e96974eabc8b  corpus.json
765ad138ec68c0f159c6f75a60e5268beb02fba152f6d53dbdc539ba1560ca38  intent.js
848908445dbb5ea93a6f52775dc3c8e6922ff971d6cee115547f236ffed0a935  knowledgeRouter.js
4fb2dca42597a277911472a3cf1e8411f9f5c08988c2712e38d260d58fc2b503  rag.js
```

**4/4 MATCH** —— 与 Q2-4-A / Q2-3 基线一致，四冻结资产零改动。

---

## 6. 未部署确认

- ⛔ **未部署**：云函数未重新上传，生产代码未变更运行实例。
- ⛔ **未修改生产环境变量**：本阶段仅读取环境变量（未在任何云控制台/配置写入 `SEARCH_CANARY_*` / `FRESHNESS_FACTUAL_ENABLED` / `SEARCH_PROVIDER` 等）。
- ⛔ **未开启 `FRESHNESS_FACTUAL_ENABLED`**：保持默认 `false`，真实源总闸关闭。
- ⛔ **未调用真实搜索 API**：所有验证经 `fakeFetch` 注入离线完成，无任何外网请求。
- ⛔ **未 commit/push**：无版本库提交。

---

## 7. 与 Q2-4-B 检查报告的衔接

Q2-4-B 将「per-user 灰度开关（`SEARCH_CANARY_OPENIDS`）」列为 **Q2-4-C 候选**。本阶段已完成该候选：
- 灰度闸门代码落地（canaryGate.js），默认关闭、零影响。
- 接入检索层最前端，对 thinkEngine 与 Freshness 双路径统一生效。
- 配合既有熔断矩阵（L0 mock → … → L3 软开），**L2 内部白名单灰度现已可落地**：
  ```
  SEARCH_CANARY_ENABLED=true
  SEARCH_CANARY_OPENIDS=openid_vip1,openid_vip2
  FRESHNESS_FACTUAL_ENABLED=true   # 总闸开（仍需先解 B1/B2）
  SEARCH_PROVIDER=tavily
  TAVILY_API_KEY=<密钥管理注入>
  ```
  非白名单用户自动回到 RAG/反思，白名单用户进入真实源——爆炸半径被锁在白名单内。

---

## 8. 下一阶段建议

当前状态：**停止，等待授权。** 灰度安全层已就绪，但真实源激活仍受 Q2-4-B 的 P1 硬阻断约束：

1. **P1 合规前置（必须先解）**
   - B1 小程序备案通过（当前审核中）。
   - B2 跨境数据合规评估（Tavily/Bing/SerpAPI 均境外；需 PIPL/DPA + 隐私政策更新；或引入国内检索中继规避直接越境）。
   - B3 request 合法域名白名单（`api.tavily.com` 等）配置。
2. **L2 灰度演练（合规解除后）**：用本阶段 `SEARCH_CANARY_*` 对内部白名单做真实源灰度，观测 §B 审计指标（latency/quota/canary_blocked 占比/mock 泄漏=0）。
3. **监控埋点补全（Q2-4-B L3 待办）**：当前审计元数据已就绪，建议补 latency 精细分位与跨境审计日志后，再放大至 L3/L4。
4. **后续阶段**：待 B1/B2 双解且 L2 指标达标，执行 Q2-4-B 的 L3→L4 分级放量。

> 本阶段**未部署、未开启、未触网**。任何生产激活须后续显式授权，并满足 Q2-4-B §4 全部非阻断项。
