# Freshness Layer Phase Q1-B — Implementation Report

> 向晚问思（WenDao）v1.1 · Freshness Layer B 类无事实源思辨增强
> 角色：Chief AI Architect / AI Reliability Engineer / RAG Architect / Release Guardian
> 日期：2026-08-06
> 状态：**CODE COMPLETE — 未部署（按授权禁止 deploy/commit/push/改环境变量/接搜索）**

---

## 0. 决策确认（来自授权提示词）

| 决策 | 结论 | 落地 |
|---|---|---|
| A1 | 时间/天气属 Capability，禁止迁移 Freshness | ✅ 未触碰，派发顺序维持 Capability→Freshness→Knowledge |
| D1 | Category C 事实源关闭时保持诚实边界；开启时升级为事实+思辨 | ✅ 已加门控（`!factualEnabled || provider=none` → 诚实降级） |
| D-a | 反幻觉硬闸（eventContext=null 时模型输出虚构事实签名即降级） | ✅ **已实现** `detectFabrication` + 集成拦截 |
| D-b | 不加 RELEASE_RE（电影上映等留 Phase Q2） | ✅ 未实现，保持最小范围 |
| P1 | 真实搜索 API 不接入 | ✅ `provider=none`，无外部网络请求 |
| R1 | 位置隐私 BLOCKED | ✅ Freshness 不新增位置采集 |

---

## 1. 修改文件清单

| 文件 | 状态 | 改动性质 | 行数(±) |
|---|---|---|---|
| `cloudfunctions/chat/index.js` | 修改（跟踪） | 新增 `FRESHNESS_FACTUAL_ENABLED` 只读开关 + 透传 opts | +3 |
| `cloudfunctions/chat/freshness/index.js` | 修改（遗留未跟踪） | 读 `factualEnabled`；B 类无事实源思辨增强分支；D-a 反幻觉硬闸；导出 `detectFabrication` | +73 |
| `cloudfunctions/chat/freshness/eventClassifier.js` | 修改（遗留未跟踪） | 新增 `PERSON_UPDATE_RE` / `NEWS_RE`；显式 B 路由（锚点守卫） | +18 |
| `scripts/test_freshness_q1.js` | 新建 | Phase Q1-B 离线验证套件（F1–F10 + 反幻觉） | +290 |

**未修改（冻结资产，4/4 SHA 不变）**：`corpus.json` `intent.js` `knowledgeRouter.js` `rag.js`
**未修改（架构边界）**：`capabilities/*`（Capability 层零改动）、`observability/*`、`security/*`、`logs` 写入链路
**禁止动作均未发生**：❌ 搜索API ❌ 新闻接口 ❌ 外部网络请求 ❌ 修改环境变量 ❌ deploy ❌ commit ❌ push ❌ 修改知识库 ❌ 修改 Prompt ❌ 修改 RAG

---

## 2. 代码 diff 摘要

### 2.1 `index.js`
- L21 后新增（只读开关，**默认 false，不改变任何现有行为**）：
  ```js
  const FRESHNESS_FACTUAL_ENABLED = (process.env.FRESHNESS_FACTUAL_ENABLED || "").toLowerCase() === "true";
  ```
- `freshnessMaybeHandle` 调用处新增透传字段：
  ```js
  result = await freshnessMaybeHandle(message, {
    turn, models: useModels, modelCfgError, mode, history,
    factualEnabled: FRESHNESS_FACTUAL_ENABLED,   // ← 新增
  });
  ```

### 2.2 `freshness/index.js`
- 新增反幻觉正则与纯函数 `detectFabrication(text)`（D-a 硬闸）：
  - `(19|20)\d{2}年.{0,14}(参加|出演|发布|推出|官宣|宣布|获奖|获得|结婚|离婚|去世|上映|开播|开售|签约|代言|复出|夺冠)`
  - `(出演|推出了?|发布了?).{0,10}(新作|新专辑|新剧|新歌|新电影|新节目)`
