# Phase Q2-4-A 实现报告：接入真实 Search Provider（代码完备 · 离线验证）

> 项目：向晚问思 (WenDao) · 微信云开发小程序 AI 思辨助手
> 阶段：Q2-4-A（真实 Search Provider 工程化接入 · 等待切换授权）
> 日期：2026-08-06
> 状态：**已完工 · 未部署 · 未接真实网络 · 等待后续授权切换生产搜索源**

---

## 0. 授权范围回顾

| 项 | 授权 | 本阶段执行 |
|---|---|---|
| 修改 `providers/search/` | ✅ 允许 | util.js / shared.js(新) / index.js / tavily.js / bing.js / serp.js 全部就位 |
| 修改非冻结编排代码 | ✅ 允许 | 仅 `providers/search/` 内部（index.js 属该目录），未触 index.js(chat 根) |
| 新增测试 | ✅ 允许 | `scripts/test_q24a.js`（51 断言） |
| 部署 | ❌ 禁止 | **未部署** |
| 改 corpus.json / intent.js / knowledgeRouter.js / rag.js | ❌ 禁止 | **未触碰，SHA 4/4 MATCH** |
| 知识入库 / embedding | ❌ 禁止 | **未触** |

八项要求落实：①保留 `SEARCH_PROVIDER=mock` 默认安全态 ✅ ②新增真实 provider ✅ ③API key 环境变量读取 ✅ ④timeout/retry/cache ✅ ⑤来源过滤 ✅ ⑥成本保护 ✅ ⑦离线测试 + mock 回归 ✅ ⑧Implementation Report ✅

---

## 1. 交付物清单

### 新增 / 修改：`cloudfunctions/chat/providers/search/`

| 文件 | 动作 | 职责 |
|---|---|---|
| `shared.js` | **新增** | 成本保护守卫 `createCostGuard(getQuota)`：进程内按 UTC 日期计数的日配额，唯一接口 `allowed()/remaining()/record()/reset()`。 |
| `util.js` | 修改 | 新增 `withTimeout`（硬超时，与 nodeFetch 实现无关）、`withRetry`（指数退避；5xx/网络/超时重试，4xx 不重试）、`applySourceFilter`、`parseList`、`extractDomain`、`stripTracking`、`toInt`；`normalizeResult` 现在剥离 `utm_*/spm` 等追踪参数并补全 source 域名。 |
| `tavily.js` | 重写 | **参考实现真实 provider**：读 `TAVILY_API_KEY`/`TAVILY_SEARCH_URL`；`include_domains`/`exclude_domains` 在 API 侧预过滤（省配额）；无 key 立即 `ok:false`；传输/HTTP 错误**抛出**交由 index 重试。 |
| `index.js` | 重写 | 统一编排：路由 + 缓存 + **超时/重试包装** + **来源过滤** + **成本保护** + **结果上限**；配置从环境变量读（`_setConfig` 供测试注入）；`mock` 默认安全态；fail-soft。 |
| `bing.js` / `serp.js` | 修改 | 移除内部 `.catch`（传输错误上抛给 index 重试）；无 key/无结果仍返回 `ok:false`（确定性、不重试）；与 Tavily 共享 index 层全部加固。 |

### 新增测试：`scripts/test_q24a.js`（51 断言，全依赖注入、零网络）

### 设计要点：真实 provider 的 fail-soft 责任划分
- **provider 层**只负责：无 key/无 fetch → `ok:false`（确定性，不重试）；200 但无结果 → `ok:false`（确定性）；**传输/HTTP 错误 → 抛出**（让编排层决定重试）。
- **index 编排层**负责：`withTimeout`+`withRetry`（重试 transient）+ `applySourceFilter` + `CostGuard` + 结果上限 + 最终 `try/catch` 兜底 `ok:false`（永不泄漏未捕获异常）。
- 这样 `bing/tavily/serp` 三个真实源统一获得超时/重试/来源过滤/成本保护，无需各写一份。

---

## 2. 七项机制落实明细

