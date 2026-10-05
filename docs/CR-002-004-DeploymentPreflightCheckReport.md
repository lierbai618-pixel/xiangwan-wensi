# CR-002 #004 Deployment Preflight Check Report

- **文档编号**：CR-002-004-DPCR
- **生成时间**：2026-08-06 13:48 (GMT+8)
- **角色**：Release Manager + DevOps Engineer
- **阶段**：Phase 1 — 部署前最终确认
- **模式**：只读核验（零代码写入、零配置变更）
- **关联文档**：`CR-002-004-HotfixDesignProposal.md`、`CR-002-004-PreDeploymentCheckReport.md`、`CR-002-ProductionIncidentDiagnosisReport.md`

---

## 1. 检查项总览

| # | 检查项 | 期望 | 实际 | 结论 |
|---|---|---|---|---|
| P-01 | `index.js` 为 Hotfix #004 版本 | 含 004 全部特征标记 | 6/6 特征全部命中 | ✅ PASS |
| P-02 | 回滚备份 `index.js.preHotfix004.bak` 存在 | 存在且非空 | 14,091 B / 08-06 12:32 | ✅ PASS |
| P-03 | corpus.json SHA256 = O-0.6 | `db01fbc9…eabc8b` | 一致 | ✅ PASS |
| P-04 | intent.js SHA256 = O-0.6 | `765ad138…60ca38` | 一致 | ✅ PASS |
| P-05 | rag.js SHA256 = O-0.6 | `5b380b3f…408286` | 一致 | ✅ PASS |
| P-06 | knowledgeRouter.js SHA256 = O-0.6 | `84890844…ed0a935` | 一致 | ✅ PASS |
| P-07 | `index.js` 语法门禁 | `node --check` 通过 | SYNTAX_OK | ✅ PASS |
| P-08 | 云端函数可达且状态健康 | Deployment completed | Deployment completed | ✅ PASS |
| P-09 | 运行时未被改变 | Nodejs16.13 | Nodejs16.13 | ✅ PASS |
| P-10 | 生产环境变量未被改动 | 仅原有 2 项 | 仅原有 2 项 | ✅ PASS |
| P-11 | 本次部署无需新增环境变量 | 代码内默认值可用 | 确认（详见 §4） | ✅ PASS |

**Preflight 结论：11/11 PASS，0 阻塞项。**

---

## 2. 代码版本确认（P-01）

`cloudfunctions/chat/index.js` — 16,025 B，mtime `2026-08-06 12:35`
SHA256 = `88cd3dff3db9217950a67ac4124df1d29bcd905b38384978c028f85c8d05e8a4`

Hotfix #004 六项特征标记逐条命中：

| 特征 | 位置 | 证据 |
|---|---|---|
| `errorCode` 字段（成功路径） | L72 / L86 / L89 | `{ …, errType: "", errorCode: null }` |
| `errorCode` 字段（异常路径） | L94 / L99 | `const errorCode = (e && e.errCode !== …) ? e.errCode : null` |
| `decideBlock` 三参签名 | L112 | `function decideBlock(res, warnOnly, degradeOnApiError)` |
| 严格布尔 `res.hit === true` 必拦 | L114 | `if (res.hit === true) return true;` |
| 严格布尔 `res.scanned === false` 降级 | L116 / L117 | `degradeOnApiError === true && res.scanned === false` → `return false` |
| `logSecurityEvent` 四参 + 双字段落库 | L127 / L133-134 | 新增 `errorType` / `errorCode`，`errType` 兼容保留 |

**in / out 两处调用点统一策略**（L236-244、L299-301）：
- L237 读取开关：`const degradeOnApiError = (process.env.SEC_DEGRADE_ON_API_ERROR || "true").toLowerCase() !== "false";`
- L244 入参决策：`decideBlock(inSafe, isWarnOnly(), degradeOnApiError)`
- L301 出参决策：`decideBlock(outSafe, isWarnOnly(), degradeOnApiError)`

---

## 3. 回滚备份确认（P-02）

| 文件 | 大小 | mtime | SHA256 | 用途 |
|---|---|---|---|---|
| `index.js.preHotfix004.bak` | 14,091 B | 2026-08-06 12:32 | `dcfd866b3318b4e12b1ddf225d923d3bab33da8b93555fbc719d6b9a49c3f2f9` | **L0 回滚锚点**（本次部署） |
| `index.js.preCR.bak` | 10,898 B | 2026-08-05 20:12 | — | 历史锚点（CR-002 之前，非本次使用） |

