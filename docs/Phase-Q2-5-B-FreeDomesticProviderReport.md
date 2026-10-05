# Phase Q2-5-B 免费国内搜索 Provider 适配与评估实施报告

> 项目：向晚问思（WenDao）· 微信云开发小程序
> 角色：Chief AI Architect / AI Agent Engineer / Search Infrastructure Engineer / Release Guardian
> 阶段目标：在不改变现有生产行为的前提下，评估并实现一个「免费 / 低成本 / 国内数据路径」搜索 Provider 适配层，作为未来中国版默认候选，替代境外 Tavily/Bing/SerpAPI。
>
> **最终状态：✅ Phase Q2-5-B COMPLETE**
> ⛔ 未部署 · ⛔ 未开启真实搜索（`SEARCH_PROVIDER=mock`） · ⛔ 未配置生产 Key · ⛔ 未出网 · ⛔ 未 commit/push · ⛔ 未触碰冻结四资产
> 等待人工授权后再进入 L2 灰度 / 激活真实源。

---

## 1. 方案评估（摘要，详见评估文档）

评估文档：`docs/Phase-Q2-5-B-FreeSearchEvaluation.md`（Task 1，纯研究、未写码）。

| 方案 | 免费 | Key | 国内 | 不跨境 | 通用检索 | 结论 |
|---|---|---|---|---|---|---|
| 1 国内官方接口(百度/搜狗/360) | ❌ | 付费 | ✅ | ✅ | ❌ 无免费档 | 排除(无免费通用API) |
| 2 国内免费API(天行/聚合) | 🟡 | ✅ | ✅ | ✅ | 🟡 仅垂直feed | 补充源 |
| 3 **SearXNG 自托管** | ✅ | ❌ | 🟡(部署地) | ⚠️(引擎配置) | ✅ | **🥇 首选** |
| 4 RSS/公开源 | ✅ | ❌ | 🟡(源) | 🟡(源) | ❌ 非搜索 | 补充源 |
| 5 国内云厂商额度(腾讯云WSA) | 🟡 | ✅ | ✅ | ✅ | ✅ | 🥈 稳定fallback |

---

## 2. 推荐理由

**首选方案 3 — SearXNG 自托管（仅启用国内引擎）**，对齐项目硬性约束：

1. **免费优先** ✅ —— 零 API 费用、无调用上限，仅自有服务器成本。
2. **不跨境** ⚠️✅ —— 部署于中国大陆 + `engines` 锁定国内源（百度/搜狗/360/必应国内/微信/知乎/维基中文）→ query 全程留境，从根因消除 Q2-4-B 的 B2 跨境 P1 阻断。
3. **国内访问** ✅ —— 与微信云开发（腾讯云）同生态，可部署于同地域，低延迟。
4. **通用检索力** ✅ —— 70+ 引擎聚合，JSON API 直接对接 think/freshness 链路。
5. **闸门全复用** ✅ —— 接入 `providers/search` 后，privacyGate / canaryGate / quotaGuard / audit / `data_route` 自动生效（单一强制点）。
6. **风险可控** —— AGPL 仅内部自用无对外分发义务；稳定性靠自托管资源与上游限速配置。

> ⚠️ **关键运维约束（必须写入激活前 checklist）**：`data_route=domestic` 的正确性**依赖运维将 SearXNG 实例限定为国内上游引擎**。适配层提供 `SEARXNG_ENGINES` 环境变量以强制限定；若运维误配境外引擎，则退化为跨境（与 Tavily 无异），届时该源不满足「不跨境」，应回退方案 5（腾讯云 WSA）。

---

## 3. 新增文件

