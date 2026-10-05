# Phase Q2-7 — Domestic Search L2 Canary Activation

**角色**：Release Manager + AI Reliability Architect
**目标**：让「向晚问思」进行第一次真实联网灰度测试的**准备与离线金丝雀验证**
**日期**：2026-08-07
**状态**：✅ L2 灰度配置就绪 + 离线金丝雀全绿（126 PASS / 0 FAIL）｜⛔ **未部署生产** ｜⛔ **未扩大用户范围**

---

## 0. 一句话结论

在 L2 灰度配置（仅 `domestic` provider）下，对 **20 条真实问题**（实时时间 / 新闻热点 / 普通知识 / 经典问题各 5）跑完整 `searchLayer → thinkEngine` 链路，结果：

- **联网检索结果作为 runtime context 进入回答** ✅
- **搜索失败时稳定回退 RAG 知识库** ✅
- **四冻结资产零改动**（SHA 4/4 + mtime 不变；corpus 14 条 = 派生 embedding 向量数不变）✅
- **审计仅含安全字段、无敏感信息** ✅
- **数据出境路径全程 `domestic`，零跨境** ✅

> ⚠️ 真实生产金丝雀仍需：① SearXNG 国内部署（仅国内引擎）② 微信 request 域名白名单 ③ 部署步骤 ④ 备案 B1。本阶段**仅完成准备与离线验证**，未触达上述任何一项。

---

## 1. 执行前检查（用户条款 1–2）

### 1.1 冻结资产 SHA 未变化
| 资产 | SHA256（前 16） | 结论 |
|---|---|---|
| corpus.json | `db01fbc92064cbea3…` | ✅ = 基线 |
| intent.js | `765ad138ec68c0f1…` | ✅ = 基线 |
| knowledgeRouter.js | `848908445dbb5ea9…` | ✅ = 基线 |
| rag.js | `4fb2dca42597a277…` | ✅ = 基线 |

### 1.2 五护栏全部在线（已接入 `providers/search/index.js` 调用链）
| 护栏 | 位置 | 验证结果 |
|---|---|---|
| privacyGate | 最前端（line 130） | ✅ PII 查询 → `pii_blocked` / `data_route=blocked` / **零外呼** |
| canaryGate | 其后（line 142） | ✅ 非白名单 openid → 降级 `mock` / `canary_blocked=true` |
| quota（shared.js CostGuard） | line 160 | ✅ 配额耗尽 → `quota_exceeded` / `quota_remaining=0` |
| audit（_audit 7 字段白名单） | line 219/224 | ✅ 全 20 问 + 护栏自检审计合规 |
| freshnessRuntimeGuard | 隔离校验器 | ✅ 正常 canary 结果通过 `makeIsolationReport` |

调用链（本层内）：`privacyGate → canaryGate → quota → provider → audit`，全部 fail-soft（永不抛未捕获异常）。

---

## 2. L2 灰度配置（用户条款 3 — 已准备，未应用）

草案见 `docs/Phase-Q2-7-L2-Canary-Config.draft.json`（**DRAFT / 未部署**）。核心变量：

```
SEARCH_PROVIDER=domestic
FRESHNESS_FACTUAL_ENABLED=true
PRIVACY_GATE_ENABLED=true
SEARCH_CANARY_ENABLED=true
SEARCH_CANARY_OPENIDS=oCANARY_l2_test_001
SEARXNG_BASE_URL=<国内 SearXNG 实例>
SEARXNG_ENGINES=baidu,sogou,360,...,wikipedia_zh   # 强制国内引擎
```

- **仅 domestic**：`tavily` / `bing` / `serpapi` / 任何跨境 provider 均**不在配置中、不在代码路径中**（断言全程无 `cross_border`）。
- **灰度收口**：非白名单 openid 强制 `mock` 降级，`data_route` 仍为 `domestic`，不扩大用户范围。
- **未改生产环境变量**：`cloudbaserc.json` 的环境变量未被修改；草案须经由部署步骤才生效（本阶段禁止）。

---

## 3. 测试：20 条真实问题（用户条款 — 测试）

**测试脚本**：`scripts/test_q27.js`（零真实网络，`fakeFetch` 模拟国内 SearXNG 返回带 `【L2联网】` 标记的结果；每问断言标记进入回答文本，证明「该问的检索结果」进入回答）
**结果**：**126 PASS / 0 FAIL**

