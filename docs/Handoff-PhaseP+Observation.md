# 交接文档 · 向晚问思（WenDao）Knowledge Platform — Phase P+ 观察期

> **生成时间**：2026-08-02 16:33 GMT+8
> **角色**：Release Guardian + Production Reliability Observer + AI System Reliability Auditor
> **适用读者**：下一个会话的接手者（无论以何种角色进入）
> **一句话**：项目已冻结（O-0.6），处于 Phase P+ 观察等待期；真实样本 N=16/50，卡在"等有机流量"，Phase Q 被锁。本会话不开发、不优化、不修复。

---

## 1. 项目概况（必读）

| 项 | 值 |
|----|-----|
| 项目 | 向晚问思（WenDao）哲学思辨助手（曾用名 问道） |
| 形态 | 微信云开发小程序，AI 思辨助手，原则「先做人再引经」五段式 |
| APPID | `wx2653f12589f9f89f` |
| 云环境 | `YOUR_CLOUD_ENV_ID` |
| 管理员 openid | `YOUR_ADMIN_OPENID` |
| 当前版本 | Knowledge Platform v1.0 GA + Operations v1.0 |
| 冻结基线 | **O-0.6**（SHA256 守门，见 §5） |
| 当前阶段 | **Phase P+ Observation Period（等待状态 WAITING）** |
| 备案状态 | 非商用工具-办公，**备案审核中**（这是有机流量迟迟为 0 的根因之一） |

**核心定位**：非商用、办公向的思辨助手，不是电商/社交。设计强调可追溯（answer_id 三层贯通：question_logs → answer_id → answer_feedback → answer_quality_log）。

---

## 2. 本次会话做了什么

本次会话是一连串**Release Guardian 角色驱动的观察/审计任务**，没有一行代码改动：

1. **Phase P+ N=50 Observation Snapshot**（docs/PhaseP+-N50-ObservationSnapshot.md）
   - 三层冻结核验（本地源 / 部署包 / 已部署生产代码），黄金标准 PASS。
   - 统计 N=15 基线指标，建立 Phase Q Gate 预览。
2. **Phase P+ N=50 Observation Review（N=16）**（docs/PhaseP+-N50-ObservationReview.md）
   - 发现实时生产日志已到 **N=16**（较 15 +1，新增一条管理员真实请求 06:34:51Z）。
   - 重算指标，输出 8 节 interim 报告。
3. **Phase P+ N=50 Maintenance Re-verification（16:20）**
   - Delta=0，不新建报告，仅输出状态。
4. **Phase P+ N=50 Maintenance Check（16:24）**
   - 再次 Delta=0，确认 Observation No Delta。
5. **Phase P+ Observation Waiting State Closure（16:28）**（docs/PhaseP+-ObservationClosure.md）
   - 关闭主动观察循环，进入 WAITING；封存基线；定义唯一重启条件 `observability_logs >= 50`。
6. **Phase P+ Production Observation Sentinel（16:30 / 16:33）**
   - 触发条件未满足（仍 N=16），仅输出 Sentinel Status，无扫描、无文档。

> 注：更早的 Phase P+ 部署与封存文档（docs/70–74）是在本会话之前由同一项目线完成的，详见 §7 参考文件。

---

## 3. 已完成（Completed）

- ✅ **冻结资产守门**：corpus.json / intent.js / rag.js / knowledgeRouter.js 的 SHA256 与 O-0.6 基线逐字节一致，本地源 + 部署包 + 已部署生产代码三层核验全 PASS。
- ✅ **Observability 链路上线**：`KNOWLEDGE_OBSERVABILITY_STORE=cloud` 环境变量已生效（保留 ADMIN_OPENID），`observability_logs` 集合已建，非阻塞写入。
- ✅ **真实样本采集**：N=16 条真实生产日志（15 条部署窗口 + 1 条管理员单点），指标已全部统计。
- ✅ **Issue Registry 建立**：#001（Confirmed non-systemic）/ #002（Escalated→Phase S-0）/ #003（Observed p99）状态清晰。
- ✅ **Latency 可靠性观察轨**：H1–H5 假设全部建立，状态 Unverified（数据饥饿），文档化于 docs/74。
- ✅ **Phase Q Gate 判定**：A FAIL / B FAIL / C FAIL / D PASS → **ALLOW_PHASE_Q = FALSE**，BLOCKED。
- ✅ **观察循环关闭 + 交接条件定义**：WAITING 状态，唯一重启条件明确。
- ✅ **约束严守**：全程未改代码/资产/Prompt/Metadata/Router/RAG/KO，未 ingest/embedding/调参/优化 latency/修复，未 commit/publish，未进 Phase Q，未自行生成任何测试请求。

