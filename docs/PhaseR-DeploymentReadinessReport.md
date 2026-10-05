# Phase R Deployment Readiness Report
### 向晚问思（WenDao）— Capability Layer 上线前审查

| 项 | 值 |
|---|---|
| 阶段 | Phase R — Capability Layer |
| 审查角色 | Chief AI Architect / Release Guardian / Production Reliability Engineer |
| 审查时间 | 2026-08-05 12:26 (GMT+8) |
| 审查性质 | **只读审查**，本轮零代码写入 |
| 冻结基线 | O-0.6，Before ≡ After（详见 Freeze Integrity Report） |
| **放行结论** | **CONDITIONAL GO — 待决策**（见 §7） |

---

## 0. 审查纪律声明

本轮严格遵守 Release Guardian 边界：

- 未重新设计架构，未扩大需求范围，未进入 Phase R2。
- 未修改任何冻结资产（SHA256 双端校验 PASS）。
- **未为了通过测试而修改测试**——发现的缺陷以缺陷登记，不以调低断言掩盖。
- 生产风险验证全部以**内联执行**完成，未在仓库落任何临时脚本。
- 发现问题后**停止推进**，只报告 + 给出待批方案，不自行修补。

审查期间 `capabilities/` 与冻结四资产的 mtime 均停留在 Phase R 开发结束时刻，无本轮写入痕迹。

---

## 1. Step 1 — Phase R 文件完整性

### 1.1 模块文件（7/7 存在）

| 文件 | 大小 | 职责 | 状态 |
|---|---|---|---|
| `capabilities/router.js` | 9,842 B | 四类识别 + 哲学否决层 | ✅ |
| `capabilities/time.js` | 4,976 B | 系统时间（显式 UTC+8） | ✅ |
| `capabilities/weather.js` | 5,933 B | Provider 抽象，默认无源 | ✅ |
| `capabilities/calculator.js` | 10,810 B | 自建 tokenizer + 调度场，零 eval | ✅ |
| `capabilities/location.js` | 3,057 B | 依赖前端授权，拒绝推测 | ✅ |
| `capabilities/formatter.js` | 4,318 B | 事实优先 + 可选邀请 | ✅ |
| `capabilities/index.js` | 4,713 B | 编排器，异常回退 | ✅ |

### 1.2 基线备份（回滚 L2 前置）

`weapp/scripts/baseline-o0.6/` 内存在 `chat-index.js.o06.bak`、`observabilityLogger.js.o06.bak` 及 `SHA256SUMS.txt`。**两个被修改的非冻结文件均有改前副本，L2 回滚具备执行条件。**

---

## 2. Step 1 — `chat/index.js` 接入正确性

### 2.1 实际链路（源码核验，index.js:186–221）

```
message
  ↓ msgSecCheck(入参)              ← 未变
  ↓ getEnabledModels()             ← 未变
  ↓ capabilityMaybeHandle()        ← Phase R 新增，最先判定
  ↓ (result 为空) freshnessMaybeHandle()
  ↓ (result 为空) generateAnswer() ← 冻结链路，唯一兜底
  ↓ answerId / msgSecCheck(出参) / logObservation / logChat / logQuestion
```

与要求的架构顺序**完全一致**：Capability → Freshness → Knowledge(RAG)。

### 2.2 关键健壮性核验

| 检查项 | 实现 | 判定 |
|---|---|---|
| 命中即绕过 RAG | `if (!result && freshness…)` / `if (!result) generateAnswer` | ✅ |
| 未命中零行为变化 | `maybeHandle` 返回 `null`，后续链路原样执行 | ✅ |
| 模块加载失败不致命 | `require` 包 try/catch，失败置 `null` 并回退 | ✅ |
| 执行异常不致命 | 调用包 try/catch，异常 `result = null` 回退原链路 | ✅ |
| 熔断开关 | `CAPABILITY_ENABLED !== "false"` → 默认启用，可秒级关停 | ✅ |
| 出参安全检测覆盖能力路径 | 能力回答同样过 `checkTextSafety` | ✅ |
| answerId 贯通 | 能力路径同样赋 `result.answerId` | ✅ |
| 无输出不劫持 | `if (!toolResult \|\| !toolResult.fact) return null` | ✅ |

