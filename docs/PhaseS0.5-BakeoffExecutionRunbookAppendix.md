# Phase S0.5 — Bake-off Execution Runbook Appendix

> 角色：Release Manager + Security Engineer + Cloud Architect
> 关联主文档：《Phase S0.5 — Search Provider Bake-off Authorization Request》（本文档为其执行 Runbook 附录）
> 生成日期：2026-08-05（GMT+8）
> 性质：**纯设计 Runbook**。禁止代码、禁止真实 API 调用、禁止创建函数、禁止部署、禁止申请真实密钥、不改变当前 Gate 状态。
> 阶段状态：本附录仅补充"如何执行"，**不授权执行**——真实动作须主文档 §8.3 四项人工签核完成后方可启动。

---

## 0. 范围与约束重申

| 约束 | 本附录遵守 |
|---|---|
| ❌ 写代码（Provider 实现 / 函数逻辑） | 遵守（仅步骤与模板） |
| ❌ 真实 API 调用 | 遵守（仅描述调用时点） |
| ❌ 创建函数 | 遵守（仅定义 `chat_bakeoff_probe` 形态，不落地） |
| ❌ 部署 | 遵守 |
| ❌ 申请真实密钥 | 遵守（仅定义生命周期，不动作） |
| ❌ 写 corpus.json / RAG / embedding | 遵守 |
| ❌ 改 Gate 状态 | 遵守（Phase S1 仍 IMPLEMENTATION BLOCKED） |

**本附录所有"命令/脚本"均为设计态模板，执行时需替换为真实环境参数，且须在 §8.3 签核后由人操作。**

---

## 1. 实验隔离架构

### 1.1 临时环境定义

| 项 | 规定 |
|---|---|
| 函数名 | `chat_bakeoff_probe`（临时，独立云函数） |
| 独立性 | **独立于 `cloudfunctions/chat/index.js`**，不 import、不挂载、不共享运行时 |
| 生产调用链 | **不进入** `index.js` 主链路；不响应真实用户请求 |
| 用户请求 | **不读取**任何生产用户消息 |
| 生产库写入 | **不写** `logs` / `question_logs` / `observability_logs` |
| 知识库 | **不读不改** `corpus.json`；不调用 `rag.js` |

### 1.2 数据流（允许路径）

```
Fixture Query（来自 §4 测试集，非真实用户）
    ↓
Bake-off Probe（chat_bakeoff_probe）
    ↓  携带 BAKEOFF_<PROVIDER>_KEY
Provider API（候选，仅白名单域名）
    ↓
Raw Evidence[]
    ↓  （仅结构化字段：source_id/title/url/snippet/domain/fetched_at）
Local Aggregation（临时聚合，不入生产库）
    ↓
Metric Report（聚合数，无原文）
```

### 1.3 数据流（禁止路径 — 越界即中止）

```
Provider Response
    ↓  ❌ 禁止
corpus.json
    ↓  ❌ 禁止
embedding
    ↓  ❌ 禁止
RAG
```

> 任何时刻若检测到底层逻辑试图把 Raw Evidence 写入 `corpus.json` 或触发 embedding，立即中止实验（主文档 §6.3 越界熔断）。

---

## 2. 密钥生命周期

### 2.1 密钥标识

```
BAKEOFF_<PROVIDER>_KEY    // 例：BAKEOFF_BING_KEY / BAKEOFF_DOMESTIC_X_KEY
```

每个候选 Provider 一个独立一次性密钥，互不相干。

### 2.2 创建前（须记录）

| 字段 | 说明 |
|---|---|
| 负责人 | 执行人账号（非生产 ADMIN_OPENID 复用，单独记录） |
| 用途 | 仅限本次 bake-off，注明关联 Runbook 版本 |
| 过期时间 | 设为实验窗口结束后 **+24h** 自动过期（Provider 侧若支持） |

### 2.3 使用期间

| 规则 | 说明 |
|---|---|
| 仅环境变量 | 通过云函数环境变量注入，**不写入代码、不入 `config.json`、不入 `corpus.json`** |
| 不进日志 | 任何日志输出须对密钥做掩码（参考 CR-002 `piiScrub.mask` 思路，但本环境独立实现或复用同款纯函数） |
| 不出前端 | 密钥永不下发小程序前端（硬 KO-6 同源） |

### 2.4 结束（必须完成）

1. 删除临时函数 `chat_bakeoff_probe`
2. 删除所有 `BAKEOFF_*` 环境变量
3. 撤销 Provider 侧 Key（Provider 控制台 revoke / delete）
4. 删除临时产物（聚合中间文件、缓存）

### 2.5 Key Lifecycle Checklist

