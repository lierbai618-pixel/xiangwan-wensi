# Phase Q2 三模式产品规范（Mode Spec）

> 版本：v1.0（设计冻结稿，禁止代码修改）
> 状态：Phase Q2-0
> 关联：Phase-Q2-Architecture.md §2/§4
> 当前现实：前端 `chat.js` 已有 `modes=[plain/deep/classic]` + `mode:"plain"`，`index.js` 已透传 `mode` 至 `generateAnswer`。

---

## 1. 三模式定义

### Mode 1 · 快答（Fast）🌐
- **定位**：像豆包/Perplexity 一样获取最新信息，快、简洁、不做价值判断。
- **管线**：`Search Provider → 摘要 → 引用`。（不走 RAG 经典深度）
- **适用**：新闻、人物动态、产品发布、股票、天气（注：天气仍由 Capability 层拦截，不在此触发搜索）、旅游、软件更新。
- **输出结构**：
  ```
  根据公开信息：
  1. 最新动态：xxx
  2. 时间：2026年8月
  3. 来源：xxx
  信息可能随时间变化。
  ```
- **禁止**：价值判断、长篇思辨、冒充权威核实。

### Mode 2 · 深思（Deep）📚
- **定位**：用经典/心理学/哲学帮助理解问题，不联网。
- **管线**：`Intent → Knowledge Router → RAG → 五段式 WenDao Reasoning`。（= 现有 Category A 链路）
- **输出**：保持理解/分析/行动/经典/思考五段。
- **禁止**：联网、引用外部新闻。

### Mode 3 · 问思（Think）🌅 ★核心差异
- **定位**：先知道世界发生什么，再帮助人理解它——事实 + 知识 + 思想三层融合。
- **管线**：`Search → Fact Extract → RAG → Reasoning → WenDao 输出`。
- **输出结构**：
  ```
  事实：AI 编码能力快速提升。
  历史：工业革命改变了劳动方式。
  思想：真正的问题不是机器是否替代人，而是人在新时代如何重新定义价值。
  ```
- **默认模式**（见 §2）。

---

## 2. 默认模式 = Think（风险策略）

计划书 §风险2 明确：**默认问思模式，而非搜索模式**。理由：
- 防止「搜索导致回答变浅」，守住产品差异化（事实+思考）。
- 未指定 `answerMode` 时，Intelligent Router 默认派发 Think。

---

## 3. 前端选择器落点

### 3.1 复用现有管线
`chat.js` 已具备 `mode` 字段与 `modes` 数组。Q2 选择器：
- 将 `modes` 数据升级为 `answerModes = [{key:"fast",label:"快答",icon:"🌐"},{key:"deep",label:"深思",icon:"📚"},{key:"think",label:"问思",icon:"🌅"}]`。
- 选中值经 `wx.request` 的 `data` 以 `answerMode` 字段发出（保持现有 `mode` 字段作为 RAG 深度子开关，方案 A）。

### 3.2 UI 位置（建议，待 Q2-2 视觉确认）
- **首选**：聊天页 `topbar` 下方新增一行 segmented control（三档），或在输入区上方气泡条。
- **次选**：复用现有 `modes` 渲染位（chat.wxml 中现有模式切换组件），替换为三模式。
- 必须：默认高亮「问思」；切换不刷新会话；每个回答气泡标注其实际 `answerMode`（沿用现有 `mode-tag` 展示逻辑）。

---

## 4. answerMode 后端流转

```
前端 answerMode ──┐
                 ├─→ index.js 解析 ─→ answerMode.js ─→ { useSearch, useRAG }
query / intent ──┘                         │
                                           ├─ fast  → useSearch=true,  useRAG=false
                                           ├─ deep  → useSearch=false, useRAG=true
                                           └─ think → useSearch=true,  useRAG=true
```

- **override 关系**：显式 `answerMode` 覆盖 Freshness 自动 B/C 分类。但 Capability（时间/天气）优先级最高，任何模式都不对其联网。
- **未指定时**：默认 think（见 §2）。
- **与现有自动路由共存**：用户不选模式 → 走 Phase Q1-B 自动路由（Capability→Freshness→Knowledge）；选了模式 → 走对应管线。

---

## 5. 各模式 Prompt 策略

| 模式 | Prompt 来源 | 策略要点 |
|---|---|---|
| Fast | Search Provider + 轻量摘要 prompt | 事实罗列 + 引用 + 时效声明；禁止评价 |
| Deep | `rag.js` ROLE_PROMPT（现有，不改） | 五段式；经典检索；不联网 |
| Think | `freshness/responder.js` 扩展三段模板 | 事实层（搜索）+ 知识层（rag 检索）+ 思想层（WenDao 反思）；**不改 `rag.js` 常量**，由 responder 组合 |

> 铁律：Think 模式复用 `rag.js` 的**检索与五段式能力**（只读调用），**不修改** `ROLE_PROMPT` 任何常量。

---

## 6. 测试矩阵（Q2-2 验收，100 条）

| 组 | 模式 | 样例 | 预期 |
|---|---|---|---|
| F-1 | Fast | 「OpenAI 最近有什么消息？」 | Search 命中 + 引用 + 简洁 |
| F-2 | Fast | 「今天天气？」 | Capability 拦截（不搜索） |
| D-1 | Deep | 「如何面对失败？」 | RAG 五段式，无搜索 |
| D-2 | Deep | 「论语怎么看学习？」 | 经典引用，无外链 |
| T-1 | Think | 「AI 会不会取代程序员？」 | 事实+知识+思想三段 |
| T-2 | Think | 「某演员最近有什么作品？」 | 搜索事实 + 经典视角融合 |
| R-1 | 默认(无指定) | 任意 | 默认 Think |
| R-2 |  override | Think 模式问「现在几点」 | Capability 仍拦截 |

> 隔离断言：所有模式均须验证 corpus/embedding/metadata SHA 不变（数据隔离硬指标）。

---

## 7. 本阶段（Q2-0）约束

- ❌ 不修改 `chat.js` / `chat.wxml` / `index.js` / `answerMode.js`（未建）。
- ❌ 不新增 UI、不部署。
- ✅ 仅本设计规范，作为 Q2-2 开工基准。