**结论：接入方式为纯增量旁路，冻结链路始终是兜底路径，符合"所有修改必须可回滚"。**

---

## 3. Step 1 — Observability 兼容性

| 检查项 | 结果 |
|---|---|
| `capability` 字段是否增量 | ✅ 非工具路径恒为 `null`，历史消费方零改动 |
| 是否影响既有字段 | ✅ 原 12 字段契约与 `freshness` 字段均未改动 |
| 是否白名单落库 | ✅ 仅 9 个 meta 字段入库，`toolResult.data` **不入库** |
| 是否与 freshness 互斥污染 | ✅ 能力路径 `freshness` 为 `null`（测试 J 组已锁） |
| fire-and-forget 语义 | ✅ 未变，落库失败不阻断回答 |

落库字段：`name / sub_type / confidence / signals / emotional / tool_ok / tool_reason / bypass_rag / has_invite`。

---

## 4. Step 1 — 循环依赖

`capabilities/` 内部 require 全图：

```
index.js → router.js / time.js / weather.js / calculator.js / location.js / formatter.js
index.js → ../intent  (只读，唯一冻结依赖；intent.js 不反向引用 capabilities)
weather.js → https    (Node 内置)
```

- 六个能力/工具文件**互不引用**，为叶子节点。
- 与 `rag.js` / `knowledgeRouter.js` / `corpus.json` **零引用**。
- **无循环依赖。** 依赖图为深度 2 的有向无环树。

---

## 5. Step 1 — Node 16.13 兼容性

生产运行时锁定 `Nodejs16.13`。静态扫描结果：

| 风险项 | 命中数 | 判定 |
|---|---|---|
| 原生 `fetch`（16.13 不存在） | 0 | ✅ |
| ES2022+ API（`.at()` / `Object.hasOwn` / `findLast` / `structuredClone` / 类私有字段 / static 块） | 0 | ✅ |
| 顶层 await | 0 | ✅ |
| 可选链 `?.` / 空值合并 `??` | 0 | ✅（即使 16 支持，实现层未使用，兼容裕度更大） |
| 模块体系 | 纯 CommonJS + `var` + `function` | ✅ |
| 外部 HTTP | `require('https')` 内置模块 | ✅ |
| 新增 npm 依赖 | 0 | ✅ 无需 `package.json` 变更 |

**残余风险（诚实记录）**：本机无 Node 16.13 运行时，测试实际在 Node 22.22.2 执行。语义差异风险已通过"零 ES2022+ 特性 + 零新依赖 + 纯 CommonJS"降至极低，但**未做真机 16.13 运行时验证**。缓解手段：部署后首个真机请求即为验证点，失败可 L1 秒级关停。

---

## 6. Step 4 & 5 — 生产风险与隐私边界

### 6.1 Capability 抢占哲学问题（误判方向 / False Positive）

指定用例 + 扩展探测，共 8 条哲学问句：

| 输入 | 结果 | 否决信号 |
|---|---|---|
| 时间的意义是什么 | ✅ 回 RAG | `veto-meaning` |
| 时间过得好快怎么办 | ✅ 回 RAG | `veto-metaphor` |
| 如何管理时间 | ✅ 回 RAG | `veto-lifeadvice` |
| 人生的意义是什么 | ✅ 回 RAG | `veto-meaning` |
| 怎么看待时间的流逝 | ✅ 回 RAG | `veto-opinion+veto-metaphor` |
| 时间都去哪了 | ✅ 回 RAG | `veto-metaphor` |
| 该不该珍惜时间 | ✅ 回 RAG | `veto-metaphor` |
| 时间的本质 | ✅ 回 RAG | `veto-meaning` |

**False Positive = 0/8。危险方向（工具层吞掉思辨）完全干净。**