```
[ ] 创建前：记录负责人 / 用途 / 过期时间
[ ] 创建前：确认密钥为"一次性/试用"性质，非生产长期密钥
[ ] 使用期：仅以云环境变量注入
[ ] 使用期：代码库中 grep 不到明文密钥
[ ] 使用期：日志中密钥已掩码（无明文）
[ ] 结束：chat_bakeoff_probe 已删
[ ] 结束：BAKEOFF_* 环境变量已删
[ ] 结束：Provider 侧 Key 已 revoke
[ ] 结束：临时产物已删
[ ] 结束：仅 Bake-off Summary Report 留存
```

---

## 3. 出网控制

### 3.1 允许清单

| 项 | 规定 |
|---|---|
| 允许目标 | 仅候选 Provider 域名（白名单，逐一列明） |
| 禁止目标 | 任意其他公网地址（含非候选搜索、社交、文件存储等） |

### 3.2 记录要求

| 字段 | 说明 |
|---|---|
| 域名 | 逐一记录放通的 Provider 域名 |
| 时间窗口 | 放通起止时间（与实验窗口一致） |
| 负责人 | 与 §2.2 负责人一致 |

### 3.3 结束

- 实验窗口结束后**立即恢复白名单**至生产基线（移除 bake-off 临时放通项）；
- 恢复动作须记录时间 + 执行人，纳入清理验收（§7）。

> 出网白名单变更属执行期动作，须主文档 §8.3-3 单独确认后方可操作。

---

## 4. 测试执行顺序

| Stage | 名称 | 动作 | 数据来源 | 产出 |
|---|---|---|---|---|
| **S0** | 环境检查 | 确认临时函数存在、环境变量就位、白名单放通、无生产链路挂载 | — | 环境就绪签认 |
| **S1** | Provider 健康检查 | 每条候选发 1 次探测查询，确认鉴权/连通/返回体结构 | 探测 query | 连通性 + 硬 KO 初判 |
| **S2** | 事实查询测试 | 跑 A 组（明确事实 30 条），每条 3 重复 | S-Pre B 组 UNKNOWN | Evidence Recall / Latency |
| **S3** | 时效查询测试 | 跑 B 组（时效 30 条），每条 3 重复 | S-Pre C 组 SEARCH_REQUIRED 时效子集 | 时效召回 / 发布时间可得性 |
| **S4** | 实体查询测试 | 跑 C 组（未知人物/产品），复用 B 组 | S-Pre B 组 UNKNOWN 补充 | 长尾覆盖 Recall |
| **S5** | 安全 fixture 测试 | 跑 D 组（含 Prompt Injection 的毒化网页） | S-0.3 T-1 / T-4（脱敏） | Security Quarantine Rate |
| **S6** | 成本统计 | 汇总调用次数 × 单价，折算月估 | Provider 账单/配额页 | Cost per query / 月估 |
| **S7** | 清理 | 执行 §2.4 + §3.3 + §7 | — | 清理验收通过 |

> 主评测集 = A(30) + B(30) = **60 条**，每条 3 重复 → **180 次采样**（S-Pre §2.6）。所有候选须**同题同刻**执行，避免时效差异污染对比。

---

## 5. 指标采集

每条查询采集以下字段，**禁止保存用户隐私**（无真实用户，Fixture 亦须脱敏域名级）。

| 类别 | 字段 | 说明 |
|---|---|---|
| 标识 | `provider` | 候选标识 |
| 标识 | `query_id` | 测试集条目 id（如 A-01 / B-12） |
| 延迟 | `latency_p50` | 同 query 3 次采样中位数 |
| 延迟 | `latency_p95` | 全部 180 次采样 p95（对照 LB-3 ≤1200ms） |
| 延迟 | `timeout_rate` | 超 1800ms 熔断线比例（对照 LB-7，目标 < 2%） |
| 证据 | `source_count` | 前 3 结果条数 |
| 证据 | `url_present` | URL 有效率（KO-2/4，目标 ≥ 98%） |
| 证据 | `domain` | 来源域名（供 Security Layer 分级，仅域名级，不存路径参数） |
| 安全 | `quarantine_rate` | D 组毒化网页被隔离比例（目标 100%） |
| 成本 | `cost_per_request` | 单次成本 |
| 成本 | `est_monthly_cost` | 按预估 QPS 折算月估 |

**存储约束**：指标仅以**聚合数 + query_id** 形式进入 Metric Report；不存 RawEvidence 原文、不存 snippet 全文、不存用户隐私。

---

## 6. KO 判定流程

### 6.1 先跑硬 KO（一票否决）

```
对候选 Provider:
  1. 跑硬 KO-1 ~ 硬 KO-8（S-Pre §2.3 八硬门禁：
     境内直连 / 出网白名单 / Node16.13兼容 / 必带URL /
     境内合规 / 服务端密钥 / 用量熔断 / query留存政策）
  2. 任一失败 → Provider OUT（记录失败项 + 理由）
  3. 全部通过 → 进入评分
```

