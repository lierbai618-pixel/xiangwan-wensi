# CR-002 #004 Hotfix Design Proposal

- **状态**：DRAFT · 设计稿（Phase 1）· **待人工授权后进入 Phase 2 改码/部署**
- **角色**：Release Manager + Security Engineer
- **目标**：恢复生产可用性（正常用户输入不再被误拦），同时保留内容安全能力（命中违规仍必拦）
- **纪律**：仅修改 CR-002 安全链路代码；**不触碰**冻结资产 / Prompt / 业务回答逻辑 / Search

---

## 1. 根因回顾（代码证据）

生产 P0：`msgSecCheck` 全局 `api_error` → `scanned=false` → `decideBlock()` 返回拦截 → 所有正常用户被拦。

证据（当前已部署 `cloudfunctions/chat/index.js`）：

| 现象 | 代码位置 | 说明 |
|---|---|---|
| 调用失败落入 catch，`scanned=false` | `index.js:90-98` `checkTextSafety` | `catch` 中 `let errType = "api_error"`（默认），仅 `timeout`/`quota` 正则命中时改写；**所有 msgSecCheck 异常最终都被归类为 api_error/timeout/quota 之一** |
| 失败即拦截 | `index.js:107-111` `decideBlock` | `return !!res.hit \|\| !res.scanned;` → `scanned=false` 恒为 `true`（拦截） |
| 入参拦截点 | `index.js:226-232` | `if (decideBlock(inSafe, isWarnOnly())) return {ok:false, error:"您的提问包含不当内容，已拦截。请换个问题。"}` —— 与截图逐字一致 |
| 出参拦截点 | `index.js:283-289` | 回答生成后再校验，失败同样拦截 |

结论：**根因是「基础设施失败 = fail-closed 拦截」的策略本身**。在 msgSecCheck 服务不可用时，该策略把「无法判定安全」等同于「不安全」，造成全量误拦。

---

## 2. 设计目标与硬性约束

### 2.1 七项明确要求（逐条映射）

| # | 要求 | 本方案实现 |
|---|---|---|
| 1 | 保留 `hit=true` 必拦截 | 决策矩阵中 `hit=true` 恒为「拦截」，与 `scanned` 无关 |
| 2 | `api_error`/`timeout`/`quota` 不再阻断用户 | 扫描失败（这三类）默认**降级放行**，恢复可用性 |
| 3 | `security_events` 增加 `errorCode`/`errorType` 元数据 | 见 §5 Schema 变更 |
| 4 | 不记录用户原文 | `logSecurityEvent` 入参仅 `stage/errType/errorCode/openidHash`，**绝不接收 text**；落库字段无原文 |
| 5 | 保留 `SEC_EMERGENCY_WARN_ONLY` 作为紧急开关 | 原语义保留（仅 `hit` 拦截），见 §6 |
| 6 | 给出修改文件列表 | 见 §4 |
| 7 | 给出回滚方案 | 见 §7（L0/L1/L2） |

### 2.2 禁止修改清单（硬约束，违反即违规）

| 资产 | 当前 SHA256（O-0.6 基线） | 本方案是否改动 |
|---|---|---|
| `corpus.json` | `db01fbc92064cbea3a6688a98160b6a70c9e150259b54063c8e2e96974eabc8b` | ❌ 不动 |
| `intent.js` | `765ad138ec68c0f159c6f75a60e5268beb02fba152f6d53dbdc539ba1560ca38` | ❌ 不动 |
| `rag.js` | `5b380b3f7c68f374e3d4e5127bd7dbeff747849401ca9d0488498dece1408286` | ❌ 不动 |
| `knowledgeRouter.js` | `848908445dbb5ea93a6f52775dc3c8e6922ff971d6cee115547f236ffed0a935` | ❌ 不动 |

> 改动面**仅限** `cloudfunctions/chat/index.js` 内的 CR-002 安全函数（非冻结资产），以及配套测试文件。Prompt、RAG 链路、业务回答逻辑、`Search` 接入一律不碰。

