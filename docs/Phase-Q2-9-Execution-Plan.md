# Phase Q2-9：SearXNG 国内部署 + 微信域名配置 + L2 生产激活执行计划

- **角色**：Release Manager + Production AI Reliability Engineer
- **日期**：2026-08-07
- **状态**：📋 **执行计划（PLAN）已就绪** ｜ ⛔ **本阶段未执行任何不可逆操作**
  （未部署服务器 / 未代点微信控制台 / 未 `tcb fn deploy` / 未改写生产 env / 未 commit）
- **核心原则**：搜索结果仅作 runtime context；知识库冻结（corpus/intent/knowledgeRouter/rag 零改动）；零跨境（data_route=domestic）；fail-soft 回退 RAG。

---

## 0. 当前状态（来自 Q2-8 只读检查）

| 维度 | 状态 |
|---|---|
| 代码 / 护栏（privacy / canary / quota / audit / freshnessRuntimeGuard） | ✅ 已就绪、已接入 `searchLayer` 链路 |
| 离线金丝雀（test_q27 / test_q28） | ✅ 全绿（217 PASS / 0 FAIL），全程 `data_route=domestic` |
| 生产 env（cloudbaserc.json） | ❌ 仍仅 `ADMIN_OPENID` + `KNOWLEDGE_OBSERVABILITY_STORE`（搜索变量全缺） |
| 新检索代码部署 | ❌ 未 `tcb fn deploy` |
| SearXNG 国内实例 | ❌ 未部署 |
| 微信 request 域名白名单 | ❌ 未配置 |
| 小程序备案 B1 | ❌ 审核中 |

**结论**：准备侧 READY；落地侧阻塞于 B1（部署）+ B2（域名）+ B3（deploy）+ B4（备案）+ B5（真实 canary openid）。

---

## Part A — B1：SearXNG 国内部署（运维侧，需独立授权执行）

> 本阶段**仅产出部署包与 runbook**，不实际执行部署（需中国大陆服务器 + 备案域名，属外部基础设施动作）。

### A.1 部署包（已随仓库提供，位于 `infra/searxng/`）

| 文件 | 作用 |
|---|---|
| `settings.yml` | SearXNG 配置：**仅国内引擎**（baidu / sogou / so(360)），禁用 bing/google/ddg 等；监听 `127.0.0.1:8080`；`secret_key` 占位待替换 |
| `docker-compose.yml` | searxng + caddy 两容器；searxng 仅暴露本机，caddy 暴露 80/443 |
| `Caddyfile` | HTTPS 自动证书（Let's Encrypt）+ `Authorization: Bearer` 鉴权反向代理 |
| `README.md` | 完整部署 runbook（生成密钥→改配置→启动→冒烟→运维） |

### A.2 关键合规保证（零跨境）

- `settings.yml` 的 `engines:` 是**唯一可信来源**：只列出国内引擎，SearXNG 不会加载未列出的跨境引擎。
- `data_route=domestic` 的正确性**依赖运维将实例限定为国内上游**——代码层仅做结果标记。
- 部署后必须运行 `scripts/smoke_searxng.js`：
  - 请求 `/search?format=json`，确认 HTTP 200 + 有结果；
  - 收集返回 `engine` 字段，比对国内白名单；**检出任何跨境引擎即 FAIL**（settings.yml 误配）。

### A.3 费用

仅 CVM 实例费，**无按量检索费、无第三方 API Key**（符合 Q2-8「不接收费服务」约束）。

---

## Part B — B2：微信 request 合法域名配置（控制台手动，需用户操作）

> 本步骤**必须在微信公众平台控制台手动完成**，Agent 无法代点。

1. 登录 **微信公众平台** → 进入「向晚问思」小程序（APPID `wx2653f12589f9f89f`）。
2. 左侧 **开发** → **开发管理** → **开发设置** → **服务器域名**。
3. 在 **request 合法域名** 中添加：
   ```
   search.example.com
   ```
   （替换为 A.1 实际部署并已 **ICP 备案** 的域名；**不带 `https://` 协议头**。）
4. 保存；生效通常数分钟内，真机须用已备案域名。
5. ⚠️ 域名**必须已完成 ICP 备案**，否则微信拒绝接受（备案 B1 与域名白名单 B2 互为前置）。

---

## Part C — B3/B5：L2 生产激活（需显式 GO 授权）

### C.1 cloudbaserc.json `envVariables` 精确补丁

当前 `envVariables` 仅：
```json
{ "ADMIN_OPENID": "YOUR_ADMIN_OPENID", "KNOWLEDGE_OBSERVABILITY_STORE": "cloud" }
```

**待应用（GO 后写入）的 10 项新增变量**：
```json
{
  "FRESHNESS_ENABLED": "true",
  "FRESHNESS_FACTUAL_ENABLED": "true",
  "SEARCH_PROVIDER": "domestic",
  "PRIVACY_GATE_ENABLED": "true",
  "SEARCH_CANARY_ENABLED": "true",
  "SEARCH_CANARY_OPENIDS": "oCANARY_l2_test_001",
  "SEARXNG_BASE_URL": "https://search.example.com",
  "SEARXNG_ENGINES": "baidu,sogou,so",
  "SEARCH_MAX_RESULTS": "5",
  "SEARCH_TIMEOUT_MS": "3000",
  "SEARCH_DAILY_QUOTA": "500"
}
```

