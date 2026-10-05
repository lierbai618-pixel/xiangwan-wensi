# Phase R Deployment Preflight Check

**项目**：向晚问思（WenDao）微信云开发小程序
**阶段**：Phase R — Capability Layer
**Release Decision**：GO ✅（R-001 Patch 已批准）
**检查时间**：2026-08-05 13:26 (UTC+8)
**执行角色**：Release Guardian + Production Deployment Engineer
**本轮写入**：**零代码修改、零测试修改、零配置修改**（仅新增本文档与上线记录文档）

**判定结论**：**READY TO DEPLOY — 由人工在微信开发者工具执行**
（沙箱不具备可信的云函数代码写入通道，详见 §8）

---

## 1. 变更范围确认

本次部署承载的**唯一功能性变更**为 R-001 Patch：

| 项 | 内容 |
|---|---|
| 变更文件 | `weapp/cloudfunctions/chat/capabilities/router.js` |
| 变更内容 | 时间表达增强 / 日期表达增强 / 天气口语表达增强（3 处正则） |
| 变更性质 | 召回率修复，不新增能力类型、不改接口协议、不加依赖 |
| 批准状态 | 已批准（路径 A） |
| 依据文档 | `docs/PhaseR-R001-PatchReport.md` |

**重要：部署包实际范围 ≠ 变更范围。**
微信开发者工具以**整目录**上传 `cloudfunctions/chat`，因此本次上传同时携带以下**此前未部署**的代码：

| 携带模块 | 文件数 | 上线后生效状态 |
|---|---|---|
| `capabilities/`（Phase R） | 7 | **启用**（`CAPABILITY_ENABLED` 默认 true） |
| `freshness/`（Phase Q） | 9 | **不启用**（`FRESHNESS_ENABLED` 默认 false，不配置即关闭） |
| `index.js` / `observabilityLogger.js` 增量接入 | 2 | 启用（旁路 + 观测增量字段） |

Phase Q 代码随包上线但处于关闭态，运行时行为等价于不存在。**这不构成 Phase Q 上线**，Q 的启用仍需单独决策与单独配置环境变量。此处显式声明，避免后续将 Q 视为"已上线"。

---

## 2. 文件完整性检查

`weapp/cloudfunctions/chat/capabilities/` 目录清单：

| 文件 | 大小 | 最后修改 | 状态 |
|---|---|---|---|
| `router.js` | 10,674 B | 08-05 13:04 | ✅ **R-001 版本** |
| `time.js` | 4,976 B | 08-05 11:57 | ✅ 未变动 |
| `weather.js` | 5,933 B | 08-05 11:58 | ✅ 未变动 |
| `calculator.js` | 10,810 B | 08-05 12:05 | ✅ 未变动 |
| `location.js` | 3,057 B | 08-05 11:58 | ✅ 未变动 |
| `formatter.js` | 4,318 B | 08-05 12:01 | ✅ 未变动 |
| `index.js` | 4,713 B | 08-05 12:01 | ✅ 未变动 |

**要求 7 文件 / 实际 7 文件 / 缺失 0 / 多余 0 → PASS**

R-001 版本确认（SHA256）：

```
capabilities/router.js
  46acd4f45f199b97381fd5738fec58a159d058aa1e864f43f3d0d8aa3bbdd830
  ≡ PhaseR-R001-PatchReport.md 所载 after-patch 哈希 → PASS

scripts/test_capabilities.js
  640b21c7e5c3f80e85c38e5a8b1a8629d7299166a5107ae4666fc6a85cc0ec55
  ≡ 补丁报告所载哈希（本轮零修改）→ PASS
```

`router.js` mtime 停留在 13:04（R-001 补丁写入时刻），本轮审查期间未再触碰。

---

## 3. 冻结资产校验（O-0.6）

| 文件 | SHA256 | 基线比对 |
|---|---|---|
| `corpus.json` | `db01fbc92064cbea3a6688a98160b6a70c9e150259b54063c8e2e96974eabc8b` | ✅ 一致 |
| `intent.js` | `765ad138ec68c0f159c6f75a60e5268beb02fba152f6d53dbdc539ba1560ca38` | ✅ 一致 |
| `rag.js` | `5b380b3f7c68f374e3d4e5127bd7dbeff747849401ca9d0488498dece1408286` | ✅ 一致 |
| `knowledgeRouter.js` | `848908445dbb5ea93a6f52775dc3c8e6922ff971d6cee115547f236ffed0a935` | ✅ 一致 |

**结果：PASS。** 四资产自 O-0.6 冻结以来逐字节未变，历经 Phase Q、Phase R、R-001 三轮改动全部零漂移。

---

## 4. 环境变量核验

**核验方法**：不看文档、不凭记忆，直接扫描代码中全部 `process.env.*` 读取点，与部署清单逐项对齐。变量名拼写不一致是云函数部署最高频的静默失败原因。

### 4.1 本次部署必须关注的三个变量

