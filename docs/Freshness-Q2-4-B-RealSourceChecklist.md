# 向晚问思 · Phase Q2-4-B 真实源接入检查报告（配置与灰度准备）

> **阶段定位**：Phase Q2-4-A（真实 Provider 代码层）已完工、离线测试全绿、未部署。
> 本阶段 **Q2-4-B = 配置与灰度准备**，目标是把「真实源接入前必须确认的一切」落成一份可勾选的检查报告。
>
> **刚性边界（本阶段）**：
> - ✅ 允许：枚举配置项、设计灰度方案、出具检查清单、准备可粘贴的环境变量模板。
> - ⛔ 禁止：部署、翻转任何生产开关、全量/小比例开启真实源、修改代码或知识库。
> - **本阶段零代码改动、零部署。** 所有激活动作均为「待操作员在云控制台执行」的预案。

---

## 0. 状态图例

| 标记 | 含义 |
|---|---|
| ✅ Ready | 已具备 / 已离线验证 / 可立即执行 |
| ⏸ Pending | 待办，需某前置条件达成 |
| ⛔ Blocked | 被合规/政策阻断（P1），未解前不得激活 |
| ⚠ Caveat | 已知注意点 / 潜在坑，需操作前知悉 |

---

## 1. 当前状态基线（默认安全态）

| 项 | 当前值 | 说明 |
|---|---|---|
| `SEARCH_PROVIDER` | `mock` | 默认安全态，真实源完全不调用 |
| `FRESHNESS_FACTUAL_ENABLED` | `false` | 事实源总闸关闭 → 上层维持「诚实边界 + 反思」 |
| `FRESHNESS_ENABLED` | `false` | Freshness 层 L1 总闸关闭（index.js:21/30） |
| `THINK_ENGINE_ENABLED` | `true` | 问思融合引擎主开关开启（但事实源闸仍关） |
| Provider 密钥 | 未配置 | `TAVILY_API_KEY` 等均未注入 |
| 真实网络调用 | 0 | 仅 `fakeFetch` 注入离线验证过，未出网 |
| 冻结四资产 SHA | 4/4 MATCH | corpus/intent/knowledgeRouter/rag 未触碰 |

**结论**：当前生产态为「零真实源、零外呼、零事实编造」的安全基线。Q2-4-A 已让代码具备真实源能力，但所有开关默认维持关闭。

---

## 2. 真实源激活路径与双重闸门（核心发现）

真实检索只通过 `providers/search` 统一层（`searchLayer.search`），由两条上层路径调用：

### 2.1 thinkEngine 路径（问思融合主目标，单闸）
- 调用方：`think/thinkEngine.js` → `searchGate` 检查 `factualEnabled` + `searchProvider`。
- 激活条件（**三者同时**）：
  1. `FRESHNESS_FACTUAL_ENABLED=true`
  2. `SEARCH_PROVIDER=tavily`（或 bing/serp）
  3. 对应密钥已配置（`TAVILY_API_KEY` 等）
- **不依赖** `FRESHNESS_ENABLED`（thinkEngine 独立于 Freshness 层加载）。
- 这是 Phase Q2-4 的主要真实源落点（think 模式 = Search + RAG + 推理）。

### 2.2 Freshness 路径（B/C/D 类，双重闸 ⚠ Caveat）
- 调用方：`freshness/index.js:177` 入口闸读 **老变量** `FRESHNESS_SEARCH_PROVIDER`（默认 `none`）；
  通过后于 `:228` 委托 `searchLayer.search`（读 `SEARCH_PROVIDER`）。
- 激活条件（**四个同时**）：
  1. `FRESHNESS_ENABLED=true`（L1 总闸，否则整层不加载）
  2. `FRESHNESS_FACTUAL_ENABLED=true`
  3. `FRESHNESS_SEARCH_PROVIDER != none`（**仅作开关，`http` 即可，不代表用该 provider 检索**）
  4. `SEARCH_PROVIDER=real` + 对应密钥
- ⚠ **坑**：仅置 `SEARCH_PROVIDER=tavily` 而 `FRESHNESS_SEARCH_PROVIDER` 仍为 `none` 时，Freshness 路径会在 `:177` 提前短路，**真实源不生效**。两者必须同步置位。
- 建议（非本阶段）：未来统一为单一闸门（如让 `:177` 也读 `SEARCH_PROVIDER`），列为 P2 清理项。

> **本阶段推荐首发路径 = 2.1 thinkEngine**，因其单闸、可控、且是 Q2-4 设计主目标；Freshness 路径留作 L4 后续，需额外注意双闸。

---

## 3. 配置项总览（环境变量模板）

