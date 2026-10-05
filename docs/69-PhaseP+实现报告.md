# Phase P+ 实现报告（docs/69）

## 向晚问思（WenDao）· Knowledge Platform **v1.0.1 Hardening** — 收官报告

> **阶段定位**：Phase P+（Phase P 设计 → 最小可运行闭环落地）
> **性质**：**纯新增代码 + 一处非冻结入口埋点**，**零冻结资产改动**
> **关联**：`docs/62`（平台标准）、`docs/64`（架构冻结）、`docs/66`（Phase P 运营设计）、`docs/67`（P+ 审计）、`docs/68`（Observability 落库设计）
> **完成时间**：2026-08-01
> **状态**：✅ 七阶段全部完成，184/184 测试通过，**等待人工评审**（未提交、未进入 Phase Q）

---

## 1. 一句话结论

Phase P 设计的知识运营体系，从「文档里的 12 章」变成了**能跑起来、有真实数据、能被测试守护**的最小闭环：注册表可替换、观测可落库、Dashboard 可出数、健康分可计算——而 `corpus.json` / `intent.js` / `rag.js` / `knowledgeRouter.js` 四项冻结资产**一字节未动**（SHA256 逐项复验通过）。

---

## 2. 七阶段完成情况

| 阶段 | 内容 | 产出 | 状态 |
|---|---|---|---|
| ① | 现状审计 | `docs/67-PhaseP+审计报告.md` | ✅ |
| ② | Registry 抽象层 | `registry/registryProvider.js` + `jsonRegistryProvider.js` | ✅ |
| ③ | Observability 落库 | `observability/` 三件套 + `index.js` 埋点 + `docs/68` | ✅ |
| ④ | Dashboard MVP | `dashboard/dashboard.js` + `printDashboard.js` | ✅ |
| ⑤ | Health Score | `knowledgeHealthScore.js` | ✅ |
| ⑥ | 测试 | `tests/phase-p-plus/`（5 组 / 184 断言） | ✅ 184/184 |
| ⑦ | 实现报告 | 本文档 | ✅ |

---

## 3. 文件清单

### 3.1 新增文件（全部为非冻结、纯增量）

| 文件 | 行数 | 职责 |
|---|---:|---|
| `cloudfunctions/chat/registry/registryProvider.js` | 114 | 注册表抽象基类 + 工厂；派生查询/统计/统一视图 |
| `cloudfunctions/chat/registry/jsonRegistryProvider.js` | 39 | JSON 文件实现（当前默认） |
| `cloudfunctions/chat/observability/observabilityLogger.js` | 133 | 观测记录构建 + fire-and-forget 落库 |
| `cloudfunctions/chat/observability/jsonObservabilityStore.js` | 62 | 本地 JSON 存储（默认/测试/降级） |
| `cloudfunctions/chat/observability/cloudObservabilityStore.js` | 65 | 云数据库存储（生产用） |
| `cloudfunctions/chat/knowledgeHealthScore.js` | 181 | 七维健康分 + N/A 权重重归一化 |
| `cloudfunctions/chat/dashboard/dashboard.js` | 428 | 八项指标只读聚合 |
| `cloudfunctions/chat/dashboard/printDashboard.js` | 212 | CLI 渲染（`--json` / `--obs`） |
| `tests/phase-p-plus/`（7 个文件） | 981 | 微测试框架 + 5 组测试 + 运行器 |
| **合计** | **2215** | |

配套文档：`docs/67`（审计）、`docs/68`（Observability 设计）、`docs/69`（本报告）。

### 3.2 修改文件（唯一一处，且非冻结）

**`cloudfunctions/chat/index.js`** —— 云函数入口，**不在冻结清单内**。Phase P+ 仅做增量 instrumentation：

```javascript
// ① 顶部引入（1 行 + 注释）
const { logObservation } = require("./observability/observabilityLogger");

// ② main 内：generateAnswer 前记时（1 行）
const startTime = Date.now();

// ③ 出参安全检测通过后：fire-and-forget 落库（13 行，整体 try/catch 包裹）
try {
  logObservation({ query, answerId, conversationId, result, intent: result.intent,
                   latencyMs: Date.now() - startTime, openid: ctx && ctx.OPENID });
} catch (e) { console.error("logObservation unexpected error:", e); }
```

