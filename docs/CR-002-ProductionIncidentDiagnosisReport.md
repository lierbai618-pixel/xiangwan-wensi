# CR-002 Production Incident Diagnosis Report

> 角色：Release Guardian + Security Engineer
> 时间：2026-08-06 12:01 GMT+8
> 状态：**只读诊断完成 · 等待人工授权修复**
> 约束遵守：未改代码 / 未部署 / 未回滚 / 未改环境变量 / 未改冻结资产 / 未删安全模块

---

## 1. 事件概要

- **现象**：生产环境所有用户正常输入（首例 `你好`）均被提示 `您的提问包含不当内容，已拦截。请换个问题。`
- **影响**：输入阶段（stage=`in`）全量拦截，生成链路（generateAnswer）永不触发 → 服务实质不可用。
- **范围**：真机 11:46–11:47（北京）测试窗口内 2 个 openid、5 次输入全部命中，符合"全局阻断"描述。
- **严重度**：**P0**（生产回归，CR-002 上线后引入的新故障模式）。

---

## 2. "你好" 实际判断路径（代码证据）

调用入口 `index.js:226`：

```js
// index.js:226
const inSafe = await checkTextSafety(message, "in");   // ← 先跑 msgSecCheck
// index.js:227-229
if (!inSafe.scanned) {
  logSecurityEvent("in", inSafe.errType, openid);        // SEC-3 审计（仅 scanned=false 时写）
}
// index.js:230-231
if (decideBlock(inSafe, isWarnOnly())) {
  return { ok: false, error: "您的提问包含不当内容，已拦截。请换个问题。" };
}
// index.js:235-240  ← inputGuard 在这里，但仅当 230 未拦截才到达
if (inputGuard) {
  const g = inputGuard.detect(message);
  if (g && g.block) {
    return { ok: false, error: "您的输入包含异常指令模式，已拦截。" };  // 与截图消息不同
  }
}
```

`checkTextSafety` 关键分支 `index.js:70-99`：

```js
async function checkTextSafety(text, stage) {
  const content = (text || "").toString().trim();
  if (!content) return { hit: false, err: "", scanned: true, errType: "" };
  try {
    const res = await cloud.openapi.security.msgSecCheck({   // index.js:74
      content, version: 2, scene: 2,
    });
    // 成功路径 → scanned:true（line 82-89）
    ...
  } catch (e) {                                              // index.js:90
    const msg = e && e.message ? e.message : "" + e;
    console.error("msgSecCheck 调用失败:", msg);             // index.js:92（真实错误在此，但未落库）
    let errType = "api_error";
    if (/timeout|超时/i.test(msg)) errType = "timeout";
    else if (/quota|limit|频率|配额/i.test(msg)) errType = "quota";
    return { hit: false, err: msg, scanned: false, errType }; // index.js:97 ← scanned=false
  }
}
```

`decideBlock` 决策 `index.js:107-111`：

```js
function decideBlock(res, warnOnly) {
  if (!res) return true;
  if (warnOnly) return !!res.hit;
  return !!res.hit || !res.scanned;   // warnOnly=false（默认）→ scanned=false 即拦截
}
```

### 对 `你好` 的逐字段判定

| 字段 | 值 | 证据 |
|---|---|---|
| `inputGuard.detect("你好").block` | `false` | `inputGuard.js:9-25` 12 条正则均含注入关键词（忽略/忘记/无视/无限制/DAN/jailbreak…），无一条匹配"你好" → `detect` 返 `{block:false,reason:""}` |
| `scanned` | **`false`** | `security_events` 实测 `errType:"api_error"`（line 97 分支被命中） |
| `errType` | **`"api_error"`** | 云端 `security_events` 5/5 实测；catch 默认分类（line 94） |
| `hit` | `false` | 异常路径 line 97 固定 `hit:false` |
| `block` 原因 | **`!res.scanned` → fail-closed** | `decideBlock` line 110：`!!false \|\| !false = true` |
| 返回消息 | `您的提问包含不当内容，已拦截。请换个问题。` | **逐字匹配 `index.js:231`**（非 line 238） |

> 结论：拦截 100% 发生在 msgSecCheck 阶段（line 74 抛异常 → line 97 `scanned=false` → line 110 fail-closed → line 231 返回）。inputGuard 对"你好"返回 `block:false` 且位于 line 235（在 line 230 拦截之后），**根本未执行到**。

---

## 3. 三项假设核查（代码 + 云端双证）

### A. msgSecCheck 失败导致全局阻断 —— ✅ CONFIRMED
- 代码：`cloud.openapi.security.msgSecCheck` 在 `index.js:74` 抛出 → catch `line 90-97` → `scanned=false, errType="api_error"`。
- 云端：`security_events` 全部 5 条 = `stage:"in"` + `errType:"api_error"`，时间窗精确覆盖 11:46–11:47 的"你好"测试。
- 逻辑：全局失败 → 每个输入的 `scanned` 均为 false → `decideBlock` 始终返回 true → 全量拦截。与"所有用户正常输入均被拦截"现象完全一致。

