# docs/74 · Reliability Observation Track

> **角色**：Production Reliability Observer（Release Guardian 子职责）
> **阶段**：Observation Period · 只观察，不修复
> **关联**：Issue-003（Latency p99 Observation, Observed）
> **最高约束**：禁止提出代码修改、禁止 instrumentation、禁止 commit/publish

---

## 1. 范围与立场

本 Track **仅观察系统可靠性症状，不做任何修复动作**。发现问题只记录、建假设、列所需数据，等待人工授权独立调查轨（非 Phase Q 知识/路由范畴）。

关联文档：
- `docs/72-PhaseP+ObservationReview.md` §3 — 首次记录 Latency p99≈9.7s
- `docs/73-PhaseP+ObservationMilestones.md` §3 — Issue-003 登记

---

## 2. 当前观察到的症状（真实数据）

来自 `observability_logs` 的 `latency_ms` 字段（chat 函数端到端计时：startTime → logObservation）。

| 分位 | 值 (ms) |
|------|----------|
| mean | **6496** |
| p50 | 7047 |
| p90 | 8727 |
| p95 | 9723 |
| **p99** | **9723** |

样本数 = 15，时间窗 02:33→03:25（≈52 min，疑似测试流量）。

**关键特征**：`p99 == p95 == 9723ms`，说明存在一个**固定高成本子集**（尾部不随样本扩散），而非纯随机长尾。用户侧感知延迟已逼近 10s 红线。

> ⚠️ 该延迟为端到端计时，**无法在 Observation Period 内分解各阶段耗时**（分解需代码埋点，被最高约束禁止）。以下假设均标记 `Unverified`。

---

## 3. 假设列表（Hypothesis）

每个假设含：**Evidence（现有证据）/ 需采集数据（Required data）/ 当前状态（Current state）**。

### H1 · LLM Provider Latency（大语言模型服务商延迟）
- **Evidence**：端到端 mean=6496ms；RAG 问答链路中 LLM 生成通常是主导成本项；本次样本使用 Flash 模型。
- **需采集数据**：围绕模型调用（wx-server-sdk / HTTP 至 provider）的独立计时 span（t_before_call / t_after_call）。
- **当前状态**：`Unverified`。**采集需代码埋点（违反观察期约束）→ 当前不可得**。

### H2 · Cloud Function Cold Start（云函数冷启动）
- **Evidence**：p99≈p95 提示固定高成本子集；冷启动会在空闲后首次调用引入一次性开销。但 Nodejs16.13 冷启动典型 200–800ms，单独难以解释 9.7s。
- **需采集数据**：① 对比「空闲后首调」与「连续 warm 调用」延迟；② CloudBase 平台监控的实例冷启动指标。
- **当前状态**：`Unverified`。可能为尾部贡献因子之一，但非充分解释。

### H3 · Knowledge Retrieval Latency（知识检索延迟）
- **Evidence**：corpus 仅 15 条经典 + 本地 TF/余弦召回，理论上 <100ms；本地 JSON 文件读取。
- **需采集数据**：围绕 `retrieve()` 的计时 span。
- **当前状态**：`Low likelihood bottleneck`（语料极小）。`Unverified`（无埋点）。

### H4 · Network Latency（网络往返延迟）
- **Evidence**：chat 云函数 → LLM provider（api.hcnsec.cn / 腾讯云）跨网络往返 + SSL 握手可能贡献 100–500ms。
- **需采集数据**：egress 网络计时；provider 响应头时间戳。
- **当前状态**：`Unverified`。

### H5 · Database Latency（数据库延迟）
- **Evidence**：observability 写入为**异步非阻塞**（`logObservation` 不 await，失败不影响回答）；corpus/registry 为本地文件，非远程 DB 读。
- **需采集数据**：DB write/read 计时 span。
- **当前状态**：`Low likelihood bottleneck`（异步非阻塞写入）。`Unverified`。

