# Phase Q2-8-MVP · 上线激活报告（Activation Report）

> 角色：Release Manager + Production AI Reliability Engineer
> 目标：让「向晚问思（WenDao）」具备真实联网搜索能力，同时保持知识库冻结。
> 状态：**✅ 准备就绪（代码/配置/测试全绿）** ｜ **⛔ 未部署 / 未改生产环境变量 / 未 commit / 未扩量**

---

## 0. 执行边界（本阶段严格禁止）

| 禁止项 | 是否触碰 |
|---|---|
| ❌ `tcb fn deploy` | 否 |
| ❌ 修改生产环境变量（cloudbaserc.json 实际写入） | 否（仅生成 patch 草案） |
| ❌ commit / push | 否 |
| ❌ 开放全量用户（canary 限白名单） | 否 |
| ❌ 修改知识库（corpus/intent/knowledgeRouter/rag） | 否 |

---

## 1. Step 1 只读检查（不修改任何文件）

### 1.1 当前 `cloudbaserc.json` envVariables（生产态）
```json
{
  "ADMIN_OPENID": "YOUR_ADMIN_OPENID",
  "KNOWLEDGE_OBSERVABILITY_STORE": "cloud"
}
```
**结论**：生产环境**没有任何搜索相关变量** → 即使已部署新代码，也运行在 `SEARCH_PROVIDER=mock` / `FRESHNESS_FACTUAL_ENABLED=false` 的默认安全态，事实检索未激活。

### 1.2 当前 chat 云函数部署状态
- 新检索层代码（Q2-4 ~ Q2-7）**未部署**；线上仍运行旧版本 + 默认 env。
- 部署需 `tcb fn deploy chat --force`（COS 上传 ~52s），本阶段禁止。

### 1.3 当前 search provider 配置（代码默认）
- `SEARCH_PROVIDER` 默认 `mock`（安全默认态，见 `providers/search/index.js:73`）。
- `domesticFreeSearch.js`：仅当 `SEARXNG_BASE_URL` 配置才联网；否则 `no_endpoint` 确定性降级，绝不外呼。
- `FRESHNESS_ENABLED` 默认 `false` → 不加载 freshness 层（一键回滚点）。
- `FRESHNESS_FACTUAL_ENABLED` / `PRIVACY_GATE_ENABLED` / `SEARCH_CANARY_ENABLED` 默认 `false`。
- `SEARCH_TIMEOUT_MS=3000` / `SEARCH_MAX_RESULTS=5` / `SEARCH_DAILY_QUOTA=500` 为代码内置默认。

### 1.4 微信 request 合法域名配置说明
- 属微信公众平台**后台手动配置**，非代码/文件。当前**未配置** SearXNG 国内端点。
- 部署前必须把 `SEARXNG_BASE_URL` 的域名加进「开发管理 → 开发设置 → 服务器域名 → request 合法域名」，否则真机 `wx.request` 被拦截（IDE 可勾"不校验"绕过，真机不行）。

### 1.5 阻塞判定
| 维度 | 判定 |
|---|---|
| 代码/护栏层（privacy/canary/quota/audit/freshnessRuntimeGuard） | ✅ READY |
| L2 配置草案 | ✅ READY（已生成，未应用） |
| chat 云函数部署（含新代码） | ⛔ **BLOCKED** |
| SearXNG 国内服务实例 | ⛔ **BLOCKED**（未部署） |
| 微信 request 域名白名单 | ⛔ **BLOCKED**（未配置） |
| 小程序备案 B1 | ⛔ **BLOCKED**（审核中） |

> **综合判定：BLOCKED（暂不能真正联网）**。准备侧全绿，落地侧待授权推进 B1–B5。

---

## 2. Step 2 联网方案选型

**决策：采用国内 SearXNG 自托管（仅国内引擎）。**

