# 观测方法修正 SOP（Observation Methodology Correction Report）

> 角色：Release Manager + AI Reliability Engineer + RAG Architect
> 形态：方法学修正 / 操作规范（纯文档，零代码改动、零数据库改动）
> 关联：CR-009-DiagnosisReport.md（支撑证据）
> 状态：本 SOP 即「Observation Methodology Correction Report」的正式载体。

---

## 0. Observation Methodology Correction Report（方法误判修正报告）

### 0.1 背景
CR-009 的立项前提是「生产环境 `logs` 写入链路失效，AI 答案轨迹不可观测」。
该前提源自 Phase T-0.5 观察报告（docs/PhaseT-0.5-ObservationReport.md）L120 的一句推断：
「**疑似**集合配额/索引/权限错误，导致 `logs` 自 2026-07-23 起停止写入」。

### 0.2 只读诊断结论（CR-009，2026-08-06）
对 `logs` 集合做只读诊断，八项全过：

| 检查项 | 结果 |
|--------|------|
| 集合存在 | ✅ `readOnly:false` |
| 文档数 | ✅ count = 302 |
| `answer` 非空 | ✅ 302 / 302 |
| 索引状态 | ✅ 与 `question_logs` 同构，无异常 |
| 写权限 | ✅ `add()` 从未返回错误 |
| 配额 | ✅ 全库仅 0.95 MB，远未触及 |
| 字段长度 | ✅ 均正常 |
| 最新写入 | ✅ **今晚 19:59:51**（诊断前 34 分钟） |

**零丢写算术证明：**
```
logs 302 − 早期独有段(07-21~24: 15+13+10+1=39) = 263 ≡ question_logs 总数 263
```
自 07-26 起，三个集合（`logs` / `question_logs` / `observability_logs`）**逐日条数严格相等**。

### 0.3 根因（方法学误判，非系统故障）
对 `logs` 使用**不带 `sort` 的 `find().limit(n)`**（返回自然序，最旧在前）：

| limit | 得出的"最后写入" |
|-------|----------------|
| 30 | 07-23 11:05:56 |
| **38** | **07-23 20:07:50** ← 与 Phase T-0.5 报告结论逐秒吻合 |
| 50 | 07-26 21:44:26 |

「`logs` 自 07-23 失效」是**取数顺序错误造成的幻觉**，被未经验证的「疑似」推断放大为一个并不存在的工程项目（CR-009）。

### 0.4 Decision（处置决定）
- **CR-009 以「前提不成立 / not-a-defect」结案，禁止进入实施阶段。**
- **禁止**继续实施 CR-009 日志恢复方案；**禁止**修改健康链路；**禁止**为不存在的问题向生产注入风险。
- `logs` 当前正常，是 Phase T-0.5 唯一答案文本源，也是 CR-006 潜在存量证据，**在 CR-006 立项前不得触碰**。
- 真正要修正的是**观察方法**，不是被观察的系统。本 SOP 即修正载体。

---

## 1. 最新数据判断（Latest-Data Judgment）

### 1.1 铁律
> **禁止** `find` + `limit` 直接取「最新」数据。
> 云数据库 `find` 默认返回**自然顺序（_id / 写入序，最旧在前）**，`limit(38)` 取到的永远是**最早**的 38 条，绝非「最新」。

### 1.2 必须做法（任选其一）
- **方案 A（推荐）：显式降序排序**
  ```js
  db.collection('logs').orderBy('createTime', 'desc').limit(10).get()
  ```
- **方案 B：聚合取最大值**
  ```js
  db.collection('logs').aggregate()
    .sort({ createTime: -1 })
    .limit(1)
    .end()
  // 或取 max：
  // .group({ _id: null, maxCreateTime: $.max('$createTime') })
  ```

### 1.3 tcb CLI 正确写法（nosql execute，JSON 数组语法）
```bash
# ✅ 正确：降序取最新 10 条
tcb db nosql execute --command '[{"TableName":"logs","CommandType":"COMMAND","Command":"{\"find\":{},\"sort\":{\"createTime\":-1},\"limit\":10}"}]'

# ✅ 正确：取最新一条的 createTime
tcb db nosql execute --command '[{"TableName":"logs","CommandType":"COMMAND","Command":"{\"aggregate\":[{\"$sort\":{\"createTime\":-1}},{\"$limit\":1}]}"}]'

# ❌ 错误：自然序取前 N 条 = 取到最旧数据，会复现 T-0.5 误判
tcb db nosql execute --command '[{"TableName":"logs","CommandType":"COMMAND","Command":"{\"find\":{},\"limit\":38}"}]'
```

### 1.4 注意
- `createTime` 由 `db.serverDate()` 写入，为服务端 Date 类型，`orderBy('createTime','desc')` 有效。
- 任何「最近活动 / 最后写入 / 是否停止」类判断，**必须先排序再取头**；凡报告「某集合自 X 日起停止写入」，须先按 1.3 正确语句复核，确认是排序问题还是真故障。

