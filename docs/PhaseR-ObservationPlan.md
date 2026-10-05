# Phase R Observation Plan
### Capability Layer 生产观察计划

| 项 | 值 |
|---|---|
| 阶段 | Phase R — Observation Window |
| 起点 | Capability Layer 部署上线之时 |
| 终点 | 真实生产样本 ≥ 50 且 Review 通过 |
| 性质 | **只观察，不优化** |
| R2 准入 | 未满足本文档 §5 全部门禁前，**禁止**进入 Phase R2 |

---

## 0. 观察期第一纪律

**只观察，不优化。**

观察期内禁止：

- 调整 `router.js` 正则以"改善"命中率
- 新增能力类型
- 接入天气/地图数据源
- 修改回答文案
- 任何以"顺手优化"为名的改动

**唯一例外**：P0 级生产事故（能力层导致回答错误、崩溃、隐私泄露）—— 此时执行 `PhaseR-DeploymentGuide.md` §4 回滚，而不是"就地修复"。

理由与 Phase P+ 一致：**没有数据的优化是猜测，会污染观察窗口，使后续判断失去基线。** Phase P+ 曾因样本 N=37 < 50 而拒绝进入 Phase Q，同一纪律在此适用。

---

## 1. 观察指标定义

数据来源：`observability_logs` 集合的 `capability` 字段（Phase R 已埋点）。

### 1.1 `capability_hit_rate` — 能力命中率

```
capability_hit_rate = count(capability != null) / count(全部记录)
```

**含义**：实时工具类问题在总流量中的占比。

**读法**：这是**产品事实发现**，不是性能指标——不存在"越高越好"。它回答的是"用户到底会不会拿 WenDao 问时间"。若长期趋近 0，说明 Phase R 修的是一个真实存在但低频的缺陷（仍值得修，但 R2 投入应审慎）。

---

### 1.2 `false_positive_rate` — 误判率（**最高优先级**）

```
false_positive_rate = 被能力层接管、但实为思辨诉求的记录数 / count(capability != null)
```

**判定方式**：人工复核 `capability != null` 的全部记录，检查原始 `query` 是否属于哲学/情绪/人生诉求。

**红线**：**任何一例都必须记录并分析。** 这是 Phase R 唯一可能**伤害产品初心**的方向——工具层吞掉了本该由经典与思辨回应的问题。上线前离线验证为 0/8，需在真实流量中复验。

**触发动作**：出现 ≥ 1 例 → 记录进 Issue Registry；出现 ≥ 3 例或占比 > 5% → 建议 L1 熔断后再分析。

---

### 1.3 `tool_ok_rate` — 工具成功率

```
tool_ok_rate = count(capability.tool_ok == true) / count(capability != null)
```

按能力分组统计（`capability.name`）：

| 能力 | 预期 `tool_ok` | 说明 |
|---|---|---|
| `time_query` | **应恒为 true** | 系统时钟始终可用。出现 false 即为严重缺陷 |
| `calculation_query` | 部分 false 正常 | 除零、负数开方、非法表达式 → 诚实拒答 |
| `weather_query` | **应恒为 false** | 当前 `WEATHER_PROVIDER=none`，全部走诚实边界。出现 true 说明配置被误改 |
| `location_query` | **应恒为 false** | 前端不上报位置。出现 true 说明前端擅自接入（触发 R-003） |

**读法**：`tool_ok=false` 不等于失败——对天气/位置而言，false 才是**正确且诚实**的状态。真正的告警是上表"应恒为"被违反。

---

### 1.4 `latency` — 时延

```
统计 capability != null 记录的 latency_ms：mean / p50 / p95 / max
```

**预期**：能力路径不调用大模型、不做检索，应**显著低于** RAG 路径（Phase P+ 基线 mean ≈ 6442ms，max ≈ 10471ms）。能力路径预期在**百毫秒量级**。

**告警**：若能力路径 mean > 1000ms，说明存在非预期的阻塞（如 weather provider 被误启用后的网络等待）。

---

### 1.5 `user_followup_rate` — 追问率

```
user_followup_rate = 能力路径回答后、同一 conversation_id 内用户继续提问的比例
```

**判定方式**：按 `conversation_id` 分组，检查能力路径记录之后是否存在后续记录。

**读法**：这是**产品判断指标，不是质量指标**。

- 追问率高 + 追问内容为思辨话题 → 「事实 + 思辨邀请」的产品假设成立，工具能力成功承担了"现实入口"的角色。
- 追问率高 + 追问为重复事实询问 → 说明回答不清晰或漏判（用户在换说法重试），需结合 R-001 分析。
- 追问率低 → 用户把 WenDao 当纯工具用完即走，需评估此类流量对产品定位的意义。

**补充观测**：建议同时统计 `has_invite` 为 true / false 两组的追问率差异，用于验证 `CAPABILITY_INVITE_ENABLED` 的实际价值。

---

## 2. 附加观测项（不设门槛，仅记录）

