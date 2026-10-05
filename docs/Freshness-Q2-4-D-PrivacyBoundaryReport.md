# 向晚问思 · Phase Q2-4-D 实现报告
## Privacy Boundary & Compliance Gate（隐私边界与数据出口控制层）

> 阶段状态：**✅ COMPLETE**
> 角色：Chief AI Architect + AI Reliability Architect + Privacy & Data Boundary Reviewer + Release Guardian
> 生成时间：2026-08-07

---

### 1. 实施范围

在 Q2-4-A（真实 Provider）、Q2-4-B（配置/灰度方案）、Q2-4-C（Canary 闸门 + Audit）基础上，新增**真实搜索源上线前最后一道「隐私边界与数据出口控制层」**：

- 新增 `privacyGate.js`：判断用户输入是否允许进入外部 Search Provider。
- 检索层 `search()` 集成隐私闸门（最前端，位于 canaryGate 之前），并扩展 audit `data_route`。
- 仅修改**非冻结编排文件**与新增测试；**未部署、未开启真实搜索、未配置真实密钥、未触碰四冻结资产、未改知识库、未改 Prompt/RAG**。

调用链（本阶段调整后，privacy 位于最前端）：

```
user query
   ↓
privacyGate   ← Phase Q2-4-D 新增（最前端，fail-closed）
   ↓
canaryGate    ← Phase Q2-4-C
   ↓
searchLayer (providers/search)
   ↓
provider (mock / tavily / bing / serp)
```

**关键设计决策**：privacyGate 与 canaryGate 同位于 `searchLayer.search()` 内部最前端（privacy 先于 canary）。
这样 **thinkEngine 与 freshness 两条检索路径都自动获得隐私边界**，单一强制点、零重复接入，
且与 Q2-4-C 既有集成风格一致。功能等价于用户图中的 `thinkEngine → privacyGate → canaryGate → searchLayer`。

---

### 2. 新增 / 修改文件

| 文件 | 类型 | 说明 |
|---|---|---|
| `cloudfunctions/chat/providers/search/privacyGate.js` | **新增** | 隐私闸门：PII 检测 + 脱敏 + 统一输出 `{allowed, reason, sanitizedQuery}` |
| `cloudfunctions/chat/providers/search/index.js` | **修改** | `search()` 最前端接入 privacyGate；阻断即早返回（不调 provider）；通过则用 `sanitizedQuery` 出境；`_audit` 增 `data_route` |
| `weapp/scripts/test_q24d.js` | **新增** | Q2-4-D 离线测试套件（39 断言） |
| `weapp/scripts/test_q24c.js` | **修改** | 审计字段白名单断言补充 `data_route`（Q2-4-D 新增安全字段，测试同步） |

> 未修改 `think/`、`freshness/`、`index.js`（chat 主）、四冻结资产、Prompt、RAG 策略。

---

### 3. 数据流变化图

**默认态（PRIVACY_GATE_ENABLED=false，当前生产等效态）**

```
query ──▶ searchLayer.search()
            └─ privacyGate.resolve() → 关闭：原样放行 (sanitizedQuery = query)
            └─ canaryGate.resolve()  → 关闭：原样放行
            └─ provider (mock) ──▶ 确定性 [MOCK] 结果
       审计: data_route = 'domestic'
```

**开启态 + 普通问题（PRIVACY_GATE_ENABLED=true）**

```
query ──▶ privacyGate.resolve()
            ├─ 无 PII → allowed:true, sanitizedQuery = query
            └─ canaryGate → provider(真实) → 出境 query（与原文一致）
       审计: data_route = 'cross_border' (tavily/bing/serp)
```

**开启态 + 高风险 PII**

```
query(含手机/身份证/邮箱/银行卡/完整地址)
   ──▶ privacyGate.resolve() → allowed:false, reason:'pii_blocked'
   ──▶ 早返回：不调用任何 provider，无外呼
   ──▶ 上层（thinkEngine/freshness）收到 ok:false → 维持 RAG/反思，不受影响
   审计: data_route = 'blocked'
```

**开启态 + 软 PII（如「在上海做程序员」）**

```
query ──▶ privacyGate.sanitize() → 去除地理/第一人称 → "做程序员…"
   ──▶ sanitizedQuery 出境（最小数据出境），allowed:true
   审计: data_route 依 provider 决定
```

