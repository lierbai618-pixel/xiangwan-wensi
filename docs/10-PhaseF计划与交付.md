# Phase F 计划与交付（v0.9.0）—— 百问验证阶段

> 评审结论：Phase E v0.8.0 **A+ 通过**。下一阶段**不是 Phase F 功能堆叠**，而是 **Phase F：百问验证（100 User Questions）**。
> 核心目标：让真实用户告诉「问道」——什么问题最需要它，什么回答真正帮助了人。这一步决定它是一个漂亮 Demo，还是一个有人愿意长期使用的产品。

---

## 1. 阶段定位

| 维度 | 说明 |
| --- | --- |
| 不是 | 新增页面 / 新增模式 / 新增智能体能力 |
| 是 | 收数据 + 用数据驱动优化 |
| 唯一新增代码 | `answer_quality_log`（定性反馈：为什么有效/无效） |
| 原则 | 不继续堆功能；标签不膨胀；经典永远"帮助用户找到答案"不是"替用户回答" |

Phase 路线已闭环：**C 建知识资产 → D 建用户体验 → E 建智能体价值 → F 用真实数据验证**。

---

## 2. F-1 百问分类进度（支撑 20/20/20/20/20）

将 `analyzeQuery` 的 8 主题映射到 **5 类桶**（不新增分类维度，只是聚合视图，避免标签膨胀）：

| 类别 | 来源主题 |
| --- | --- |
| 人生方向 | 迷茫、自我 |
| 学习成长 | 学习、行动 |
| 情绪压力 | 情绪 |
| 关系问题 | 关系 |
| 长期选择 | 长期、判断 |

- `rag.js` `analyzeQuery` 返回 `category`；**完全无关键词命中的问题归入「未分类」**，而非悄悄堆进"人生方向"，保证进度统计可信。
- `chat/index.js` `logQuestion` 落库 `category` 字段。
- `admin` insights 输出 `categoryBreakdown`（每行 `count/20` 进度条），直接看 5 类桶离各 20 条还差多少。

---

## 3. F-2 三指标脚手架

三个验收指标全部可由现有数据聚合得出，管理页已呈现：

| 指标 | 数据来源 | 计算 |
| --- | --- | --- |
| 理解准确率 | `answer_feedback.helpful` | 👍 占比（有帮助率） |
| 行动有效率 | `answer_feedback` + 负向 `reason` | 👎 + "没解决我的问题/缺少行动建议/太抽象" 占比 |
| 引用接受度 | `answer_feedback.reason=="引用太多"` | 引用被反感的比例 |

> 注：`answer_feedback` 是**量化**（是否帮），`answer_quality_log` 是**定性**（为什么帮），二者互补。

---

## 4. answer_quality_log（F 阶段唯一新代码）

### 设计动机
- `question_logs`：记录用户**问了什么**。
- `answer_feedback`：记录**喜欢/不喜欢**（量化）。
- 还缺：**为什么这条回答有效/无效**——这正是未来训练 prompt、优化 agent 最有价值的数据。

### 集合 schema
```
answer_quality_log: {
  openid: String,
  question: String,
  answer_id: String,
  failureReason: String,   // 哪里没帮到（可选，≤200字）
  goodPoint: String,        // 哪里帮到了（可选，≤200字）
  createTime: ServerDate
}
```

### 实现
- `cloudfunctions/feedback` 云函数复用，按 `type` 分流：
  - `type=rate`（默认）→ 写 `answer_feedback`
  - `type=quality` → 写 `answer_quality_log`（两项皆空则跳过写库）
- 聊天页：用户评分（👍/👎）后，下方出现**可选**「补充：哪里帮到/没帮到你」自由文本输入，提交不打断主流程。
- `admin` insights 聚合 `quality.failures` / `quality.goods` 高频定性原因，直接看到"用户说太抽象 / 共情到位"等真实信号。

---

## 5. 部署清单（比上次 0 改动，多一个集合）

1. 重新上传部署 **chat + admin + feedback** 三个云函数（右键→上传并部署·云端安装依赖）；
2. 云开发控制台**手动新建 `answer_quality_log` 集合**（不建会报 COLLECTION_NOT_EXIST）；
3. `question_logs` / `answer_feedback` 新字段（category / failureReason 等）云库无 schema、自动兼容；
4. `archive/` 旧脚本仍**禁止运行**。

---

## 6. 验证方法论（数据驱动优化闭环）

