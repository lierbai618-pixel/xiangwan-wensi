# CR-002 #004 Hotfix — 部署前检查报告（Pre-Deployment Check）

- **状态**：实施完成（Phase 1–4），**未部署** · 待单独授权部署
- **实施角色**：Release Manager + Security Engineer
- **动作许可**：改 `cloudfunctions/chat/index.js` + `scripts/test_security_hardening.js`；禁止 commit/push/部署/改生产环境变量
- **生成时间**：2026-08-06

---

## 1. 修改文件列表

| 文件 | 状态 | 改动性质 |
|---|---|---|
| `cloudfunctions/chat/index.js` | **Modified** | CR-002 #004 安全链路：checkTextSafety / decideBlock / logSecurityEvent / in·out 调用点 |
| `cloudfunctions/chat/index.js.preHotfix004.bak` | **新增（回滚备份）** | Phase 1 备份，部署前基线，用于 L0 回滚 |
| `scripts/test_security_hardening.js` | **Modified** | 新增 CR-002 #004 覆盖用例（T-S-01~T-S-10）+ `errApiError` mock |

**未触碰（硬约束遵守）**：`corpus.json` / `intent.js` / `rag.js` / `knowledgeRouter.js` / `inputGuard.js` / `piiScrub.js` / Prompt / RAG 链路 / 业务回答逻辑 / Search。

---

## 2. Diff 摘要（index.js，相对 .preHotfix004.bak）

| 函数 / 位置 | 变更 |
|---|---|
| `checkTextSafety` | ① 三处成功返回新增 `errorCode: null`；② catch 中新增 `errorCode`（取自 `e.errCode`，缺失为 `null`）；③ 注释更新（扫描失败交由调用方决策，默认降级放行） |
| `decideBlock` | 新增第三参 `degradeOnApiError`；改为**严格布尔**：`res.hit === true` 必拦；`warnOnly === true` 仅命中拦；`degradeOnApiError === true && res.scanned === false` → 放行；否则 `res.scanned === false` 退回 fail-closed |
| `logSecurityEvent` | 新增第三参 `errorCode`；落库增 `errorType`（=errType 同值）与 `errorCode`；`errType` 旧字段保留兼容；入参仍**不含原文** |
| 入参调用点（原 226-232） | 新增 `degradeOnApiError` 开关读取；`logSecurityEvent` 传 `inSafe.errorCode`；`decideBlock` 传 `degradeOnApiError` |
| 出参调用点（原 283-289） | 同上对称处理 |

**净增行**：约 +60 行注释/逻辑；**无删除既有安全行为**，仅改变失败分支默认决策。

---

## 3. 测试结果（Phase 4，本地 Node 22.22.2）

```
==== 结果: 24 PASS / 0 FAIL ====
```

CR-002 #004 覆盖用例（全部 PASS）：

| 用例 | 期望 | 结果 |
|---|---|---|
| T-S-01 输入违规(hit=true)→拦截 | 拦 | PASS |
| T-S-02 输出违规(hit=true)→拦截 | 拦 | PASS |
| T-S-03 扫描成功且未命中→放行 | 放 | PASS |
| T-S-04 api_error→默认降级放行（含 errorCode=-1） | 放 | PASS |
| T-S-05 timeout→默认降级放行 | 放 | PASS |
| T-S-06 quota→默认降级放行 | 放 | PASS |
| T-S-07 出参扫描失败→降级放行（对称） | 放 | PASS |
| T-S-08 SEC_DEGRADE_ON_API_ERROR=false→扫描失败拦截(fail-closed) | 拦 | PASS |
| T-S-09 SEC_EMERGENCY_WARN_ONLY=true→扫描失败放行但仍审计 | 放+审计 | PASS |
| T-S-10 security_events 仅元数据(无原文)且含 errorCode/errorType | 合规 | PASS |

> 附：注入护栏（中/英）2、正常问题 0 误杀 6、PII 脱敏 5、性能门禁 1，均 PASS。stderr 中的 `msgSecCheck 调用失败:` 为 mock 异常的预期日志，非错误。

---

## 4. 冻结资产 SHA256 对比（O-0.6 基线）

| 资产 | 当前 SHA256 | O-0.6 基线 | 结论 |
|---|---|---|---|
| `corpus.json` | `db01fbc92064cbea3a6688a98160b6a70c9e150259b54063c8e2e96974eabc8b` | 同 | ✅ MATCH |
| `intent.js` | `765ad138ec68c0f159c6f75a60e5268beb02fba152f6d53dbdc539ba1560ca38` | 同 | ✅ MATCH |
| `rag.js` | `5b380b3f7c68f374e3d4e5127bd7dbeff747849401ca9d0488498dece1408286` | 同 | ✅ MATCH |
| `knowledgeRouter.js` | `848908445dbb5ea93a6f52775dc3c8e6922ff971d6cee115547f236ffed0a935` | 同 | ✅ MATCH |

**四资产逐字节一致，零漂移。**

---

## 5. 部署前检查清单

| 检查项 | 状态 |
|---|---|
| 仅改授权文件（index.js / test） | ✅ PASS |
| 冻结四资产 SHA256 不变 | ✅ PASS |
| 未碰 Prompt / RAG / Search / 业务回答逻辑 | ✅ PASS |
| 未改生产环境变量（仅代码中读 `SEC_DEGRADE_ON_API_ERROR`，默认 true，未写环境变量面板） | ✅ PASS |
| 未 commit / 未 push | ✅ PASS（待用户决定） |
| 未部署云函数 | ✅ PASS（仅本地实施） |
| 单元测 24/24 PASS | ✅ PASS |
| 回滚备份 `index.js.preHotfix004.bak` 就位 | ✅ PASS |

---

## 6. 部署就绪结论

**PRE-DEPLOYMENT GATE = READY（待人工授权部署）**

部署前置注意事项（供下一阶段）：
1. 云函数改动**必须重新部署**才生效；SCF 上传端点沙箱不可达，须用户在微信开发者工具「上传并部署·云端安装依赖」。
2. `SEC_DEGRADE_ON_API_ERROR` 默认 `true`（代码内 `|| "true"`），**无需在环境变量面板新增**即生效降级放行；若面板曾被手动改过该键，须确认未误设为 `false`。
3. 部署后真机验证：① 发「你好」应正常回答（P0 闭合）；② `security_events` 应出现 `errorType=api_error`、`errorCode` 记录；③ 构造命中样本仍被拦。
4. 回滚：L1 设 `SEC_DEGRADE_ON_API_ERROR=false` 秒级退回 fail-closed（免部署）；L0 用 `.preHotfix004.bak` 覆盖重部署。

> 本文件仅记录「实施+本地验证」阶段，不含部署动作。部署为独立授权步骤。