| 变量名 | 代码读取点 | 默认值 | 生效逻辑 | 本次应设 |
|---|---|---|---|---|
| `CAPABILITY_ENABLED` | `index.js:30` | `"true"` | `!== "false"` 即启用 | **不配置**（走默认启用）或显式 `true` |
| `CAPABILITY_INVITE_ENABLED` | `capabilities/formatter.js:20` | `"true"` | `!== "false"` 即附加思辨邀请 | **不配置**（走默认启用） |
| `WEATHER_PROVIDER` | `capabilities/weather.js:24` | `"none"` | `none` = 无数据源，诚实声明边界 | **不配置**（保持 `none`，R2 前不接数据源） |

**变量名与代码读取点逐字符一致 → PASS。** 三者均设计为"不配置即安全默认"，本次部署**无需新增任何环境变量配置**。

### 4.2 必须保留的既有变量（部署时勿丢失）

| 变量名 | 用途 | 丢失后果 |
|---|---|---|
| `KNOWLEDGE_OBSERVABILITY_STORE=cloud` | 观测落库开关 | **观察期无数据可采，五项指标全部失效，R2 准入永远无法满足** |
| `ADMIN_OPENID` | 管理员识别 | 后台/看板相关能力受影响 |

> ⚠️ **部署清单必检项**：微信开发者工具的云函数环境变量面板在某些操作路径下为**整体覆盖**语义。部署完成后必须回到该面板确认上述两个变量仍然存在。这是本次部署唯一有"静默破坏既有能力"风险的环节。

### 4.3 本次不涉及的变量（保持原状）

`FRESHNESS_ENABLED`（未配置 = 关闭，Phase Q 不启用）、`FRESHNESS_SEARCH_*`（Q2 事项）、`WEATHER_API_KEY` / `WEATHER_API_URL` / `WEATHER_TIMEOUT_MS`（R2 事项）、`KB_ROUTER_ENABLED`（默认 true）。

---

## 5. 运行时与依赖检查

`config.json`：

```json
{"permissions": {"openapi": ["security.msgSecCheck"]}, "timeout": 90, "memorySize": 512, "runtime": "Nodejs16.13"}
```

| 项 | 值 | 判定 |
|---|---|---|
| runtime | `Nodejs16.13` | ✅ 与冻结约定一致，未被改动 |
| timeout | 90s | ✅ 未变；能力层为同步计算，实际耗时远低于此 |
| memorySize | 512MB | ✅ 未变；能力层零额外内存压力 |
| permissions | `security.msgSecCheck` | ✅ 未变；内容安全校验保持生效 |

`package.json` 依赖：

```json
"dependencies": {"wx-server-sdk": "~2.6.3"}
```

**零新增依赖 → PASS。** Phase R 全部能力（时间换算、表达式求值、格式化）均为自实现，`calculator.js` 使用自建 tokenizer + 调度场算法，**零 `eval` / 零 `new Function` / 零 `vm`**。

Node 16.13 兼容性（静态复核）：零可选链 `?.`、零空值合并 `??`、零 ES2022+ API（`.at()` / `Object.hasOwn` / `structuredClone` / `findLast`）、零原生 `fetch`、零顶层 `await`、纯 CommonJS + `var`。

> 尽管无新依赖，仍**建议选择"上传并部署：云端安装依赖"**而非"仅上传代码"，以保证云端 `node_modules` 与 `package.json` 状态一致，避免历史残留差异。

---

## 6. 测试复跑

```
node weapp/scripts/test_capabilities.js
→ 通过: 75 / 75
→ 全部通过 ✅
```

与 R-001 补丁报告所载结果完全一致，无衰减。本轮未修改测试脚本一字（SHA256 见 §2）。

---

## 7. 离线首验预演

在本地直接调用 `capabilities/index.js` 的 `maybeHandle()`，预演三条 Smoke Case 的真实返回，用于确立云端首验的**判读基准**。

### Case 1：`现在北京时间`

```
mode        = capability
bypass_rag  = true
citations   = []
capability  = time_query / time
tool_ok     = true
answer      = 现在是北京时间 2026年8月5日 13:26，星期三。

              顺带一提：如果你此刻在意的其实不是几点，而是"又过去一天了"，我在这儿。
```
→ 全部符合期望。**这正是 R-001 修复的目标句式**（修复前此句 MISS 回 RAG）。

### Case 2：`今天日期`

```
mode        = capability
bypass_rag  = true
citations   = []
capability  = time_query / date        ← 注意：不是 date_query
tool_ok     = true
answer      = 今天是北京时间 2026年8月5日，星期三。
```
→ 符合期望，但**能力类型命名需按 PF-01 判读**（见 §9）。

### Case 3：`时间的意义是什么`

```
maybeHandle() → null
router.hit    = false
router.reason = philosophical-veto:veto-meaning
```
→ 不命中能力层，直落 Freshness（关闭态，透传）→ Knowledge Layer (RAG)，由冻结链路输出五段式。**否决层按设计生效。**

