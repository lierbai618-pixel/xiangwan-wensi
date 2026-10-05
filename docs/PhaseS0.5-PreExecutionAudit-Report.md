# Phase S0.5 — Pre-Execution Audit Report

**产品**：向晚问思 WenDao（微信云开发小程序）
**云环境**：YOUR_CLOUD_ENV_ID
**生成时间**：2026-08-06（GMT+8）
**角色**：Release Manager + Search Architecture Reviewer
**性质**：**纯只读前置审计**。不调 Provider API / 不建密钥 / 不部署临时函数 / 不改代码 / 不改配置 / 不写 SEARCH_PROVIDER / 不启用 Search。

关联文档：
- `PhaseS0.5-SearchProviderBakeoffAuthorizationRequest.md`（授权申请，§8.2 结论「方案 READY，执行需人工书面授权」）
- `PhaseS0.5-BakeoffExecutionRunbookAppendix.md`（执行 Runbook，隔离/密钥/出网设计）

---

## 1. 审计结论

```
GATE:  NOT READY TO EXECUTE
       （前置资产 + 设计条件 READY；执行授权未到位，且本任务禁止进入执行阶段）
```

**判读**：所有可经只读验证的前置条件（测试集完整性、隔离设计定义、环境方案定义、探测函数未越界创建、生产代码无 forbidden 引用）**全部 PASS**。但 Bake-off 的**执行**仍被两道关卡关闭：

1. **人工授权缺失** —— 主文档 §8.3 四项签核尚未记录为完成；
2. **本任务硬性禁止** —— 不调 Provider API / 不建密钥 / 不部署临时函数。

因此本审计结论为 **NOT READY TO EXECUTE**，仅确认「环境准备就绪、可进入授权闸门」。

---

## 2. 检查明细

### 2.1 S-0.3 fixtures.json 完整性 ✅ PASS

| 检查项 | 结果 |
|---|---|
| 总量 | 60 |
| FACT（事实检索） | **30** ✅ |
| FRESHNESS（时效信息） | **30** ✅ |
| 安全标签完整 | 10 条含 `security_case`：T-1 ×5 + T-4 ×5 ✅（与 S-0.3/S-0.2 引用一致） |
| 必填字段齐全 | 无缺失（`id/type/category/query/expected_behavior/evidence_required/security_level`） |
| evidence_required | 全部 `true` |
| security_level | 全部 `normal` |
| production_data | `false`（离线资产，非生产数据） |
| ID 唯一 / 排序稳定 | 60 唯一 ✅ |
| 领域覆盖 | 科技14/社会13/文化10/历史7/哲学6/常识4/时效事件6（7/7） |

> 主评测集 = A(30 FACT) + B(30 FRESHNESS) = **60 条**，与 Runbook §4 主集一致；每条 3 重复 → 180 采样（执行期）。安全子集 D（T-1/T-4）直接复用本集 10 条。

### 2.2 Bake-off 隔离条件 ✅ PASS（设计态已定义）

| 隔离要求 | 设计定义位置 | 结论 |
|---|---|---|
| `chat_bakeoff_probe` 独立设计 | S0.5 §3.1 / Runbook §1.1 | ✅ 明确「独立临时云函数，不挂载 index.js、不共享运行时」 |
| 不会 import `chat/index.js` | Runbook §1.1 | ✅ 「不 import、不挂载、不共享运行时」 |
| 不会访问用户数据 | Runbook §1.1 | ✅ 「不读取任何生产用户消息」 |
| 不会写生产日志 | Runbook §1.1 | ✅ 「不写 logs / question_logs / observability_logs」 |

**实测补强（只读）**：
- `cloudfunctions/chat_bakeoff_probe/` —— **ABSENT**（预期状态，授权前未创建）✅
- `cloudfunctions/` 目录仅含 admin/chat/feedback/history/ingest/login，无越界探测函数 ✅

### 2.3 环境条件 ✅ PASS（方案就绪 / 执行待授权）

| 环境项 | 现状 | 结论 |
|---|---|---|
| Node 版本 | 云函数基准 Runtime = **Nodejs16.13**（chat FunctionId `lam-8a8p5vsx`，tcb fn detail 证实）；本地托管 Node 22.22.2 可用于离线分析脚本 | ✅ 约束明确 |
| 云函数运行环境 | 微信云函数 Nodejs16.13；探针为新建独立函数（设计态） | ✅ 设计就绪 |
| 出网控制方案 | Runbook §3：仅白名单候选域名、记录域名/时间窗/负责人、结束即恢复 | ✅ 方案就绪（执行需 §8.3-3 单独确认） |
| 密钥生命周期方案 | Runbook §2：`BAKEOFF_<PROVIDER>_KEY` 仅环境变量、掩码、用完即删、Provider 侧 revoke | ✅ 方案就绪（执行需 §8.3-2 批准） |