### 6.2 通过后进入评分

```
对通过硬 KO 的候选:
  1. 按 A 类 KO-1~KO-8 能力轴 + D1~D7 七维加权（S-Pre §2.4/2.5）打分
  2. 计算加权总分（权重：D1 20% / D2 25% / D3 15% / D4 20% / D5 10% / D6 5% / D7 5%）
  3. 应用选型判据（S-Pre §2.7）：
     - 硬 KO 全过
     - 加权 ≥ 3.5/5.0 且 D2 ≥ 4.0
     - 产出主备两家且不共用底层索引
```

### 6.3 输出

```
Candidate Ranking:
  主选: <provider>  (加权 X.X / D2 Y.Y)
  备选: <provider>  (加权 X.X / D2 Y.Y)
  落选: <list>      (各自硬 KO / 评分失败项)
```

> 若无候选满足 → 结论「Phase S 无合格 Provider」，S1 延后，**不降标准**（S-Pre §2.7）。

---

## 7. 清理验收

实验结束前必须逐项验证（任一不过 → 不得标记 COMPLETE）：

| 验证项 | 方法 | 期望 |
|---|---|---|
| 临时函数不存在 | 查云函数列表无 `chat_bakeoff_probe` | 不存在 |
| 密钥环境变量不存在 | 查云环境变量无 `BAKEOFF_*` | 不存在 |
| 临时数据库记录不存在 | 查无 bake-off 专用集合 / 无孤儿记录 | 不存在 |
| 生产日志无污染 | 查 `observability_logs` / `logs` / `question_logs` 无 bake-off 痕迹 | 无污染 |
| 白名单已恢复 | 比对出网白名单基线 | 已恢复 |
| 保留物唯一 | 仅 `Bake-off Summary Report`（聚合指标 + Ranking） | 单一留存 |

---

## 8. 授权状态更新模板

实验执行前后，按以下模板更新状态（本附录设计态，真实填写须在执行期）：

```
S0.5 Execution Status:   READY | RUNNING | COMPLETE
  - READY    : 主文档 §8.3 四项签核完成，待执行
  - RUNNING  : 已进入 Stage 0~7，未清理
  - COMPLETE : §7 清理验收全过，仅 Summary Report 留存

Provider Recommendation:  WAITING | <provider> (主) / <provider> (备)
  - WAITING  : 实验未完或结论未批准
  - 填主备   : 经 §6 判定 + 人工批准（主文档 §7.2）后填写

S1 影响:  未改变（Phase S1 仍 IMPLEMENTATION BLOCKED，直至主文档 §7.2 批准写入 SEARCH_PROVIDER）
```

> 本模板仅记录状态，**不构成授权**。真实 `SEARCH_PROVIDER` 写入生产配置仍须主文档 §7.2 显式人工批准。

---

## 附录 A. 与主文档及 S 系列追溯

| 引用 | 来源 |
|---|---|
| `chat_bakeoff_probe` 独立函数形态 | 主文档 §3.1 |
| `BAKEOFF_<PROVIDER>_KEY` 生命周期 | 主文档 §3.1 / §8.3-2 |
| RawEvidence 六字段 | 主文档 §1.2 / S1 §4.1 |
| 60 主集 + D 安全子集 | 主文档 §4 / S-Pre §3 / S-0.3 |
| LB-3 ≤1200ms / LB-7 ≤1800ms | 主文档 §5 / S-Pre §6 / S1 §4.3 |
| 硬 KO-1~8 + D1~D7 加权 + 选型判据 | 主文档 §2 / S-Pre §2.3~2.7 |
| 越界熔断 | 主文档 §6.3 |
| 人工批准闸门 | 主文档 §7.2 / §8.3 |

## 附录 B. 风险登记（R-S0.5-RB-*，Runbook 执行期）

| ID | 风险 | 等级 | 缓解 |
|---|---|---|---|
| R-S0.5-RB-001 | 临时函数误挂载生产 | 高 | §1.1 独立性约定 + §7 验收 |
| R-S0.5-RB-002 | 密钥过期前未删 | 中 | §2.5 Checklist + §7 |
| R-S0.5-RB-003 | 白名单未及时恢复 | 中 | §3.3 + §7 |
| R-S0.5-RB-004 | 评测滑向矮子里拔将军 | 中 | §6.2 选型判据 + 无合格即延后 |
| R-S0.5-RB-005 | 指标误存原文/隐私 | 中 | §5 存储约束（仅聚合 + query_id） |

---

*文档结束。本附录为执行 Runbook 设计，不产生任何代码、函数、密钥或部署动作。真实执行须主文档 §8.3 四项人工签核完成后由人操作。*
