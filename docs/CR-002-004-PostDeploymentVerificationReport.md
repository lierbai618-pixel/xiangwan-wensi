# CR-002 #004 Post Deployment Verification Report

- **文档编号**：CR-002-004-PDVR
- **生成时间**：2026-08-06 14:00 (GMT+8)
- **角色**：Release Manager + DevOps Engineer
- **范围**：Deployment + Post Deployment Verification（不含任何代码/配置修改）
- **关联文档**：`CR-002-004-HotfixDesignProposal.md`、`CR-002-004-PreDeploymentCheckReport.md`、`CR-002-004-DeploymentPreflightCheckReport.md`、`CR-002-ProductionIncidentDiagnosisReport.md`

---

## 0. 结论摘要

```
CR-002 #004 = DEPLOYED + OBSERVATION
生产可用性 = 已恢复
真机测试 = 4 / 4 PASS
冻结资产 = 4 / 4 零漂移
Issue #004 = RESOLVED (症状闭合) → 转 OBSERVATION
```

> **附带重大发现**：本次生产日志首次给出 `api_error` 的**确切根因** —— `errCode: -501001 / security.msgSecCheck:fail invalid wx openapi access_token`。该项**不在本次授权范围内**，已登记为观察期跟进项 OBS-004-A（见 §7.2），未做任何处置。

---

## 1. 部署信息

| 项 | 值 |
|---|---|
| 部署时间 | **2026-08-06 13:51:47 (GMT+8)** |
| 环境 ID | `YOUR_CLOUD_ENV_ID` |
| 函数名 | `chat` |
| FunctionId | `lam-8a8p5vsx` |
| 部署通道 | CloudBase CLI 3.6.4 → **COS 上传** |
| 部署命令 | `tcb fn deploy chat --force` |
| Deploy Result | **`√ [chat] Cloud function deployed successfully!`** |
| 耗时 | 52 s |
| Status（部署后） | Deployment completed |
| Auto install dependencies | **TRUE**（云端安装依赖） |

### 1.1 部署前 / 后对比

| 项 | 部署前 | 部署后 | 判定 |
|---|---|---|---|
| Code size (B) | 11,223,771 | **11,243,674** (+19,903) | 变更符合预期（index.js 增量） |
| Modification time | 2026-08-05 16:15:53 | **2026-08-06 13:51:47** | 已更新 |
| Runtime | Nodejs16.13 | **Nodejs16.13** | ✅ 未改变 |
| Handler | index.main | index.main | ✅ 未改变 |
| Memory / Timeout | 512 MB / 60 s | 512 MB / 60 s | ✅ 未改变 |
| 环境变量 | `ADMIN_OPENID`, `KNOWLEDGE_OBSERVABILITY_STORE=cloud` | **同前，2 项完整保留** | ✅ 未改变 |
| Network / Trigger | None / None | None / None | ✅ 未改变 |

> **未执行**：`npm upgrade`、运行时变更、环境变量面板修改、代码再修改、commit、push。
> `cloudbaserc.json` 的 `envVariables` 与生产**逐值相同**，故 CLI 部署对环境变量为幂等操作，未产生任何变更。

---

## 2. 代码版本确认

### 2.1 本地产物

| 文件 | SHA256 | 大小 |
|---|---|---|
| `cloudfunctions/chat/index.js` | `88cd3dff3db9217950a67ac4124df1d29bcd905b38384978c028f85c8d05e8a4` | 16,025 B |
| `cloudfunctions/chat/index.js.preHotfix004.bak` | `dcfd866b3318b4e12b1ddf225d923d3bab33da8b93555fbc719d6b9a49c3f2f9` | 14,091 B |

部署前后 `index.js` SHA256 **完全一致** —— 部署过程未触发任何代码再生成或改写。

### 2.2 云端代码实体核验（`tcb fn detail` 直读线上源码）

线上代码逐条命中 Hotfix #004 特征，**云端 ≡ 本地**：