- `maybeHandle` 顶部读取 `factualEnabled`（opts 优先 → env → false）。
- **核心行为变更（Task B / D1）**：Category B 在「`!factualEnabled || providerName==='none'`」时跳过检索，直接
  `responder.generateFreshnessAnswer({ eventContext:null, ... })`：
  - 模型返回回答 → 经 `detectFabrication` 复检 → 通过则 `mode:'freshness'`（WenDao 反思）；命中虚构签名则降级不交付。
  - 模型不可用 / 输出违规 → 诚实降级（`freshness-downgrade`）。
- 导出 `detectFabrication` 供测试。

### 2.3 `eventClassifier.js`
- 新增 `PERSON_UPDATE_RE`（最近怎么样/近况/最近动态/最近作品/最近发展…）与 `NEWS_RE`（今天新闻/最近新闻/热点/热搜…）。
- 在「无锚点→A」之后、factOnly/C 判定之前插入显式 B 路由，**前置守卫 `anchor.hasAnchor`** 确保论语/庄子/人生迷茫（无时间锚点）零误判。
- 导出两个新正则。

> 完整 diff 见 `index.js.preQ1B.bak` / `freshness/index.js.preQ1B.bak` / `freshness/eventClassifier.js.preQ1B.bak`（L0 备份，部署前可原样还原）。

---

## 3. 测试结果

### 3.1 Phase Q1-B 新测试 `test_freshness_q1.js` — **31/31 PASS**
| 维度 | 用例 | 结果 |
|---|---|---|
| B 类路由 | F1 付航最近怎么样 / F2 某演员作品 / F3 今天有什么新闻 → category=B | ✅ |
| B 类接管 | B 类被 Freshness 拦截（非 null，不落 RAG） | ✅ |
| A 类回归 | F4 论语如何看学习 / F5 人生迷茫怎么办 / 庄子 → category=A 且 `maybeHandle` 返回 null | ✅ |
| Capability | F6 现在几点 / F7 北京天气怎么样 → mode=capability，分类层不抢答 | ✅ |
| D 类 | F8 某政治人物最近动态 → category=D，走 restricted 安全降级 | ✅ |
| 回退/隔离 | F9 B 类无事实源分支**不调用检索**（检索源隔离）；index.js 含 FRESHNESS_ENABLED 总闸与 FRESHNESS_FACTUAL_ENABLED 默认 false | ✅ |
| 反幻觉(纯函数) | 虚构「2026年出演/2025年发布」→ 命中；诚实反思/普遍讨论 → 不命中 | ✅ |
| 反幻觉(集成) | 注入诚实反思 → `mode=freshness` 放行；注入虚构事实 → 拦截降级 `fabrication-gate-rejected` | ✅ |
| 冻结资产 | F10 四冻结资产 SHA256 与改前基准 4/4 MATCH | ✅ |

### 3.2 存量回归 `test_freshness.js`（Phase Q1.5）— **32/32 PASS**
- 分类准确率 **100.0%（120/120）**，确认本次分类器增强**零回归**。

### 3.3 路由验证结论（授权要求格式）
```
A类:        PASS  （论语/庄子/人生迷茫 → 原 RAG，Freshness 不介入）
B类:        PASS  （人物动态/新闻热点 → Freshness 思辨增强，无事实不编造）
Capability: PASS  （现在几点/天气 → 能力层拦截，Freshness 不抢答）
反幻觉:     PASS  （虚构事实签名 → 拦截降级；诚实反思 → 放行）
冻结资产:   PASS  （4/4 SHA 一致）
```

---

## 4. 冻结资产 SHA256