- **未改动** 既有 `logChat` / `logQuestion` / `generateAnswer` 调用与返回结构。
- 埋点位于 `generateAnswer` 返回**之后**，只读 `result`，**不进检索/生成路径**。
- 三重失败安全：`store.write` 内部 try/catch → `logObservation` 内部 try/catch → 调用处 try/catch。

> ⚠️ **诚实说明**：`git diff index.js` 显示 24 行新增，其中 **9 行**（`question_logs` 的 `questionType/questionDomain/answerFormat/needKnowledge/knowledgePolicy` 字段）来自**更早的「通用助手升级」阶段遗留未提交改动**，不属于 Phase P+。Phase P+ 实际新增 **15 行**。

---

## 4. 未触碰的资产（冻结验证）

### 4.1 四项冻结资产 SHA256（Phase ⑥ 复验，2026-08-01）

| 文件 | SHA256 | vs O-0.6 基线 |
|---|---|---|
| `cloudfunctions/chat/corpus.json` | `db01fbc92064cbea3a6688a98160b6a70c9e150259b54063c8e2e96974eabc8b` | ✅ 一致 |
| `cloudfunctions/chat/intent.js` | `765ad138ec68c0f159c6f75a60e5268beb02fba152f6d53dbdc539ba1560ca38` | ✅ 一致 |
| `cloudfunctions/chat/rag.js` | `5b380b3f7c68f374e3d4e5127bd7dbeff747849401ca9d0488498dece1408286` | ✅ 一致 |
| `cloudfunctions/chat/knowledgeRouter.js` | `848908445dbb5ea93a6f52775dc3c8e6922ff971d6cee115547f236ffed0a935` | ✅ 一致 |

> **关于 `git status` 的 `M` 标记**：`corpus.json` 与 `rag.js` 在 git 中显示为已修改，这是 **Phase G 遗留的未提交改动**（tags 扩展 / `question_bridge` / `frameTitles`），**不是 Phase P+ 造成的**。Phase N-5 / O-0 / O-1 / P+ 的全部基线与测量均建立在**当前工作区状态**之上，四项 SHA256 自 O-0.6 起从未变化。判断「生产是否被改动」请用 SHA256 前后比对，勿看 git 标记。

### 4.2 三层防护（不止于事后比对）

| 层次 | 手段 | 位置 |
|---|---|---|
| 静态源码扫描 | Phase P+ 8 个模块中，「写 API + 冻结文件名」不得同现 | 测试 5 |
| 运行时哈希 | 跑完 Dashboard + Observability 全链路后再算一次哈希 | 测试 5 |
| 文档互锁 | 测试里的基线常量必须在 `docs/67` 中查得到 | 测试 5 |

> 第三层是关键：**只改测试常量而不改审计文档（或反之）会立刻红灯**，无法悄悄「洗白」一次冻结破坏。

### 4.3 其他未触碰项

- 未新增任何知识资产（KO 对象数仍为 1：`KO-P-04`）
- 未做 ingest、未生成 embedding、未改动 `tests/pilot-n4/`、`tests/pilot-n5/`、`tests/pilot-o1/` 任何产物
- 未修改 Registry schema、19 字段 Metadata 契约、Release Gate C1–C8 定义
- 未提交 git、未打 tag、未部署云函数

---

## 5. 新增的能力

### 5.1 Registry 可替换（阶段②）

```
调用方（Dashboard / Health Score / 准入）
        ↓ 只依赖抽象接口
  RegistryProvider（getRaw / getAll / getById / getByStatus / getByType / getStats / getUnifiedRecords）
        ↓ 实现可换
  JsonRegistryProvider（今天）  →  DbRegistryProvider（明天，调用方零改动）
```