### 3.1 逐条结果
| # | 类别 | 模式 | 联网结果进回答 | 回退RAG | data_route | audit合规 |
|---|---|---|---|---|---|---|
| 1 | 实时时间 | fast | ✅ | — | domestic | ✅ |
| 2 | 实时时间 | fast | ✅ | — | domestic | ✅ |
| 3 | 实时时间 | fast | ✅ | — | domestic | ✅ |
| 4 | 实时时间 | fast | ✅ | — | domestic | ✅ |
| 5 | 实时时间 | fast | ✅ | — | domestic | ✅ |
| 6 | 新闻热点 | fast | ✅ | — | domestic | ✅ |
| 7 | 新闻热点 | fast | ✅ | — | domestic | ✅ |
| 8 | 新闻热点 | fast | ✅ | — | domestic | ✅ |
| 9 | 新闻热点 | fast | ✅ | — | domestic | ✅ |
| 10 | 新闻热点 | fast | ✅ | — | domestic | ✅ |
| 11 | 普通知识 | fast | ✅ | — | domestic | ✅ |
| 12 | 普通知识 | fast | ✅ | — | domestic | ✅ |
| 13 | 普通知识 | fast | ✅ | — | domestic | ✅ |
| 14 | 普通知识 | fast | ✅ | — | domestic | ✅ |
| 15 | 普通知识 | fast | ✅ | — | domestic | ✅ |
| 16 | 经典问题 | fast | ✅ | — | domestic | ✅ |
| 17 | 经典问题 | fast | ✅ | — | domestic | ✅ |
| 18 | 经典问题 | think | — | ✅(think内部兜底) | domestic | ✅ |
| 19 | 经典问题 | fast | — | ✅(派发器兜底) | domestic | ✅ |
| 20 | 经典问题 | fast | — | ✅(派发器兜底/网络异常) | domestic | ✅ |

- **在线成功组（Q1–Q17，17 条）**：`data_route=domestic` 共 **17** 次，零 `cross_border`。
- **搜索失败回退组（Q18–Q20，3 条）**：含 1 条 `think` 内部 RAG 兜底 + 2 条 `fast` 派发器回退（其中 Q20 模拟网络异常 `provider_exception`），均回到 RAG 知识库，失败路径 `data_route` 仍为 `domestic`。

### 3.2 六项用户验收（全部 ✅）
| 验收项 | 结果 |
|---|---|
| 1. 联网结果进入回答 | ✅ 17/17 在线问标记命中 |
| 2. 搜索失败自动回退 RAG | ✅ Q18(think) / Q19 / Q20(fast 派发器) |
| 3. corpus SHA 不变 | ✅ `db01fbc9…abc8b` 前后一致 |
| 4. embedding 数量不变 | ✅ corpus 14 条（派生向量数）前后一致，无 ingest |
| 5. audit 无敏感信息 | ✅ 全部通过 `guard.verifyAudit`（仅 7 安全字段，无 URL/原文） |
| 6. data_route=domestic | ✅ 全 20 问 = domestic，零跨境 |

### 3.3 隔离不变量（Frozen-KB 守护）
- 全 20 问运行前后，四冻结资产 `SHA` 与 `mtime` 完全相等 → **知识库文件零写入**。
- `freshnessRuntimeGuard.verifyAnswerResult` / `makeIsolationReport` 对正常 canary 结果判定通过：无 `corpus/embedding/ingest/…` 疑似知识沉淀结构泄露。
- 搜索结果仅存活于请求内存（`_ephemeral` 硬标记贯穿 `search→fact→ThinkContext`）；`ThinkContext.toSafeMeta` 只输出观测元信息；RAG 只读消费。

---

## 4. 上线前置（仍阻塞 — 须授权后方可执行）

| # | 阻塞项 | 现状 | 责任 |
|---|---|---|---|
| B1 | SearXNG 国内部署（仅国内引擎） | 未部署 | 运维 |
| B2 | 微信 request 合法域名白名单（真机） | 未配置 | 公众平台 |
| B3 | 部署使 L2 配置生效（`tcb fn deploy`） | 禁止（本阶段） | RM |
| B4 | 小程序备案（B1）通过 | 审核中 | 运营 |
| B5 | `PRIVACY_GATE_ENABLED=true` 已在草案，但生产生效须随 B3 | 草案态 | RM |

---

## 5. 合规与边界（回顾）

- **数据出境**：仅 `domestic` 路径，query 经 privacyGate 脱敏后出境；PII 硬阻断（`blocked`）。本阶段零真实外呼，无数据实际出境。
- **最小权限**：canary 白名单 openid 唯一；其余用户零影响。
- **知识库冻结**：全程未修改 corpus/intent/knowledgeRouter/rag/Prompt/RAG 逻辑，无 embedding、无 ingest、无 metadata 写入、无长期缓存知识生成。
- **fail-soft**：搜索任意失败（空结果 / 超时 / 异常 / 配额 / 隐私 / 灰度拦截）→ 诚实降级或回退 RAG，绝不编造。

---

## 6. 交付物

| 文件 | 说明 |
|---|---|
| `docs/Phase-Q2-7-L2-Canary-Report.md` | 本报告 |
| `docs/Phase-Q2-7-L2-Canary-Config.draft.json` | L2 灰度配置草案（DRAFT / 未应用） |
| `scripts/test_q27.js` | 20 问 L2 金丝雀测试（126 PASS / 0 FAIL） |
| `freshnessRuntimeGuard.js` | 隔离校验器（Q2-6 已建，本阶段复用验证） |

**下一步**：等待授权执行 B1–B5（运维部署 + 域名白名单 + 部署 + 备案），方可开展**真实生产 L2 金丝雀**。本阶段不主动推进。