---

## 8. 部署通道判定

| 通道 | 探测结果 | 可用性 |
|---|---|---|
| 沙箱 curl → `scf.tencentcloudapi.com` | HTTP 200 / connect 0.0007s / **curl exit 23** | ❌ **不可信**（连接耗时与返回码模式表明为沙箱代理拦截而非真实端点响应） |
| `tcb` CLI 读侧（`tcb env list`） | 成功返回 `YOUR_CLOUD_ENV_ID`（个人版，Normal） | ✅ 读可达 |
| `tcb` CLI 写侧（代码上传） | 依赖 SCF 上传端点 → 同上不可信 | ❌ 不采用 |
| 微信开发者工具 GUI | 需人工操作 | ✅ **本次采用** |

**判定：部署为 HUMAN-EXECUTED。** 沙箱侧读类 API 可达但**代码写入通道不可信**，在生产部署场景下"不可信"等同于"不可用"——半成功的代码上传比明确失败危险得多。且用户已明确指定使用微信开发者工具，此为唯一批准通道。

---

## 9. Preflight Findings

本轮共发现 5 项，**0 项阻塞部署**。

### PF-01（P1 · 判读口径 · 必读）— 不存在 `date_query` 能力类型

任务书 Case 2 要求"检查 `date_query`"，但实现契约中**没有** `date_query` 这一能力类型。日期查询归属 `time_query`，通过 `sub_type` 区分：

```
capability.name     = "time_query"
capability.sub_type = "date"        ← 日期在这里区分
```

**影响**：若首验时按字面查找 `date_query`，会把一条**实际通过**的用例误判为 FAIL，进而可能触发不必要的回滚。

**处置**：本轮禁止改代码，且此为**命名口径差异而非缺陷**（时间与日期共享同一时钟源与同一工具实现，合并为一个能力类型是正确设计）。**首验判读标准以 `time_query` + `sub_type=date` 为准**，已写入上线记录的判读表。

### PF-02（P3 · 文案微瑕 · 不修）— 日期查询沿用时间口径的邀请语

`今天日期` 的回答附加邀请为「如果你此刻在意的其实不是**几点**……」，对日期类问句略不贴切（应为"哪一天"口径）。

**处置**：属文案打磨，非功能缺陷，不影响事实正确性。本轮禁止修改代码 → **登记为观察期 P3 待办**，与 R-001-a 一并在观察期结束后统一评审。

### PF-03（P2 · 范围披露）— 部署包携带 Phase Q 代码（关闭态）

详见 §1。**不阻塞**，但需在上线记录中留痕，避免后续误认为 Phase Q 已上线。

### PF-04（P1 · 部署操作风险）— 既有环境变量可能被覆盖丢失

详见 §4.2。`KNOWLEDGE_OBSERVABILITY_STORE=cloud` 一旦丢失，**观察期将采集不到任何数据**，而这一失败是完全静默的——线上功能一切正常，只是没有日志，等到发现时已浪费整个观察窗口。

**处置**：列为部署后**第一项**必检动作，优先级高于 Smoke Test。

### PF-05（P3 · 遗留）— R-001-a 长句尾缀仍在锚定式之外

`北京时间现在是多少啊` 一类带语气尾缀的长句仍会 MISS。方向安全（最坏等同修复前），已在补丁报告登记，转观察期用真实样本决定是否续修。

---

## 10. Preflight 判定

| 检查项 | 结果 |
|---|---|
| 1. `router.js` 为 R-001 版本 | ✅ PASS（SHA256 比对一致） |
| 2. `capabilities/` 七文件完整 | ✅ PASS（7/7，无缺无冗） |
| 3. 环境变量配置正确 | ✅ PASS（三变量名与代码读取点逐字一致，均为安全默认，本次无需配置） |
| 4. 冻结四资产 SHA256 | ✅ PASS |
| 5. 运行时 / 依赖 / 权限 | ✅ PASS（Nodejs16.13，零新增依赖） |
| 6. 测试 75/75 | ✅ PASS |
| 7. 离线首验预演 3/3 | ✅ PASS |
| 8. 部署通道 | ⚠️ HUMAN-EXECUTED（沙箱写侧不可信） |
| 阻塞项 | **0** |

**结论：READY TO DEPLOY。**

放行条件（须在部署过程中逐条满足）：

1. 部署方式为微信开发者工具「上传并部署：**云端安装依赖**」；
2. 部署完成后**先**确认 `KNOWLEDGE_OBSERVABILITY_STORE=cloud` 与 `ADMIN_OPENID` 未丢失（PF-04）；
3. 三条 Smoke Case 按本文档 §7 基准与 PF-01 口径判读；
4. 任一 Smoke Case 失败 → 立即执行 L1（关闭 `CAPABILITY_ENABLED`），**不现场调试、不现场改代码**。

---

*本文档为只读审查产物。生成过程未修改任何代码、测试、配置或冻结资产。*