- `getRaw()` 与原生 `JSON.parse(fs.readFileSync(...))` **逐字符一致**（测试断言）。
- **可替换性已被证明**，而非声称：测试 1 用一个纯内存 Provider 换掉 JSON 实现，断言 `getAll/getStats/getUnifiedRecords` 三者结果**完全相同**。
- `getUnifiedRecords()` 把 14 条 grandfathered 经典（`corpus.json` **只读**）与 1 条认证对象合并为统一视图；经典 ID 加 `classic:` 前缀，与认证对象 ID 空间隔离。

### 5.2 Observability 有真实数据（阶段③）

- 每次请求落一条记录，字段见 `docs/68 §3`（本阶段扩充后共 **15 字段**）。
- 存储双实现同接口：本地 JSON（默认/测试/降级）↔ 云数据库（生产，`KNOWLEDGE_OBSERVABILITY_STORE=cloud`）。
- `router_decision` / `fallback_reason` 通过**只读调用冻结的 `routeQuestion`** 复算取得——复用冻结能力，不加不改。

**⚠️ 本阶段发现并部分修复的契约缺口**：Phase ⑥ 测试暴露出，落库记录原先只覆盖 `docs/62 §9` 十二字段契约中的 **2 项**。其中 4 项数据本就在入参里、只是没持久化，已零成本补齐：

| 覆盖状态 | 字段 | 说明 |
|---|---|---|
| ✅ 直接覆盖 6/12 | `knowledge_type` `fallback_reason` `domain` `intent` `policy_name` `router_enabled` | 后 4 项为本阶段补齐 |
| ◐ 等价覆盖 1/12 | `citation_source` ≈ `retrieval_result` | 存标题列表而非 `display_text` |
| ❌ 未覆盖 5/12 | `retrieval_mode` `router_adjustment` `rerank_score` `chunk_id` `vector_score` | **取值必须在冻结的 `rag.js` 检索内部埋点**，与「零冻结资产改动」硬冲突 → 推迟 Phase Q |

这 5 项缺口被测试**显式锁定**（断言它们「确实缺席」），任何人补齐或进一步删减都会让测试红灯，被迫更新披露——**缺口不能被悄悄改变**。

### 5.3 Dashboard MVP（阶段④）

八项指标，来源严格限定于 Registry / Observability / Regression：

| # | 指标 | 当前值 | 数据来源 |
|---|---|---|---|
| ① | Knowledge Count | **15**（经典 14 + 认证 1） | Registry 统一视图 |
| ② | Registry Status | 1 条，`knowledge-registry/v1.0` / `production-candidate` / candidate=1 | Registry |
| ③ | Citation Accuracy | 静态 **1.0**（C5 门禁 pass）；运行时 **N/A** | O-1 证书 + Observability |
| ④ | Regression Status | **PASS**（Hit@3 0.82 / 侵入 0 / Benchmark 1.0 / O-0 Go=true） | `regression-report.json` |
| ⑤ | KQS | **0.9205**（n=1） | Registry `quality_score` |
| ⑥ | Health Score | **0.939**（N/A 维：metadata / feedback / usage） | knowledgeHealthScore |
| ⑦ | Query Count | **0** | Observability |
| ⑧ | Knowledge Usage | **N/A**（尚无观测记录） | Observability |

**「不重算检索」是被证明的，不是被声称的**——测试 3 做了三重验证：源码不含 `require rag` / `embedding` / 相似度计算；**独立子进程跑完 `buildDashboard()` 后检查 `require.cache`，`rag.js` 与 `intent.js` 均未被加载**；跑前跑后 5 个数据源文件 SHA256 不变。

### 5.4 Health Score 可计算（阶段⑤）

七维加权：Metadata 15 / Citation 20 / Evidence 10 / Retrieval 20 / Feedback 15 / Usage 10 / Regression 10 = 100。

**缺失维度处理是本模块的核心诚实点**：不填 0、不填满分、不填任何默认值，而是标 `na:true` 并**按可用权重重归一化** `Σ(w·v)/Σw`。测试 4 专门断言：缺 2 维后的分数**既不等于「缺失填 0」的 0.710，也不等于「缺失填 1」的 0.960**。

分数差异也如实反映事实差异：