| 维度 | 结论 |
|---|---|
| 选型 | 国内服务器部署 SearXNG（开源、无 API Key、零按量费用） |
| 引擎约束 | 仅启用国内引擎：`baidu,sogou,360,so,bing__chinese,wikidata,wiki` |
| 数据路径 | `data_route=domestic`，query 全程留境，**零跨境** |
| 成本评估 | 自托管仅需一台国内小规格 VM（通常现有基础设施已覆盖），**无第三方收费** |
| Fallback | 仅在自托管成本过高时评估腾讯云免费搜索 API；**本阶段不接入任何收费服务** |
| 合规依据 | PIPL 2026 出境四条路径；限定国内引擎 = 数据留境，规避跨境合规风险 |

> 与 Q2-5-B 评估一致：SearXNG 自托管（仅国内引擎）是「免费 + 无 Key + 留境」的最优解。

---

## 3. Step 3 生产配置草案（只生成 diff，未应用）

生成物：`docs/Phase-Q2-8-MVP-envVariables-patch.draft.json`

**⚠️ 用户 Q2-8 变量清单遗漏 2 项部署必需变量，已在草案中补全并标注：**

1. `FRESHNESS_ENABLED=true` —— **总闸**。缺此则 `index.js` 不加载 freshness 层，事实检索根本不可达（双开关设计：总闸 + 事实源闸）。
2. `SEARXNG_BASE_URL` + `SEARXNG_ENGINES` —— domestic 连通端点 + 强制国内引擎，否则 `domestic` 退化为 `no_endpoint`（不联网）或误配境外引擎（跨境）。

**完整 patch（proposed_envVariables）：**
```
FRESHNESS_ENABLED=true
SEARCH_PROVIDER=domestic
FRESHNESS_FACTUAL_ENABLED=true
PRIVACY_GATE_ENABLED=true
SEARCH_CANARY_ENABLED=true
SEARCH_CANARY_OPENIDS=oCANARY_q28_test_001   # 部署前替换为真实测试 openid
SEARCH_MAX_RESULTS=5
SEARCH_TIMEOUT_MS=3000
SEARCH_DAILY_QUOTA=500
SEARXNG_BASE_URL=https://<国内-SearXNG-端点>/search   # 部署前填真实国内 HTTPS
SEARXNG_ENGINES=baidu,sogou,360,so,bing__chinese,wikidata,wiki
```
保留既有：`ADMIN_OPENID` / `KNOWLEDGE_OBSERVABILITY_STORE`。
**严禁**：任何跨境 provider（`tavily`/`bing`/`serp`）；`SEARXNG_ENGINES` 不得含 `google`/`duckduckgo`/`brave` 等。

> 该 draft **未写入** `cloudbaserc.json`，未部署，未 commit。应用须待 Step 5 阻塞项清除后，由人工授权执行 `tcb fn deploy`。

---

## 4. Step 4 上线前验证（scripts/test_q28.js）

**运行：`node scripts/test_q28.js` → 217 PASS / 0 FAIL（零真实网络）**

### 4.1 六项用户验收（全部 ✅）
| # | 验收项 | 结果 |
|---|---|---|
| 1 | 搜索结果进入回答 | ✅ 17 条在线问答含 `【L2联网】` 标记 |
| 2 | 搜索失败自动回退 RAG | ✅ Q18(think 内部兜底) / Q19+Q20(fast 派发器回退) 均回退 `【RAG知识库回答】` |
| 3 | corpus SHA 不变化 | ✅ 4 冻结资产 SHA 前后一致（含 mtime，证明无写入） |
| 4 | embedding 数量不变化 | ✅ corpus 条目数 = 14（派生 embedding 向量数不变，无 ingest） |
| 5 | audit 不含 query/用户信息/全文/URL | ✅ 逐条 + 汇总扫描零泄露；guard 白名单通过 |
| 6 | data_route = domestic | ✅ 20/20 `domestic`（零 cross_border） |