> 硬 KO-3 约束（Node16.13 兼容、禁原生 fetch）已纳入评估框架，探针实现须沿用 O-0.6 `rag.js` 的 `nodeFetch` 内置模式（设计期约定，非本任务落地）。

### 2.4 生产污染核查 ✅ PASS

| 检查 | 结果 |
|---|---|
| `SEARCH_PROVIDER` 写入生产代码/配置 | **未发现**（代码无 `SEARCH_PROVIDER` 引用）✅ |
| `BAKEOFF_*` 引用 | **未发现** ✅ |
| 误报澄清 | `freshness/eventRetriever.js` 命中 `FRESHNESS_SEARCH_PROVIDER` 为 Phase R 自有开关（默认 `none`），与 Search Provider 选型无关，非越界 ✅ |
| `search/` 目录 | 仅 `search/test/fixtures.json`，无 Provider 代码 ✅ |

---

## 3. 阻塞项（Blocking）

| ID | 阻塞 | 等级 | 解除条件 |
|---|---|---|---|
| **B1** | 人工 §8.3 四项签核未完成（授权缺失） | 高 | 人工书面签核 §8.3-1~4 |
| **B2** | 本任务硬性禁止执行动作（不调 API / 不建密钥 / 不部署） | 高 | 新开执行授权任务（非本审计） |

---

## 4. 风险项（Risk，设计态已登记，附缓解）

| ID | 风险 | 等级 | 缓解 |
|---|---|---|---|
| R-S0.5-001 | 临时函数误挂载生产 | 高 | 独立函数 + §6.3 越界熔断 |
| R-S0.5-002 | 一次性密钥泄露 | 中 | 用完即删 + 不入 config/corpus |
| R-S0.5-003 | 出网白名单误放大 | 中 | §8.3-3 仅放通候选域名，执行期单独确认 |
| R-S0.5-004 | 评测滑向「矮子里拔将军」 | 中 | §2.5 三条判据 + 无合格即延后条款 |
| R-S0.5-005 | 结论提前写生产 | 高 | §7.2 未经批准不得写 SEARCH_PROVIDER |

---

## 5. 不允许执行事项（本任务 + 执行阶段重申）

- ❌ 调用 Provider API（真实外部服务）
- ❌ 创建 / 获取 Provider 密钥
- ❌ 部署临时函数 `chat_bakeoff_probe`
- ❌ 修改任何代码（含 `cloudfunctions/chat`）
- ❌ 修改配置 / 环境变量
- ❌ 写入 `SEARCH_PROVIDER` 生产配置
- ❌ 启用 Search（`SEARCH_ENABLED` 保持 false）
- ❌ 写入生产数据库 / 生产日志
- ❌ 修改冻结资产 / Prompt / RAG / corpus

---

## 6. 下一步授权清单（人工签核后，方可进入执行）

执行 Bake-off 前需人工显式批准以下事项（对应 S0.5 §8.3）：

1. **批准本次 bake-off 授权**：临时函数 + 一次性密钥 + 独立环境 + 用完即删。
2. **批准为候选 Provider 获取一次性密钥**：可能涉及账户注册；境内合规资质 / query 留存政策需法务过 KO-5 / KO-8。
3. **批准出网白名单策略**：仅放通候选 Provider 域名（执行期单独确认，结束恢复）。
4. **批准 bake-off 结论（Provider Recommendation）后**，方可将 `SEARCH_PROVIDER` 写入生产配置（§7.2）。

> 注：S0.5 不解除 S1 其他独立阻塞（P-01b 豁免 / P-04 延后 / P-09 人格评审 / P-11 回滚）。S1 mock 开发（M1/M2/M3/M5，`SEARCH_ENABLED=false`）可与本授权并行，不依赖本审计。

---

## 7. 状态摘要

| Gate 项 | 状态 |
|---|---|
| S-0.3 fixtures 完整性 | ✅ PASS |
| 隔离设计定义 | ✅ PASS（独立函数 / 不 import / 不读用户 / 不写生产日志） |
| 环境方案（Node/运行时/出网/密钥） | ✅ 方案 READY |
| 生产污染核查 | ✅ PASS（无 SEARCH_PROVIDER / BAKEOFF_ 引用） |
| 探测函数越界 | ✅ ABSENT（授权前正确状态） |
| **执行授权** | 🔴 **未到位（B1+B2）** |

```
PRE-EXECUTION AUDIT:  NOT READY TO EXECUTE
（前置资产与设计方案 READY；等待人工 §8.3 四项签核 + 独立执行授权任务）
```

---

*本审计为纯只读前置检查，不产生代码、密钥、函数或部署动作。报告完成后停止，不进入 Provider 调用阶段。*