| 对象 | 健康分 | N/A 维 | 原因 |
|---|---:|---|---|
| 14 条经典 | 0.940 | metadata / feedback / usage | 经典无 19 字段 Metadata，**不按满分处理** |
| `KO-P-04` | 0.925 | feedback / usage | Metadata 可用但完整度未满 |

---

## 6. 测试结果

```
node tests/phase-p-plus/run-tests.js
```

| # | 套件 | 断言 | 结果 |
|---|---|---:|---|
| 1 | Registry Provider 一致性与可替换性 | 22 | ✅ 22/22 |
| 2 | Observability 非阻塞与失败安全 | 36 | ✅ 36/36 |
| 3 | Dashboard 指标只读聚合 | 56 | ✅ 56/56 |
| 4 | Health Score 七维计算与 N/A 重归一化 | 45 | ✅ 45/45 |
| 5 | 冻结资产哈希保护 | 25 | ✅ 25/25 |
| | **合计** | **184** | **✅ 184 passed, 0 failed（293ms）** |

- 零外部依赖：自带 89 行微框架，裸 `node` 可跑，退出码 0/1 可直接接 CI。
- 结果产物：`tests/phase-p-plus/results.json`。
- 运行时 stderr 会出现 3 条 `console.error`（`boom-sync` / `boom-async` / `ENOENT`）——这是**故意注入的失败用例**，正是「错误被记录而非抛出」的证据，非异常。

### 6.1 几条值得单独点名的断言

| 断言 | 为什么重要 |
|---|---|
| 换成内存 Provider 后三个派生方法结果完全相同 | 「可替换」从声称变为证明 |
| 慢 store（300ms）下 `logObservation` 0ms 返回 | 「非阻塞」从声称变为实测 |
| 子进程 `require.cache` 无 `rag.js` | 「不重算检索」从声称变为证据 |
| N/A 分数既不等于填 0 也不等于填满分 | 「不伪造」从声称变为反证 |
| 测试基线哈希必须在 `docs/67` 中查得到 | 防止「只改测试洗白冻结破坏」 |
| §9 未覆盖的 5 项「确实缺席」 | 缺口无法被悄悄修改 |

---

## 7. 已知缺口（诚实清单）

| # | 缺口 | 影响 | 阻塞原因 | 建议阶段 |
|---|---|---|---|---|
| 1 | Observability §9 契约 5/12 未覆盖 | 无法做 per-type 偏置审计、无法追踪 rerank/vector 分数 | 取值在冻结 `rag.js` 内部 | Phase Q |
| 2 | Observability 生产尚未产生真实数据 | Query Count / Knowledge Usage / 运行时引用率均为 N/A；Health Score 的 Feedback / Usage 维恒 N/A | 云函数未部署、`KNOWLEDGE_OBSERVABILITY_STORE=cloud` 未配置 | 部署后自然闭合 |
| 3 | Feedback 维无数据源 | 七维中 15% 权重恒被重归一化剔除 | 前端尚无「有用/没用」反馈入口 | Phase Q |
| 4 | Health Score 的 Retrieval 维用全局 Hit@3 代理 | 单对象检索质量无法区分 | 缺 per-object 检索追踪 | Phase Q |
| 5 | Dashboard 仅 CLI，无可视化界面 | 只能开发者本地查看 | MVP 范围约定 | 按需 |
| 6 | 云函数本地文件系统无状态 | `JsonObservabilityStore` **在生产环境不可用** | 云函数实例不持久化 | 部署前**必须**切 Cloud Store |

> **第 6 条是部署前的硬提醒**：若未设 `KNOWLEDGE_OBSERVABILITY_STORE=cloud`，观测数据会随云函数实例销毁而丢失，Dashboard 永远显示 0。

---

## 8. 下一阶段建议

### 8.1 部署前必做（不属于 Phase Q，属于上线动作）

1. 云数据库手动创建 `observability_logs` 集合（**云数据库不会自动建表**，参考 `model_config` 踩过的坑）。
2. chat 云函数环境变量设置 `KNOWLEDGE_OBSERVABILITY_STORE=cloud`。
3. 重新上传部署 chat 云函数（改了 `index.js`，**不部署不生效**）。
4. 部署后跑 `node cloudfunctions/chat/dashboard/printDashboard.js --obs <导出的观测数据>` 验证真实数据可被聚合。

