# 08 · 开发历史（History）

> **刷新于 2026-08-07（终校至 Q2-15）**：补全 Freshness/联网搜索全链路 Phase（Q2-4 → Q2-15）。详细记录见 `.workbuddy/memory/2026-08-07.md` 与各 `docs/Phase-Q2-*.md`。

## Phase 时间线

| Phase | 目标 | 结果 | 关键遗留 |
|-------|------|------|---------|
| **A–E** | 会话/RAG/Intent/通用架构 | ✅ | — |
| **F** | 百问验证 | ✅ 冻结基线 `v0.6.1-mvp` | 结构不动 |
| **G** | RAG 召回优化 | ⏸ 未提交 | question_bridge 未读取 |
| **H / H-2** | 离线/真实验收 | ✅/⏸沙箱无凭证 | 真实 100 题待跑 |
| **R** | Capability 实时能力（时间/天气） | ✅ 已上线（首验 3/3） | R2 天气 BLOCKED（位置隐私） |
| **Q1-B** | 反幻觉冷降级 | ✅ 已验收（31/31+32/32） | 未部署（后随 Freshness 一并上线） |
| **Q2-0** | Fast/Deep/Think 三模式架构 | ✅ DESIGN FROZEN（4 文档，零代码） | — |
| **Q2-4-B/C/D** | Freshness 安全层（canary/privacy/audit/compliance） | ✅ 设计+测试全绿 | 未部署 |
| **Q2-5-A/B** | 国内搜索源评估（SearXNG→domesticFreeSearch） | ✅ | 后弃用 SearXNG |
| **Q2-6-MVP** | 在线激活准备 + 隔离守卫 | ✅（31 PASS） | 未部署 |
| **Q2-7 / Q2-8-MVP** | L2 灰度 + 激活准备 | ✅（217 PASS） | 未部署 |
| **Q2-9** | SearXNG 国内部署计划 | 📋 PLAN（用户选自部署） | 后改通用适配器 |
| **Q2-10** | provider-agnostic 适配器 | ✅（225 PASS） | 弃 domesticFreeSearch |
| **Q2-11** | 选型评估 | 推荐腾讯云 WSA（32 分） | — |
| **Q2-12** | 腾讯云 WSA adapter | ✅（104 PASS） | — |
| **Q2-13** | Qwen/百炼 adapter（只取 search_results） | ✅（124 PASS） | — |
| **Q2-14** | **联网搜索上线激活（部署）** | ✅ 已部署 | 用户须配 model_config |
| **Q2-14（bug）** | freshness 短路 + canary provider 缺失 | ✅ 修复重部署 | — |
| **Q2-14-b** | 分类器路由修复（B 类触发搜索） | ✅ 修复重部署 | — |
| **Q2-15** | 传记幻觉防护（付航案） | ✅ 已部署（36 PASS） | — |

## 关键变更与 CR

| 项 | 状态 | 说明 |
|----|------|------|
| **CR-002 + Hotfix#004** | ✅ 已部署 | `SEC_DEGRADE_ON_API_ERROR` 默认 true=降级放行；msgSecCheck 真根因 `-501001/-40003` 仍 0% 可用（**OPEN**） |
| **CR-009** | ❌ VOID | logs 从未失效，`find+limit` 误判，未改码 |
| **Q2-14 部署** | ✅ | `tcb fn deploy chat --force`；env 激活（FRESHNESS_ENABLED/FACTUAL=true, SEARCH_PROVIDER=qwen, PRIVACY_GATE=true, SEARCH_CANARY_ENABLED=true, OPENIDS=ADMIN_OPENID） |
| **Q2-14-b 修复** | ✅ | `freshness/index.js:176` 改用 `searchLayer.getProviderName()`；`canaryGate.isRealProvider` 补 qwen/tencent |
| **Q2-15 防护** | ✅ | `eventClassifier` 人物身份→B；`downgrade.PERSON_IDENTITY_TEMPLATES`；`responder.BIOGRAPHY_HALLUCINATION_RES` + `guardOutput` |

## 当前激活 env（已部署，2026-08-07）

```
FRESHNESS_ENABLED=true
FRESHNESS_FACTUAL_ENABLED=true
SEARCH_PROVIDER=qwen
PRIVACY_GATE_ENABLED=true
SEARCH_CANARY_ENABLED=true
SEARCH_CANARY_OPENIDS=<ADMIN_OPENID>   # 仅管理员真实搜索，其余 mock/RAG
SEARCH_MAX_RESULTS=5
SEARCH_TIMEOUT_MS=3000
SEARCH_DAILY_QUOTA=500
KNOWLEDGE_OBSERVABILITY_STORE=cloud
```

## 关键版本号

- `v0.6.1-mvp`（Phase F 冻结基线）、`v0.9.2-prelaunch`、`v0.9.3-hotfix`
- 当前以 **Phase 标记**（Q2-15），无新语义版本号

## 未提交改动（工作区）

- Phase G：corpus.json 扩 tags + frameTitles 改值（离线预测 84.7%→50.7%）
- Q2-4…Q2-13 设计/适配器代码（多数已随 Q2-14 部署，但**按惯例未 commit**，留用户）
- 冻结资产（corpus.json/intent.js/rag.js/knowledgeRouter.js）SHA 4/4 不变

> 规则：不擅自 commit。冻结资产改动须以 SHA256 比对。
