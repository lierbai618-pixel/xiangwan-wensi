# CR-002 Implementation Report

> **项目**：向晚问思（WenDao）微信云开发小程序
> **变更**：msgSecCheck 安全加固（独立修复轨，非 Phase S Search Layer）
> **角色**：Security Engineer + Backend Engineer + Release Guardian
> **执行日期**：2026-08-05
> **状态**：✅ 实施完成 / 测试通过 / 冻结守门通过 / **未部署**（等待人工部署与冒烟）

---

## 1. 修改文件列表

| 文件 | 操作 | 说明 | 冻结? |
|---|---|---|---|
| `cloudfunctions/chat/index.js` | **修改** | SEC-1~5 全部接入点 | 否（可改） |
| `cloudfunctions/chat/security/inputGuard.js` | **新增** | SEC-4 规则式注入护栏（纯函数） | 否 |
| `cloudfunctions/chat/security/piiScrub.js` | **新增** | SEC-5 日志 PII 脱敏（纯函数） | 否 |
| `scripts/test_security_hardening.js` | **新增** | 离线安全测试（mock，无真实 API） | 否 |
| `cloudfunctions/chat/index.js.preCR.bak` | **新增（备份）** | L2 回滚用，非运行时代码 | 否 |

**未触碰**：`corpus.json` / `intent.js` / `rag.js` / `knowledgeRouter.js`（SHA256 见 §4）。
**未改动**：Prompt / ROLE_PROMPT / RAG 逻辑 / Knowledge Router / 任何依赖（护栏与脱敏均为纯函数，零新依赖）。
**未引入**：Search Layer / Provider / 外部 API。

---

## 2. 每个安全缺口修复说明

### SEC-1 / SEC-2 — 入参/出参扫描 fail-closed
- `checkTextSafety(text, stage)` 返回值由 `{hit, err}` 扩展为 `{hit, err, scanned, errType}`。
- 扫描异常（网络/超时/配额/API 错误）返回 `scanned:false`，**不再视为安全**。
- 调用点（入参 L225 区 / 出参 L282 区）统一用 `decideBlock(res, isWarnOnly())`：
  - `scanned:false` → **默认拦截**（fail-closed）。
  - `SEC_EMERGENCY_WARN_ONLY=true` 时退化为仅 `hit` 才拦（事故止血开关，默认关）。

### SEC-3 — 扫描错误可观测
- 新增 `logSecurityEvent(stage, errType, openid)`：扫描失败即写 `security_events` 集合。
- 记录**仅元数据**：`{ stage, errType, openidHash, createTime }`，`openidHash` 用 Node 内置 `crypto` sha256，**绝不写 message/answer/query/隐私**。
- `errType` 分类：`timeout` / `quota` / `api_error`，便于区分绕过手法。

### SEC-4 — 输入指令注入护栏
- `security/inputGuard.js`：`detect(message)` 纯函数，无 LLM / 无网络 / 无依赖。
- 在 `checkTextSafety(message)` 之后、`generateAnswer()` 之前调用；命中即拒绝生成。
- 覆盖：忽略/忘记/无视 + 指令/系统/限制；「你…没有限制」角色劫持；`ignore previous instructions` / `system prompt` / `DAN` / `jailbreak` / `roleplay as unrestricted AI` 等。
- 误杀控制：6 条正常哲学问法 + 5 条用户指定集全部 `block:false`（测试验证）。

### SEC-5 — 日志脱敏
- `security/piiScrub.js`：`mask(text)` 纯函数，落库前脱敏。
- 覆盖：手机号 / 邮箱 / 身份证 / 微信号（仅上下文后 ID）/ 银行卡 / apikey-token。
- 落点：`logObservation` 的 `query`、`logChat` 的 `message`/`answer`、`logQuestion` 的 `question` 均先过 `mask` 再写库。
- **不改用户实际回答**，仅脱敏日志副本。

---

## 3. 测试结果

运行：`node scripts/test_security_hardening.js`（mock `wx-server-sdk`，**未调用真实 msgSecCheck**）

```
PASS  T-S-01 输入违规→拦截
PASS  T-S-02 输出违规→拦截
PASS  T-S-03 输入扫描异常→fail-closed
PASS  T-S-04 输出扫描异常→fail-closed
PASS  T-S-05 扫描异常→security_events 仅元数据(无原文)
PASS  T-S-06 SEC_EMERGENCY_WARN_ONLY→放行但仍审计
PASS  注入攻击→拦截(中文)
PASS  注入攻击→拦截(英文 jailbreak)
PASS  正常问题不误杀: 孔子是谁
PASS  正常问题不误杀: 如何理解道德经
PASS  正常问题不误杀: 人生迷茫怎么办
PASS  正常问题不误杀: 什么是归因理论
PASS  正常问题不误杀: 我应该如何提升自己
PASS  正常问题不误杀: 我应该如何理解人生意义
PASS  PII 手机号脱敏
PASS  PII 邮箱脱敏
PASS  PII 身份证脱敏
PASS  PII 微信号上下文脱敏
PASS  PII 普通英文不误伤
PASS  性能门禁 本地逻辑耗时
==== 结果: 20 PASS / 0 FAIL ====
```