---

## 4. 假设优先级（观察视角，非行动）

| 假设 | 可能性（基于现有间接证据） | 解释力（对 p99≈9.7s） | 验证难度 |
|------|--------------------------|----------------------|----------|
| H1 LLM Provider | 高（典型主导项） | 高 | 需埋点 |
| H2 CF Cold Start | 中（部分解释尾部） | 中 | 需平台指标/埋点 |
| H3 Retrieval | 低（语料极小） | 低 | 需埋点 |
| H4 Network | 中 | 中 | 需埋点 |
| H5 Database | 低（异步非阻塞） | 低 | 需埋点 |

**观察结论**：最可能根为 **H1（LLM Provider）**，但**当前无任何数据可确认**——因为分解各阶段耗时所需的 instrumentation 在 Observation Period 内被最高约束禁止。

---

## 5. 数据缺口声明（Critical）

> **当前 Reliability Track 处于「数据饥饿」状态**：所有根因假设（H1–H5）的验证都依赖**代码埋点 / 平台监控指标**，而这两者在 Observation Period 均不可得。

因此本 Track 现阶段**只能**：
1. 记录症状（p99=9723ms）
2. 维护假设列表（H1–H5）
3. 标注每个假设所需的未来数据

**不能**：
- ❌ 在 chat 函数内加计时 span
- ❌ 调整 LLM 调用方式 / 超时
- ❌ 切换 provider / 实例规格
- ❌ 任何代码或配置修改

---

## 6. 建议（仅观察建议，非行动项）

1. **建议设立独立 Reliability 调查轨**（非 Phase Q）：在获得人工授权后，通过一次性埋点补采 H1–H5 所需计时数据，定位 p99 根因。该轨与知识/路由优化无关。
2. **建议订阅 CloudBase 平台监控**：cold start / 实例数 / egress 延迟等指标可由平台侧提供，部分绕过代码埋点需求。
3. **观察期继续累积样本**：N=50/100 时复测 p95/p99，确认是否为测试流量特有的尾部（测试请求可能含更复杂 prompt）。

---

## 7. 约束遵守声明

- ❌ 未提出任何代码修改
- ❌ 未加 instrumentation / 未改 chat 函数
- ❌ 未 commit / 未 publish / 未进 Phase Q
- ✅ 仅记录症状 + 建假设 + 列数据缺口

> **Release Guardian 立场**：Issue-003 维持 `Observed`。在获得显式授权前，Reliability Track 不采取任何修复动作。

---

## 8. Observation Update @ N=16（2026-08-02T16:17 GMT+8）

- **新增 1 条真实样本**（非测试生成）：`2026-08-02T06:34:51.883Z`（≈14:34 GMT+8），openid=管理员，`通用/opinion`，query「昨天脚被盆子砸了（用幽默的方式回答）」，`kt=[]`（fallback），`latency_ms=6077`，`citation_count=0`。
- **样本窗口扩展**：原 02:33→03:25（≈52min，疑似测试）现扩展至 **02:33→06:34（≈3h59m）**，出现第二个时间簇（14:34 单点），由真实用户（管理员 openid）产生。
- **Latency 重算（N=16）**：mean=6470 / p50=7047 / p90=8727 / p95=8727 / **p99=9723ms（不变）**。
  - ⚠️ p95 由 9723 降至 8727 为**单样本插入的统计假象**（新样本 6077 落在旧 p90–p95 之间，仅重排分位），**非真实改善**。尾部 p99 仍为 9723ms，风险未变。
  - 新样本 6077ms 处于正常区间，**未触发尾部**，对 H1–H5 无任何新增证据。
- **假设状态**：H1–H5 全部维持 `Unverified`。无 instrumentation 数据，数据饥饿状态不变。
- **Issue-003 维持**：`Observed`，Confidence=Low（N=16 仍小，且两窗口混合）。**仍禁止 Root Cause Confirm**。
