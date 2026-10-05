# Phase D 计划与交付（MVP 闭环）

> 阶段目标：把「问道」从一个后端能力，变成用户可真正使用的产品闭环——
> **问一个人生问题 → 像有深厚阅读积累的老师一样回答 → 告诉依据在哪里**。
> 品牌名经评审确定为 **「问道」**。本阶段交付 D-1（体验层）+ D-2（人格层）+ D-3（数据闭环）全套。

---

## 0. 关键决策（评审通过）

| 项 | 决定 |
|---|---|
| 品牌名 | **问道**（用户从 知行/明道/思源/问道/哲思 中选定） |
| 交付范围 | D-1 + D-2 + D-3 全套 |
| schema 冻结 | 进入 Phase D 后 `knowledge/` 与 `corpus.json` 字段不再频繁增加，维持 C-3 终版 |
| 边界 | 不纳入任何政治敏感著作；知识来源限定 10 本公版经典 |

---

## D-1 用户体验层（已交付）

### 1. 全面 rebrand（关键前置）
Phase B/C 只改了后端 prompt 与知识库，**前端界面从未重新品牌化**，残留「同志你好 / 《毛泽东著作》学习助手 / 主要矛盾 / 调查研究 / 持久战」等旧敏感文案。
D-1 已彻底清理：

| 文件 | 改动 |
|---|---|
| `app.json` | 标题「问道」；tabBar 改为 **首页 / 对话 / 说明**（首页文字态，对话/说明沿用原图标） |
| `pages/chat/chat.js` | `topics` 8 条改为映射到 10 本经典的人生问题；`starter` 问候改为「问道」；`onShareAppMessage` 改标题 |
| `pages/chat/chat.wxml` | 品牌「问道 / 经典思辨助手」；引用区「查看依据来源」→「查看思想来源」，展示《书名》· 篇章 |
| `pages/about/*` | hero / mission / 资料范围 全部去毛选化，列出 10 本经典；「每日一句」→「每日思考」 |
| `pages/privacy/*` | 隐私政策与用户协议正文去毛选化，改写为「问道」思辨助手 |
| `cloudfunctions/chat/rag.js` | 清理 `frameTitles`/`sourcePriority`/`methodSummary`/`chooseAddress` 中的旧敏感标题与「同志」称呼（后端 rebrand） |
| 旧脚本归档 | `build-corpus.js` + `seed.json`（含旧敏感语料）移至 `archive/`，防止误跑覆盖当前哲学语料 |
| 旧文档归档 | 4 份旧敏感主题规划文档移至 `archive/` |

### 2. 首页 `pages/home`
- 品牌 hero「问」字标 + 标语「以经典为镜，陪你思考人生」
- **今日思考**卡：按日期确定性抽取 1 条（主题 + 原文 + 开放问题 + 来源），可「换一张」
- 两大入口：**人生问题**（→ 对话 tab）/ **经典阅读**（→ books 页）

### 3. 经典阅读页 `pages/books`
- 列出 10 本 ready 公版经典（标题 / 作者 / 学派）
- 点击展开详情（简介 + 示例摘录），数据来自 `miniprogram/data/books.js`

### 4. 数据资产
- `miniprogram/data/dailyThoughts.js`：30 条「今日思考」，全部取自 10 本公版经典真实原文，离线可用
- `miniprogram/data/books.js`：10 本书目清单（与 `knowledge/index.json` 保持一致）

---

## D-2 人格层（已交付）

三种回答模式，前端选择、后端生效：

| 模式 | key | 行为 |
|---|---|---|
| 普通解释 | `plain` | 平实简短，直接回应，少引经据典（默认） |
| 深度思考 | `deep` | 从多思想传统（儒/道/斯多葛/存在/心理）分视角分析，不站队 |
| 经典引用 | `classic` | 以原文为主轴，先给原文与出处，再做 AI 解读 |

实现：
- 前端 `chat.js` 新增 `modes` 数据与 `setMode`；`chat.wxml` 新增模式分段控件；发送时把 `mode` 带入 `callFunction`
- 后端 `rag.js` 新增 `MODE_PROMPTS` 与 `buildRolePrompt(mode)`，把模式指令拼进 system；`tryModelAnswer` 按模式调整 user 指令；`composeLocalAnswer` 本地回退也按模式追加尾注
- `chat/index.js` 透传 `event.mode` 到 `generateAnswer`

---

## D-3 数据闭环（已交付）

目标：让系统随真实用户问题越用越准。

- **采集**：`chat/index.js` 每次成功回答后 fire-and-forget 写 `question_logs` 集合（openid / 问题 / 模式 / 推断意图 intent / 命中来源标题 / 聚合标签 matchedTags）
- **分析**：`admin` 云函数新增 `insights` action，聚合近 200 条，返回 `totalQuestions` / `topTags` / `topQuestions`
- **展示**：管理页 `pages/admin` 新增「问题洞察」区块（高频主题 + 高频提问），刷新即更新
- 用途：用高频 `matchedTags` 反哺知识库的 `problem_tags`，提升召回（符合用户提出的中间层「用户问题 → 思想主题 → 思想概念 → 经典文本」演进方向）

---

## 部署注意事项（与历史版本差异）

1. **新增集合**：云控制台「数据库」手动新建 **`question_logs`**（无 schema 要求，云函数服务端写入）。`logs` / `conversations` / `model_config` 同前。
2. **必须重新部署**：`chat` 云函数（新增 mode 透传 + question_logs 上报）、`admin` 云函数（新增 insights）。部署后无需调整运行时（实际环境锁定 Node 16，代码用 `nodeFetch` 兼容，无需 Node 18+）。
3. **`build-corpus.js` 已归档**：`corpus.json` 为当前哲学替身语料，已直接提交，**不要再用旧脚本重新生成**。
4. README 的「配置模型增强 API（OPENAI_API_KEY 环境变量）」一节为旧方案；当前模型配置走 `admin` 管理页 + `model_config` 集合，以该路径为准。

---

## 验证

- 全部改动 JS 通过 `node --check` 语法检查（10 个文件）
- `app.json` / `home.json` / `books.json` 通过 JSON 解析
- `rag.js` 在 Node 下跑通完整本地回答路径：三种 mode 均返回，**引用来源均为 10 本公版经典，无敏感标题泄漏**
- 全局 grep 确认活动代码中已无「同志你好 / 毛泽东 / 实践论 / 矛盾论 / 论持久战」等旧敏感字符串（仅 `archive/`、测试断言、历史 CHANGELOG 中保留）

## MVP 验收标准（用户定义）

> 「我问一个人生问题，它能像一个有深厚阅读积累的老师一样回答，并告诉我依据在哪里。」

D-1 聊天页 + 思想来源卡片 + D-2 三种模式 + 10 本经典语料，已满足该标准。D-3 提供长期优化闭环。
