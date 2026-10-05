# CR-002 #004 Observation Report — OBS-001

> 角色：Release Guardian + Production Reliability Engineer + AI System Auditor
> 项目：向晚问思（WenDao）微信云开发小程序
> 里程碑：**CR-002 #004 = DEPLOYED + OBSERVATION**
> 报告性质：**只读观察**。本次执行未修改任何代码、配置、环境变量、知识库；未部署、未 commit、未 push、未 ingest、未 embedding、未进入任何新 Phase。
> 取证方式：`tcb db nosql execute`（只读查询）+ `tcb fn detail`（只读）+ 本地 `sha256sum`（只读）。**未调用 `tcb fn invoke`**，以免向观察数据集注入合成样本。

---

## 1. 时间窗口

| 项 | 值（GMT+8） |
|---|---|
| 观察期起点（部署完成） | 2026-08-06 13:51:47 |
| 本次观察执行时刻 | 2026-08-06 14:15:40 |
| **部署后观察时长** | **约 24 分钟** |
| 数据集覆盖窗（全历史） | 2026-08-02 10:33:53 → 2026-08-06 13:55:31 |
| 最后一条业务请求 | 2026-08-06 13:55:31（距今 20 分钟） |

**窗口性质说明（事实）**：观察期起点至今，`observability_logs` 仅新增 **2 条**，且时间戳与 Post-Deployment Verification 的 T1 / T4 完全重合。**观察窗内零有机用户流量。**

---

## 2. 生产事实

### 2.1 部署实体状态（`tcb fn detail`）

| 指标 | 结果 |
|---|---|
| Status | `Deployment completed` |
| FunctionId | `lam-8a8p5vsx` |
| Runtime | `Nodejs16.13`（未变） |
| Handler | `index.main`（未变） |
| Memory / Timeout | 512 MB / 60 s（未变） |
| Code size | 11,243,674 B（= 部署后记录值，未再变动） |
| 环境变量 | `ADMIN_OPENID=obmZ…APm8`；`KNOWLEDGE_OBSERVABILITY_STORE=cloud` — **2 项完整保留，无新增无删除** |

### 2.2 冻结资产完整性（O-0.6 基线比对）

| 资产 | 实测 SHA256 | 结论 |
|---|---|---|
| corpus.json | `db01fbc92064cbea3a6688a98160b6a70c9e150259b54063c8e2e96974eabc8b` | ✅ MATCH |
| intent.js | `765ad138ec68c0f159c6f75a60e5268beb02fba152f6d53dbdc539ba1560ca38` | ✅ MATCH |
| rag.js | `5b380b3f7c68f374e3d4e5127bd7dbeff747849401ca9d0488498dece1408286` | ✅ MATCH |
| knowledgeRouter.js | `848908445dbb5ea93a6f52775dc3c8e6922ff971d6cee115547f236ffed0a935` | ✅ MATCH |

**4/4 逐字节一致，零漂移。** 生产代码 `index.js` = `88cd3dff…d05e8a4`（与部署时一致）；回滚锚点 `index.js.preHotfix004.bak` = `dcfd866b…9c3f2f9` 在位。

### 2.3 观察目标 1 — API 错误情况（`-501001`）

| 指标 | 结果 |
|---|---|
| `security_events` 总量 | **10** |
| 部署前记录（无 errorCode 字段） | 5 条 |
| 部署后记录（含 errorCode 字段） | 5 条 |
| `errType` 取值分布 | `api_error: 10`（**100%**） |
| `errorCode` 取值分布 | `-501001: 5`（部署后全部） |
| 错误文案（来自线上日志） | `security.msgSecCheck:fail invalid wx openapi access_token` |
| 首次出现 | 2026-08-06 11:46:56 |
| 最近一次出现 | 2026-08-06 13:55:31 |
| **是否恢复** | **UNDETERMINED（无法判定）** |

**出现次数明细（部署后 5 条）**：

| # | 时间（GMT+8） | stage | errType | errorCode |
|---|---|---|---|---|
| 1 | 13:54:36 | in | api_error | -501001 |
| 2 | 13:54:41 | out | api_error | -501001 |
| 3 | 13:55:07 | in | api_error | -501001 |
| 4 | 13:55:25 | in | api_error | -501001 |
| 5 | 13:55:31 | out | api_error | -501001 |

**msgSecCheck 可用率（部署后窗口）= 0 / 5 = 0%。**

「是否恢复」判定为 UNDETERMINED 的依据（**事实，非推测**）：`security_events` 仅在扫描失败时写入。13:55:31 之后无新记录，但同期 `observability_logs` 亦无新记录 —— 即**该时段根本没有请求**。因此「无新错误」不能推出「已恢复」。判定恢复需要新的真实流量，或一次经明确授权的探针调用。

### 2.4 观察目标 3 — AI 回答质量