| 文件 | 类型 | 说明 |
|---|---|---|
| `providers/search/domesticFreeSearch.js` | **新增** | SearXNG 兼容免费国内适配层；`search(query, opts, nodeFetch)`；读 `SEARXNG_BASE_URL`(必填，空→不联网)、可选 `SEARXNG_API_KEY`(受保护实例)、可选 `SEARXNG_ENGINES`(强制国内引擎)；无 Key 要求。 |
| `scripts/test_q25b.js` | **新增** | 离线测试（fakeFetch 注入，零网络），41 断言覆盖 8 项要求 + KB 零污染。 |
| `docs/Phase-Q2-5-B-FreeSearchEvaluation.md` | **新增** | Task 1 方案评估文档。 |

---

## 4. 架构变化

### 4.1 修改文件（均为非冻结编排/支撑文件）

| 文件 | 变更 |
|---|---|
| `providers/search/index.js` | ① `require('./domesticFreeSearch')`；② `getProviderName()` 放行 `domestic`；③ `isRealProvider()` 增 `domestic`（配额/审计生效，防滥用）；④ 新增 `isDomesticProvider()`；⑤ `dataRouteOf()` 对国内源返回 `domestic`；⑥ `search()` 新增 `domestic` 分支；⑦ 导出 `isDomesticProvider`/`isRealProvider`。 |
| `providers/search/canaryGate.js` | `isRealProvider()` 增 `domestic` —— 使免费国内源同样受 per-user 灰度约束（否则灰度对 domestic 失效）。 |

> 冻结资产（corpus.json / intent.js / knowledgeRouter.js / rag.js）**零改动**，SHA 4/4 MATCH。

### 4.2 数据流（与既有链路一致，单一强制点）

```
用户 query
   ↓
searchLayer.search(query, opts)
   ├─ privacyGate    ① 最前端，fail-closed；PII → pii_blocked（data_route=blocked，零外呼）
   ├─ canaryGate     ② per-user 灰度；未命中白名单 → canary_blocked（强制 mock，零外呼）
   ├─ costGuard      ③ 配额检查（domestic 计入，防滥用）
   ├─ cache          ④ 命中早返回
   └─ provider       ⑤ domestic（SearXNG 兼容）→ 仅把脱敏 query 出境
        ↓
   audit { provider, latency_ms, cache_hit, downgrade_reason,
           quota_remaining, canary_blocked, data_route:'domestic' }
```

- `data_route` 枚举：`domestic`（国内源/本地）｜`cross_border`（tavily/bing/serp）｜`blocked`（隐私/合规拦截）。
- **零跨境保证**：依赖运维配置（SearXNG 国内部署 + 国内引擎），适配层以 `SEARXNG_ENGINES` 提供强制入口。

### 4.3 成本保护（任务四，免费仍保留）

`domestic` 源纳入 `isRealProvider` → `SEARCH_DAILY_QUOTA`(默认500) / `SEARCH_TIMEOUT_MS`(默认3000) / `SEARCH_MAX_RESULTS`(默认5) 全部生效：
- 配额耗尽 → `quota_exceeded` 降级，不无限调用；
- 硬超时 → `timeout` fail-soft，不被封/不卡死；
- 结果上限 → 降低噪声与下游负担。

---

## 5. 测试结果

### 本阶段（test_q25b.js）
```
Phase Q2-5-B 测试结果: 41 PASS / 0 FAIL
```
覆盖：① 默认 mock 不变 ② provider 注册成功 ③ fakeFetch 返回结果 ④ timeout fallback ⑤ privacyGate 拦截（data_route=blocked，零外呼）⑥ canary 拒绝（强制 mock）⑦ audit 字段严格 7 项白名单 ⑧ data_route=domestic（且 tavily 仍 cross_border，枚举未混淆）+ KB 零污染（corpus SHA 不变）。

