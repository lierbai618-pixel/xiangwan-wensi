# Phase T (Hybrid Intelligence) 执行计划 — 决策记录与阶段重映射

报告编号：HIA-T-PLAN-001 ｜ 生成于 2026-08-06 ｜ 依赖：HIA-Q0-001 (Phase Q0 架构审计)

## 0. 背景
Phase Q0 架构审计（HIA-Q0-001）完成，发现升级计划书 v1.0 存在 2 处 P0 冲突（HQ-001 编号冲突、HQ-002 禁改清单与升级目标互斥）与 4 处前提失真。审计结论为「Q0 PASS（有条件）」，需 HD-1~HD-5 五项人工裁决后方可进入设计阶段。

本文件记录五项裁决结果，将原 Q0~Q8 重映射为 Phase T0~T8，关闭审计门并给出即时下一步。

## 1. HD 裁决记录（2026-08-06）
| 编号 | 议题 | 裁决 | 依据 |
|------|------|------|------|
| HD-1 | Phase 编号 Q vs T | **改 Phase T** | HQ-001 P0：Phase Q 已被 Freshness 占用，复用造成文档与代码注释永久歧义 |
| HD-2 | 冻结禁令是否放宽 | **走 CR 逐项授权** | HQ-002 P0：Q1/Q4/Q5 必然触碰 corpus/intent/rag/knowledgeRouter，须以 CR 单资产授权 + 回滚 |
| HD-3 | Q2 是否合并进 Phase S | **合并** | HQ-003 P1：Phase S 已有 79KB+ Search 设计，卡点是 S0.5 选型授权而非设计缺失 |
| HD-4 | Q4 是否合并进 PQRA-001 | **合并** | HQ-004 P1：PQRA D-1~D-6 已审计完，卡点是产品/隐私裁决而非技术缺失 |
| HD-5 | PQ-002 skip 幻觉盲区是否优先 | **先做 T-0** | 改动最小、止血价值最高、不依赖数据建设 |

## 2. 阶段重映射（Q → T）
| 原计划 | Phase T | 内容 | 备注 |
|--------|---------|------|------|
| Q0 | T0 | 架构审计 | ✅ 已完成（HIA-Q0-001） |
| — | T-0 | skip 分支反幻觉护栏（PQ-002） | 新增优先项，独立 CR-008 |
| Q1 | T1 | Unified Query Classification Contract | 统一现有 4 分类器，不造第 5 个；需 CR 授权 |
| Q2 | （并入 S0.5） | Web Search Layer | 不新建，推动 Phase S 选型授权 |
| Q3 | T3 | 知识生命周期 metadata（TTL/confidence） | corpus 生命周期隔离 |
| Q4 | （并入 PQRA/CR-008） | 人物实体能力 | 先答 D-1~D-6，再 CR-008 实施 |
| Q5 | T5 | 回答格式补契约 | 工作量远小于原预估 |
| Q6 | T6 | 开发实施 | 受 CR 门控 |
| Q7 | T7 | 测试（叠加既有 184 条回归） | HQ-006：声明叠加非替换 |
| Q8 | T8 | 灰度上线 | 用 feature flag `*_ENABLED`；HQ-005 已澄清机制 |

## 3. 冻结与 CR 政策（落实 HD-2）
- 四冻结资产（corpus.json / intent.js / rag.js / knowledgeRouter.js）在未经 CR 批准前保持零改动。
- 任一触碰动作 = 一个新 CR，含：改动 diff、风险、回滚（恢复至 O-0.6 SHA256）、测试、部署前置（IDE 手动上传）、验收。
- 已占编号：CR-002#004（冻结基线，观察期）、CR-005/006/007（PROPOSED/BACKLOG）。T-0 使用 **CR-008**。

## 4. 即时下一步
1. **T-0 设计 + CR-008 提案**（本批产出 `docs/CR-008-SkipBranchAntiHallucination.md`）→ 待人工批准部署。
2. **T1 设计**：起草 Unified Query Classification Contract（不新增分类器，统一 intent / capability / freshness / knowledgeRouter 的契约）→ CR 授权。
3. **并行推动** S0.5 选型授权（HD-3）与 PQRA D-1~D-6 裁决（HD-4）。

## 5. 状态
Q0 ✅｜HD 全裁决 ✅｜T-0 设计进行中（CR-008 提案已出）｜T1~T8 待 CR / 裁决授权。