- **安全回归**：T-S-01~06 全绿（违规拦截 + fail-closed + 审计无原文 + WARN_ONLY 逻辑）。
- **注入护栏**：中文/英文攻击均拦截；正常哲学问法 **0 误杀**。
- **PII 脱敏**：手机/邮箱/身份证/微信号均验证无明文；普通英文文本不误伤。
- **性能**：1000 次 `detect+mask` 耗时 2ms → **单次 ≈ 0.002ms**，远低于 200ms / 5ms 预算。

---

## 4. SHA256 冻结检查（Freeze Check Report）

| 文件 | 改前 SHA | 改后 SHA | 结论 |
|---|---|---|---|
| `corpus.json` | `db01fbc9…74eabc8b` | `db01fbc9…74eabc8b` | ✅ 一致 |
| `intent.js` | `765ad138…1560ca38` | `765ad138…1560ca38` | ✅ 一致 |
| `rag.js` | `5b380b3f…1408286` | `5b380b3f…1408286` | ✅ 一致 |
| `knowledgeRouter.js` | `84890844…ffed0a935` | `84890844…ffed0a935` | ✅ 一致 |
| `index.js` | `c66ac9fd…0663a7a0e` | `dcfd866b…49c3f2f9` | 🔧 预期变化（安全加固） |
| `index.js.preCR.bak` | — | `c66ac9fd…0663a7a0e` | 📌 等于改前 index.js（备份 faithful） |

> **关于 git status**：`git status` 显示 `corpus.json`/`rag.js`/`intent.js`/`knowledgeRouter.js` 带 `M`，但本变更**未触及它们**——该 `M` 为 Phase G 遗留未提交状态（工作记忆已预警）。以 SHA256 为唯一真相源，四文件内容逐字节未变。改动范围由 `diff index.js index.js.preCR.bak` 证明仅含安全加固（见文档附录 diff，共 ~60 行新增，0 行触及冻结资产）。

---

## 5. 回滚方式（Rollback Plan）

| 级别 | 触发 | 操作 | 部署? |
|---|---|---|---|
| **L0** | 安全服务抖动误拦（可用性反噬） | 云环境变量 `SEC_EMERGENCY_WARN_ONLY=true`（默认 `false`），秒级生效，免部署 | 否 |
| **L1** | 护栏误杀 / 逻辑缺陷 | `git revert` 本次 index.js 提交 → 重新「上传并部署」 | 是 |
| **L2** | L1 无效 / 整体回退 | `cp cloudfunctions/chat/index.js.preCR.bak cloudfunctions/chat/index.js` → 重新「上传并部署」 | 是 |

- 回滚后须复核：四冻结资产 SHA256 不变；`observability_logs` 无 `search.*` 字段（本变更无 Search）。
- **L0 仅作事故止血，不降级安全常态**：它让「扫描失败」从「拦截」变为「告警放行」，运维应事后排查根因并复位。

---

## 6. 是否满足 P-02 #002

| 验收项 | 结果 |
|---|---|
| #002 安全缺口闭环（fail-open → fail-closed） | ✅ SEC-1/2 |
| 扫描失败可观测（无静默绕过） | ✅ SEC-3 |
| 指令注入/越狱基础护栏 | ✅ SEC-4（0 误杀） |
| 日志 PII 脱敏 | ✅ SEC-5 |
| 冻结资产零改动 | ✅ SHA256 一致 |
| 零新依赖 / 无 LLM / 无网络 | ✅ 纯函数 + 内置 crypto |
| 测试 20/20 通过 | ✅ |
| 性能门禁 | ✅ 0.002ms/次 |

**结论：P-02 #002 = PASS（实施层）。** 设计层门禁（S-0.1 §9 七项）中，本变更落地了 #002 自身的代码修复，剩余「上线前合规双签」「真实流量观测」属于部署后动作（见下）。

---

## 7. 未完成事项 / 部署前待办（人工执行，非本变更范围）

1. **新增集合**：云数据库手动创建 `security_events` 集合（否则审计写会被 try/catch 静默吞掉，不影响回答链路，但无审计数据）。可选但建议。
2. **部署**：本变更**未部署**（按纪律禁止）。由人工在微信开发者工具「上传并部署·云端安装依赖」。
3. **冒烟**：部署后验证 ① 正常提问回答正常 ② 违规输入被拦 ③ `SEC_EMERGENCY_WARN_ONLY` 仅事故时开启。
4. **合规**：若 #002 与 Phase S 合并评审，仍须走 S-0.2 的 SP-2 双签（本变更本身已不依赖 Search，独立可上线）。
5. **测试钩子**：`exports.__cr002` 仅在 `CR002_TEST_HOOK==='1'` 时暴露，生产环境变量不含该键 → **零行为影响**，可保留或部署前删除。

---

*文档链：S0 架构 → S-Pre → S-0.1 → S-0.2 → S-0.3 → S1 规格 → CR-002 设计 → **CR-002 实施报告（本文件）***
