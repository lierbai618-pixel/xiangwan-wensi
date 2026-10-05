# README_AI.md · AI 入口（Entry Point）

> **任何新接手本项目的 AI，第一件事必须读这个文件。**
>
> **📅 文档刷新于 2026-08-07（终校至 Q2-15）**：已校准至当前真实状态——**联网搜索已部署上线（Q2-14）、分类器路由修复（Q2-14-b）、传记幻觉防护（Q2-15）**。若本文与代码或 `.workbuddy/memory/2026-08-07.md` 冲突，**以代码与当日日志为准**（代码为真实来源）。

## 5 分钟上手流程

```
1. 读本文（README_AI.md）            ← 你在这
2. 读 00_PROJECT.md                  ← 身份/版本/APPID/四模式+三层能力
3. 读 01_ARCHITECTURE.md             ← 架构 + Mermaid（含 Freshness/Think/providers 护栏链）
4. 读 02_BUSINESS.md                 ← 页面职责
5. 读 03_CODE_STRUCTURE.md           ← 目录/模块（含 providers/freshness/think/security/observability）
6. 读 04_DATABASE.md                 ← 集合（含 observability_logs 与冲突标注）
7. 读 05_RAG.md                       ← Knowledge 轨道 + Freshness 在线搜索
8. 读 06_PROMPT.md                    ← Prompt 索引
9. 读 07_KNOWLEDGE.md                ← 37 经典 + 冻结基线 SHA256
10. 读 08_HISTORY.md                  ← Phase A→H-2→R→Q1-B→Q2-0→Q2-4…Q2-15
11. 读 09_TEST.md                     ← 测试覆盖（q24c…q33）
12. 读 10_RULES.md                    ← 当前开发原则（冻结纪律/部署纪律/护栏/观测纪律）
13. 读 11_TODO.md                     ← 下一阶段任务（model_config 配置等真实阻塞）
14. 读 PROJECT_MAP.md                 ← 一张图
```

## 读完应输出（接手 AI 的理解）

1. **项目理解**：向晚问思 = AI 思辨助手，经典是启发不是答案；五段式「先做人再引经」不可破坏；联网搜索只为补实时/事实，不替经典。
2. **当前架构**：`chat/index.js` 派发 **四模式**（Fast🌐/Deep📚/Think🌅）+ **三层能力**（Capability 实时事实 / Freshness 在线搜索 / Knowledge 经典 RAG）；搜索走 `providers/search/` 护栏链（privacy→canary→quota→provider→audit），`data_route=domestic` 零跨境。
3. **当前阶段**：**Q2-15**（传记幻觉防护已部署）；联网搜索 **已上线**（Q2-14 部署），当前真实阻塞 = 用户须在云库 `model_config` 配好百炼模型（支持 enable_search），否则 `no_endpoint`→诚实降级（行为正确，只是无源可搜）。
4. **主要模块**：chat（index/rag/intent/knowledgeRouter/freshness/think/providers/security/observability）、capabilities（实时能力）、history/ingest/feedback/admin/login。
5. **风险**：① 命名冲突 4 处（已标注待确认）② msgSecCheck 真根因 `-501001/-40003` 仍 0% 可用（OPEN）③ 联网需 model_config 配置才生效 ④ 四冻结资产 SHA 守门（corpus.json/intent.js/rag.js/knowledgeRouter.js）。
6. **开发任务**：当前阶段早已越过"仅文档不写码"旧红线；真实约束是**冻结资产不可改 + 部署前必读 cloudbaserc.json + 护栏链路不被破坏 + 观测取数纪律**。

## 守则

- 代码为真实来源，文档仅解释；冲突指出，不猜测，等确认（除非用户明确授权修改）。
- 冻结资产（corpus.json / intent.js / rag.js / knowledgeRouter.js）改动须以 SHA256 比对，漂移即违规。
- 所有云函数改动须重新部署才生效；部署前必读 `cloudbaserc.json`，避免环境变量被静默覆盖。
- 不替用户做决定；先做人再引经；内容安全（msgSecCheck）先跑；联网结果只作 runtime context，不进 corpus/embedding/长期缓存。