> 下列变量均在**云函数环境变量**（云控制台 / `cloudbaserc.json` envVariables）配置。
> 当前代码**未读取** `cloudbaserc.json` 中的这些键（grep 无命中），说明现由云控制台注入或尚未配置。
> 下方「待粘贴值」为 L3 灰度建议值，L4 生产值见 §5。

| # | 变量名 | 作用域 | 当前/默认 | L3 灰度值 | L4 生产值 | 必须 | 风险 |
|---|---|---|---|---|---|---|---|
| 1 | `SEARCH_PROVIDER` | 全检索层 | `mock` | `tavily` | `tavily` | ✅ | 未知值→降级 `none`，安全 |
| 2 | `FRESHNESS_FACTUAL_ENABLED` | 事实源总闸 | `false` | `true` | `true` | ✅ | 真源唯一总闸 |
| 3 | `TAVILY_API_KEY` | tavily 源 | 未配置 | 真实 Key | 真实 Key | ✅(选tavily) | 无 key→`ok:false` 不出网 |
| 4 | `TAVILY_SEARCH_URL` | tavily 端点 | `api.tavily.com/search` | 默认 | 默认 | ⏸ | 可覆盖 |
| 5 | `BING_SEARCH_KEY` | bing 源 | 未配置 | — | 备用 | ⏸ | 选 bing 时必填 |
| 6 | `SERPAPI_KEY` | serp 源 | 未配置 | — | 备用 | ⏸ | 选 serp 时必填 |
| 7 | `SEARCH_TIMEOUT_MS` | 单次硬超时 | `3000` | `2500` | `3000` | ⏸ | ≤3s 政策约束 |
| 8 | `SEARCH_RETRY` | 重试次数 | `2` | `2` | `2` | ⏸ | 5xx/网络重试，4xx 不重试 |
| 9 | `SEARCH_MAX_RESULTS` | 结果上限 | `5` | `3` | `5` | ⏸ | 成本控制+降噪 |
| 10 | `SEARCH_DAILY_QUOTA` | 日配额 | `500` | `100` | `500`+ | ⏸ | **成本硬闸**，超限降级 |
| 11 | `SEARCH_BLOCKED_DOMAINS` | 黑名单 | `''` | 合规名单 | 合规名单 | ⏸ | 逗号分隔 |
| 12 | `SEARCH_ALLOWED_DOMAINS` | 白名单 | `''` | 可选 | 可选 | ⏸ | 优先于黑名单 |
| 13 | `FRESHNESS_ENABLED` | Freshness L1 总闸 | `false` | `false` | `true`(若开Freshness) | ⏸ | L4 才考虑 |
| 14 | `FRESHNESS_SEARCH_PROVIDER` | Freshness 入口闸 | `none` | `none` | `http`(若开Freshness) | ⏸ | 双闸坑，见 §2.2 |
| 15 | `THINK_ENGINE_ENABLED` | 问思引擎总闸 | `true` | `true` | `true` | ✅ | 一键熔断备用 |

### 3.1 可粘贴环境变量块（L3 灰度，thinkEngine 路径）

```bash
# === Q2-4-B L3 灰度：thinkEngine 真实源（tavily） ===
SEARCH_PROVIDER=tavily
FRESHNESS_FACTUAL_ENABLED=true
TAVILY_API_KEY=<从密钥管理注入，勿明文提交>
TAVILY_SEARCH_URL=https://api.tavily.com/search
SEARCH_TIMEOUT_MS=2500
SEARCH_RETRY=2
SEARCH_MAX_RESULTS=3
SEARCH_DAILY_QUOTA=100
SEARCH_BLOCKED_DOMAINS=<合规黑名单，如 spam-domain.com>
# 以下保持默认/关闭，确保 Freshness 路径不误激活：
FRESHNESS_ENABLED=false
FRESHNESS_SEARCH_PROVIDER=none
THINK_ENGINE_ENABLED=true
```

> ⛔ **密钥安全**：`TAVILY_API_KEY` 必须经云控制台密钥管理/环境变量注入，**禁止**写入代码仓库或 `cloudbaserc.json` 明文，禁止出现在任何 artifact。

---

## 4. 前置阻断项检查清单（P1，未解前不得激活）