| 行 | 云端实际代码 |
|---|---|
| L128 | `const errorCode = (e && e.errCode !== undefined && e.errCode !== null) ? e.errCode : null;` |
| L133 | `return { hit: false, err: msg, scanned: false, errType, errorCode };` |
| L146 | `function decideBlock(res, warnOnly, degradeOnApiError) {` |
| L148 | `if (res.hit === true) return true;` — 要求1 命中必拦 |
| L150 | `if (degradeOnApiError === true && res.scanned === false) return false;` — 要求2 降级放行 |
| L151 | `return res.scanned === false;` — 降级关时回 fail-closed |
| L161 | `async function logSecurityEvent(stage, errType, errorCode, openid) {` |
| L167-168 | 落库 `errorType` / `errorCode`（`errType` 兼容保留） |
| L271 | `const degradeOnApiError = (process.env.SEC_DEGRADE_ON_API_ERROR \|\| "true").toLowerCase() !== "false";` |
| L278 / L335 | in / out 两处**统一**传入 `degradeOnApiError` |

---

## 3. 真机测试结果

全部经 `tcb fn invoke` 对**线上函数**真实调用（非本地模拟）。

### 测试 1 — 正常输入回归 → **PASS** ✅

| 项 | 值 |
|---|---|
| 输入 | `你好` |
| RequestId | `090ae48b-93dd-458a-be91-cbc08ac8e360` |
| 返回 | `{"ok":true,"mode":"model",...}` |
| 耗时 | 5,151 ms |
| 禁止串「您的提问包含不当内容，已拦截。请换个问题。」 | **未出现** ✅ |

线上日志证据（同一次调用内）：
```
msgSecCheck 调用失败: errCode: -501001 ... invalid wx openapi access_token
[检索] 弱召回：知识库无相关内容 | query=你好 | frame=general
[意图] type=opinion | domain=通用 | policy=optional | 命中资料=0条
[模型切换] 尝试 #1 Flash → Flash 成功
```
→ **扫描失败仍进入完整回答流程**，降级逻辑在生产环境按设计生效。**P0 闭合。**

### 测试 2 — 安全日志验证 → **PASS** ✅

查询 `security_events`（`tcb db nosql execute`，只读），本次部署后新增 **5 条**，与 3 次调用**逐条对齐**：

| # | createTime (GMT+8) | stage | errType | **errorType** | **errorCode** | openidHash | 归属 |
|---|---|---|---|---|---|---|---|
| 1 | 13:54:36 | `in` | api_error | **api_error** | **-501001** | `b23a6a84…09bc` (64 hex) | 测试1 入参 |
| 2 | 13:54:41 | `out` | api_error | **api_error** | **-501001** | `b23a6a84…09bc` | 测试1 出参 |
| 3 | 13:55:07 | `in` | api_error | **api_error** | **-501001** | `b23a6a84…09bc` | 测试3 入参 |
| 4 | 13:55:25 | `in` | api_error | **api_error** | **-501001** | `b23a6a84…09bc` | 测试4 入参 |
| 5 | 13:55:31 | `out` | api_error | **api_error** | **-501001** | `b23a6a84…09bc` | 测试4 出参 |

**必须存在项**：
- `stage=in` ✅（3 条）
- `errorType=api_error` ✅（msgSecCheck 确仍失败，故该值符合预期）
- `errorCode` 存在 ✅（`-501001`，首次落库真实错误码）

**必须不存在项**（隐私红线）：记录字段仅 `_id / stage / errType / errorType / errorCode / openidHash / createTime` 共 7 个键。
- `message` ❌ 不存在 ✅
- `content` ❌ 不存在 ✅
- 用户原文（任何形式）❌ 不存在 ✅
- openid 明文 ❌ 不存在（仅 SHA256 64 位十六进制）✅

**对照组佐证**：Hotfix 前的旧记录（如 11:46:56 那批）仅有 `stage / errType / openidHash / createTime`，**无 `errorType`、无 `errorCode`** —— 证明两个新字段确由本次 Hotfix 引入并已生效。

### 测试 3 — 违规拦截能力 → **PASS** ✅

| 项 | 值 |
|---|---|
| 输入 | 提示词注入样本（要求输出系统提示词全文） |
| RequestId | `dc6ef78a-d843-4367-8dba-27ef5bde17fd` |
| 返回 | `{"ok":false,"error":"您的输入包含异常指令模式，已拦截。"}` |
| 耗时 | 52 ms |