> ⚠️ 注意：
> - `FRESHNESS_ENABLED=true` 是**总闸**，缺它 freshness 层根本不加载（Q2-8 已验证）。
> - `SEARXNG_BASE_URL` 必须 = B1 实际域名，且已备案、已在 B2 白名单。
> - `SEARXNG_ENGINES` 与 `settings.yml` 的引擎清单应一致（baidu/sogou/so）。
> - `SEARCH_CANARY_OPENIDS` 替换为**真实测试微信号 openid**；仅该 openid 走真实 domestic，其余用户仍走 mock/RAG（L2 灰度）。
> - 本补丁**禁用任何跨境 provider**（tavily/bing/serp 不在配置中）。

### C.2 部署命令（GO 后执行）

```bash
# 在 weapp/ 目录
tcb fn deploy chat --force
```

> ⚠️ **部署前必读 `cloudbaserc.json`**：`tcb fn deploy` 会套用其 `envVariables/runtime/timeout/memorySize`，
> 与生产不一致会**静默覆盖**生产环境变量。务必先确认 C.1 补丁已正确写入且 runtime=Nodejs16.13、timeout/memory 与现网一致。

### C.3 L2 金丝雀验证（真实联调）

1. 用 `SEARCH_CANARY_OPENIDS` 中的测试号发起真实问答（覆盖实时时间/新闻/普通知识/经典问题）。
2. 观测 `logs` / `observability_logs`：
   - 联网结果进入回答 ✅
   - `search_audit.data_route = "domestic"` ✅（零跨境）
   - `search_audit` 无 query / openid / URL / 全文 ✅
   - 搜索失败自动回退 RAG ✅
3. 跑 `scripts/smoke_searxng.js` 确认实例合规（见 A.2）。
4. 跑 `scripts/test_q28.js` 确认离线回归仍全绿（217 PASS）。

---

## Part D — 回滚方案

| 风险 | 回滚动作 |
|---|---|
| 联网质量差 / 延迟高 | 将 `SEARXNG_BASE_URL` 置空 → `domesticFreeSearch` 立即 `no_endpoint` 降级，回答回退 RAG，零代码改动 |
| 检出跨境引擎 | 停 SearXNG 实例或修改 `settings.yml` 重启；同时置空 `SEARXNG_BASE_URL` |
| 想整体关闭事实搜索 | `FRESHNESS_FACTUAL_ENABLED=false`（或 `FRESHNESS_ENABLED=false` 一键关整个 freshness 层） |
| 部署异常 | 重新 `tcb fn deploy chat --force` 上一个已知良好版本；或临时改回 env 不含搜索变量 |

回滚均为 env/实例层操作，**不触碰知识库、不回滚代码冻结资产**。

---

## Part E — 验证清单（本阶段已可执行 / 待 B1 后执行）

| # | 验证项 | 状态 |
|---|---|---|
| 1 | 冻结资产 SHA 4/4 不变 | ✅ 本阶段 4/4（见 §1） |
| 2 | test_q28 离线回归全绿 | ⏳ 待本阶段末尾重跑确认 |
| 3 | smoke_searxng 合规（无跨境引擎） | ⏳ 待 B1 部署后 |
| 4 | 微信域名白名单配置 | ⏳ 待 B2 用户操作 |
| 5 | 真实 L2 canary 联调 | ⏳ 待 B3/B5 GO 后 |

---

## 1. 冻结资产证明（SHA256，基线对比）

| 文件 | SHA256 | 比对 |
|---|---|---|
| corpus.json | `db01fbc92064cbea3a6688a98160b6a70c9e150259b54063c8e2e96974eabc8b` | ✅ 基线 |
| intent.js | `765ad138ec68c0f159c6f75a60e5268beb02fba152f6d53dbdc539ba1560ca38` | ✅ 基线 |
| knowledgeRouter.js | `848908445dbb5ea93a6f52775dc3c8e6922ff971d6cee115547f236ffed0a935` | ✅ 基线 |
| rag.js | `4fb2dca42597a277911472a3cf1e8411f9f5c08988c2712e38d260d58fc2b503` | ✅ 基线 |

本阶段仅**新增** `infra/searxng/*` 与 `scripts/smoke_searxng.js`，**未修改**上述四文件及任何知识库/RAG/冻结代码。

---

## 2. GO 闸门（须用户显式授权方可执行）

| 闸门 | 动作 | 责任方 |
|---|---|---|
| G1 | 采购/准备中国大陆 CVM + 备案域名 | 用户 |
| G2 | 执行 `infra/searxng` 部署（B1） | 用户/运维（或授权 Agent 跑 runbook） |
| G3 | 微信控制台添加 request 域名（B2） | 用户 |
| G4 | 将 C.1 env 补丁写入 `cloudbaserc.json` | 需 GO |
| G5 | `tcb fn deploy chat --force`（B3） | 需 GO |
| G6 | 提供真实测试 openid 替换 `SEARCH_CANARY_OPENIDS`（B5） | 用户 |
| G7 | 真实 L2 canary 联调 + 扩量决策（B4 备案通过后） | 用户 |

> 本阶段交付**计划 + 部署包 + 验证脚本**，不代为跨过任何 GO 闸门。

---

## 3. 严禁事项（重申）

❌ 修改 corpus.json / intent.js / knowledgeRouter.js / rag.js
❌ 修改 Prompt / RAG 逻辑 / embedding / ingest
❌ 污染长期知识缓存
❌ 接入 tavily / bing / serpapi / 任何跨境 provider
❌ 开放全量用户（L2 仅限 canary openid）
❌ commit / push（除非另行授权）
❌ 实际 `tcb fn deploy`（除非 G5 GO）
