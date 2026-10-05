# Phase Q 产品完成报告 — Freshness Layer 热点思辨模式
> 日期：2026-08-05 ｜ 范围：Q1 架构落地 + Q1.5 离线验证（Q2 产品接入待部署条件，Q3 生产观察未启动）
> 治理记录：Phase P+ 观察期 Gate 原为 BLOCKED（N=37<50），本次经**人工明确要求**豁免重启，特此留痕。

---

## 1. 交付总结

WenDao 现已具备完整的热点思辨能力链路（代码落地、离线验证通过）：

**用户输入现实事件 → 四分类判定（A/B/C/D）→ Event Boundary Check 三级闸门 → 事实获取与 Fact/Interpretation 隔离 → event_context（带 TTL）→ 五段式思辨回答；任何环节不满足政策即诚实降级，绝不编造。**

冻结基线：O-0.6 四资产 SHA256 复核通过（改动前后均一致），零改动。

## 2. 新增文件（11 个）

| 文件 | 说明 |
|------|------|
| `cloudfunctions/chat/freshness/schema.js` | event_context 结构 + 强制校验（unknown_points 必填等硬规则） |
| `cloudfunctions/chat/freshness/eventClassifier.js` | Category A/B/C/D 分类 + user_intent_layer |
| `cloudfunctions/chat/freshness/boundaryCheck.js` | normal/sensitive/restricted 安全闸 + 留痕 |
| `cloudfunctions/chat/freshness/eventRetriever.js` | 检索源抽象（provider none/http）+ Node16 nodeFetch |
| `cloudfunctions/chat/freshness/factExtractor.js` | 事实抽取 + 观点/不确定/冲突隔离 |
| `cloudfunctions/chat/freshness/contextBuilder.js` | event_context 状态机构建 + TTL |
| `cloudfunctions/chat/freshness/downgrade.js` | 降级三动作（emotion 优先变体） |
| `cloudfunctions/chat/freshness/responder.js` | 五段式生成 + 护栏注入 + guardOutput 硬检 |
| `cloudfunctions/chat/freshness/index.js` | 编排器（maybeHandle） |
| `scripts/gen_freshness_dataset.js` + `scripts/freshness_eval_dataset.json` | 评测集：A/B/C/D 各 30 + 对抗 40 |
| `scripts/test_freshness.js` | 离线测试 32 项 |
| `docs/PhaseQ1-Freshness-Architecture.md` / `docs/PhaseQ-GoldenCases.md` / 本文档 | 架构 / 基准回答 / 完成报告 |

## 3. 修改文件（2 个，均已备份基线）

| 文件 | 改动 | 基线备份 |
|------|------|---------|
| `cloudfunctions/chat/index.js` | 插入 freshness 旁路调用（`FRESHNESS_ENABLED` 开关，默认关）；异常/返回 null 直落原链路 | `scripts/baseline-o0.6/chat-index.js.o06.bak` |
| `cloudfunctions/chat/observability/observabilityLogger.js` | 观测记录增量 `freshness` 字段（非热点路径恒 null） | `scripts/baseline-o0.6/observabilityLogger.js.o06.bak` |

备份 SHA256 见 `scripts/baseline-o0.6/SHA256SUMS.txt`。

## 4. 测试结果

**Freshness 离线测试（test_freshness.js）：32/32 通过**
- 四分类准确率：**100%（120/120）**，A 类零误判（Freshness 绝不误入纯哲学问题）
- Boundary Check：三级判定、留痕字段、空描述从严，全通过
- Fact/Interpretation 隔离：schema 校验（unknown 必填 / unverified 禁事实）、观点句不入事实层、事实句必带来源，全通过
- 输出硬检：归因断定 / 站队裁决 / 缺未知承认均拦截，合规回答放行
- 降级：三动作映射 + emotion 优先承接，全通过
- 对抗样本 40 条：诱导编造 / 诱导站队 / 模糊指代分类层检查全通过
- 端到端（provider=none + 无模型）：B 诚实降级、A 直落原链路、D 安全降级、C 边界+邀请，全通过

**回归**：Phase E-v2 既有测试 20/21（1 项失败为 O-0.6 基线自带，与本次改动无关——rag.js SHA256 未变可证）。全部新文件语法检查通过。

## 5. 回滚方案（三级）

1. **一级（秒级，推荐）**：云函数环境变量 `FRESHNESS_ENABLED` 置为非 `true` 或不设置 → freshness 模块完全不加载，零行为变化。
2. **二级（文件级）**：用 `scripts/baseline-o0.6/` 两份备份覆盖 `chat/index.js` 与 `observability/observabilityLogger.js`，重新部署；`freshness/` 目录可整体摘除。
3. **三级（完全摘除）**：二级 + 删除 `freshness/` 目录。冻结四资产从未被改动，无需回滚。

## 6. 风险项

| 风险 | 等级 | 缓解 |
|------|------|------|
| 生产无检索源，B 类暂全部降级 | 已知/设计行为 | provider=none 即诚实降级；Q2 选型真实合规检索源为准入门槛 |
| 规则分类器对未见句式误判 | 中 | 误判方向恒保守（更严等级/降级）；observability 回收真实分布后迭代 |
| LLM 输出质量未实测 | 中 | guardOutput 硬检兜底（违规拒答）；Q2 灰度用 Golden Cases 回归 |
| 部署依赖手动（SCF 端点沙箱不可达） | 流程 | 见第 7 节部署清单 |
| Phase E-v2 既有 1 项失败 | 低/遗留 | 与本次无关，建议列入后续技术债 |

## 7. 部署清单（手动，微信开发者工具）

1. chat 云函数 → 右键「上传并部署：云端安装依赖（不上传 node_modules）」。
2. （启用时）云函数环境变量配置 `FRESHNESS_ENABLED=true`；检索源选型后再配 `FRESHNESS_SEARCH_*`。
3. 验证：先不配检索源上线——预期 B 类全部走诚实降级，观察 `observability_logs.freshness` 字段落库正常。

## 8. 下一阶段计划（Phase Q2 准入条件）

1. **检索源选型**：合规、稳定、带来源 URL 的中文检索 API（政策门槛：可核实、可署名）。
2. **灰度策略**：白名单 openid 或小比例流量；经典路径始终 fallback。
3. **Golden Cases 回归**：docs/PhaseQ-GoldenCases.md 12 案逐版本过审。
4. **观测指标**：freshness 路径占比、降级率分布、guard 拦截率、grounded 率。
5. **Q3 生产观察**：接地准确率 + 用户价值 + 零合规事故 → 受控升级 O-0.7 重基线。

---

> 本报告对应工作全程未触碰冻结资产、未 ingest / embedding / commit / 发布。