→ **降级放行只作用于「扫描失败」，不削弱既有拦截能力**：请求先通过降级后的 msgSecCheck 关卡，随后被 `inputGuard` 精确拦截。安全能力**未被 Hotfix 削弱**。

> **诚实披露（重要）**：由于线上 msgSecCheck 当前 **100% 失败**（access_token 无效），`hit=true` 这条**由微信内容安全服务判定**的分支在生产环境**当前不可复现、因而无法真机验证**。该分支的正确性目前由本地测试保障（Phase 3，`res.hit === true` 严格布尔必拦，24/24 PASS）。这构成残留风险 **RISK-004-1**（见 §7.2）。

### 测试 4 — 回答链路与五段式 → **PASS** ✅

| 项 | 值 |
|---|---|
| 输入 | `我最近总是焦虑，感觉人生没有方向，该怎么办` |
| RequestId | `d19763b7-a103-4cbe-a855-5ee41064d4c7` |
| 返回 | `{"ok":true,"mode":"model",...}` |
| 耗时 | 6,015 ms |
| 意图 | `type=emotion / domain=人生 / policy=use / 命中资料=3条 / reason=emotion-signal` |
| 模型 | Flash 一次成功 |

`generateAnswer` 正常执行，**五段式结构完整未变**：

| 段 | 线上实际输出 | 状态 |
|---|---|---|
| 理解 | 【理解】你不是"出了问题"，而是心在提醒你… | ✅ |
| 分析 | 【分析】焦虑常发生在"我该往哪走"和"我还没想清楚"之间… | ✅ |
| 行动 | 【建议】今天就做一件"小到不可能失败"的事… | ✅ |
| 经典 | citations：《中庸》第二章、爱比克泰德《手册》第一节（+1 条） | ✅ |
| 思考 | 【思考】如果"方向"不是一条笔直的路… | ✅ |

RAG 召回、`route`、`analysis`、`intent`、`retrieval`、`citations` 全字段结构与 Hotfix 前一致。**「先做人再引经」原则未被侵蚀。**

---

## 4. 冻结资产复核

部署后重新计算，与 O-0.6 基线逐字节比对：

| 资产 | SHA256 | O-0.6 基线 | 结论 |
|---|---|---|---|
| corpus.json | `db01fbc92064cbea3a6688a98160b6a70c9e150259b54063c8e2e96974eabc8b` | 同 | ✅ MATCH |
| intent.js | `765ad138ec68c0f159c6f75a60e5268beb02fba152f6d53dbdc539ba1560ca38` | 同 | ✅ MATCH |
| rag.js | `5b380b3f7c68f374e3d4e5127bd7dbeff747849401ca9d0488498dece1408286` | 同 | ✅ MATCH |
| knowledgeRouter.js | `848908445dbb5ea93a6f52775dc3c8e6922ff971d6cee115547f236ffed0a935` | 同 | ✅ MATCH |

**4/4 零漂移。** 自 Phase Q → R → R-001 → CR-002 → Hotfix #004 共五轮迭代，冻结四资产 SHA256 恒定。

同时确认**未修改**：Prompt、RAG、Search、业务回答逻辑、`inputGuard.js`、`piiScrub.js`、`capabilities/`、`freshness/`、`observability/`。

---

## 5. 生产可用性判定

| 判据 | 部署前（故障态） | 部署后 | 判定 |
|---|---|---|---|
| 正常问候可用 | ❌ 被全量拦截 | ✅ 正常回答 | **已恢复** |
| 正常长问题可用 | ❌ 被全量拦截 | ✅ 五段式完整 | **已恢复** |
| 注入攻击拦截 | ✅（但被 msgSecCheck 抢先误拦） | ✅ 精确拦截 | **保持** |
| 安全审计可观测 | 仅 errType | **+ errorType + errorCode** | **增强** |
| 用户隐私 | 无原文 | 无原文 | **保持** |

```
生产可用性 = RESTORED
```

---

## 6. 回滚能力（就绪，未使用）