---

## 3. 决策模型（核心变更）

### 3.1 决策矩阵

| `scanned` | `hit` | `warnOnly` | `degrade` | 决策 | 说明 |
|---|---|---|---|---|---|
| `true` | `true` | — | — | **拦截** | 要求 1：确认违规必拦 |
| `true` | `false` | — | — | 放行 | 扫描成功且未命中 |
| `false` | `false` | `true` | — | 放行 | 紧急开关：最宽松姿态 |
| `false` | `false` | `false` | `true`（默认） | **放行** | 要求 2：服务不可用/超时/配额 → 降级放行 |
| `false` | `false` | `false` | `false` | 拦截 | 退回原 fail-closed（仅在显式关闭降级时） |
| `res == null` | — | — | — | **拦截** | 防御性：结果缺失无法判定 |

### 3.2 `decideBlock` 新规格（伪代码）

```js
// CR-002 #004：基础设施失败（api_error/timeout/quota）默认降级放行；
// 仅「确认命中违规 hit=true」才拦截。fail-open on service failure，fail-closed on confirmed violation。
function decideBlock(res, warnOnly, degradeOnApiError) {
  if (!res) return true;                              // 防御：结果缺失 → 拦截
  if (res.hit) return true;                           // 要求1：命中违规必拦截（无论 scanned）
  if (warnOnly) return false;                         // SEC_EMERGENCY_WARN_ONLY：仅命中才拦
  if (degradeOnApiError && !res.scanned) return false;// 要求2：扫描失败 → 降级放行
  return !res.scanned;                                // 降级关：维持原 fail-closed
}
```

- `degradeOnApiError` 来自 `process.env.SEC_DEGRADE_ON_API_ERROR`（默认 `true`，见 §6）。
- 入参/出参拦截点（§3.4）统一传入同一 `degrade` 值，行为对称。

### 3.3 `checkTextSafety` 增强（新增 `errorCode`）

```js
} catch (e) {
  const msg = e && e.message ? e.message : "" + e;
  // 提取结构化错误码（wx-server-sdk 通常挂 e.errCode）
  const errCode = (e && e.errCode !== undefined && e.errCode !== null)
    ? e.errCode
    : null;
  let errType = "api_error";
  if (/timeout|超时/i.test(msg)) errType = "timeout";
  else if (/quota|limit|频率|配额/i.test(msg)) errType = "quota";
  return { hit: false, err: msg, scanned: false, errType, errorCode: errCode };
}
```
> 仅**新增**返回字段 `errorCode`，不影响既有 `hit/scanned/errType` 语义。
> 注意：`msgSecCheck` 异常恒被分类为 `api_error`/`timeout`/`quota` 之一（默认 `api_error`），故要求 2 实际覆盖**全部**扫描失败面，P0 根因彻底闭合。

### 3.4 调用点变更（入参 / 出参）

```js
// 入参（原 index.js:226-232）
const degrade = (process.env.SEC_DEGRADE_ON_API_ERROR || "true").toLowerCase() !== "false";
const inSafe = await checkTextSafety(message, "in");
if (!inSafe.scanned) logSecurityEvent("in", inSafe.errType, inSafe.errorCode, openid); // SEC-3
if (decideBlock(inSafe, isWarnOnly(), degrade)) {
  return { ok: false, error: "您的提问包含不当内容，已拦截。请换个问题。" };
}

// 出参（原 index.js:283-289）同构
const outSafe = await checkTextSafety(result && result.answer, "out");
if (!outSafe.scanned) logSecurityEvent("out", outSafe.errType, outSafe.errorCode, openid);
if (decideBlock(outSafe, isWarnOnly(), degrade)) {
  return { ok: false, error: "本次回答触发内容安全限制，已停止输出。请换个角度提问。" };
}
```

### 3.5 `logSecurityEvent` 增强（见 §5）

签名新增 `errorCode` 参数，落库写入 `errorCode` / `errorType`（并保留 `errType` 旧字段做向后兼容，避免打破既有监控查询）。