---

## 2. 单集合异常判断（Cross-Validation）

### 2.1 三集合职责
| 集合 | 记录内容 | 写入位置 |
|------|----------|----------|
| `logs` | 用户原文（脱敏）+ 完整 answer（脱敏）+ mode + citations | `index.js` → `logChat()` |
| `question_logs` | 问题文本（脱敏）+ 意图/域/分类/路由决策 + answerId | `index.js` → `logQuestion()` |
| `observability_logs` | 运行时事实：domain/intent/router_decision/capability/freshness/latency | `index.js` → `logObservation()`（经 `observabilityLogger`） |

### 2.2 关键不变量
`index.js` 在 `generateAnswer` 返回后**无条件**依次调用 `logObservation` / `logChat` / `logQuestion`。
**因此：每一次成功回答都会同时写入上述三个集合。** 三个集合的**逐日条数应严格相等**（Capability / Freshness / RAG 各路径均如此）。

### 2.3 交叉验证规则
1. **单集合异常 ≠ 真实故障。** 任一集合条数异动，须立即比对另外两个集合同时间窗条数。
2. **一致性判据：** 三集合同一天 `count` 相等（误差 ≤ 0，因同一次请求同步写入）→ 链路健康。
3. **真实故障判据（须同时满足 ≥2 项）：**
   - 三集合同窗条数**同时**显著下降或归零；
   - 伴随 `add()` 返回错误（如配额 `-502001`、权限 `-502002`、索引 `-502005`）；
   - `tcb fn log` 出现写入异常堆栈；
   - 生产首验（真实 `tcb fn invoke`）复现失败。
4. **仅单集合缺失**（如 `observability_logs` 有而 `logs` 无）：优先怀疑该集合独立配置（存储实现开关 `KNOWLEDGE_OBSERVABILITY_STORE`、索引、配额），**不是全局故障**，不应触发全链路回滚。

### 2.4 观察期取数三个必知（血泪，来自 CR-009 / Phase R 复盘）
- 观测记录**不含 `mode` 字段**（只在 API 返回体）。统计能力层命中用 `capability != null`，误用 mode 得 0 条。
- 字段名双层映射：API 是 `capability.capability`，落库是 `capability.name`；`freshness.category` 同理。
- `tcb fn detail` 会直接吐线上函数源码，是核验「云端代码 ≟ 本地」的最强手段，比 mtime 可靠。

---

## 3. CR 立项规范（Hypothesis → Evidence → Decision）

### 3.1 铁律
> **任何 CR 不得基于「疑似」直接进入实施。**
> 必须走 `Hypothesis → Evidence → Decision` 闭环；未获 Evidence 支撑的 Hypothesis 只能停留在诊断阶段。

### 3.2 标准流程
```
Hypothesis（假设）
   │  明确：什么现象、影响范围、疑似根因
   ▼
Evidence（证据）
   │  只读诊断产出的硬数据：集合状态/权限/配额/索引/错误码/时序
   │  至少一项「直接证据」+ 交叉验证，排除方法学误判（见 §1/§2）
   ▼
Decision（决策）
   │  GO        → 进入实施（附 Implementation Plan + L0 备份 + 冻结 SHA）
   │  NO-GO     → 结案（如 CR-009，not-a-defect，禁止实施）
   │  NEED-MORE → 回到 Hypothesis，补充观测
```

### 3.3 CR 提案模板（强制字段）
- **Hypothesis**：现象描述 + 疑似根因 + 影响面。
- **Evidence**：诊断命令与原始输出（脱敏）+ 交叉验证结论 + 是否排除「取数顺序误判」。
- **Decision**：GO / NO-GO / NEED-MORE，及理由。
- **冻结资产影响**：是否触及 `corpus.json` / `intent.js` / `knowledgeRouter.js` / `rag.js`（SHA256 守门）。

### 3.4 冻结资产保护
四冻结资产在 O-0.6 基线 SHA256 恒定。任何 CR 改动前须 `sha256sum` 基线比对，改动后再次比对；漂移即违规。CR-009 全程零写入、零部署、未 invoke 生产函数，四资产 SHA 4/4 恒定。

---

## 附录：常用正确查询速查
| 目的 | 正确语句 |
|------|----------|
| 最新 1 条 | `orderBy('createTime','desc').limit(1)` |
| 今日条数 | `where({createTime: _.gte(今日0点)}).count()` |
| 三集合一致性 | 分别对三集合取同窗 `count` 比对 |
| 能力层命中统计 | `where({capability: _.neq(null)})` 或 `where({'capability.name': _.exists(true)})` |
| Freshness 命中 | `where({freshness: _.neq(null)})` 或 `where({'freshness.category': _.exists(true)})` |

---
*本文件为方法学修正产物，未改动任何代码 / 数据库 / 知识库，未执行 commit / deploy。CR-009 相关生产代码与配置保持现状。*