### B. 返回结构兼容错误（误判 hit=true） —— ❌ RULED OUT
- 若为结构误判，msgSecCheck 应**成功返回**（`scanned=true`）且 `hit` 被错判为 true。
- 但 `logSecurityEvent` 仅在 `!inSafe.scanned` 时写入（`index.js:227`）。云端实测存在 `errType:"api_error"` 记录 → 证明走的是 **catch 异常分支（line 90）**，即 API 调用本身抛错，**不是**成功返回后结构解析错误。
- 反证成立：无 `scanned=true` 的 security_events 记录；若存在 hit=true 误判，则不会写任何日志（因 `scanned=true`）。

### C. inputGuard 误匹配 —— ❌ RULED OUT
- 三重证据：
  1. **消息不匹配**：截图消息 = `您的提问包含不当内容，已拦截。请换个问题。`（line 231）；inputGuard 消息 = `您的输入包含异常指令模式，已拦截。`（line 238）。二者不同 → 拦截源非 inputGuard。
  2. **执行顺序**：inputGuard 在 `index.js:235`，位于 `decideBlock` 拦截（line 230）之后；"你好"在 line 230 已被拦，inputGuard 未执行。
  3. **模式不命中**：`inputGuard.js:9-25` 全部 12 条正则均要求注入类关键词，"你好"零匹配（已逐条核对）。

---

## 4. 云端取证明细（只读 `security_events`）

| 维度 | 结果 |
|---|---|
| 查询方式 | `tcb db nosql execute`（MongoDB 命令对象，只读） |
| 返回记录数 | 5（limit 25，集合内仅 5 条） |
| `errType` 分布 | `api_error: 5`（100%） |
| `stage` 分布 | `in: 5`（100%，无 `out`） |
| 不同 `openidHash` | 2 |
| 时间窗（UTC） | `2026-08-06 03:46:56Z` – `03:47:52Z`（= 北京 11:46–11:47） |
| 全集合总数 | 5（即仅有这些记录，事件被完整捕获） |

> 说明：msgSecCheck 在 `out` 阶段（line 283-289）也会调用，但因输入阶段已全部拦截、生成永不触发，故无 `stage:"out"` 记录——与预期一致。

---

## 5. api_error 具体成因（待修复阶段确认，非本诊断结论）

代码无法告知 msgSecCheck **为何**抛出（catch 仅记 `errType`，未落 `err` 原文；真实消息在 `index.js:92` `console.error`，但未写入 `security_events`）。

- 获取途径（需人工/开发者工具）：微信开发者工具「云开发 → 云函数 chat → 日志」，或 Cloud Console 函数日志，搜 `msgSecCheck 调用失败:` 后的具体 message。
- CLI 不可取：`tcb fn log` 返回 `GetFunctionLogs 当前版本不支持`（需升级开发者工具）；且本沙箱出网偶发 ECONNRESET。
- **候选根因（修复阶段确认，非诊断结论）**：
  1. msgSecCheck 接口权限未开通 / 小程序后台「内容安全」未启用；
  2. `cloud.openapi.security.msgSecCheck` 的 `version:2, scene:2` 参数与账号资质不匹配（如未开通 v2）；
  3. access token 失效 / 云环境权限变更；
  4. 配额耗尽（但会被归类为 `quota`，非 `api_error`——可排除此项）。

---

## 6. 事件登记建议

建议登记为 **Issue #004**（沿用 #001 psych routing / #002 msgSecCheck fail-open / #003 latency p99 序列）：
- 标题：**CR-002 fail-closed 与 msgSecCheck 可用性强耦合，导致安全服务不可用时全量拦截**
- 性质：CR-002 修复引入的**新故障模式**（fail-open 已修，但 fail-closed 过激）
- 严重度：P0
- 状态：诊断完成，待授权修复
- *编号以你确认为准。*

---

## 7. 修复选项（仅列出，未经授权不执行）

| 选项 | 动作 | 风险 | 说明 |
|---|---|---|---|
| **M1 止血（推荐先行）** | 设环境变量 `SEC_EMERGENCY_WARN_ONLY=true` | 低 | `decideBlock` line 109 改为仅 `!!hit` 拦截，api_error 不再拦 → 立即恢复服务；msgSecCheck 恢复后可撤。违反本诊断任务"禁改环境变量"约束，需你单独授权。 |
| **M2 L2 回滚** | 用 `index.js.preCR.bak` 恢复 CR-002 前版本 | 中 | 回到 fail-open（旧漏洞重现），仅作最后兜底。 |
| **M3 根因修复** | 修 msgSecCheck 调用（权限/参数/资质） | 中 | 消除 api_error 源头；需先取得 §5 真实错误消息。 |
| **M4 设计加固** | 区分"服务不可用"与"内容违规"：api_error 降级放行+告警，仅 hit=true 拦截 | 中 | 根治强耦合，避免安全服务抖动拖垮全站；需代码改动+重部署。 |

---

## 8. 结论与停止点

- **诊断结论（有代码+云端双证）**：本次 P0 回归 = **msgSecCheck 调用全局失败（api_error）→ `scanned=false` → CR-002 fail-closed 全量拦截**。假设 A 确证，B/C 排除。
- **"你好"判定**：`scanned=false` / `errType=api_error` / `hit=false` / 拦截因 `!scanned`（fail-closed）。
- **当前状态**：只读诊断完成。**未做任何修改、未部署、未回滚、未改配置**。
- **下一步**：等待你授权修复（M1 止血 / M3 根因 / M4 加固 择一或组合），并确认 Issue 编号。
- 不自动进入任何修复动作。
