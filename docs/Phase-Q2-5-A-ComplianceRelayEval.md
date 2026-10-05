# 向晚问思 · Phase Q2-5-A 合规边界审查与国内中继方案评估

> **阶段定位**：Phase Q2-5-A = 合规边界审查 + 国内中继/检索方案评估。
> 本阶段**纯研究与评估**，目标是解开 Q2-4-B 点明的 **B2 跨境数据合规 P1 硬阻断**（tavily/bing/serp 均境外，query 越境）。
> **刚性边界（本阶段）**：
> - ✅ 允许：审查现状、调研方案、对比评估、产出推荐路线与落地草图。
> - ⛔ 禁止：新增 provider 代码、部署、翻转任何生产开关、配置真实密钥、接真实 API、改知识库/冻结资产。
> - **本阶段零代码改动、零部署。** 所有落地动作均为「下一阶段待授权实施的草图」。

---

## 1. 当前合规边界现状（来自代码实测，非凭记忆）

| 项 | 当前值 | 合规含义 |
|---|---|---|
| `SEARCH_PROVIDER` | `mock` | 默认安全态，**零真实外呼、零跨境** |
| `FRESHNESS_FACTUAL_ENABLED` | `false` | 事实源总闸关闭 → 维持诚实边界 + 反思 |
| `PRIVACY_GATE_ENABLED` | `false` | 隐私闸默认关闭（代码已就位，未启用） |
| `SEARCH_CANARY_ENABLED` | `false` | 灰度闸默认关闭 |
| 真实网络调用 | 0 | 仅 `fakeFetch` 离线验证，未出网 |
| 冻结四资产 SHA | 4/4 MATCH | corpus/intent/knowledgeRouter/rag 未触碰 |

**结论**：当前生产态为「零真实源、零外呼、零跨境」的安全基线。所有真实源能力均处于**待授权激活**状态。

### 1.1 数据出境路径精确映射（检索层 `data_route` 分类）

检索层 `search()` 现有 `dataRouteOf()` 逻辑（`providers/search/index.js:231`）：

| provider | `isRealProvider` | `data_route` | 是否触发 PIPL 出境 |
|---|---|---|---|
| `mock` / `none` | 否 | `domestic` | 否（无外呼） |
| `tavily` | 是 | `cross_border` | **是**（美国） |
| `bing` | 是 | `cross_border` | **是**（美国 Microsoft） |
| `serp` | 是 | `cross_border` | **是**（境外 SerpAPI） |
| *(新增国内源)* | 待加 `isDomesticProvider` | `domestic`（需改 `dataRouteOf`） | **否**（数据留境） |

> **关键事实**：即便开启 `PRIVACY_GATE_ENABLED`，普通哲学/知识问题经脱敏后仍走 `tavily` → `data_route=cross_border` → **用户 query（即便脱敏）仍越境**。隐私闸只**降低**出境数据中的 PII 风险，**不消除**跨境事实本身。这就是 B2 的根因——它不在代码逻辑层，而在**数据源地理位置**。

### 1.2 既有安全层对跨境风险的作用边界

| 已建层 | 对 B2（跨境合规）的作用 | 局限 |
|---|---|---|
| `privacyGate`（Q2-4-D） | 硬阻断手机/身份证/邮箱/银行卡/完整住址；软 PII 脱敏 | 仅降 PII 密度，普通 query 仍越境 |
| `canaryGate`（Q2-4-C） | per-user 灰度，爆炸半径锁白名单 | 不解决跨境合法性 |
| `audit.data_route`（Q2-4-D） | 可观测每条请求的出境方向 | 仅观测，非控制 |
| `costGuard` / `sourceFilter` | 成本/来源控制 | 与跨境无关 |

**判定**：B2 无法靠既有代码层绕开。解除 B2 只有两条本质路径——**换国内源（数据不留境）** 或 **走 PIPL 跨境合法机制**。

---

## 2. PIPL 跨境数据合规要点（2026 现行框架）

依据网信办《数据出境安全管理政策法规问答》（2026-01 / 2026-07）、CAC 认证办法与标准合同办法：