情绪共存用例：`我好焦虑，现在几点了` / `睡不着，现在几点` → 均 `hit=true, emotional=true`，即**事实照给、收尾切换为情绪承接**，未因情绪词而丢失事实诉求。

### 6.2 漏判方向（False Negative）→ **发现缺陷 R-001，见 §7**

### 6.3 隐私边界（Step 5）

| 要求 | 核验结果 |
|---|---|
| 禁止 IP 推测 | ✅ `capabilities/` 全目录零 geoip/IP 解析逻辑；`location.js` 仅在**文案中显式声明拒绝 IP 猜测** |
| 禁止地址落库 | ✅ 模块内零 `db.` / 零 `collection(` 调用；观测层不接收 `toolResult.data` |
| 坐标禁入日志 | ✅ `location.js` 数据出口硬编码为 `{ authorized: bool }`，坐标不出模块（测试 J 组"位置观测不含坐标明文"已锁） |
| 日志仅记录授权状态 | ◐ **部分符合**，见 R-002 |
| 调试泄露 | ✅ `capabilities/` 零 `console.log`（仅 `index.js` 一处 `console.error` 打印异常 message，不含位置数据） |

**重要架构事实**：`miniprogram/pages/chat/chat.js` 调用云函数时**从未传 `location`**（第 532、577 行入参为 `{message, history, mode, conversationId}`）。因此 `event.location` 在生产中恒为 `undefined`，`location.js` 授权分支**当前不可达**。位置相关隐私风险为**潜伏态**，非活跃态。

---

## 7. 缺陷登记（Findings Registry）

### R-001 — 时间能力存在漏判，flagship 症状可经近义句式复现 · **P1 · 需决策**

**现象**：以下自然问法未被 Capability 识别，回落 RAG：

| 输入 | 期望 | 实际 |
|---|---|---|
| `现在北京时间` | time_query | ❌ 回 RAG（`no-capability-signal`） |
| `北京时间` | time_query | ❌ 回 RAG |
| `今天日期` | time_query/date | ❌ 回 RAG |
| `这个月几号` | time_query/date | ❌ 回 RAG |
| `外面冷吗` | weather_query | ❌ 回 RAG |

**根因**（`router.js`，只读定位，未修改）：

- L69 `北京时间是?多少` —— 强制要求"是多少"后缀，裸词 `北京时间` / `现在北京时间` 落空。
- L70 `(今天|今日|现在|当前).{0,3}(几号|…|什么日期|日期是)` —— 备选项含 `什么日期`/`日期是`，不含裸 `日期`。
- L70 锚点集合无 `这个月|本月`。
- L82 天气词表含 `冷不冷`，不含 `冷吗|热吗`。

**影响评级**：

- 方向属**漏判**（False Negative），行为退化到 Phase R 之前的状态 → **不构成回归**，不引入新的不稳定性。
- 但 `北京时间` 是**本产品输出文案自身的用词**（能力层标准回答即"现在是北京时间 ……"），用户极可能照此提问。命中该句式时，用户将遭遇**与原始报障完全相同的体验**（RAG 用五段式回答时间问题并自曝"无法获取时间"）。
- 即：**flagship 缺陷未被完全消灭，只是被削弱。**

**建议修复（已设计，未应用，待批准）**：纯正则增补，不新增能力、不改架构、不触碰冻结资产：

```js
// TIME_RES 增补（锚定式，避免吞掉"北京时间是怎么定义的"这类知识问题）
{ sub: 'time', re: /^\s*(现在|当前|此刻)?\s*北京时间\s*(是多少|多少|几点)?\s*[?？。!！]*$/u },
{ sub: 'date', re: /(今天|今日|现在|当前|这个月|本月).{0,3}(日期|几号|多少号)/u },
// WEATHER_RES 增补
{ sub: 'today', re: /(外面|外头|今天|现在).{0,4}(冷吗|热吗|下雨吗)/u },
```

修复后必须：重跑 `test_capabilities.js` 达 60/60 + 新增上述 5 条断言（**新增断言，不放宽既有断言**）+ 重跑 8 条哲学否决用例确认 False Positive 仍为 0。