### 全量回归（0 回归）
| 套件 | 结果 |
|---|---|
| test_q25b | 41 PASS / 0 FAIL |
| test_q24c (Q2-4-C) | 37 PASS / 0 FAIL |
| test_q24d (Q2-4-D) | 39 PASS / 0 FAIL |
| test_q24a (Q2-4-A) | 51 PASS / 0 FAIL |
| test_q23 (Q2-3) | 84 PASS / 0 FAIL |
| test_q21b | 37 PASS / 0 FAIL |
| test_freshness_q1 | 31 PASS / 0 FAIL |
| test_freshness | 32 PASS / 0 FAIL |
| test_capabilities | 75 PASS / 0 FAIL |
| test_pipeline | 16 PASS / 0 FAIL |
| test_security_hardening | 24 PASS / 0 FAIL |
| **合计** | **467 断言 / 0 失败** |

---

## 6. 风险说明

1. **R1 跨境依赖运维配置（高）**：`data_route=domestic` 的正确性取决于 SearXNG 实例**仅启用国内上游引擎**+国内部署。误配境外引擎 → 退化为跨境。缓解：激活前 checklist 强制 `SEARXNG_ENGINES` 限定国内源 + 部署地域校验；监控 `data_route` 分布告警。
2. **R2 AGPL 许可证义务（中）**：SearXNG 为 AGPL-3.0。本项目**内部自用 / 仅后端调用**不触发对外分发义务；若未来以网络服务对外提供，需按 AGPL 提供对应修改源码。
3. **R3 上游稳定性（中）**：国内引擎可能限速/封 IP，高并发需配置与轮换；1 vCPU/512MB 仅支撑个人/低流量。需容量规划。
4. **R4 内容合规（中）**：检索结果仍须经既有 `applySourceFilter`（黑白名单）+ `factExtractor` 事实核验 + `fabrication gate` 反幻觉闸；UGC/敏感内容走 `msgSecCheck` 既有链路。
5. **R5 未部署未激活（当前 OK）**：当前 `SEARCH_PROVIDER=mock`、`FRESHNESS_FACTUAL_ENABLED=false`，domestic 源处于 dormant 态，零外呼。激活仍需后续授权 + B1 备案 + 数据源择定。

---

## 7. 后续授权点

激活真实国内源（L2 灰度及之后）前，需依次授权/完成：

1. **A1 数据源择定授权**：确认采用 SearXNG 自托管（首选）或腾讯云 WSA（fallback），或两者并存（domestic 主 + tcloud 降级）。
2. **A2 运维前置（非代码）**：SearXNG 国内部署 + `format:json` + 限定国内引擎 + HTTPS/限速/访问控制；或腾讯云 WSA 开通与 Key 注入（密钥管理，禁明文）。
3. **A3 合规收尾**：B1 小程序备案完成；隐私政策补充「国内检索服务」告知（因数据留境，无需 PIPL 出境机制）。
4. **A4 L2 灰度授权**：以 `SEARCH_CANARY_ENABLED` + `SEARCH_CANARY_OPENIDS` 对白名单用户开放 `domestic`，监控 `data_route`/`latency`/`quota`/降级率。
5. **A5 放量授权**：验证门通过（3–7 天）后，置 `FRESHNESS_FACTUAL_ENABLED=true` + `SEARCH_PROVIDER=domestic`，进入 L3→L4。

---

## 8. 最终状态确认

- ✅ 免费国内 Provider 适配完成（`domesticFreeSearch.js`，SearXNG 兼容）
- ✅ 方案评估完成（5 类方案、推荐排序明确）
- ✅ 数据出口边界完成（`data_route=domestic`，依赖运维限定国内引擎）
- ✅ 测试通过（41 本阶段 + 467 全量，0 失败）
- ✅ 冻结资产未变化（SHA 4/4 MATCH）
- ⛔ 未部署
- ⛔ 未开启真实搜索（`SEARCH_PROVIDER=mock`）
- ⛔ 未配置生产 Key
- ⛔ 未出网
- ⛔ 未 commit/push
- ⛔ 未修改知识库/Prompt/RAG 策略

**不主动进入 L2 灰度，不主动激活真实源。等待下一步人工授权。**