### 2.1 四条合法出境路径（PIPL 第 38 条）
1. **CAC 数据出境安全评估**（最严，强制场景：CIIO、处理超 100 万人个人信息、或累计出境超 100 万人 / 超 1 万人敏感个人信息）
2. **个人信息出境认证**（2026-01-01《认证办法》生效，由 CAC 认可专业机构发证）
3. **标准合同（SCC）备案**（省级网信办备案，生效后 10 工作日内；<10 万非敏感 或 <1 万敏感可走此路，免安全评估）
4. **其他法律法规/网信办规定情形**

### 2.2 共性强制要求
- **PIPIA（个人信息保护影响评估）**：所有三条路径均须事前完成，且须记录留存。
- **单独同意**：向境外提供个人信息须取得个人**单独同意**（非打包授权）。
- **告知义务**：隐私政策须明示「检索词可能发往境外」及境外接收方、目的、方式。
- **2026-07 补充国标**：加密基准、访问控制规范、审计日志标准（2026-07 起强制）。
- **必要性评估**：出境个人信息须限于实现目的的最小范围（与 privacyGate 的「最小数据出境」原则一致）。

### 2.3 对本项目的适用性
- 本项目为**非商用-办公**小程序，用户量级小（真实样本 <50），理论可走 **标准合同（SCC）** 而非安全评估。
- 但 SCC 仍要求：PIPIA 文档 + 隐私政策更新 + 单独同意弹窗 + 省级备案 + 与境外接收方（Tavily/Bing/SerpAPI）签署 CAC 标准合同。**周期以周~月计，且境外接收方须配合签署**——实务阻力大。
- 更重要的是：**即便走完 SCC，普通 query 仍物理越境**，只是「合法越境」。合规成本与运营复杂度显著高于换源。

---

## 3. 三类方案评估

### Route 1 · 国内原生检索源（数据留境，推荐优先）

**本质**：用国内搜索服务替代境外源，query 全程不离开中国内地 → **不触发 PIPL 第 38 条出境**，B2 根因消除。

| 候选 | 底层/提供方 | 数据位置 | 接入形态 | 适用评估 |
|---|---|---|---|---|
| **腾讯云联网搜索 API（WSA）** | 搜狗搜索（腾讯系） | 中国内地 | `wsa.tencentcloudapi.com` / `api.wsa.cloud.tencent.com`；AK/SK 或 API KEY | **首选**：与微信小程序 + 腾讯云开发同源生态，域名国内已备案（B3 易解），数据留境 |
| **火山引擎 Web Search** | 头条/抖音同源库（字节） | 中国内地 | HTTP API / Responses API；SaaS + 私有化 | 质量好、支持私有化；非腾讯生态但数据留境 |
| **百度搜索 API** | 百度 | 中国内地 | 企业合规申请 | 个人/小项目门槛高，优先级低 |
| **国内大模型内置 `web_search`**（通义/DeepSeek/Kimi/腾讯混元） | 各厂商内搜 | 中国内地（须用中国内地 endpoint） | 模型参数 `enable_search` / `web_search` tool | 零新增 provider 可能；但须换/改 model_config，且搜索过程对事实抽取层透明度弱 |

**Route 1 对现有架构的契合度（高）**：
- `providers/search` 抽象层已具备 timeout/retry/cache/来源过滤/成本保护/privacyGate/canary；新增一个国内 provider 文件即可**全盘复用**。
- `data_route` 改分类为 `domestic` → 审计显示数据留境，合规审计告警（Q2-4-B §7）自然熄灭。
- 微信后台 request 合法域名只需加 `wsa.tencentcloudapi.com`（国内备案域名，B3 比加 `api.tavily.com` 更顺）。

**Route 1 的剩余合规义务（轻）**：
- 国内处理仍受 PIPL 一般规则约束（目的限定、最小必要、告知同意）——**与现有国内模型推理同级**，不新增跨境维度。
- `privacyGate` 仍建议开启：不向**任何**搜索源（含国内）发送原始 PII，属数据 hygiene 最佳实践，且降低国内处理风险。

### Route 2 · 跨境 + PIPL 合法机制（保留为 fallback）

**本质**：保留 tavily/bing/serp，补齐 SCC/认证 + PIPIA + 隐私政策 + 单独同意。

| 维度 | 评估 |
|---|---|
| 合规合法性 | ✅ 走完即合法越境 |
| 实施成本 | ⛔ 高：PIPIA 文档、隐私政策改版、单独同意弹窗、省级备案、境外接收方签署标准合同 |
| 周期 | 周~月；且依赖境外厂商配合签约 |
| 数据物理位置 | 仍越境（只是合法） |
| 适用场景 | 仅当国内源质量/覆盖**确证不足**且业务强依赖境外源时 |