部署后 2 条业务记录明细：

| 时间 | intent | domain | policy | router | knowledge_type | 召回 | citation_count | latency_ms |
|---|---|---|---|---|---|---|---|---|
| 13:55:31 | emotion | 人生 | use | true | `["classic"]` | 中庸 / 爱比克泰德《手册》/ 沉思录 | **3** | 5865 |
| 13:54:41 | opinion | 通用 | optional | true | `[]` | （空） | **0** | 4945 |

全历史（n=54）质量分布：

| 指标 | 分布 |
|---|---|
| citation_count | `0:35`、`1:5`、`2:4`、`3:10` |
| retrieval_result | `0条:35`、`1条:5`、`2条:4`、`3条:10` |
| **RAG 召回率** | **19/54 = 35.2%** |
| knowledge_type | `classic:19`、`空:35` |
| fallback_reason | `classic-priority-domain:49`、`fallback-classic:4`、`cognitive-psychology-signal:1` |
| capability 非空 | 5（均为 Phase R time_query，2026-08-05） |
| freshness 非空 | **0**（Phase Q 默认关闭，与设计一致） |

**五段式完整率 / 引证准确性 / 幻觉检出**：**不可测（NOT MEASURABLE）**。`observability_logs` 仅落 `answer_id`，**不落答案正文**，无法离线复核五段式结构与引证准确性。当前唯一直接证据为 Post-Deployment Verification 测试 4（n=1，PASS：【理解】【分析】【建议】+《中庸》《手册》引证 +【思考】完整）。**样本量 n=1，不构成完整率统计。** 本次观察未发现幻觉事实，亦无证据可证明其不存在。

### 2.5 观察目标 4 — 系统稳定性

| 指标 | 结果 |
|---|---|
| 部署后请求数 | 2（均为验证流量，无有机流量） |
| 请求成功率（部署后） | 2/2 = **100%** |
| 安全拦截（部署后） | 1 次（inputGuard 注入样本，符合预期） |
| latency_ms（全历史 n=54） | min 53 / mean 5887 / p50 6180 / p90 8609 / p99 10471 / max 10471 |
| latency（部署后 n=2） | 4945、5865（均在 p50 附近，无劣化迹象） |
| 业务错误率 | 0（无 ok:false 的非预期返回） |
| fallback 情况 | 100% 落 `classic-priority-domain` 主路径，无异常 fallback |
| 按日流量 | 08-02:37、08-04:4、08-05:11、08-06:2 |

**稳定性结论：样本不足（部署后 n=2），不足以支撑稳定性判断。**

---

## 3. 安全状态

# **DEGRADED**

判定依据（逐条事实）：

| 维度 | 状态 | 事实依据 |
|---|---|---|
| 可用性（P0） | ✅ 恢复 | 「你好」正常回答，拦截串未出现，降级策略生效 |
| 注入护栏（inputGuard） | ✅ 在线 | 部署后注入样本被精确拦截（52 ms） |
| 出参安全链路 | ✅ 在线 | out 阶段扫描仍被调用并审计 |
| 审计元数据 | ✅ 增强 | `errorType` + `errorCode` 已落库 |
| 隐私脱敏（security_events） | ✅ 合规 | 见 §2.6 合规核验 |
| **微信内容安全扫描（msgSecCheck）** | ❌ **离线** | **可用率 0%，`-501001` 100% 复现** |

因**内容安全扫描实际处于离线状态**，输入侧仅剩 inputGuard 正则护栏兜底，整体安全状态判定为 **DEGRADED**，而非 PASS。

### 2.6 隐私合规核验（观察目标 2）

**`security_events`（n=10）— PASS**

| 检查项 | 结果 |
|---|---|
| 字段全集 | `_id, stage, errType, errorType, errorCode, openidHash, createTime`（7 键） |
| 违禁字段（message/content/text/query/answer/prompt/raw） | **无 ✅** |
| 明文 `openid` 字段 | **不存在 ✅** |
| `openidHash` 全为 sha256(64 hex) | **是 ✅**（唯一值 3 个） |
| 含 `errorCode` | 5/10（部署后 100%） |
| 含 `errorType` | 5/10（部署后 100%） |
| `hit` 字段 | **不存在** — 设计如此：仅扫描失败事件落库，`hit=true` 拦截不写 `security_events` |
| `action` 字段 | **不存在** — 当前 schema 无此字段 |

**`observability_logs`（n=54）— 存在合规事实，见 §4 新发现**

---

## 4. 新发现

> 仅记录事实。以下四项均为观察所得，**未做任何推测性归因，未做任何修复**。

**F-1｜`-501001` 根因文案已固化于线上日志**
线上返回 `errCode: -501001`，文案 `security.msgSecCheck:fail invalid wx openapi access_token`。部署后 5 次扫描 5 次复现，无一次成功。截至最后一次请求（13:55:31）未恢复。