两份备份均位于 `cloudfunctions/chat/`，与函数代码同目录，会随上传包一并进入云端。二者为惰性文件，**不被 `index.main` 引用、不参与运行时加载**，对线上行为零影响。本次不做移动或删除（部署纪律：禁止修改任何代码/配置）。

---

## 4. 环境变量确认（P-10 / P-11）

云端现有环境变量（`tcb fn detail` 读取，未做任何修改）：

```
ADMIN_OPENID=YOUR_ADMIN_OPENID
KNOWLEDGE_OBSERVABILITY_STORE=cloud
```

**关键判定：本次部署无需在环境变量面板新增任何键。** 三个安全开关均为「不配置即安全默认」：

| 开关 | 云端是否已配置 | 未配置时的取值 | 本次期望行为 |
|---|---|---|---|
| `SEC_DEGRADE_ON_API_ERROR` | 否 | **true**（代码内默认） | 扫描失败 → 降级放行（P0 闭合） |
| `SEC_EMERGENCY_WARN_ONLY` | 否 | false | 保持正常安全语义 |
| `CAPABILITY_ENABLED` | 否 | true | Phase R 能力层照常 |

> 由此，Hotfix #004 的降级放行**仅靠代码部署即生效**，不触碰环境变量面板 —— 与本次执行纪律「❌ 修改环境变量面板」完全相容。

同时确认 `KNOWLEDGE_OBSERVABILITY_STORE=cloud` 与 `ADMIN_OPENID` **均仍在**，Phase R 观察期数据链路不会因本次部署断裂。

---

## 5. 冻结资产复核（P-03 ~ P-06）

| 资产 | 实测 SHA256 | O-0.6 基线 | 结论 |
|---|---|---|---|
| corpus.json | `db01fbc92064cbea3a6688a98160b6a70c9e150259b54063c8e2e96974eabc8b` | 同 | ✅ MATCH |
| intent.js | `765ad138ec68c0f159c6f75a60e5268beb02fba152f6d53dbdc539ba1560ca38` | 同 | ✅ MATCH |
| rag.js | `5b380b3f7c68f374e3d4e5127bd7dbeff747849401ca9d0488498dece1408286` | 同 | ✅ MATCH |
| knowledgeRouter.js | `848908445dbb5ea93a6f52775dc3c8e6922ff971d6cee115547f236ffed0a935` | 同 | ✅ MATCH |

**四资产逐字节零漂移。** 自 Phase Q → Phase R → R-001 → CR-002 → Hotfix #004 共五轮迭代，SHA256 恒定未变。

---

## 6. 云端现状快照（部署前 Before）

| 项 | 值 |
|---|---|
| Environment ID | `YOUR_CLOUD_ENV_ID` |
| Function name | `chat` |
| Status | Deployment completed |
| Code size | 11,223,771 B (≈11.2 MB) |
| Handler | `index.main` |
| Memory | 512 MB |
| Runtime | **Nodejs16.13** |
| Timeout | 60 s |
| Network / Trigger | None / None |

部署后需复核：Runtime 仍为 Nodejs16.13、Handler 仍为 `index.main`、环境变量两项仍在。

---

## 7. 部署范围与红线

**本次上传目录**：`cloudfunctions/chat`（整目录）

随包上传但**行为零变化**的既有模块（均为此前已上线或默认关闭）：
- `capabilities/`（Phase R，已上线，`CAPABILITY_ENABLED` 默认 true）
- `freshness/`（Phase Q，默认关，`FRESHNESS_ENABLED=false`）
- `security/`（CR-002 `inputGuard.js` / `piiScrub.js`，本次**未修改**）
- `observability/` / `registry/` / `dashboard/`

**红线自检**：本次仅部署 Phase 2 已审核通过的 `index.js`。未修改代码、未修改配置、未 `npm upgrade`、未改运行环境、未 commit / push。

---

## 8. 结论

```
DEPLOYMENT PREFLIGHT = PASS
阻塞项 = 0
准入判定 = PROCEED TO PHASE 2 (DEPLOY)
```

进入 Phase 2：`cloudfunctions/chat` 上传并部署（云端安装依赖）。