**结论**：对本题（哲学/思辨/知识问答辅助）非必需。除非 Route 1 实测检索质量不达标，否则不优先。

### Route 3 · 中继代理转发境外（明确不解决根因）

**本质**：在国内部署代理服务器，转发请求到 tavily/bing/serp。

| 维度 | 评估 |
|---|---|
| 数据物理位置 | ❌ **仍越境**（代理只是中转，query 最终到美国） |
| 对 B2 的作用 | ❌ **零**。PIPL 看出境事实，不看你中间有没有代理 |
| 唯一价值 | 延迟优化、统一出口 IP、可观测性、密钥集中管理 |
| 误用风险 | ⚠️ 若把「加了国内代理」当作「已合规」，是**严重合规误判** |

**结论**：Route 3 **不得**作为 B2 解除依据。如需用它，只能定位为「延迟/可观测性增强」，且**前提是已走完 Route 2 的 PIPL 机制**。本评估将其标注为 **不推荐 / 仅限 Route 2 之上的可选增强**。

---

## 4. 方案对比总表

| 维度 | Route 1 国内源（首选） | Route 2 跨境+PIPL | Route 3 中继代理 |
|---|---|---|---|
| 数据是否留境 | ✅ 是 | ❌ 否（合法越境） | ❌ 否（仍越境） |
| 消除 B2 根因 | ✅ 是 | ✅ 是（合法化） | ❌ 否 |
| 实施成本 | 低（新增 provider + env） | 高（法务+备案+签约） | 中（但无效） |
| 周期 | 天级（代码）+ 备案等待 | 周~月 | 天级（但无意义） |
| 复用既有层 | ✅ 全复用 | ✅ 全复用 | ✅ 全复用 |
| 微信域名 B3 | 易（国内备案域） | 中（境外域需备案） | 中 |
| 推荐度 | ⭐⭐⭐⭐⭐ | ⭐⭐（fallback） | ⭐（不推荐） |

---

## 5. 推荐路线与落地草图（不实现）

### 5.1 推荐
**Route 1 国内原生检索源，首选腾讯云联网搜索 API（WSA）。** 理由：生态同源、数据留境、B2 根因消除、架构零摩擦复用、微信域名易解。

### 5.2 落地草图（供下一阶段授权后实施）

> 以下为**设计草图**，本阶段不写代码。

1. **新增 provider 文件** `providers/search/tcloudWsa.js`
   - 复用 `util.httpPostJson` / `util.normalizeResult` / `util.applySourceFilter`
   - 认证：API KEY（`TENCENT_WSA_API_KEY`，Bearer）或 AK/SK 签名（企业级）
   - 超时/重试/失败 fail-soft 同 tavily 风格（抛出传输错误，由 `withRetry` + 编排层兜底）
2. **检索层注册** `providers/search/index.js`
   - `getProviderName()` 支持 `tcloud` 值
   - `isRealProvider` 维持（tavily/bing/serp）；**新增** `isDomesticProvider(p)` → `p === 'tcloud'`（及未来火山等）
   - `dataRouteOf()` 改为：`piiBlocked → 'blocked'`；`isDomesticProvider → 'domestic'`；`isRealProvider → 'cross_border'`
   - provider switch 增加 `else if (provider === 'tcloud') providerFn = ...`
3. **环境变量**（L3 灰度草案）
   ```
   SEARCH_PROVIDER=tcloud
   TENCENT_WSA_API_KEY=<密钥管理注入>
   SEARCH_TIMEOUT_MS=2500
   SEARCH_MAX_RESULTS=3
   SEARCH_DAILY_QUOTA=100
   PRIVACY_GATE_ENABLED=true      # 仍建议开启，向任何源最小化出境
   SEARCH_CANARY_ENABLED=true     # L2 白名单灰度
   SEARCH_CANARY_OPENIDS=内部白名单
   FRESHNESS_FACTUAL_ENABLED=true
   ```
4. **复用既有安全层**：privacyGate / canaryGate / costGuard / sourceFilter / cache / audit 全部自动生效，无需改动。
5. **测试**：仿 `test_q24a.js` 新增 `test_q24e.js`（离线 fakeFetch 注入），断言：
   - `tcloud` provider 调用形态正确
   - `data_route === 'domestic'`
   - 全链路复用 timeout/retry/cache/sourceFilter/cost/privacy/canary
   - 冻结四资产 SHA 不变