### ① 保留 `SEARCH_PROVIDER=mock` 默认安全态
`getProviderName()` 默认读 `mock`；未知值降级为 `none`。默认环境下真实源完全不触发，行为与 Q2-3 完全一致（零回归）。

### ② 新增真实 provider
- **Tavily** 作为参考实现真实 provider（LLM 优化摘要，最契合「事实+引用」场景，见 Phase-Q2-Search-Policy §2）。
- Bing / SerpAPI 同步具备真实调用能力，并共享 index 层加固。
- **真实激活条件（三层闸，全部满足才出网）**：`SEARCH_PROVIDER=tavily|bng|serp` **且** `FRESHNESS_FACTUAL_ENABLED=true` **且** 对应 API Key 已配置。任一不满足 → 维持无事实源反思行为。

### ③ API key 环境变量读取
- `TAVILY_API_KEY` / `TAVILY_SEARCH_URL`（默认 `https://api.tavily.com/search`）
- `BING_SEARCH_KEY` / `BING_SEARCH_URL`
- `SERPAPI_KEY` / `SERPAPI_URL`
- 无 key → 立即 `ok:false`，**绝不抛异常**，且**不发起任何网络请求**。

### ④ timeout / retry / cache
- **超时**：`SEARCH_TIMEOUT_MS`（默认 3000ms，≤3s 政策 §4），`withTimeout` 用 `Promise.race` 实现，不依赖 nodeFetch 的 timeout 选项。
- **重试**：`SEARCH_RETRY`（默认 2，共最多 3 次），指数退避（300/600ms）。`defaultShouldRetry`：5xx / 网络错误 / 超时 → 重试；**4xx（鉴权/配额）→ 不重试**。
- **缓存**：进程内 `query` 归一化 key，TTL 10 分钟，上限 200 条。**缓存命中不计配额**、不触发外呼。

### ⑤ 来源过滤
- `SEARCH_BLOCKED_DOMAINS`（黑名单）/`SEARCH_ALLOWED_DOMAINS`（白名单，优先）。
- 在 index 层对全部 provider 结果统一过滤；`applySourceFilter` 按域名判定。
- Tavily 额外在 API 侧传 `exclude_domains`/`include_domains`，**服务端预过滤**进一步省配额、降噪。

### ⑥ 成本保护
- `SEARCH_DAILY_QUOTA`（默认 500，按 UTC 日计）：仅对真实 provider 计费，**缓存命中不计**。
- 超限 → `ok:false reason='quota_exceeded'`，上层降级为无事实源反思。
- `SEARCH_MAX_RESULTS`（默认 5）：单查询最大结果数，降低下游噪声与成本。
- **已知局限**：进程内计数，云函数冷启动会重置；跨实例强一致需后续接 `search_quota` 集合（build-only 阶段不引入 DB 依赖）。

### ⑦ 离线测试 + mock 回归
- 新增 `test_q24a.js`：51 断言覆盖 util 纯函数 / CostGuard / Tavily 直调 / index 集成（mock 默认+缓存、Tavily 真实路径、超时、重试、来源过滤、配额、上限、fail-soft）/ corpus SHA 不变。
- 全部用 `retriever.nodeFetch` 注入 `fakeFetch`，**零网络**。

### ⑧ Implementation Report（本文件）

---

## 3. 测试结果

### Q2-4-A 专属（test_q24a.js）
```
PASS: 51   FAIL: 0
```
覆盖：A util 纯函数 / B CostGuard / C Tavily 直调（无key·正常·网络·5xx） / D index 集成（D0 默认 mock · D1+D2 缓存 · D3 真实路径 · D4 无key · D5 超时 · D6 重试 · D7 来源过滤 · D8 配额 · D9 上限 · D10 fail-soft） / E 冻结 SHA 不变。