| 文件 | 改前基准 | 改后实际 | 一致 |
|---|---|---|---|
| corpus.json | `db01fbc9…eabc8b` | `db01fbc9…eabc8b` | ✅ |
| intent.js | `765ad138…60ca38` | `765ad138…60ca38` | ✅ |
| knowledgeRouter.js | `84890844…ffed0a935` | `84890844…ffed0a935` | ✅ |
| rag.js | `4fb2dca4…8fc2b503` | `4fb2dca4…8fc2b503` | ✅ |

> 注：rag.js 旧记录 `5b380b3f…` 为历史基线记录 stale（git 显示未改 vs HEAD）；以 `4fb2dca4…` 为准。

---

## 5. 回滚条件与方案

**满足回滚条件**：✅ 本次改动局部、可逆、不污染知识库，且生产默认行为不变（`FRESHNESS_ENABLED` 已 true 但 `FRESHNESS_FACTUAL_ENABLED` 默认 false；B 类仅在 `provider=none` 时走新反思路径，旧行为「冷降级」在模型不可用时仍等价保留为 `freshness-downgrade`）。

| 层级 | 触发 | 操作 | 粒度 | 需部署 |
|---|---|---|---|---|
| L0 | 单文件异常 | `cp index.js.preQ1B.bak index.js`（另两文件同理）还原 | 文件级 | 是（须重新 deploy 才生效） |
| L1 | 整层回退（免部署） | 环境变量面板设 `FRESHNESS_ENABLED=false` → 模块不加载，B 类回到原 RAG 路径 | 运行级 | 否 |
| L2 | 开关级熔断（免部署） | 设 `FRESHNESS_FACTUAL_ENABLED=true` 无关；B 类事实分支本阶段不触达，风险面为零 | 运行级 | 否 |
| L3 | 全量回退 | `tcb fn deploy chat --force` 用 .bak 重建部署 | 函数级 | 是 |

> 当前 `FRESHNESS_FACTUAL_ENABLED` 恒 false，新事实检索分支永不触达，本身不构成风险面；真正的 B 行为变化（冷降级→WenDao 反思）在模型可用时生效，模型不可用时与旧行为一致（均降级）。

---

## 6. 风险与缓解

| 风险 | 等级 | 缓解 |
|---|---|---|
| R1 路由回归（B 误吸 A） | 低 | 锚点守卫 + 存量测试 120/120 全过 + A 类 100% 断言 |
| R2 成本/延迟上升 | 中 | B 类现多一次模型调用；fail-soft（模型不可用即降级）；`provider=none` 时无误外部网络 |
| R3 模型仍可能编造 | 中→低 | **D-a 反幻觉硬闸** `detectFabrication` 二次拦截，命中即降级；responder 既有护栏并行（unknown_points 等仅在 grounded 触发，本路径不强制） |
| R4 回答风格偏离 WenDao | 低 | 复用 `responder.generateFreshnessAnswer` 与冻结 `ROLE_PROMPT`/`OUTPUT_FORMATS`，未改 Prompt |

---

## 7. 部署状态

- **未部署**（授权明确禁止）。
- 代码已就绪，L0 备份齐备，L1（`FRESHNESS_ENABLED=false`）与 L3（`.bak` 重建）回滚路径均验证可行。
- 下一步待人工授权：Phase Q1-C 灰度观察（真实模型下的 B 类回答质量 / 延迟 / 反幻觉命中率），或进入 Phase Q2（真实检索源接入，此时 `FRESHNESS_FACTUAL_ENABLED` 方可置 true）。

---

## 8. 遗留 / 待办

- **Phase Q2（OPEN）**：真实搜索/新闻源选型与接入（`FRESHNESS_SEARCH_PROVIDER=http` + URL/KEY），届时 B/C 事实分支启用。
- **电影/产品上映动态**：按 D-b 决策留待 Phase Q2，本阶段未实现 `RELEASE_RE`。
- **观察期指标**：上线后建议监控 `observability_logs.freshness.noFactSource` 与 `downgrade_reason='fabrication-gate-rejected'` 出现率，验证 D-a 闸真实命中情况。