### 5.3 与现有境外源的共存
- `SEARCH_PROVIDER` 仍为可切换枚举：`mock` / `tcloud`（国内）/ `tavily` / `bing` / `serp`（境外）。
- 若未来国内源质量不足，可临时切回境外源 + 走 Route 2 机制，二者不互斥。

---

## 6. 风险评估与开放项

| # | 风险 / 开放项 | 等级 | 说明 / 缓解 |
|---|---|---|---|
| R1 | 国内源检索质量/覆盖不及境外 | 中 | 哲学/思辨/中文知识场景国内源（搜狗底）通常足够；L3 灰度用「命中率/反幻觉闸通过率」验证，不达标再评估 Route 2 |
| R2 | 国内源同样处理 query（含软 PII） | 低 | 开启 `PRIVACY_GATE_ENABLED` 最小化出境；国内处理合规等级等同现有模型推理 |
| R3 | 误将 Route 3 中继当合规解 | 高（合规） | 本报告已明确标注 Route 3 不解除 B2；若实施须绑定 Route 2 |
| R4 | B1 小程序备案仍未过 | 高（阻断） | 与数据源择无关，仍须备案通过方可开通外网请求合规审查 |
| R5 | 微信 request 合法域名配置 | 中 | `wsa.tencentcloudapi.com` 为国内备案域，B3 较境外源更易；仍须备案通过后于公众平台配置 |
| R6 | 隐私政策需更新（即便国内源） | 低 | 建议补充「检索词可能发送至国内搜索服务（腾讯云）」告知，与现有模型推理告知一致 |

---

## 7. 刚性边界确认（本阶段）

- [x] ✅ 零代码改动（仅审查 + 调研 + 评估 + 本报告）
- [x] ✅ 零部署（未翻转任何开关）
- [x] ✅ 未配置真实密钥（无 `TENCENT_WSA_API_KEY` / `TAVILY_API_KEY` 等注入）
- [x] ✅ 未接真实 API（仅 Web 调研，未出网调用）
- [x] ✅ 未改知识库 / 冻结四资产（SHA 4/4 MATCH，未触碰）
- [x] ✅ 未 commit/push
- [x] ✅ 未开启 `FRESHNESS_FACTUAL_ENABLED` / 真实搜索 / `PRIVACY_GATE_ENABLED`

---

## 8. 结论与下一阶段建议

**结论**：Q2-5-A 完成「合规边界审查 + 国内中继/检索方案评估」。
- 现状：当前零跨境、零外呼安全基线；B2 根因在**数据源地理位置**，非代码逻辑，既有隐私/灰度层只能降风险不能消根因。
- PIPL 2026：出境须走四条路径之一（安全评估/认证/标准合同/其他），均须 PIPIA + 单独同意；小量级可走标准合同但成本高、周期长。
- 评估：**Route 1 国内原生检索源（首选腾讯云 WSA）** 在合规、成本、架构复用、生态契合上全面优于 Route 2（跨境+PIPL）与 Route 3（中继代理，不解决根因）。

**推荐下一阶段（需单独授权）**：
1. **Q2-5-B（实施候选）**：按 §5.2 草图新增 `tcloudWsa.js` provider + 检索层注册（`isDomesticProvider` + `dataRouteOf` 改 `domestic`）+ `test_q24e.js` 离线测试 + 冻结 SHA 复核。**仍不部署、不激活**。
2. **合规收尾**：B1 备案跟踪；隐私政策补充国内检索告知（R6）。
3. **满足条件后灰度**：B1 过 + Route 1 代码落地 → L2（canary + privacy 全开）内测 → L3（成本受限软开，验证命中率/反幻觉闸）→ L4 全量。每级 env 秒级回滚。

> 本阶段**未部署、未激活、未出网**。任何生产激活均须后续显式授权并满足 B1（备案）+ 数据源合规择定。

---

*本报告由合规审查 + 架构评估产出，依据：① 代码实测（`data_route` / `privacyGate` / 默认 `mock` 态）② 网信办 2026 数据出境政策法规问答 ③ 腾讯云 WSA / 火山引擎 / 通义千问联网搜索公开文档。冻结资产 SHA 以既存 4/4 MATCH 为准，本阶段零改动。*