**F-2｜`hit=true` 分支在生产环境不可复现**
`security_events` 中 `errType` 100% 为 `api_error`，无任何成功扫描记录。这意味着微信侧内容安全判定在生产从未被真实触发过，`hit=true` 必拦逻辑当前**仅由本地测试（24 PASS）保障**，无生产实证。

**F-3｜`observability_logs` 存储用户查询明文与明文 openid**
- `query` 字段：54/54 条存在，为用户提问明文（长度分布 1-5:7 / 6-15:37 / 16-40:10）。
- `openid` 字段：54/54 条存在，其中 **38 条为明文 openid（28 字符，`o` 开头）**，16 条为 `"unknown"`。**非 sha256 脱敏形态。**
- 该集合为 Phase P+ 可观测体系产物，**早于 CR-002 存在，非本次 Hotfix 引入**。CR-002 #004 的脱敏要求仅覆盖 `security_events`，`observability_logs` 不在其治理范围内。
- 与观察纪律「禁止保存用户原文、禁止泄露 openid、保持 sha256 脱敏」存在口径差异，登记为事实，**不修复，等待授权**。

**F-4｜答案质量存在观察盲区**
`observability_logs` 不落答案正文，五段式完整率、引证准确性、幻觉率三项**无法离线测量**。当前仅有 n=1 的人工验证证据。

---

## 5. 风险登记

| 编号 | 描述 | 等级 | 状态 | 本次变更 |
|---|---|---|---|---|
| **OBS-004-A** | msgSecCheck 全量失败：`errCode -501001 / invalid wx openapi access_token`。微信内容安全扫描离线，可用率 0%。 | **P1** | **OPEN** | 维持 OPEN。新增证据：部署后 5/5 复现；恢复状态 UNDETERMINED（零流量不可判定）。 |
| **OBS-004-B** | `hit=true` 必拦分支生产不可复现，仅本地测试覆盖，缺生产实证。 | P2 | **WATCHING** | 维持 WATCHING。依赖 OBS-004-A 修复后方可自然解除。 |
| **OBS-004-C** | `observability_logs` 存明文 `query` 与明文 `openid`（38/54），非 sha256 脱敏。Phase P+ 遗留，非 #004 引入。 | **P1** | **OPEN（本次新登记）** | 首次登记。仅记录，未修复。 |
| **OBS-004-D** | 答案质量观察盲区：无答案正文留存，五段式完整率 / 引证准确性 / 幻觉率不可测，现有证据 n=1。 | P2 | **OPEN（本次新登记）** | 首次登记。仅记录，未修复。 |
| RISK-004-1 | 降级放行期间内容安全扫描离线（已在部署报告中接受）。 | 已接受 | **WATCHING** | 与 OBS-004-A 同源，随其闭环。 |

**回滚能力状态**：L0（`.preHotfix004.bak` 覆盖重部署）/ L1（`SEC_DEGRADE_ON_API_ERROR=false` 秒级免部署熔断）/ L2（O-0.6 基线还原）—— **三级全部就绪可用**。

---

## 6. 是否触发下一阶段

# **REQUEST REVIEW**

触发依据（三项，均为事实）：

1. **安全状态为 DEGRADED 而非 PASS。** msgSecCheck 可用率 0%，微信内容安全扫描在生产实际离线。这对 UGC 类小程序的合规姿态构成实质影响，**超出「继续观察」可自行消化的范围**。
2. **新增 P1 级发现 OBS-004-C。** `observability_logs` 明文存储用户提问与 openid，与既定隐私口径存在差异，需人工裁定是否纳入治理范围。
3. **观察窗内零有机流量。** 部署后有效样本 n=2 且全为验证流量，无法证明系统在真实环境下稳定运行 —— 本阶段目标（证明稳定性）尚未达成，需人工决定是否延长观察窗或引入受控流量。

**明确声明**：本报告**不自行进入任何下一 Phase**，不启动修复，不提出实施动作。OBS-004-A / B / C / D 全部保持登记态，等待人工授权。

---

## 附：观察纪律自检

| 禁止项 | 本次执行 |
|---|---|
| 修改代码 / Prompt / Intent / RAG / 知识库 | ❌ 未执行 |
| ingest / embedding | ❌ 未执行 |
| commit / push / 部署 | ❌ 未执行 |
| 修改生产环境变量 | ❌ 未执行 |
| 开启 Phase Q | ❌ 未执行 |
| 自行修复已发现问题 | ❌ 未执行 |

**Observation Before Optimization —— 本次仅记录，未优化。**

---

*报告生成时间：2026-08-06 14:15:40 GMT+8*
*下一次观察建议触发条件：出现新的有机流量（`observability_logs` 增量 ≥ 10 条）或人工指令。*