| # | 阻断项 | 状态 | 说明 / 解除条件 |
|---|---|---|---|
| B1 | 小程序备案（ICP/微信备案） | ⛔ Blocked | working memory 记「备案审核中」。微信要求完成备案方可开通部分能力与外网请求合规审查。**解除**：备案通过。 |
| B2 | 跨境数据合规（PIPL/DPA） | ⛔ Blocked | Tavily/SerpAPI/Bing 均为**境外服务**。用户 query 可能含个人信息，跨境传输需：① 数据出境安全评估/标准合同（CAC）；② 隐私政策明示「检索词可能发往境外」；③ 用户授权。当前未评估。**解除**：完成 DPA 评估 + 隐私政策更新 + 法务签字。 |
| B3 | request 合法域名白名单 | ⏸ Pending | 微信要求 `api.tavily.com`/`api.bing.microsoft.com`/`serpapi.com` 加入小程序**后台 request 合法域名**（HTTPS + ICP 备案域名）。**解除**：备案通过后于公众平台配置。 |
| B4 | 真实密钥就位 | ⏸ Pending | 需在密钥管理注入 `TAVILY_API_KEY`（或 bing/serp）。**解除**：申请并注入，确认无 key 时 `ok:false` 不出网（已代码保障）。 |
| B5 | 成本预算批复 | ⏸ Pending | `SEARCH_DAILY_QUOTA` 对应 API 费用预算需确认（tavily 按次计费）。**解除**：财务/owner 批配额上限。 |

> ⚠ **B1+B2 为硬阻断**：任一未解，即使配置全部就位也**不得**翻转 `FRESHNESS_FACTUAL_ENABLED`。这是合规红线，非技术可绕。

---

## 5. 灰度发布方案（L0 → L4）

> 设计原则：**默认关 → 配置核验（零影响）→ 内部/极小比例 → 成本受限软开 → 全量**。
> 每级设**验证门**与**一键回滚**；任一门不过即回退上一级。

### L0 · 现状（mock，全关）
- 配置：`SEARCH_PROVIDER=mock`，`FRESHNESS_FACTUAL_ENABLED=false`。
- 用户影响：无。验证：离线测试 + 现有生产行为不变。

### L1 · 配置就绪核验（不激活，零用户影响）
- 动作：完成 B3/B4/B5 配置；注入密钥但不翻转 `FRESHNESS_FACTUAL_ENABLED`；部署监控埋点（§7）。
- 验证门：① 密钥注入后无 key 路径 `ok:false` 已离线证明；② 合法域名已加；③ 监控面板可看到 `search_provider`/`quota` 字段。
- 回滚：无（未激活）。

### L2 · 内部白名单灰度（canary）
- ⚠ **代码依赖**：当前代码**无 per-user 灰度开关**，仅 env 二进制全开。真正的内部白名单需新增 `SEARCH_CANARY_OPENIDS`（在 `index.js` 或 thinkEngine 注入 openid 判定）——**此为代码项，本阶段未实现，列为 Q2-4-C 候选**。
-  interim 方案：若暂不做 L2 代码项，可跳过至 L3 但用 L3 的**极低配额**作爆炸半径限制。
- 配置（若实现 L2）：`SEARCH_CANARY_OPENIDS=openid1,openid2` + 同 L3 值 + `QUOTA=20`。
- 验证门：仅内部 openid 命中真实源；24–48h 观察延迟/成本/反幻觉闸通过率。

### L3 · 小比例/全量软开启（成本受限）
- 配置：§3.1 块（`QUOTA=100`，`MAX_RESULTS=3`，`TIMEOUT=2500`）。
- 验证门（观察 3–7 天，**全部达标方可进 L4**）：
  - 搜索命中率（ok=true 占比）≥ 预期下限且无骤降；
  - `p95` 检索延迟 < 3s（含重试）；
  - 配额消耗在 `QUOTA` 内，无超支；
  - **mock 泄漏 = 0**（用户可见文本无 `[MOCK]`/`mock.local`，已由 Q2-3 测试保障）；
  - 反幻觉闸（`detectFabrication`）误杀率/漏杀率可接受；
  - 无新增崩溃/异常告警。
- 回滚：`FRESHNESS_FACTUAL_ENABLED=false` 或 `SEARCH_PROVIDER=mock`（**秒级**）。

### L4 · 全量生产
- 前置：B1/B2 全解 + L3 指标达标。
- 配置：`QUOTA=500`+、`MAX_RESULTS=5`、`TIMEOUT=3000`、来源过滤生效；可选开启 Freshness 路径（需同步 `FRESHNESS_ENABLED=true` + `FRESHNESS_SEARCH_PROVIDER=http`，注意 §2.2 双闸）。
- 验证门：7 日稳定性 + 成本月预算复核。

---

## 6. 回滚与熔断矩阵

| 熔断开关 | 默认值 | 翻转效果 | 恢复时间 |
|---|---|---|---|
| `SEARCH_PROVIDER=mock` | mock | 真实源立即停用，回退反思 | 秒级（改 env） |
| `FRESHNESS_FACTUAL_ENABLED=false` | false | 事实源总闸关，回退诚实边界 | 秒级 |
| `SEARCH_DAILY_QUOTA=0` | 500 | 当日真实检索硬拦（成本熔断） | 秒级 |
| `THINK_ENGINE_ENABLED=false` | true | 问思引擎整体关，回答回到 Q2-2 前 | 秒级 |
| `FRESHNESS_ENABLED=false` | false | Freshness 层整体关 | 秒级 |

