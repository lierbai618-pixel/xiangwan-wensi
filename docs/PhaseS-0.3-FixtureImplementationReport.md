# Phase S-0.3 Fixture Implementation Report — Search QA Test Asset Preparation

> 角色：Search QA Engineer + Release Guardian + AI System Test Architect
> 阶段性质：**纯测试资产建设（Test Asset Only）** — 不进入 Provider 测试、不接入 Search、不改变生产系统
> 执行日期：2026-08-05
> 交付状态：**READY FOR HUMAN REVIEW**

---

## 0. 执行前审计（Read-Only）

### 0.1 规范来源（只读扫描）
- `docs/PhaseS-Pre-SearchLayerImplementationReadinessPackage.md`（P-01~P-12 门禁）
- `docs/PhaseS-0.3-msgSecCheckSecurityFixtureSpecification.md`（60 条安全 fixture / T-1~T-7）
- `docs/PhaseS-0.2-msgSecCheckComplianceQuarantineGovernanceReview.md`（双扫描模型 SP-1/SP-2）
- `docs/PhaseS0.5-SearchProviderBakeoffAuthorizationRequest.md` §D（安全 fixture 复用 T-1/T-4）
- `docs/PhaseS0.5-BakeoffExecutionRunbookAppendix.md` §S5（安全隔离测试）

### 0.2 关键澄清（避免混淆两个“S-0.3”资产）
- 既有 `PhaseS-0.3-msgSecCheckSecurityFixtureSpecification.md` 定义的是 **60 条安全 fixture（攻击 50 + 正常 10，T-1~T-7）**，服务于 P-02b/f/g。
- 本任务交付的是 **Search QA / Provider bake-off fixture 数据集（30 FACT + 30 FRESHNESS）**，是**独立资产**。
- 本数据集仅**复用** S-0.3/S-0.2/S0.5 已定义的 `T-1` / `T-4` **引用标签**作为 `security_case` 元数据（10 条子集），用于后续 bake-off 安全隔离测试。**未新增任何安全规则、未改动 inputGuard、未改动 msgSecCheck。**

### 0.3 冻结资产（审计起点，记为基线）
| 文件 | SHA256 | 状态 |
|---|---|---|
| corpus.json | `db01fbc92064cbea3a6688a98160b6a70c9e150259b54063c8e2e96974eabc8b` | 未修改 |
| intent.js | `765ad138ec68c0f159c6f75a60e5268beb02fba152f6d53dbdc539ba1560ca38` | 未修改 |
| rag.js | `5b380b3f7c68f374e3d4e5127bd7dbeff747849401ca9d0488498dece1408286` | 未修改 |
| knowledgeRouter.js | `848908445dbb5ea93a6f52775dc3c8e6922ff971d6cee115547f236ffed0a935` | 未修改 |

> 结论：**No production asset modification**。

---

## 1. 新增文件列表

| 文件 | 类型 | 说明 |
|---|---|---|
| `weapp/search/test/fixtures.json` | 测试资产（JSON） | Phase S-0.3 Provider bake-off 标准测试集（22,204 bytes） |

> 本任务**仅新增上述一个文件**。未创建任何运行时代码、未改动生产代码、未写入生产数据库、未部署、未 commit/push。

---

## 2. Fixture 数量统计

| 类别 | 要求 | 实际 | 结果 |
|---|---|---|---|
| FACT（事实检索类） | 30 | 30 | ✅ |
| FRESHNESS（时效信息类） | 30 | 30 | ✅ |
| **合计** | **60** | **60** | ✅ |

- ID 范围：`F-FACT-001`~`F-FACT-030`、`F-FRESH-001`~`F-FRESH-030`。
- ID 唯一性：60/60 唯一，无重复（脚本校验 `duplicates: []`）。
- 排序稳定性：`ids == sorted(ids)` → True（FACT 段在前、FRESHNESS 段在后，安全子集内嵌于末段）。

---

## 3. 分类统计（领域覆盖）

| 领域 | 数量 | 覆盖 |
|---|---|---|
| 科技 | 14 | ✅ |
| 社会 | 13 | ✅ |
| 文化 | 10 | ✅ |
| 历史 | 7 | ✅ |
| 时效事件 | 6 | ✅ |
| 哲学 | 6 | ✅ |
| 常识 | 4 | ✅ |
| **合计** | **60** | 7/7 领域全覆盖 |

> 满足任务要求：覆盖 科技 / 文化 / 哲学 / 历史 / 社会 / 常识 / 时效事件。

### 3.1 安全子集（复用 T-1 / T-4 引用标签）
| security_case | 数量 | Fixture ID |
|---|---|---|
| T-1（Prompt Injection，检索回毒化网页） | 5 | F-FACT-026、F-FACT-027、F-FACT-030、F-FRESH-026、F-FRESH-030 |
| T-4（Malicious Web Content，违规网页） | 5 | F-FACT-028、F-FACT-029、F-FRESH-027、F-FRESH-028、F-FRESH-029 |
| **小计** | **10** | 均为良性用户查询，bake-off 中由测试台配对 S-0.3 T-1/T-4 脱敏 Raw Evidence |

---

## 4. 字段规范检查