---

## 4. 当前卡在哪（Stuck）

**唯一卡点：真实样本不足 + 无有机流量。**

- **样本缺口**：N=16 / 50（32%），还差 **+34 条**。N=50 是生成终态报告的最低门槛；N=100 才是 Phase Q Gate 条件 A。
- **流量隐忧**：16 条全部来自 2026-08-02 的部署验证窗口（02:33→06:34Z，约 52 分钟簇），疑似测试/admin 流量，**有机真实用户流量 ≈ 0**。
- **根因链**：小程序仍在**备案审核中** → 未过审发布 → 无外部用户 → 无有机流量 → 样本无法自然累积。
- **Phase Q 被锁**：四项条件三项 FAIL（A 样本不足、B 可靠性证据不足/数据饥饿、C 无 ADR），只有 D 冻结完整 PASS。
- **Latency p99 悬而未决**：9723ms 尾部风险已知，但 H1–H5 全 Unverified，缺 instrumentation 数据，当前**只能观察不能下结论**。

---

## 5. 下一步怎么继续（Next Steps）

**触发条件（任一满足即重启观察循环）：**
- `observability_logs >= 50` 真实生产样本出现；**或**
- 人工明确要求执行 N=50 Review。

**重启后执行流程（已是既定 SOP，照做即可）：**
1. **Freeze Integrity**：重算 4 资产 SHA256，必须 == O-0.6。失败则停止只报告，禁止修复。
2. **Sample Growth**：记录 N16→N50 新增量、时间窗、用户来源类型。禁止生成测试请求。
3. **Metrics Comparison**：Fallback/Citation/Coverage/Intent/Domain 对比 N=16 基线。
4. **Latency Evolution**：mean/p50/p90/p95/p99 只描述 Observed，禁止 Root Cause Confirm（除非有真实埋点证据）。
5. **Issue Registry Review**：#001 无新证据禁升级；#002 维持 Phase S-0；#003 维持 Observed。
6. **Reliability Track**：H1–H5 默认 Unverified，无数据不推断。
7. **Phase Q Gate Preview**：A≥100 / B 证据 / C ADR / D 冻结 → 输出 ALLOW_PHASE_Q。
- 终态产物：`docs/PhaseP+-N50-FinalObservationReview.md`（12 节全量对比）。

**更长的路（不在本会话范围内，仅提示）：**
- 小程序过审发布后，靠真实用户自然累积样本至 50 / 100。
- #002 msgSecCheck → **Phase S-0 独立修复轨**（已被 Escalated，本阶段禁止在 P+ 内修）。
- Latency p99 → 需先加 instrumentation（provider 响应时间、cold/warm 差、retrieval 时长、DB 写入延迟）才能确认 H1–H5 中哪一个成立。
- N=100 后按 Phase Q Gate 四条件重判是否 ALLOW_PHASE_Q。

---

## 6. 踩过的坑（Pitfalls — 千万别重踩）

1. **SCF 代码上传端点沙箱不可达**
   `scf.tencentcloudapi.com` 在沙箱内不可达 → `tcb fn deploy` 必失败（socket hang up / 超时）。**结论**：代码部署只能由用户在微信开发者工具手动「上传并部署·云端安装依赖」。沙箱能做的：建集合、推送环境变量（`tcb config update fn` 走可达端点）、读类 API、invoke。

2. **tcb db nosql execute 语法（本构建 3.6.4）**
   裸 mongo 命令（find/query/count/aggregate 作顶层键）会被 RunCommands 解析器拒绝。**正确姿势**：
   ```
   tcb db nosql execute --command '[{"TableName":"observability_logs","CommandType":"QUERY","Command":"{\"find\":\"observability_logs\",\"filter\":{},\"limit\":200}"}]' --env-id YOUR_CLOUD_ENV_ID
   ```
   （注意 JSON 嵌套转义；`{"find":...}` 是放在 `Command` 字符串里的。）