> 任一级异常 → 优先 `SEARCH_PROVIDER=mock` 或 `FRESHNESS_FACTUAL_ENABLED=false`（最小波及）。所有开关均为 env 级，无需重新部署代码即可生效（仅需云函数环境变量更新 + 实例重载）。

---

## 7. 监控与观测清单

现有可观测钩子（结果元信息已暴露，无需新代码）：
- `meta.search_provider`：实际命中 provider（mock/tavily/...）。
- `retrieval.cached` / `reason`：缓存命中、失败原因（`no_api_key`/`quota_exceeded`/`timeout`/`all_filtered`）。
- `meta.downgraded` / `downgrade_reason`：降级原因，含 `fabrication-gate-rejected`。
- `costGuard.remaining()`（`_costRemaining` 钩子）：当日配额余量。

需建立的监控项：
| 指标 | 告警阈值 | 数据源 |
|---|---|---|
| 真实检索日调用量 | 接近 `QUOTA` 80% 预警 | costGuard |
| `ok=false` 占比突变 | ＞基线 +20pp | `reason` 分布 |
| 检索 p95 延迟 | ＞3s | 链路计时（需补埋点⏸） |
| mock 泄漏 | ＞0 即 P0 | 用户可见文本扫描 |
| 反幻觉闸误杀 | ＞基线 | `downgrade_reason` |
| 跨境合规事件 | 任何用户个人信息越境告警 | 审计日志（需补⏸） |

> ⏸ 标注项：延迟精细计时、跨境审计日志当前未显式埋点，建议在 L2/L3 前补最小埋点（不触碰冻结资产，仅增 `meta` 字段）。

---

## 8. 检查清单汇总（Master Checklist）

### 代码与测试（继承 Q2-4-A）
- [x] ✅ 真实 Provider 代码层具备（tavily/bing/serp + timeout/retry/cache/来源过滤/成本保护）
- [x] ✅ 离线测试 `test_q24a.js` 51 断言 + 全量回归 350 断言全绿
- [x] ✅ 冻结四资产 SHA 4/4 MATCH，KB 零污染
- [x] ✅ mock 默认安全态，无 key 不出网（代码保障）

### 配置准备（本阶段产出）
- [x] ✅ 配置项总览表（§3）已列全 15 项变量与默认值
- [x] ✅ L3 可粘贴环境变量块已备（§3.1）
- [x] ✅ 双闸激活路径已厘清（§2，含 Freshness 双闸坑）

### 前置阻断项
- [ ] ⛔ B1 小程序备案通过
- [ ] ⛔ B2 跨境数据合规评估完成（PIPL/DPA + 隐私政策）
- [ ] ⏸ B3 request 合法域名白名单配置
- [ ] ⏸ B4 真实密钥注入（密钥管理）
- [ ] ⏸ B5 成本预算批复

### 灰度方案
- [x] ✅ L0–L4 分级方案与每级验证门/回滚已设计（§5）
- [ ] ⏸ L2 per-user 白名单代码项（`SEARCH_CANARY_OPENIDS`，Q2-4-C 候选）
- [ ] ⏸ L3 监控埋点补全（延迟计时/跨境审计）

### 本阶段刚性边界
- [x] ✅ 零代码改动（仅读取核对）
- [x] ✅ 零部署（未翻转任何开关）
- [x] ✅ 未全量开启（所有激活为预案，待授权）

---

## 9. 结论与下一步授权

**结论**：Q2-4-B 完成「配置与灰度准备」。代码层（Q2-4-A）已具备真实源能力且离线验证全绿；本阶段厘清了 15 项配置变量、双闸激活路径、L0–L4 灰度分级与回滚矩阵，并产出可粘贴的环境变量模板。

**未解阻断**：`B1 小程序备案审核中` 与 `B2 跨境数据合规未评估` 为 P1 硬阻断，二者未解前**严禁**翻转 `FRESHNESS_FACTUAL_ENABLED` 或 `SEARCH_PROVIDER`。当前状态仍为「零真实源、零外呼」安全基线。

**当前状态**：停止，等待下一阶段授权。候选下一步（均需单独授权）：
1. **Q2-4-C（可选）**：实现 `SEARCH_CANARY_OPENIDS` per-user 灰度开关 + L3 监控埋点补全，使 L2 内部灰度可落地。
2. **合规前置评估**：推进 B1 备案跟踪 + B2 跨境 DPA 评估（可能需国内检索中继以避免直接越境）。
3. **待 B1/B2 双解后**：执行 L3 灰度（按 §3.1 粘贴变量 + 监控验证门），再依指标进 L4 全量。

> 本阶段**未部署、未开启**，任何生产激活均须后续显式授权并满足 §4 全部非阻断项。