---

## 4. 修改文件列表

| 文件 | 改动类型 | 改动内容 |
|---|---|---|
| `cloudfunctions/chat/index.js` | **核心改动（必改）** | ① `checkTextSafety` 增加 `errorCode` 返回字段；② `decideBlock` 增加 `degradeOnApiError` 参数与降级放行分支；③ `logSecurityEvent` 增加 `errorCode` 入参与 `errorCode`/`errorType` 落库；④ 两处调用点（`226-232`、`283-289`）传入 `degrade` 与 `errorCode` |
| `scripts/test_security_hardening.js` | 测试同步（建议改） | 新增用例：命中必拦、三类扫描失败放行、`errorCode/errorType` 落库断言；更新 `__cr002` 导出签名调用（不改函数名） |

> **冻结资产零改动**：`corpus.json` / `intent.js` / `rag.js` / `knowledgeRouter.js` 不变；`inputGuard.js` / `piiScrub.js` 不变（规则式护栏与脱敏逻辑保持独立）；Prompt 不变；不接入 Search；不改业务回答分支。

---

## 5. `security_events` Schema 变更

| 字段 | 类型 | 来源 | 是否新增 | 备注 |
|---|---|---|---|---|
| `stage` | string | 调用点 | 不变 | `"in"` / `"out"` |
| `errType` | string | `checkTextSafety` | 不变（保留） | `api_error`/`timeout`/`quota` 向后兼容字段 |
| `errorType` | string | `checkTextSafety` | **新增** | 与 `errType` 同值，语义化命名 |
| `errorCode` | number/string/null | `checkTextSafety` | **新增** | 来自 `e.errCode`，无则 `null` |
| `openidHash` | string | `hashOpenid()` | 不变 | SHA256 哈希，非明文 |
| `createTime` | serverDate | db | 不变 | — |

**隐私保证（要求 4）**：以上字段**均不含用户原文**。`logSecurityEvent` 调用处只传入 `stage / errType / errorCode / openid`，从未传入 `message`/`text`。落库内容与现状一致，仅增补错误元数据。

---

## 6. 环境变量 / 开关设计

| 变量 | 默认 | 语义 | 本方案 |
|---|---|---|---|
| `SEC_EMERGENCY_WARN_ONLY` | `false` | 紧急开关：仅 `hit` 拦截，余皆放行 | **保留**，语义不变（最宽松姿态，作为 master kill-switch 留存） |
| `SEC_DEGRADE_ON_API_ERROR` | `true` | 扫描失败（api_error/timeout/quota）降级放行（要求 2 的行为开关） | **新增**；`false` 时退回原 fail-closed，等价于「免部署回滚」 |

> 设计权衡：`SEC_DEGRADE_ON_API_ERROR` 默认 `true` 即把「服务不可用不阻断」设为常态，直接闭合 P0；若未来需临时恢复严格态，设 `false` 即可（无需重新部署，见 §7 L1）。`SEC_EMERGENCY_WARN_ONLY` 作为更激进的 master 开关保留，二者正交。

---

## 7. 回滚方案

> 云函数改动**必须重新部署**才生效（硬约束）。回滚分三级：

### L0 — 单文件还原（首选，需重新部署）
- 进入 Phase 2 改码前，先备份：`cloudfunctions/chat/index.js` → `cloudfunctions/chat/index.js.preHotfix004.bak`。
- 回滚：将 `.preHotfix004.bak` 覆盖回 `index.js`，在微信开发者工具「上传并部署·云端安装依赖」即可恢复 CR-002 上线态（不含本 hotfix）。

### L1 — 环境变量熔断（免部署，最快）
- 设 `SEC_DEGRADE_ON_API_ERROR=false` → `decideBlock` 立即退回 `!res.scanned` 拦截逻辑（原 fail-closed），**无需重新部署**。
- 若同时设 `SEC_EMERGENCY_WARN_ONLY=true` → 强制最宽松（仅 `hit` 拦）。
- 适用：hotfix 引入新问题时秒级止损。

