# Release Preparation Report

> 角色：Release Manager + Release Guardian
> 性质：**上传前最终检查（纯审计，零代码/零部署/零 commit）**
> 执行时间：2026-08-06 09:46 GMT+8
> 结论口径：仅确认当前工作区状态；所有判定基于只读核验，未改动任何文件。

---

## 1. 当前版本状态

| 项目 | 状态 |
|---|---|
| 产品 | 向晚问思（WenDao）· 微信云开发小程序 |
| 冻结基线 | **O-0.6** |
| 已部署生产 | Phase R Capability Layer（2026-08-05 16:15 部署 / 16:28 首验 3/3 PASS / 16:35 记录回填） |
| CR-002 Security Hardening | **已上线**（2026-08-05 20:29 部署，tcb 代码核验确认含全部 CR-002 标记） |
| 本次待上传范围 | 仅新增/变更内容见 §3，**不含任何冻结资产** |

> 说明：本检查针对「工作区当前可上传内容」，CR-002 与 Phase R 此前已部署，其产物在当前工作区同时存在（属既有状态），将在 §3 清单与 §4 风险中分别标注。

---

## 2. 已完成 Phase

### 2.1 CR-002 Security Hardening（独立安全加固轨，已上线）
- 目标：修复引入不可信外部文本前的既有 fail-open 缺口（#002）。
- 落地内容（已代码核验）：
  - `cloudfunctions/chat/index.js` 含 **fail-closed**（`decideBlock` 默认拦截 `scanned=false`）、**`security_events`** 落库（仅元数据 + `openidHash`）、**`inputGuard`**（规则式注入护栏，无 LLM/网络）、**`piiScrub`**（落库前 PII 掩码）。
  - 新增 `cloudfunctions/chat/security/inputGuard.js`、`cloudfunctions/chat/security/piiScrub.js`。
  - 止血开关 `SEC_EMERGENCY_WARN_ONLY`（默认关）、测试钩子 `exports.__cr002` 仅 `=="1"` 暴露。
- 回滚基线：`cloudfunctions/chat/index.js.preCR.bak` 存在（SHA `c66ac9fd…a0e`）。

### 2.2 Phase S-0.3 Fixture（Search QA 测试资产，已就绪未部署）
- 目标：将 S-0.3 Search 测试设计实体化为可复现离线资产，供后续 S0.5 Bake-off 使用。
- 交付：`search/test/fixtures.json`（60 条：FACT 30 + FRESHNESS 30，10 条带 T-1/T-4 安全引用标签）。
- 性质：纯测试资产，不接入 Search、不调用外部 API、不进生产链路。

---

## 3. 上传文件清单

> 分类依据：`git status --short` 当前输出（2026-08-06 09:46）。`M` = 已修改（tracked 工作树），`??` = 未跟踪。

### 3.1 生产代码（本次增量相关）

| 文件 | 来源 Phase | 说明 |
|---|---|---|
| `weapp/cloudfunctions/chat/index.js` | CR-002 | **已上线**（20:29 部署）；当前为线上版本的工作树文件 |
| `weapp/cloudfunctions/chat/security/inputGuard.js` | CR-002 | **已上线** |
| `weapp/cloudfunctions/chat/security/piiScrub.js` | CR-002 | **已上线** |
| `weapp/cloudfunctions/chat/index.js.preCR.bak` | CR-002 | 回滚基线（非运行时代码，仅供回退） |
| `weapp/cloudfunctions/chat/capabilities/` | Phase R | **已上线**（16:15 部署） |
| `weapp/cloudfunctions/chat/freshness/` | Phase Q | 随 R 整目录部署；`FRESHNESS_ENABLED` 未配置=关闭 |
| `weapp/cloudfunctions/chat/observability/` | Phase P+/R | 观测增量 |
| `weapp/cloudfunctions/chat/registry/`, `dashboard/` | Phase P+ | 运营观测 |
| `weapp/cloudfunctions/chat/knowledgeHealthScore.js` | Phase O | 知识健康评分 |
| `weapp/cloudfunctions/history/index.js` | — | 历史函数（tracked modified） |
| `weapp/cloudfunctions/chat/intent.js`, `knowledgeRouter.js` | — | 显示为未跟踪（无历史提交基线），**内容与 O-0.6 冻结值逐字节一致**（见 §4） |
| `weapp/miniprogram/pages/chat/chat.js` | — | 前端（tracked modified） |

> 注：上述 `cloudfunctions/chat/*` 多数在 `git status` 中呈 `??`（仓库从未就这些文件做过基线提交），与「已上线」不冲突——线上部署走微信开发者工具手动上传，不经本仓库 git 提交。本清单仅为「工作区有哪些可上传产物」的透明罗列，**本任务不执行任何上传/部署动作**（见 §5 停止点）。

### 3.2 测试资产