### 8.2 Phase Q 候选（按性价比排序）

| 优先级 | 事项 | 理由 | 是否触碰冻结资产 |
|---|---|---|---|
| **P0** | 前端加「这个回答有用吗」反馈入口 | 一次性点亮 Health Score 15% 权重的 Feedback 维，且**完全不碰冻结资产** | ❌ 不碰 |
| **P0** | 观测数据积累 2 周后复算 Dashboard | 让 Query Count / Usage / 运行时引用率从 N/A 变真实值 | ❌ 不碰 |
| **P1** | 补齐 §9 剩余 5 字段 | 需在 `rag.js` 内部埋点 → **必须先解冻或走「只读钩子」方案** | ⚠️ 需专门评审 |
| **P1** | 第二个知识对象准入试点 | 检验 Registry / Gate / Regression 闭环的可复用性 | ❌ 不碰 |
| **P2** | Dashboard 可视化（管理端页面） | 提升可用性，非能力增量 | ❌ 不碰 |
| **P2** | Alert 规则落地（`docs/66 §6`） | 有了真实观测数据才有意义，晚于 P0 | ❌ 不碰 |

> **关于 P1「补齐 §9 字段」的建议**：不要为了指标完整度去动 `rag.js`。更稳的路子是设计一个**只读钩子**（`rag.js` 暴露一个可选回调，默认 no-op），把「改逻辑」降级为「加一个不影响行为的出口」，并用逐字节回归证明 `KB_ROUTER_ENABLED=false` 下输出完全一致——这需要单独一次架构评审，不应顺手做掉。

### 8.3 明确不建议做的事

- ❌ 不要在 Feedback / Usage 无数据时给 Health Score 填默认值凑「好看的分数」——这会直接摧毁整套指标的可信度。
- ❌ 不要在观测数据不足时上 Alert 阈值——会产生大量误报，最终导致告警被无视。
- ❌ 不要在第二个知识对象准入前扩大知识规模——N-4 的教训（Hit@3 −8pp）说明域路由架构的复验优先于知识数量。

---

## 9. 验收对照（用户约束逐条核销）

| 用户约束 | 结果 | 证据 |
|---|---|---|
| 冻结核心不变 | ✅ | 四项 SHA256 == O-0.6，测试 5（25 断言） |
| Registry 可替换 | ✅ | 测试 1 内存 Provider 换实现结果全等 |
| Observability 有真实数据 | ⚠️ **有能力，无生产数据** | 落库链路 + 读写往返已测通；生产需部署后才有数据（缺口 #2） |
| Dashboard MVP 存在 | ✅ | 八项指标 + CLI，实测可出数 |
| Health Score 可计算 | ✅ | 0.939（N/A 维如实标注） |
| 所有测试通过 | ✅ | 184/184 |
| 不新增知识资产 | ✅ | KO 对象数仍为 1 |
| 不做 ingest / embedding | ✅ | 无任何模型/向量调用 |
| 不提交 | ✅ | 未 `git commit`、未打 tag |

> 「Observability 有真实数据」一条给的是 ⚠️ 而非 ✅：链路真实、测试真实，但**生产库里现在确实是 0 条记录**。按本项目一贯的诚实原则，不把「能力就绪」写成「数据就绪」。

---

## 10. 结论

Phase P+ 七阶段全部完成，**184/184 测试通过，四项冻结资产逐字节未变**。知识运营从设计文档变成了可运行、可观测、可度量、且被测试守护的最小闭环。

**当前状态：等待人工评审。未提交、未部署、未进入 Phase Q。**

评审建议关注三点：① `index.js` 那 15 行埋点是否可接受；② §9 契约 5 项缺口的处理方式（是否值得为它动 `rag.js`）；③ 部署前是否确认切换 Cloud Store。

---

*文档版本：v1.0 ｜ 生成时间：2026-08-01 ｜ 阶段：Phase P+ 第七阶段（收官）*