---

### 4. 隐私策略

**核心原则**：① 默认安全 ② fail-closed ③ 最小数据出境 ④ 不记录用户隐私 ⑤ 不影响既有 mock/RAG 行为

**风险分级（最小检测集）**

| 类别 | 行为 | reason |
|---|---|---|
| 手机号（含 +86/空格/横线） | 硬阻断 | `pii_blocked` |
| 身份证（18 位含 X / 15 位） | 硬阻断 | `pii_blocked` |
| 邮箱 | 硬阻断 | `pii_blocked` |
| 银行卡（16–19 位，排除身份证） | 硬阻断 | `pii_blocked` |
| 显式 PII 自述（"我的身份证/手机号/银行卡/住址…"） | 硬阻断 | `pii_blocked` |
| 完整住址（显式地址关键词 或 省/市 + 街道级细节） | 硬阻断 | `pii_blocked` |
| 软 PII（个人语境下的城市/区域，如"在上海做…"） | 脱敏后放行 | `sanitized` |

**脱敏规则**
- 去除：显式 PII 关键词、手机号、身份证、银行卡、个人语境下的地理实体、第一人称「我」。
- 保留：问题语义与用户意图（如「程序员 / 失业」保留）。
- 话题保护：纯话题中的城市（如「上海美食」「上海有什么好玩的」）**不脱敏、不阻断**，避免误伤。
- 边界示例：「我35岁，在上海做程序员，最近失业怎么办？」→「35岁，做程序员，最近失业怎么办？」（上海、我去除以最小出境）。

**最小数据出境**
- 通过隐私闸门的请求，仅把 `sanitizedQuery` 交给下游 provider（闸门关闭时 `sanitizedQuery === query`，行为零变化）。
- 缓存 key 使用脱敏后 query，避免缓存层留存原文。

**审计不记录隐私（任务四 + 测试 #9 验证）**
- audit 仅含白名单字段：`provider / latency_ms / cache_hit / downgrade_reason / quota_remaining / canary_blocked / data_route`。
- **禁止**记录：原始 query、sanitizedQuery、用户身份（openid）、搜索结果全文。
- 新增 `data_route` 枚举：`domestic`（本地/无跨境）`cross_border`（真实境外 provider）`blocked`（隐私/合规拦截，数据未出境）。

**fail-closed**
- 隐私闸门默认关闭（零影响）；开启后任何检测/脱敏异常一律视为阻断（宁可不检索，也不泄露）。
- privacyGate 为纯函数，**绝不保存** query / openid / 个人信息；sanitizedQuery 仅用于本次请求出境，不落库、不入审计、不写日志。

---

### 5. 测试结果

**Q2-4-D 新增**：`test_q24d.js` → **39 PASS / 0 FAIL**，覆盖全部 10 项要求：

1. ✅ 默认关闭状态（闸门关闭时含 PII 仍放行，mock 行为不变）
2. ✅ 普通问题允许（"什么是存在主义" → allowed，sanitizedQuery=原 query）
3. ✅ 手机号阻断
4. ✅ 身份证阻断
5. ✅ 邮箱阻断
6. ✅ 地址阻断（完整住址）
7. ✅ 脱敏成功（去除「上海/我」，保留「程序员/失业」）
8. ✅ search 未被调用（隐私阻断时 provider fetch 调用次数 = 0）
9. ✅ audit 不泄露隐私（仅安全字段；不含手机号/查询原文；无 query/sanitizedQuery/openid 键；data_route=blocked）
10. ✅ mock 行为零变化（闸门关闭时 PII query 仍走 mock 返回结果）

附加 `data_route` 枚举验证：domestic（mock/none）/ cross_border（tavily 放行）/ blocked（隐私阻断）/ canary 强制 mock → domestic。

**全量回归（10 套件，0 regression）**：

| 套件 | 结果 |
|---|---|
| test_q24d (Q2-4-D) | 39 PASS |
| test_q24c (Q2-4-C) | 37 PASS |
| test_q24a (Q2-4-A) | 51 PASS |
| test_q23 (Q2-3) | 84 PASS |
| test_q21b | 37 PASS |
| test_freshness_q1 | 31 PASS |
| test_freshness | 120/120 分类 + 其余 PASS |
| test_capabilities | 75 PASS |
| test_pipeline | 16 PASS |
| test_security_hardening | 24 PASS |