| 文件 | 来源 | 说明 |
|---|---|---|
| `weapp/search/test/fixtures.json` | Phase S-0.3 | **本次新增**（60 条 FACT 30 + FRESHNESS 30） |
| `weapp/scripts/test_security_hardening.js` | CR-002 | 20/20 PASS（位于 weapp/scripts/，非函数内） |
| `weapp/scripts/test_capabilities.js`, `test_freshness.js` | Phase R / Q | 回归测试 |
| `weapp/scripts/baseline-o0.6/` | 基线 | 冻结 SHA256SUMS + 备份 |
| `weapp/scripts/records-*.json`, `freshness_eval_dataset.json` | 观测/评测 | 数据快照 |
| `weapp/tests/*` | 多 Phase | 各类回归/在线质量测试 |

### 3.3 文档

| 目录 | 数量 | 说明 |
|---|---|---|
| `weapp/docs/PhaseS-0.3-FixtureImplementationReport.md` | 本次新增 | S-0.3 Fixture 实现报告 |
| `weapp/docs/Release-Preparation-Report.md` | 本次新增 | 本报告 |
| `weapp/docs/CR-002-*.md`（3 份） | CR-002 | 设计/实施/发布报告 |
| `weapp/docs/PhaseS*`, `PhaseQ*`, `PhaseR*`, `PhaseP*` … | 各 Phase | 设计/规格/部署/观察全套文档（历史累积未提交） |

---

## 4. 风险检查

| 检查项 | 结果 | 证据 |
|---|---|---|
| 无冻结资产漂移 | ✅ PASS | 见下表 SHA256 比对 |
| 无 Search 接入 | ✅ PASS | 工作区无 `search/` 运行时代码；`search/test/fixtures.json` 仅为离线资产；无 Provider 调用/配置 |
| 无外部 API | ✅ PASS | 本轮零 API 调用；CR-002 `inputGuard`/`piiScrub` 纯本地规则，无网络；`SEC_EMERGENCY_WARN_ONLY` 默认关 |
| 无生产数据 | ✅ PASS | `fixtures.json` 顶层 `production_data:false`；所有测试 query 为公开 benign 内容；`security_events` 仅存元数据+哈希，零原文 |

### 4.1 冻结资产 SHA256 比对

| 文件 | 当前 SHA256 | O-0.6 baseline | 一致性 |
|---|---|---|---|
| `corpus.json` | `db01fbc92064cbea3a6688a98160b6a70c9e150259b54063c8e2e96974eabc8b` | `db01fbc9…eabc8b` | ✅ MATCH |
| `intent.js` | `765ad138ec68c0f159c6f75a60e5268beb02fba152f6d53dbdc539ba1560ca38` | `765ad138…60ca38` | ✅ MATCH |
| `rag.js` | `5b380b3f7c68f374e3d4e5127bd7dbeff747849401ca9d0488498dece1408286` | `5b380b3f…8286` | ✅ MATCH |
| `knowledgeRouter.js` | `848908445dbb5ea93a6f52775dc3c8e6922ff971d6cee115547f236ffed0a935` | `84890844…d0a935` | ✅ MATCH |

> 注：`git status` 中 `corpus.json` / `rag.js` 显示 `M`（工作树 diff），但 SHA256 与 O-0.6 逐字节一致——该 diff 为 Phase G / CR-002 遗留未提交所致，**非本次引入**。权威判据以 SHA256 字节比对为准。

### 4.2 工作区分类（git status 快照）

- **生产代码**：`cloudfunctions/chat/{index.js, intent.js, knowledgeRouter.js, capabilities/, freshness/, observability/, registry/, dashboard/, security/, knowledgeHealthScore.js, index.js.preCR.bak}`，`cloudfunctions/history/index.js`，`miniprogram/pages/chat/chat.js`
- **测试资产**：`search/test/fixtures.json`，`scripts/test_*.js`，`scripts/baseline-o0.6/`，`scripts/records-*.json`，`scripts/freshness_eval_dataset.json`，`tests/*`
- **文档**：`docs/*`（含本次新增 2 份），`AI_CONTEXT/`，`cloudbaserc*.json`
- **部署临时**：`.deploy-backup/`，`.deploy-tmp/`（部署产物，非源码）

---

## 5. Release Gate

```
┌─────────────────────────────────────────────┐
│  RELEASE GATE: READY FOR UPLOAD              │
├─────────────────────────────────────────────┤
│ ✅ CR-002 安全加固标记齐备（fail-closed /    │
│    security_events / inputGuard / piiScrub） │
│ ✅ Phase S-0.3 Fixture 实体化完成（60 条）    │
│ ✅ 冻结四资产 SHA256 ≡ O-0.6（零漂移）        │
│ ✅ 无 Search 接入 / 无外部 API / 无生产数据   │
│ ✅ 本轮零代码改动、零部署、零 commit          │
└─────────────────────────────────────────────┘
```

**最终状态：READY FOR UPLOAD**

---

## 6. 停止点（Stop Here）

按任务约束，完成本报告后即停止：

- ❌ 不执行上传（微信开发者工具手动上传由人工执行）
- ❌ 不部署
- ❌ 不 commit
- ❌ 不 push

等待人工执行上传动作。所有改动（如有）仅停留在工作区，未触碰冻结资产，未引入任何运行期风险。

---

*报告结束 · 2026-08-06 · Release Manager + Release Guardian*