```
真实用户提问
   → question_logs（问题 + category + 命中书目 + 路线主题）
   → AI 回答（理解→分析→行动→经典→思考）
   → answer_feedback（有帮助率 / 负向原因）
   → answer_quality_log（为什么有效 / 无效）
   → admin 洞察（分类进度 + 三指标 + 定性原因）
   → 反哺 analyzeQuery 主题词 / actionLibrary 行动 / 引用策略 / metadata.user_questions
```

**目标**：首批 100 个真实问题（5 类各 20）。重点回收：
- 高频人生主题（指导 user_questions 策展）；
- 召回失败案例（命中书目为空 / 跑题 → 补索引）；
- 回答形式偏好（用户喜欢共情+具体行动，还是更多经典）。

---

## 7. 验证结果

- `scripts/test_phasef.js` **19/19**：五分类映射（含「未分类」兜底）、`feedback` 的 `quality` 写库分支与 `rate` 默认分支、`admin` insights 聚合 `categoryBreakdown` + `quality`。
- 回归：Phase B 22/22、C-2 22/22、C-3 34/34、E 27/27、E-v2 21/21 全过。
- 改动 JS（`rag.js`/`chat/index.js`/`feedback/index.js`/`admin/index.js`/`chat.js`）均 `node --check` 通过。

---

## 8. 不在本阶段做的事（刻意收敛）

- ❌ Phase F 功能堆叠（更多模式 / 更多页面 / 更多智能体能力）
- ❌ 继续加分类标签（保持在 8 主题 / 5 类桶，不膨胀）
- ⏸️ E-3 收藏（个人空间）：留作可选，等首批数据说明值得做再动手

---

## 9. 评审补充实施（v0.9.1）

Phase F v0.9.0 评审 **A+ 通过**，并给出明确补充建议。本版落地其中"现在就该做"的硬建议，把"留作路线图"的软建议记入此处，不提前写代码。

### 9.1 answer_id 三层贯通（评审"当前唯一建议"）
- `chat/index.js` 新增 `makeAnswerId()` 生成规范 ID：`YYYYMMDD_xxxx`（日期前缀便于按日分析模板效果）。
- 所有回答路径（model / local / localOnly-fallback）均经 `generateAnswer` 出口，`main` 注入 `result.answerId` 后：
  - 写入 `question_logs.answer_id`；
  - 随返回结果下发前端 `result.answerId`；
  - 前端 `chat.js` 改用后端下发的 id（不再本地生成），`feedback`/`quality` 提交携带同一 `answer_id`。
- 三层（`question_logs` / `answer_feedback` / `answer_quality_log`）通过 `answer_id` 可关联，未来可分析"经典模式平均满意度 vs 普通模式"等。
- 验证：`test_phasef.js` [4] 断言 result.answerId 格式 + question_logs 落库 answer_id + 两者一致，**23/23 全过**。

### 9.2 点踩快捷原因规范化（评审推荐）
- 点踩后原因 chips 对齐评审建议 5 项语义：**太抽象 / 没解决我的问题 / 引用太多 / 缺少行动建议 / 理解错了**。
- 自由文本补充（`answer_quality_log`）仍保留为**可选**，符合"不强迫填写"原则——用户愿意点按钮，不一定愿意写 100 字。
- `admin` insights 聚合 `failureReason` 时这些规范值自然聚合成高频栈，直接指导 `actionLibrary` / 引用策略优化。

### 9.3 Phase G 路线图（百问达标后，不提前做）
评审批准 Phase F 后建议的下一阶段，**不是大功能堆叠**，而是智能优化：
- **G-1 查询理解优化**：用 100 问反哺"用户口语 → 标准问题 → 思想主题"映射（扩 `analyzeQuery` 词库与重写规则）。
- **G-2 回答策略优化**：根据反馈调整「理解→分析→行动→经典→思考」五段的比例与深度（经典模式权重、行动段长度）。
- **G-3 小规模真实用户测试**：邀请 20~50 人，观察留存、二次提问率、使用时间、高频主题。

### 9.4 100 问真实验收标准（达成后）
| 层 | 验收 |
| --- | --- |
| 数据层 | 100 条真实问题；五分类基本稳定；高频问题 Top20 生成 |
| 回答层 | 统计 👍 比例；点踩原因 Top10；引用接受率；行动建议满意度 |
| 知识层 | 输出新增 `user_questions` 50+（如"考试失败怎么办 / 创业失败还能继续吗 / 努力很久没结果怎么办"）—— 这才是未来 RAG 的核心资产 |

### 9.5 部署补充（v0.9.1）
- 无新增集合（`answer_quality_log` 已在 v0.9.0 建）；重部署 **chat**（含 answer_id 注入）+ **admin** + **feedback** 即可。
- `question_logs` 新增 `answer_id` 字段云库无 schema、自动兼容。