---

### R-002 — 观测缺少显式 `location_authorized` 字段 · **P2**

**现象**：Step 5 要求"日志只能记录 `location_authorized:true/false`"。当前观测 `capability` 字段无该键，授权状态只能由 `tool_reason === 'no_authorization'` 反推。

**评级**：这是**观测完整性缺口，不是隐私泄露**——方向偏保守（记少了而非记多了），不构成上线阻塞。

**建议修复（未应用）**：`capabilities/index.js` 在 location 分支为 meta 增设布尔 `location_authorized`，并在 logger 白名单补该键。**严禁**顺带透传 `toolResult.data` 全量。

---

### R-003 — 位置地址可经回答文本落入 `logs` 集合 · **P2 · 潜伏（R2 准入前置）**

**现象**：授权分支回答文本形如"按你授权的定位，你现在在：<address>。"，而 `logChat()` 会把 `answer` 前 1000 字写入 `logs` 集合 → 地址明文入库。

**当前风险**：**不可达**。前端从不上报 `location`，该分支在生产中永不执行。

**约束登记**：**在前端接入 `wx.getLocation` 上报之前，必须先解决回答文本入库问题**（脱敏写入 / 能力路径跳过 answer 落库）。此条列为 Phase R2 硬性准入前置，不得随功能一起顺推上线。

---

### R-004 — 缺少 Node 16.13 真机运行时验证 · **P3 · 已缓解**

见 §5 残余风险。缓解：零 ES2022+ 特性、零新依赖、L1 秒级熔断。

---

### R-005 — E-v2 回归 20/21（既有） · **P3 · 非本阶段引入**

`test_phasee2.js` 单项失败为 O-0.6 遗留。`rag.js` SHA256 未变可自证与 Phase R 无关。不在本阶段处理范围。

---

## 8. 放行结论

| 门禁 | 判定 |
|---|---|
| 文件完整性 | ✅ PASS |
| 接入正确性 | ✅ PASS |
| Observability 兼容 | ✅ PASS |
| 循环依赖 | ✅ PASS（无环） |
| Node 16.13 兼容 | ✅ PASS（静态） |
| 测试 60/60 | ✅ PASS |
| 冻结完整性 | ✅ PASS |
| False Positive（抢占思辨） | ✅ PASS（0/8） |
| 隐私边界 | ✅ PASS（R-002 为完整性缺口，非泄露） |
| **False Negative（能力漏判）** | ❌ **FAIL — R-001** |

**综合结论：CONDITIONAL GO。**

系统**稳定性维度全部达标**，可安全部署且随时可回滚；但**缺陷修复完成度未达标**——上线后仍有一类用户会命中原始故障体验。

**两个可选路径，需你拍板，我不自行推进：**

**路径 A（推荐）— HOLD，先修 R-001 再部署**
理由：修复面为 3 条正则，完全落在 Phase R 既定范围内（不新增能力、不改架构、不碰冻结资产），代价极低；而 `北京时间` 恰是产品自身输出用词，漏判概率不低。带着已知的 flagship 复现路径上线，不符合 Release Guardian 职责。

**路径 B — 直接部署，R-001 转 Phase R 观察期 P1 待办**
理由：漏判不构成回归，最坏情况等同于修复前。可用真实观察数据量化 `北京时间` 类问法的实际占比后再决定是否值得改。风险：观察期内该类用户体验不变差、但也不变好。

无论选哪条，**部署与回滚步骤见 `PhaseR-DeploymentGuide.md`，观察指标见 `PhaseR-ObservationPlan.md`**。

---

## 9. 相关文档

- `PhaseR-CapabilityLayer.md` — 架构与实现说明（Phase R 开发交付）
- `PhaseR-FreezeIntegrityReport.md` — 冻结完整性报告
- `PhaseR-TestReport.md` — 测试报告
- `PhaseR-DeploymentGuide.md` — 部署操作与回滚
- `PhaseR-ObservationPlan.md` — 观察计划与 R2 准入