3. **MongoDB 扩展 JSON 数值包裹**
   查询结果里 `citation_count`、`latency_ms` 等数值是 `{"$numberInt":"6077"}` 形式。**必须在 Python 里递归 unwrap** `$numberInt / $numberLong / $numberDouble` 后才能做算术，否则当字符串处理会算错。

4. **tcb config update fn 交互阻塞**
   该命令会交互询问 Merge/Overwrite，直接跑会卡住。用 `printf '\033[B\n'` 管道送入 Merge 选项可绕过。

5. **Managed Python 是 Windows 原生，路径要用 `D:\...` 不是 `/d/...`**
   在 Git Bash 里 `/d/...` 能跑 shell，但 Python 脚本里写 `/d/...` 会 `FileNotFoundError`（路径转换只对 shell 生效，不传给 Windows 原生 Python）。**Python 脚本一律用 `D:/不知道是啥/教员/...` 这种 Windows 绝对路径。**

6. **git status 的 M/?? 是噪音，别信**
   `corpus.json` / `rag.js` 等显示 `M` 是 Phase G 遗留未提交，不是本次改动。判断资产是否漂移**只用 SHA256 比对**，不看 git status。

7. **云环境选择是 IDE GUI 操作，不是文件配置** —— 别去翻配置文件找环境 ID。

8. **测中文接口用 Python 显式 utf-8，别用 Git Bash curl** —— GBK 会乱码。

9. **冻结资产 SHA256 守门是硬红线**：corpus.json / intent.js / rag.js / knowledgeRouter.js 任一字节变化 = 漂移 = 违规；且云函数改动必须重新部署才生效（Nodejs16.13 锁定，禁原生 fetch，rag.js 内置 nodeFetch）。

---

## 7. 关键参考文件

**观察期文档（本会话产）：**
- `docs/PhaseP+-N50-ObservationSnapshot.md` — N=15 基线快照
- `docs/PhaseP+-N50-ObservationReview.md` — N=16 interim 状态报告（当前权威）
- `docs/PhaseP+-ObservationClosure.md` — WAITING 关闭封存 + 重启条件
- `docs/74-ReliabilityObservation.md` — Latency 可靠性观察轨 H1–H5

**更早的 Phase P+ 部署/封存文档（本会话前完成）：**
- `docs/70-PhaseP+Deployment审计.md` / `docs/70-PhaseP+Deployment报告.md`
- `docs/71-PhaseP+FinalFreeze.md`
- `docs/72-PhaseP+ObservationReview.md`
- `docs/73-PhaseP+ObservationMilestones.md`

**数据副本（scripts/）：**
- `records-milestone.json`（15 条）/ `records-n16-live.json`（16 条，已 unwrap，权威副本）
- `cloudbaserc.json`（含 ADMIN_OPENID + KNOWLEDGE_OBSERVABILITY_STORE=cloud）
- `.deploy-backup/chat-pre-obs-20260802/`（部署前线上代码备份，7542B 无埋点）

**项目记忆：**
- `D:\不知道是啥\教员\.workbuddy\memory/MEMORY.md` — 精简守护上下文（冻结哈希/硬约束/坑）
- `D:\不知道是啥\教员\.workbuddy\memory/2026-08-02.md` — 当日逐轮详细记录

---

## 8. 给下一会话的提醒（Read This First）

- **你大概率会以 Release Guardian 身份被唤醒**。如果不满足 `observability_logs >= 50` 且没有人工 N=50 指令，**只输出 Sentinel Status，不要扫描、不要建文档**（除非用户明确要求别的东西）。
- **当前固定态势**：Status=WAITING / Freeze=LOCKED(PASS) / Phase Q=BLOCKED(FALSE) / Sample=16/50。
- **绝对不要**为了凑样本去发测试请求——观察期铁律，观察者只能等真实流量。
- **绝对不要**改任何冻结资产或进 Phase Q，除非用户明确解除约束并批准。
- 如果有人问"为什么 latency 这么高/psych 路由为什么 miss"——答案是：**数据饥饿，H1–H5 全 Unverified，没有 instrumentation 不能下结论**，按 docs/74 记录即可。
- 真正能推进项目的外部事件只有两个：**①小程序过审发布带来有机流量；②用户主动批准进入下一步（N=50 Review / Phase Q / Phase S-0 修 #002）。**

---

*交接完毕。下一会话接手时，先读 §1 + §4 + §8，再按需读 §7 对应文档。*