### 4.2 护栏在线（验证项 5/6 支撑）
- PII 查询 → `pii_blocked` + `data_route=blocked` + **零外呼**（privacyGate 最前端拦截）
- 非白名单 openid → 强制 `mock`，`data_route` 仍 `domestic`
- 配额耗尽 → `quota_exceeded`，`data_route` 仍 `domestic`

### 4.3 隔离保证（知识库零污染）
- 搜索结果仅作请求级 runtime context，全程 `_ephemeral`；`ThinkContext.toSafeMeta()` 仅输出观测元信息。
- `audit` 仅 7 安全白名单字段，绝不含 query/URL/全文/用户信息。
- RAG 只读消费，不回写 corpus；全程无 `fs.write` 知识集合。

---

## 5. Step 5 上线清单（部署前最后阻塞项）

> 以下任一项未完成，均不得 `tcb fn deploy`。

| ID | 阻塞项 | 状态 | 责任方 | 备注 |
|---|---|---|---|---|
| B1 | SearXNG 国内实例部署（仅国内引擎） | ⛔ 未部署 | 运维 | 零跨境前提；须与 `SEARXNG_ENGINES` 一致 |
| B2 | 微信 request 合法域名白名单 | ⛔ 未配置 | 你（MP 后台） | 填 `SEARXNG_BASE_URL` 域名 |
| B3 | 应用 patch 并 `tcb fn deploy chat` | ⛔ 未执行 | 需授权 | 先读 `cloudbaserc.json` 核对，避免静默覆盖 |
| B4 | 小程序备案 B1 通过 | ⛔ 审核中 | 你 | 全量发布前提；L2 canary 可先于全量 |
| B5 | `SEARCH_CANARY_OPENIDS` 替换为真实测试 openid | ⛔ 占位 | 你 | 防止误扩量 |

**建议上线顺序**：B1 → B2 →（B3 部署）→ 用真实测试 openid(B5) 跑 L2 canary → 观察 audit/回退率 → B4 通过后扩量。

---

## 6. 未修改冻结资产证明

| 资产 | SHA256（前/后一致） | 状态 |
|---|---|---|
| corpus.json | `db01fbc92064cbea3a6688a98160b6a70c9e150259b54063c8e2e96974eabc8b` | ✅ 未变 |
| intent.js | `765ad138ec68c0f159c6f75a60e5268beb02fba152f6d53dbdc539ba1560ca38` | ✅ 未变 |
| knowledgeRouter.js | `848908445dbb5ea93a6f52775dc3c8e6922ff971d6cee115547f236ffed0a935` | ✅ 未变 |
| rag.js | `4fb2dca42597a277911472a3cf1e8411f9f5c08988c2712e38d260d58fc2b503` | ✅ 未变 |

> git status 中 `M corpus.json` / `M rag.js` 为历史遗留未提交标记；以 SHA256 比对为准，确认零改动。

---

## 7. 修改/新增文件清单

| 文件 | 类型 | 说明 |
|---|---|---|
| `docs/Phase-Q2-8-MVP-Activation-Report.md` | 新增 | 本报告 |
| `docs/Phase-Q2-8-MVP-envVariables-patch.draft.json` | 新增 | env patch 草案（DRAFT，未应用） |
| `scripts/test_q28.js` | 新增 | 上线前验证（217 PASS/0 FAIL） |
| `cloudbaserc.json` | **未改** | 仅产出草案，未写入 |
| corpus/intent/knowledgeRouter/rag | **未改** | 冻结资产，SHA 4/4 不变 |

---

## 8. 结论

代码、护栏、配置草案、上线前验证**全部就绪且全绿**；真实联网仍被 B1–B5 阻塞（运维部署 + 域名白名单 + 部署步骤 + 备案 + 真实测试 openid）。本阶段**未部署、未改生产 env、未 commit、未扩量**。

**下一步须人工授权**推进 B1–B5 后执行 `tcb fn deploy`，方可开展真实生产 L2 金丝雀。