**累计 ≈ 426 断言零失败**（299 → 350 → 387 → 426，逐阶段递增且全绿）。

---

### 6. 冻结资产验证（SHA256）

| 资产 | SHA256 | 状态 |
|---|---|---|
| `corpus.json` | `db01fbc92064cbea3a6688a98160b6a70c9e150259b54063c8e2e96974eabc8b` | ✅ MATCH |
| `intent.js` | `765ad138ec68c0f159c6f75a60e5268beb02fba152f6d53dbdc539ba1560ca38` | ✅ MATCH |
| `knowledgeRouter.js` | `848908445dbb5ea93a6f52775dc3c8e6922ff971d6cee115547f236ffed0a935` | ✅ MATCH |
| `rag.js` | `4fb2dca42597a277911472a3cf1e8411f9f5c08988c2712e38d260d58fc2b503` | ✅ MATCH |

> 注：`git status` 中 `corpus.json`/`rag.js` 等显示 `M` 为历史遗留未提交标记（工作记忆已载明），**以 SHA256 比对为准**——四资产与冻结基线逐字节一致，本阶段零改动。

---

### 7. 未完成事项 / 开放项（刚性约束）

- ⛔ **未部署**：所有代码仅落地于源码与测试，未执行任何部署命令。
- ⛔ **未开启真实搜索**：`SEARCH_PROVIDER` 仍为 `mock`（默认），`FRESHNESS_FACTUAL_ENABLED` 仍为 `false`。
- ⛔ **未配置真实密钥**：无任何 `TAVILY_API_KEY` / `BING_SEARCH_KEY` / `SERPAPI_KEY` 注入；测试仅用 `fakeFetch` 注入离线验证。
- ⛔ **未 commit/push**、未改知识库、未改 Prompt/RAG 策略、未触碰四冻结资产。
- ⏸ **P1 硬阻断仍未解**（激活真实源前必须）：
  - **B1** 小程序备案审核中；
  - **B2** 跨境数据合规（tavily/bing/serp 均境外，需 PIPL/DPA 评估 + 隐私政策更新 + 合法域名白名单）。
- ⏸ 尚未执行 L2/L3/L4 灰度（需先解 B1/B2 并获授权；Q2-4-C canary + 本阶段 privacy 已就绪，爆炸半径锁在白名单内）。
- ⏸ 监控埋点（latency 分位、跨境审计告警）尚未补全——可于灰度前一并补齐。
- ⚠️ `privacyGate` 为**最小规则集**正则检测，存在误判/漏判可能（如 18 位纯数字误判为身份证）。生产前建议：① 补充更多地址/银行卡模式 ② 对脱敏结果做人工抽检 ③ 考虑接入专业 PII 检测服务作为二级闸。

---

### 8. 下一阶段建议

当前状态：**Phase Q2-4-D COMPLETE**，停在「未部署 / 未开启真实搜索 / 未配置真实密钥 / 等待备案与合规授权」。

候选方向（均需**下一步人工授权**，不要主动进入灰度或激活真实源）：

1. **合规前置评估（推荐优先）**：完成 B2 跨境数据 PIPL/DPA 评估；评估引入**国内检索中继/国内搜索源**以规避直接越境的可行性（可让 `data_route` 更多落在 `domestic`）。
2. **监控与告警补全**：在 `audit.data_route='cross_border'` 路径上加合规审计埋点与配额/异常告警，为 L2 灰度提供观测底座。
3. **PII 检测增强**：补充地址/银行卡模式、接入二级专业 PII 检测服务，降低误判漏判。
4. **满足条件后灰度演练**：B1+B2 双解 → 先 L2（canary 白名单 + privacy 全开）内测验证 → 再 L3（成本受限软开）→ L4（全量）。每级带 env 秒级回滚。

---

*本报告由 Release Guardian 生成，所有结论基于 `test_q24d.js`（39 断言）与全量回归（10 套件 0 失败）实测，冻结资产 SHA 经 `sha256sum` 复核 4/4 MATCH。*
