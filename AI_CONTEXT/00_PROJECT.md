# 00 · 项目简介（Project）

> 本文件是 AI_CONTEXT 入口索引的第一篇。任何新接手本项目的 AI，应先读 `README_AI.md`，再按图索骥读下列文档。
> **刷新于 2026-08-07（终校至 Q2-15）**。

## 项目身份

| 项 | 值 |
|----|----|
| 项目名称 | **向晚问思**（曾用名「问道」） |
| 产品定位 | AI 思辨助手：以经典哲学/文学/心理学，帮用户**理解问题、形成判断**，但**不替用户做决定** |
| 目标用户 | 想认真想清楚一件事的人（学生 / 职场人 / 创作者 / 内省者） |
| 产品目标 | 让「经典」成为思考的跳板，而非标准答案 |
| 当前阶段 | **Q2-15**（传记幻觉防护已部署）；联网搜索已上线（Q2-14 部署） |
| 项目现状 | 微信云开发小程序，**备案审核中**（非商用-办公） |
| APPID | `wx2653f12589f9f89f`（旧文档 `…f9d89f` 为笔误，第 15 位应为 `f`） |
| 云环境 ID | `YOUR_CLOUD_ENV_ID` |
| openid 样例（管理员） | `YOUR_ADMIN_OPENID` |

## 第一原则（产品）

**先做人，再引经**——回答固定五段（理解 → 分析 → 行动 → 经典 → 思考）；经典是启发不是答案；严格分离原文与 AI 解读。

## 四模式 + 三层能力（2026-08 定型）

`chat/index.js` 按用户选择的 `mode` 与问题性质派发：

| 模式 | 含义 | 检索策略 |
|------|------|---------|
| **Fast🌐** | 快答（联网优先） | Search（关 RAG）；无源则派发器回退 RAG |
| **Deep📚** | 深读（经典优先） | RAG only |
| **Think🌅** | 思辨（融合） | Search + RAG + Reasoning |

能力层（与模式正交）：

| 能力层 | 职责 | 是否走 RAG/搜索 |
|--------|------|----------------|
| **Capability** | 确定性实时事实（时间/天气等） | 否，绕过 RAG，直接实时取数 |
| **Freshness** | 事件背景 / 需联网的时效内容 | 走 `providers/search/`（在线搜索，受护栏管控） |
| **Knowledge** | 经典思辨 | 走 corpus.json + RAG |

> **硬约束**：实时能力**永不**进 corpus / embedding / 靠 Prompt 生成事实；联网搜索结果**只作 runtime context**，不进 corpus/embedding/metadata/长期缓存（见 `freshnessRuntimeGuard.js`）。

## 一句话介绍

> 一个用经典帮你想清楚的 AI 思辨小程序；实时事实走能力层、时效内容走 Freshness 在线搜索、经典思辨走 Knowledge RAG。

## 本目录导航

```
AI_CONTEXT/
├── 00_PROJECT.md        ← 你在这
├── 01_ARCHITECTURE.md  # 系统架构 + Mermaid（含 Freshness/Think/providers 护栏链）
├── 02_BUSINESS.md       # 业务流程 / 页面职责
├── 03_CODE_STRUCTURE.md # 代码结构（含 providers/freshness/think/security/observability）
├── 04_DATABASE.md       # 数据库集合（含 observability_logs 与冲突标注）
├── 05_RAG.md            # Knowledge 轨道 + Freshness 在线搜索
├── 06_PROMPT.md         # 全部 Prompt 汇总
├── 07_KNOWLEDGE.md      # 知识资产（37 经典 + 冻结 SHA256）
├── 08_HISTORY.md        # 开发史 Phase A→…→Q2-15
├── 09_TEST.md           # 测试覆盖（q24c…q33）
├── 10_RULES.md          # 当前开发原则（冻结/部署/护栏/观测纪律）
├── 11_TODO.md           # 下一阶段任务（model_config 配置等）
├── README_AI.md         # AI 入口
└── PROJECT_MAP.md       # 一张图（Mermaid）
```

**阅读顺序建议**：README_AI.md → 00 → 01 → 02 → 03 → 04 → 05 → 06 → 07 → 08 → 09 → 10 → 11 → PROJECT_MAP