### 4.1 顶层结构
```json
{
  "version": "S-0.3-v1",
  "created_by": "Search QA Engineer",
  "purpose": "Provider bake-off fixture dataset",
  "production_data": false,
  "notes": "...",
  "cases": [ ... ]
}
```
- `version` / `created_by` / `purpose` / `production_data` 齐全，`production_data=false`（本任务纯测试资产，不含任何生产/用户数据）。

### 4.2 每条 case 字段
| 字段 | 要求 | 校验结果 |
|---|---|---|
| id | 唯一、稳定 | ✅ 60 唯一 |
| type | FACT / FRESHNESS | ✅ 取值合法 |
| category | 领域枚举 | ✅ 落在 7 领域 |
| query | 真实用户可能提出、非随机串 | ✅ 人工设计、可复现 |
| expected_behavior | 明确测试目的 | ✅ 每条含断言语义 |
| evidence_required | true | ✅ 60/60 = true |
| security_level | "normal" | ✅ 全量 normal |
| security_case（仅子集） | T-1 / T-4 | ✅ 10 条带此元数据 |

- 字段统一：所有 60 条均含 7 个基础字段；`security_case` 仅作为叠加元数据出现在 10 条安全子集上（不破坏基础 schema）。

---

## 5. 质量检查结果

| 检查项 | 方法 | 结果 |
|---|---|---|
| JSON 可解析 | `json.load` | ✅ OK |
| 数量 FACT=30 | 计数 | ✅ |
| 数量 FRESHNESS=30 | 计数 | ✅ |
| ID 唯一 | Counter 去重 | ✅ 无重复 |
| 字段完整 | 字段子集校验 | ✅ 无缺失 |
| 排序稳定 | `ids == sorted(ids)` | ✅ |
| 查询真实性 | 人工评审 | ✅ 均为合理用户提问 |
| 领域覆盖 | 计数分布 | ✅ 7/7 |
| 安全子集合规 | 仅引用 T-1/T-4 标签 | ✅ 未新增规则 |
| 内容红线 | 人工评审 | ✅ 无政治敏感扩展、无个人隐私、无违法内容、无极端攻击样本 |

> 安全子集说明：T-1/T-4 的 fixture 本身均为**良性用户查询**（如“免费 PDF 转换工具推荐”“网上彩票预测软件靠谱吗”），仅在 bake-off 执行时由测试台配对 S-0.3 已定义的**脱敏** Raw Evidence（毒化/违规网页片段），验证 Security Layer 隔离/拦截。符合 S-0.3 脱敏与 S0.5 §D 复用约定。

---

## 6. 冻结资产检查结果

| 文件 | 起点 SHA | 终点 SHA（复校） | 一致 |
|---|---|---|---|
| corpus.json | `db01fbc9…eabc8b` | `db01fbc9…eabc8b` | ✅ |
| intent.js | `765ad138…60ca38` | `765ad138…60ca38` | ✅ |
| rag.js | `5b380b3f…8286` | `5b380b3f…8286` | ✅ |
| knowledgeRouter.js | `84890844…d0a935` | `84890844…d0a935` | ✅ |

- 复校脚本：`sha256sum corpus.json intent.js rag.js knowledgeRouter.js`（路径 `weapp/cloudfunctions/chat/`）。
- 结论：四资产字节级与 O-0.6 基线完全一致，**本任务零生产资产改动**。

### 6.1 git 状态说明（透明度）
- 本任务**仅新增** `weapp/search/`（即 `fixtures.json`）。
- `git status` 中 `corpus.json` / `rag.js` 等显示的 `M` 与 `git diff --stat` 差量为 **Phase G / CR-002 遗留未提交内容**（项目记忆已载明），**非本任务引入**。
- 权威完整性以 SHA256 字节比对为准（上文 6 表），与 git 工作树历史标记无关。

---

## 7. 生产影响评估

| 维度 | 评估 |
|---|---|
| 生产代码 | 未触碰 `index.js` / `rag.js` / `knowledgeRouter.js` / `intent.js` / `corpus.json` / Prompt |
| RAG 流程 | 未改动，未 embedding / ingest / 知识库更新 |
| Search Provider | 未接入、未调用任何外部 API |
| 云函数 / 部署 | 未创建、未部署 |
| 生产数据库 | 未写入 |
| 版本控制 | 未 commit / push（按任务约束） |
| 安全逻辑 | 未扩展；仅引用既有 T-1/T-4 标签作测试元数据 |

> **总体结论**：本任务为纯离线测试资产建设，对生产系统**零影响、零风险**。

---

## 8. 后续入口（等待人工指令）

本资产已就绪，但**不**自动进入下一阶段：
- ❌ 不进入 S0.5 Bake-off（需人工签核 4 项授权）
- ❌ 不调用 Provider
- ❌ 不接入 Search
- ❌ 不启动 S1 开发

建议下一步（人工择一）：
1. 审阅本数据集，批准进入 S0.5 Bake-off 安全隔离测试（使用 10 条 `security_case` 子集）。
2. 将 `fixtures.json` 作为 S1-T10 的正式回归集基线（SELECT 子集或全量）。
3. 补充领域权重或调整安全子集比例（如需）。

---

## 最终状态

# ✅ READY FOR HUMAN REVIEW

*Phase S-0.3 Fixture 实体化完成。交付 `weapp/search/test/fixtures.json`（60 条，30 FACT + 30 FRESHNESS，10 条 T-1/T-4 安全子集）。冻结资产字节级未变，生产零影响。*
