# 02 · 业务逻辑（Business Flow）

> **刷新于 2026-08-07（终校至 Q2-15）**：补充四模式、Freshness 在线搜索、传记幻觉防护。

## 用户完整使用路径

```
首页(home) ──进入──▶ 对话(chat) ──查看──▶ 历史(history/sessions)
     │                    │ 引经/联网       │ 会话列表
     │                    ▼                ▼
  说明(about) ◀──产品介绍  引用卡(Citation)   反馈(feedback)
                                   │
                                   ▼
                              后台(admin) ──管理员──▶ 模型/日志管理
```

## 每个页面负责什么

| 页面 | 路径 | 职责 |
|------|------|------|
| 首页 | `miniprogram/pages/home/` | 落地页 / 产品入口 / 导航到对话 / **四模式选择**（Fast🌐/Deep📚/Think🌅） |
| 对话 | `miniprogram/pages/chat/` | 输入框 → 调 chat 云函数 → 渲染回答；隐私浮层（首次进入未同意时弹出）；引用卡展示经典出处；联网结果标注来源 |
| 说明 | `miniprogram/pages/about/` | 产品理念、使用说明、跳转隐私协议 |
| 书库 | `miniprogram/pages/books/` | 经典书库浏览（corpus.json 的 37 部经典） |
| 后台 | `miniprogram/pages/admin/` | 管理员：模型配置 CRUD、question_logs / answer_quality_log 查看 |
| 隐私 | `miniprogram/pages/privacy/` | 《隐私政策》《用户协议》全文页 |
| 会话 | `miniprogram/pages/sessions/` | 当前用户会话列表（conversations 集合） |

## 核心业务规则

1. **不替用户做决定**：AI 给启发（经典原文 + 解读 + 联网事实），用户自己判断
2. **先做人再引经**：回答五段式（理解→分析→行动→经典→思考）契约不可破坏
3. **内容安全**：chat 云函数先跑 `msgSecCheck`，违规文本不进 LLM
4. **会话隔离**：每个 openid 的会话独立存于 `conversations` 集合
5. **引用可追溯**：每处经典引用带 `source`（如《论语·学而》），可点击跳书库
6. **三层能力分流**：
   - 确定性实时事实（时间/天气）→ Capability，绕过 RAG/搜索
   - 事件背景/时效内容 → Freshness 在线搜索（受护栏管控，`data_route=domestic`）
   - 经典思辨 → Knowledge RAG
   - 实时能力/联网结果**永不**进 corpus / embedding / 靠 Prompt 生成事实
7. **反幻觉硬闸**：
   - 冷降级（无事实源）→ WenDao 反思增强，不编造（Q1-B）
   - 传记身份问法（"XX是谁"）→ 触发联网核实，无源则诚实降级，绝不编造学历/院校/出生（Q2-15）
8. **联网搜索事实隔离**：搜索结果只作 runtime context，不进 corpus/embedding/长期缓存（见 `freshnessRuntimeGuard.js`）