| 层级 | 手段 | 生效方式 | 状态 |
|---|---|---|---|
| **L1** | 环境变量面板设 `SEC_DEGRADE_ON_API_ERROR=false` | **秒级、免部署**，退回 fail-closed | 就绪（本次未设置，走代码默认 true） |
| **L1'** | 设 `SEC_EMERGENCY_WARN_ONLY=true` | 免部署，仅命中才拦 | 就绪 |
| **L0** | 用 `index.js.preHotfix004.bak` 覆盖 `index.js` 后重部署 | 需一次部署 | 备份就位（`dcfd866b…f2f9`） |
| **L2** | 恢复 O-0.6 全量基线 | 需一次部署 | `weapp/scripts/baseline-o0.6/` |

---

## 7. Issue #004 状态

### 7.1 主状态

| 项 | 值 |
|---|---|
| Issue | **#004 — CR-002 fail-closed 导致正常用户全量拦截（P0）** |
| 症状 | 已闭合（真机 4/4 PASS） |
| 状态迁移 | `Confirmed` → **`RESOLVED (Symptom)`** → **`OBSERVATION`** |
| 结案条件 | 观察期内无回归 **且** OBS-004-A 有明确处置结论 |

### 7.2 观察期跟进项（**仅登记，本次不处置**）

| 编号 | 内容 | 级别 | 状态 |
|---|---|---|---|
| **OBS-004-A** | msgSecCheck 真实根因已定位：`errCode -501001 / security.msgSecCheck:fail invalid wx openapi access_token`。属**微信 openapi access_token 无效**，非代码缺陷、非配额问题。需单独立项排查（小程序 openapi 权限 / 云环境与 AppID 绑定 / 备案审核态影响）。 | **P1** | **OPEN — 待人工授权后另开工单** |
| **RISK-004-1** | msgSecCheck 全量失败期间，**微信内容安全扫描实际处于离线状态**；输入侧仅剩 `inputGuard` 注入护栏，无违规文本识别能力。这是本次「可用性优先」的**已知且已接受**的权衡。OBS-004-A 修复后自动解除。 | **P1** | **ACCEPTED（观察中）** |
| **OBS-004-B** | `hit=true` 分支无法在生产复现验证，依赖本地测试保障，需在 OBS-004-A 修复后补一次真机验证。 | P2 | OPEN |

### 7.3 观察期纪律

1. **只观察，不优化。** 发现问题只登记，不自行修复。
2. 观察指标：`security_events` 中 `errorType` 分布、`errorCode` 取值收敛情况、是否出现非 `-501001` 的新错误码。
3. 若出现「正常输入被拦截」回归 → 立即 L1 熔断并输出 Incident Report，等待人工授权。
4. **不进入** S0.5 / S1 / Provider / Search / 任何新功能开发。

---

## 8. 执行纪律合规声明

| 禁止项 | 是否触碰 |
|---|---|
| 修改任何代码 | ❌ 未触碰（部署前后 index.js SHA256 一致） |
| 修改任何配置 | ❌ 未触碰 |
| 修改环境变量面板 | ❌ 未触碰（部署后仍为原 2 项） |
| 修改 Prompt / RAG / Search | ❌ 未触碰 |
| 修改 corpus.json / intent.js / rag.js / knowledgeRouter.js | ❌ 未触碰（SHA256 4/4 MATCH） |
| commit / push | ❌ 未执行 |
| 进入其他 Phase | ❌ 未进入 |

**本次仅执行**：Deployment + Post Deployment Verification（只读）。

---

## 9. 最终状态

```
╔══════════════════════════════════════════════╗
║   CR-002 #004 = DEPLOYED + OBSERVATION       ║
║   生产可用性       = RESTORED                 ║
║   真机测试         = 4 / 4 PASS               ║
║   冻结资产         = 4 / 4 MATCH              ║
║   隐私红线         = 零原文，PASS              ║
║   回滚能力         = L0 / L1 / L2 全就绪       ║
║   Issue #004      = RESOLVED → OBSERVATION   ║
║   跟进项           = OBS-004-A (P1, OPEN)     ║
╚══════════════════════════════════════════════╝
```

部署闭环完成，进入观察期。停止于此，等待人工指令。
