# 06 · 全部 Prompt（Prompts）

> 本项目所有 Prompt 均集中在 `cloudfunctions/chat/` 与各前端页面。以下为职责汇总，未改动任何文件。
> **刷新于 2026-08-07（终校至 Q2-15）**：位置说明与 Q1-B/Q2-15 状态对齐。

## Prompt 清单

| Prompt | 位置 | 职责 |
|--------|------|------|
| **Role Prompt** | `rag.js` 顶部常量（❄️冻结） | 定义 AI 身份：「先做人再引经」的思辨助手 |
| **System Prompt** | `rag.composeSystem()`（❄️冻结） | 五段式输出契约（理解→分析→行动→经典→思考） |
| **Safety Prompt** | `chat/index.js` msgSecCheck 前后 | 违规文本不进 LLM；危机/情绪优先提示 |
| **History Prompt** | `rag.buildPriorMessages()`（❄️冻结） | 拼接最近 10 轮上下文（≤20 条） |
| **Citation Prompt** | 前端引用卡 + system 里的经典字段 | 带 `source` 出处，可跳书库 |
| **WenDao 反思增强** | Phase Q1-B 冷降级路径 | 无事实源时不编造，走反思式引导 |
| **Freshness 护栏指令** | `freshness/responder.js` `buildFreshnessGuardrails()` | 对 B+无底座注入「严格禁止断言学历/院校/出生日期」等（Q2-15） |
| **降级文案** | `freshness/downgrade.js` | 含 `PERSON_IDENTITY_TEMPLATES`（Q2-15 传记专用诚实降级） |

## 输出契约（不可破坏）

```
理解：……（用户问题重述）
分析：……（拆解关键点）
行动：……（下一步可做）
经典：《xxx·y》（原文 + 解读）
思考：……（留白给用户自己判断）
```

## 禁止情形（Phase H / Q1-B / Q2-15 规则）

- 不得在 skip 路径出现《》
- 不得为空检索编造经典
- 不得为引经而引经强行塞《》
- 不得破坏五段式顺序
- 冷降级场景不得编造事实（Q1-B 反幻觉硬闸）
- 传记/身份问法无可靠来源时，不得断言学历/院校/出生日期/职业履历（Q2-15 `BIOGRAPHY_HALLUCINATION_RES`）

## 注意

上述 Prompt 文本**不在此文档全文展开**（避免冗长），其结构与职责以 `rag.js` / `chat/index.js` / `freshness/*` / 前端引用组件为真实来源。本文件仅作索引与职责说明。