| 项 | 来源 | 用途 |
|---|---|---|
| `capability.name` 分布 | 观测字段 | 四类能力的真实需求配比 |
| `capability.sub_type` 分布 | 观测字段 | 时间子类（time/date/weekday/year/relative）偏好 |
| `capability.emotional` 占比 | 观测字段 | 情绪语境下的事实诉求频率，验证"情绪不否决事实"的设计 |
| `capability.confidence` 分布 | 观测字段 | 低置信命中是否与误判相关 |
| **R-001 漏判取样** | 人工 | 在 `capability == null` 的记录中，检索 `北京时间` / `日期` / `冷吗` 等关键词，统计漏判实际发生频次 |

> R-001 漏判取样是本观察期的**专项任务**：它将直接决定该缺陷是"必须修"还是"可以不修"。

---

## 3. 数据采集与复核方式

1. **采集**：`observability_logs` 集合自动累积，无需额外动作。
2. **复核频率**：建议每累积约 25 条能力路径记录做一次中期快照，避免末期集中复核导致遗漏。
3. **快照留痕**：每次快照导出为 `weapp/scripts/records-phaseR-nXX.json`，与 Phase P+ 的 `records-n37-live.json` 保持同一惯例。
4. **样本纯度**：需区分 admin/测试流量与真实用户流量。Phase P+ 的教训是初期样本几乎全为测试流量，**统计前必须按 `openid` 剔除 admin 与自测账号**。

---

## 4. 观察期禁止事项对照表

| 动作 | 允许 | 说明 |
|---|---|---|
| 读取观测数据、生成快照 | ✅ | 观察期核心工作 |
| 记录缺陷进 Issue Registry | ✅ | 只登记，不修 |
| L1 熔断（出现 P0 事故） | ✅ | 止血优先于观察 |
| 调整正则提升命中率 | ❌ | 污染窗口 |
| 新增能力类型 | ❌ | 属 R2 |
| 接入天气/地图数据源 | ❌ | 属 R2 |
| 前端接入位置上报 | ❌ | 触发 R-003，须先解隐私前置 |
| 修改回答文案 | ❌ | 影响 `user_followup_rate` 基线 |
| 修改冻结资产 | ❌ | 永久禁令 |

---

## 5. Phase R2 准入门禁

**全部满足**方可提议进入 Phase R2。任一 FAIL 即 BLOCKED。

| 门 | 条件 | 判定方式 |
|---|---|---|
| **Gate A — 样本量** | 真实生产样本 **≥ 50** 条（`capability != null`，已剔除 admin/测试流量） | `observability_logs` 计数 |
| **Gate B — 安全性** | `false_positive_rate` = 0，或全部误判已完成根因分析并有明确处置结论 | 人工逐条复核 |
| **Gate C — 可靠性** | `time_query` 的 `tool_ok_rate` = 100%；`weather/location` 的 `tool_ok` 符合 §1.3「应恒为」预期 | 分组统计 |
| **Gate D — 时延** | 能力路径 mean latency < 1000ms | 统计 |
| **Gate E — 冻结完整性** | 四资产 SHA256 与 O-0.6 一致 | `sha256sum` 比对 |
| **Gate F — 缺陷收敛** | R-001 已有明确处置结论（修复并验证 / 经数据证明可接受而正式关闭）；R-002 / R-003 状态已更新 | Issue Registry |
| **Gate G — 隐私前置** | 若 R2 计划接入位置上报，R-003 必须先行解决 | 设计评审 |

### 达标后的动作

输出 `docs/PhaseR-N50-ObservationReview.md`，内容对齐 Phase P+ SOP：

1. 样本构成与纯度说明
2. 五项指标实测值
3. 误判逐例分析（若有）
4. R-001 漏判实测频次与处置建议
5. Issue Registry 状态更新
6. Gate A–G 逐项判定
7. **明确的 ALLOW_PHASE_R2 = TRUE / FALSE 结论**

---

## 6. Issue Registry（Phase R）

| ID | 描述 | 级别 | 状态 |
|---|---|---|---|
| **R-001** | 时间/天气能力漏判（`现在北京时间`、`今天日期`、`这个月几号`、`外面冷吗`），flagship 症状可经近义句式复现 | P1 | **Open — 待决策**（路径 A 修复 / 路径 B 转观察） |
| **R-002** | 观测缺少显式 `location_authorized` 布尔字段，授权状态只能由 `tool_reason` 反推 | P2 | Open — 观测完整性缺口，非隐私泄露 |
| **R-003** | 授权分支回答文本含地址，经 `logChat` 落入 `logs` 集合 | P2 | **Latent** — 前端不上报位置故不可达；列为 R2 硬性准入前置 |
| **R-004** | 缺 Node 16.13 真机运行时验证 | P3 | Mitigated — 零 ES2022+ / 零新依赖 / L1 可熔断；首个真机请求即验证点 |
| **R-005** | `test_phasee2.js` 20/21，单项失败 | P3 | Pre-existing — O-0.6 遗留，与 Phase R 无关 |

---

## 7. 一句话总结

**这一阶段的成功标准不是"指标好看"，而是"我们终于知道用户到底怎么用它"。** 在拿到 50 条真实样本之前，任何关于 Capability Layer 该往哪走的判断都是猜测。