### 全量回归（350 断言全绿）
| 套件 | 结果 |
|---|---|
| test_q21b (Q2-1-B) | 37 PASS |
| test_q23 (Q2-3) | 84 PASS |
| test_freshness_q1 (Q1-B) | 31 PASS |
| test_freshness (Q1.5) | 32 PASS |
| test_capabilities (Phase R) | 75 PASS |
| test_pipeline | 16 PASS |
| test_security_hardening | 24 PASS |
| **test_q24a (本阶段)** | **51 PASS** |
| **合计** | **350 PASS / 0 FAIL** |

### 冻结四资产 SHA（复核 4/4 MATCH）
```
corpus.json       db01fbc9...74eabc8b  ✓
intent.js         765ad138...1560ca38  ✓
knowledgeRouter.js 84890844...fed0a935  ✓
rag.js            4fb2dca4...d58fc2b503 ✓
```

---

## 4. 数据隔离（KB 零污染）

- 检索结果仅存在于请求内存（searchContext），随回答生成结束即释放，**绝不写入** corpus / embedding / metadata / history。
- `test_q24a.js` E1 断言：跑过 mock + Tavily(注入) 混合检索流程后，`corpus.json` SHA 与流程前**逐字节一致**。
- `normalizeResult` 剥离 `utm_*/spm` 等追踪参数，降低引用噪音。

---

## 5. 回滚与默认安全

| 层级 | 手段 | 影响 |
|---|---|---|
| 默认态 | `SEARCH_PROVIDER=mock` | 真实源完全不触发，行为与 Q2-3 一致 |
| 成本闸 | `SEARCH_DAILY_QUOTA` / `FRESHNESS_FACTUAL_ENABLED=false` | 即使误配 provider，事实源总闸关则不出网 |
| 配置 | 全部 env 可配，无硬编码密钥 | 生产密钥走环境变量，不入代码 |

---

## 6. 风险与开放项

- **真实源激活仍卡 P1 OPEN（未解）**：
  1. **搜索供应商选型 + API 密钥** — 本阶段仅写好读取逻辑，未配置真实密钥（且按约束未接真实 API）。
  2. **跨境数据 / 内容合规** — 小程序**备案审核中**；任何境外源 = 用户查询可能含 PII 出境，须满足 PIPL 跨境要求或选境内可签 DPA 的供应商（政策 §2 红线）。联网呈现第三方内容亦扩大平台内容安全责任。
  3. **成本配额** — 可先用默认 500/日，但需运营监控；建议后续接 `search_quota` 集合做跨实例强一致计数。
- **未做真实联调**：真实 provider 仅经注入 `fakeFetch` 离线验证，未对 Tavily/Bing/SerpAPI 实际端点发起请求（按约束「禁止接真实搜索 API」+「等待后续授权」）。上线前需在隔离环境用真实 key 跑通成功率/延迟基线。
- **未部署**：所有变更仅在源码层，未 `tcb fn deploy`，真机/线上无影响。

---

## 7. 禁止事项确认

- ✅ 未部署（未执行任何 deploy 命令）
- ✅ 未接真实搜索 API（仅注入 fakeFetch 离线验证；真实 key 未配置、未出网）
- ✅ 未修改知识库（corpus / embedding 未动）
- ✅ 未触碰四冻结资产（SHA 4/4 MATCH）

---

## 8. 下一步

等待后续授权。候选动作（须用户明确授权后执行）：
1. **切换生产搜索源**：配置真实 API 密钥 + 置 `SEARCH_PROVIDER=tavily`（或 bing/serp）+ 置 `FRESHNESS_FACTUAL_ENABLED=true`，并在隔离环境用真实 key 跑通联调基线。
2. **合规前置**：确认小程序备案审核状态与类目是否允许「资讯/搜索」能力；评估跨境数据传输方案（PIPL / DPA）。
3. **成本可观测**：接 `search_quota` 集合实现跨实例日配额强一致；补充真实源成功率/延迟监控。
4. **部署**：随前述前置齐备后，经 `tcb fn deploy` 上线（本阶段未部署）。

---
*本报告由 WeChat Mini Program Developer Agent 在 Phase Q2-4-A 完工后产出。所有结论均有离线测试（51 断言）与全量回归（350 断言）及 SHA 复核支撑。*