### L2 — 全量还原（git / 备份）
- 用仓库历史或 `scripts/baseline-o0.6/chat-index.js.o06.bak` 之外、CR-002 上线后的 `index.js` 快照整体还原并重新部署。
- 注意：**不要**误用 `index.js.preCR.bak`（那是 CR-002 之前的未加固版本，会丢失全部安全能力）。

---

## 8. 验证与测试计划（Phase 2 执行）

基于现有 `scripts/test_security_hardening.js`（已 mock `wx-server-sdk`/`db`，经 `CR002_TEST_HOOK` 暴露内部函数，零真实调用）：

| 用例 | 前置 | 期望 |
|---|---|---|
| 确认违规拦截 | mock 返回 `detail:[{level:2}]` | `decideBlock` = `true` |
| 扫描成功未命中放行 | mock 返回 `suggest:"pass"` | `decideBlock` = `false` |
| `api_error` 放行 | mock `throw {errCode:-1}` | `decideBlock` = `false`，`errorCode=-1`/`errorType=api_error` 落库 |
| `timeout` 放行 | mock `throw {message:"timeout"}` | `decideBlock` = `false` |
| `quota` 放行 | mock `throw {message:"quota exceeded"}` | `decideBlock` = `false` |
| 降级关退回 fail-closed | `SEC_DEGRADE_ON_API_ERROR=false` + 扫描失败 | `decideBlock` = `true` |
| `SEC_EMERGENCY_WARN_ONLY=true` | 扫描失败 | `decideBlock` = `false` |
| 隐私断言 | 任意失败路径 | `security_events` 记录**不含** `message`/文本字段 |

> 部署后真实验证（真机/invoke）：① 发「你好」应正常回答（不再拦截）；② `security_events` 应出现 `errorType=api_error`、`errorCode` 非空记录；③ 构造命中样本（如明确违规词）应仍被拦。

---

## 9. 残留风险与缓解

| 风险 | 说明 | 缓解 |
|---|---|---|
| 服务降级期有毒内容透出 | msgSecCheck 不可用时，确认违规以外的真实有毒内容可能放行（可用性 > 严格安全的权衡） | ① `inputGuard` 规则式护栏仍独立拦截注入；② `security_events` 持续记录 api_error 率，异常升高即告警；③ 服务恢复后命中仍必拦 |
| 误判服务「可用」但返回结构异常 | 极罕见返回结构兼容错误（诊断中已排除 B 类，但留监测） | 维持 `scanned` 语义：返回解析失败时仍 `scanned=false` → 走降级放行，不阻断 |
| `errorCode` 取不到 | 部分异常无 `errCode` | 落 `null`，不影响 `errorType` 分类与放行决策 |

---

## 10. 部署检查清单（Phase 2 预览，待授权后执行）

1. 备份 `index.js` → `index.js.preHotfix004.bak`（L0 锚点）
2. 按 §3 改 `index.js` 四处（checkTextSafety / decideBlock / logSecurityEvent / 两调用点）
3. 更新 `scripts/test_security_hardening.js` 用例并本地跑通
4. 校验冻结四资产 SHA256 不变（§2.2）
5. 微信开发者工具「上传并部署·云端安装依赖」（SCF 上传端点沙箱不可达，须手动）
6. 设 `SEC_DEGRADE_ON_API_ERROR=true`（默认值即 true，无需新增；若环境变量面板曾被改需确认）
7. 真机验证 §8 三条；观察 `security_events` 与 `observability_logs`
8. 更新 Issue #004 状态为 Resolved / 观察期

---

## 11. 授权闸门

> **本文件为 Phase 1 设计稿，未做任何代码 / 配置 / 资产修改。**
> 待用户明确授权后进入 **Phase 2**：实施 §3–§4 改动、跑测试、部署、真机验证。
> 授权时可一并确认：是否接受「服务不可用 → 降级放行」的可用性权衡（§9 残留风险）。
