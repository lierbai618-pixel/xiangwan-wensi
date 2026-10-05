# Phase R Test Report
### Capability Layer 上线前测试执行报告

| 项 | 值 |
|---|---|
| 执行时间 | 2026-08-05 12:26 (GMT+8) |
| 执行运行时 | Node 22.22.2（生产为 Nodejs16.13，差异见 §5） |
| 测试性质 | 回归验证，**未修改任何测试断言** |
| **总体结论** | **主测试 PASS，扩展探测发现 1 项 P1 缺陷（R-001）** |

---

## 1. 执行纪律

严格遵守"不为了通过测试而修改测试"：

- 本轮**未改动** `test_capabilities.js` / `test_freshness.js` / `test_phasee2.js` 任何一行。
- 扩展探测（Step 4 生产风险）以**内联执行**完成，未落临时脚本、未污染仓库。
- 探测发现的失败项按缺陷登记处理，**未通过放宽断言使其"通过"**。

---

## 2. Step 2 — 主测试：`test_capabilities.js`

```
命令：node weapp/scripts/test_capabilities.js
结果：通过 60 / 60
状态：全部通过 ✅
```

### 分组结果

| 组 | 内容 | 结果 |
|---|---|---|
| A–H | 路由识别 / 时间 / 计算 / 天气 / 位置 / 否决层 / 格式化 / 安全性 | ✅ |
| I | 端到端调用链（时间、计算、天气边界、位置边界；`mode=capability`；无 `citations`） | ✅ 6/6 |
| J | 观测字段（落库、`bypass_rag`、freshness 互斥为 null、非能力路径恒 null、位置不含坐标明文） | ✅ 5/5 |
| K | 三层边界隔离（零引用 corpus/rag/knowledgeRouter/embedding；仅只读引用 intent.js） | ✅ 2/2 |

**60/60 达成，与 Phase R 开发交付时的结果一致，无衰减。**

---

## 3. Step 4 — 扩展探测：生产风险

### 3.1 False Positive —— Capability 是否抢占哲学问题

要求：以下必须回 RAG。

| # | 输入 | 结果 | 否决信号 |
|---|---|---|---|
| 1 | 时间的意义是什么 | ✅ 回 RAG | `veto-meaning` |
| 2 | 时间过得好快怎么办 | ✅ 回 RAG | `veto-metaphor` |
| 3 | 如何管理时间 | ✅ 回 RAG | `veto-lifeadvice` |
| 4 | 人生的意义是什么 | ✅ 回 RAG | `veto-meaning` |
| 5 | 怎么看待时间的流逝 | ✅ 回 RAG | `veto-opinion+veto-metaphor` |
| 6 | 时间都去哪了 | ✅ 回 RAG | `veto-metaphor` |
| 7 | 该不该珍惜时间 | ✅ 回 RAG | `veto-metaphor` |
| 8 | 时间的本质 | ✅ 回 RAG | `veto-meaning` |

**False Positive = 0 / 8。**

要求：以下必须走 Capability。

| # | 输入 | 结果 |
|---|---|---|
| 1 | 现在几点 | ✅ `time_query/time` |
| 2 | 今天几号 | ✅ `time_query/date` |
| 3 | 现在是星期几 | ✅ `time_query/weekday` |
| 4 | 23+45等于多少 | ✅ `calculation_query/arithmetic` |
| 5 | 今天天气怎么样 | ✅ `weather_query/today` |
| 6 | 我在哪 | ✅ `location_query/self` |
| 7 | **现在北京时间** | ❌ **回 RAG** → R-001 |

### 3.2 情绪共存

| 输入 | hit | emotional | 判定 |
|---|---|---|---|
| 我好焦虑，现在几点了 | true | true | ✅ 事实照给 + 语气切换 |
| 睡不着，现在几点 | true | true | ✅ 同上 |

情绪不否决事实诉求，仅改变收尾语气——设计意图得到验证。

### 3.3 False Negative 面量化（19 条自然问法探测）

| 输入 | 结果 |
|---|---|
| 现在几点了 / 几点了 / 现在时间 / 当前时间 / 现在是几点 / 报下时间 | ✅ HIT `time` |
| 今天是几号 | ✅ HIT `date` |
| 现在是哪一年 / 今年是哪一年 | ✅ HIT `year` |
| 明天星期几 / 昨天是几号 | ✅ HIT `relative` |
| 现在多少度 | ✅ HIT `weather/today` |
| 算一下 12*8 / 100的平方根 | ✅ HIT `arithmetic` |
| **现在北京时间** | ❌ MISS |
| **北京时间** | ❌ MISS |
| **今天日期** | ❌ MISS |
| **这个月几号** | ❌ MISS |
| **外面冷吗** | ❌ MISS |

**漏判率 5 / 19 ≈ 26%。** 详细根因与待批修复方案见 `PhaseR-DeploymentReadinessReport.md` §7 R-001。

**方向性说明**：漏判使行为退化至 Phase R 之前，**不构成回归**；误判（抢占思辨）才是危险方向，该方向为 0。

---

## 4. 回归测试

| 套件 | 本轮结果 | 基准 | 判定 |
|---|---|---|---|
| `test_capabilities.js` | 60 / 60 | 60 / 60 | ✅ 持平 |
| `test_freshness.js` | 32 / 32，分类准确率 100%（120/120） | 32 / 32 | ✅ 持平，Capability 接入未影响 Freshness |
| `test_phasee2.js` | 20 / 21 | 20 / 21 | ✅ 持平（唯一失败项为 O-0.6 遗留，`rag.js` SHA 未变可自证与 Phase R 无关） |

**三套回归零衰减。**

---

## 5. 运行时差异声明（诚实记录）

测试在 **Node 22.22.2** 执行，生产运行时为 **Nodejs16.13**，本机无 16.13 可用。

已采取的降险措施：

- 静态扫描确认零 ES2022+ API、零原生 `fetch`、零顶层 await、零可选链/空值合并。
- 纯 CommonJS + `var` + `function`，无语法层面的版本敏感点。
- 零新增 npm 依赖，`package.json` 无需变更。

**残余风险登记为 R-004（P3）**：首个真机请求即为运行时验证点，异常可 L1 秒级熔断。

---

## 6. 结论

| 门禁 | 判定 |
|---|---|
| Step 2 主测试 60/60 | ✅ PASS |
| False Positive（抢占思辨） | ✅ PASS（0/8） |
| 情绪共存 | ✅ PASS |
| 三套回归零衰减 | ✅ PASS |
| **False Negative（能力漏判）** | ❌ **FAIL — R-001（P1）** |

**测试维度结论：稳定性达标，完成度未达标。** 是否阻塞上线由 `PhaseR-DeploymentReadinessReport.md` §8 的路径 A / B 决策决定。
