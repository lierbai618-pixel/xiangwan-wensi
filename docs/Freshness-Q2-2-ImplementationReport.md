# Phase Q2-2 Implementation Report · 前端三模式选择器

> 版本：v1.0
> 状态：**完成（未部署，等待 Q2-3 授权）**
> 角色：WeChat Mini Program Engineer / Frontend Architect / Release Guardian
> 依据：用户《Execution: Phase Q2-2》授权 + 计划书 v1.0 + Q2-0 设计文档 + Q2-1-B 已落地骨架
> 铁律：禁止部署、禁止修改 corpus.json / intent.js / knowledgeRouter.js / rag.js、不接真实搜索、不改变默认回答逻辑、保留旧 `mode` 字段兼容

---

## 1. 概述

在 Q2-1-B 已落地的后端骨架（`answerMode` 解析 + Search Provider 抽象 + 默认 `think`）之上，落地**前端三模式选择器**——让用户在聊天页真实切换 🌐 普通 / 📚 深度 / 🌅 思考，并把 `answerMode` 字段透传到 `chat` 云函数。

**核心结论**：本阶段只动前端 `chat` 页 3 个文件（`chat.js` / `chat.wxml` / `chat.wxss`），`cloudfunctions/` 零改动。由于后端 `FRESHNESS_FACTUAL_ENABLED=false` + `SEARCH_PROVIDER=mock` 维持不变，三模式当前**仅改变产品形态与字段传输，不改变回答内容**——即用户能"真实体验三模式产品形态"，但 Deep/Think 真正驱动 RAG 深度与推理、Fast 真正走检索，要等 Q2-3 融合引擎与真实源接入。

---

## 2. 修改文件清单（仅前端 3 文件，均为非冻结资产）

| 文件 | 改动类型 | 说明 |
|---|---|---|
| `miniprogram/pages/chat/chat.js` | 修改 | 三模式状态、选择器 handler、请求透传、回答徽标持久化/还原 |
| `miniprogram/pages/chat/chat.wxml` | 修改 | `mode-bar` 改三模式图标 chips + 描述行；assistant 气泡加 `ans-mode-tag` 徽标 |
| `miniprogram/pages/chat/chat.wxss` | 修改 | `.mode-chip` 适配图标+文字、`.mode-desc`、`.ans-mode-tag` 三色变体 |

> 后端 `cloudfunctions/chat/*` 本阶段**零改动**；四冻结资产零触碰。

---

## 3. diff 摘要

### 3.1 `chat.js`

**① 常量替换**（旧 RAG 深度三态 → 新三模式）
```js
// 旧
const modes = [
  { key: "plain", label: "普通" },
  { key: "deep", label: "深度" },
  { key: "classic", label: "经典" },
];
// 新
const answerModes = [
  { key: "fast",  icon: "🌐", label: "普通", desc: "快速回应，少引经，多直接对话" },
  { key: "deep",  icon: "📚", label: "深度", desc: "深挖经典，多引用，长回答" },
  { key: "think", icon: "🌅", label: "思考", desc: "检索 + 经典 + 推演，最贴近「问思」" },
];
```

**② 新增 `answerModeLabel`**（与旧 `modeLabel` 并存）
```js
function answerModeLabel(key) {
  return key === "fast" ? "🌐 普通" : key === "deep" ? "📚 深度" : "🌅 思考";
}
```

**③ `data` 新增字段，旧 `mode` 字段保留**
```js
    answerModes,
    answerMode: "think", // 三模式默认「思考」，与后端 answerMode 默认一致
    mode: "plain",       // 旧 RAG 深度子开关字段保留，默认 plain 不变，保证后端链路兼容
    modeDesc: "检索 + 经典 + 推演，最贴近「问思」",
```

**④ handler 改名并新增描述刷新**
```js
  setAnswerMode(e) {
    const am = e.currentTarget.dataset.mode;
    if (am === this.data.answerMode) return;
    const def = answerModes.find((m) => m.key === am);
    this.setData({ answerMode: am, modeDesc: (def && def.desc) || "" });
  },
```

**⑤ 请求透传（主调用 + 超时降级回退均带 `answerMode` + 旧 `mode`）**
```js
  _doSend(text, mode, cid) {
    const answerMode = this.data.answerMode;
    // ...
    wx.cloud.callFunction({ name: "chat", data: { message: text, history, mode, answerMode, conversationId: cid } });
    // 超时回退：wx.cloud.callFunction({ name: "chat", data: { message: text, history, localOnly: true, mode, answerMode, conversationId: cid } })
```

**⑥ 回答对象带三模式徽标字段**（assistantMsg 与 fallbackMsg 一致）
```js
          _reqModeLabel: modeLabel(mode),
          answerMode: answerMode,
          _answerMode: answerMode,
          _answerModeLabel: answerModeLabel(answerMode),
```

**⑦ 持久化与还原**（appendHistory `clean()` + loadConversation）
```js
// clean()
base.answerMode = m._answerMode || "";
base.answerModeLabel = m._answerModeLabel || "";
// loadConversation restore
base._answerMode = m.answerMode || "";
base._answerModeLabel = m.answerModeLabel || "";
```

### 3.2 `chat.wxml`

**mode-bar**（图标+文字 chips + 选中描述）
```xml
  <view class="mode-bar">
    <text class="mode-label">回答模式</text>
    <view class="mode-chips">
      <view wx:for="{{answerModes}}" wx:key="key"
        class="mode-chip {{answerMode === item.key ? 'active' : ''}}"
        bindtap="setAnswerMode" data-mode="{{item.key}}">
        <text class="mode-ico">{{item.icon}}</text>
        <text class="mode-name">{{item.label}}</text>
      </view>
    </view>
    <view wx:if="{{modeDesc}}" class="mode-desc">{{modeDesc}}</view>
  </view>
```

**assistant 气泡顶部徽标**
```xml
<view wx:if="{{item._answerModeLabel}}" class="ans-mode-tag am-{{item._answerMode}}">{{item._answerModeLabel}}</view>
```

### 3.3 `chat.wxss`

- `.mode-bar` 增加 `flex-wrap: wrap` + 底部留白；`.mode-chip` 改为 `inline-flex` 图标+文字布局，active 态不变；新增 `.mode-ico` / `.mode-name` / `.mode-desc`。
- 新增 `.ans-mode-tag` + `.am-fast`(绿) / `.am-deep`(朱红) / `.am-think`(金) 三色变体，色系与现有 `#9b2f25` / `#d9b26f` 主题一致。

---

## 4. 三模式 ↔ 后端对齐

| 前端选择 | `answerMode` | 后端 `answerMode.js` resolve（Q2-1-B 已落地） | 当前实际行为（FRESHNESS_FACTUAL_ENABLED=false） |
|---|---|---|---|
| 🌐 普通 | `fast` | `useSearch=true, useRAG=false` | 事实分支休眠 → 仍走 RAG，与 `think` 同路径（search 未接） |
| 📚 深度 | `deep` | `useSearch=false, useRAG=true` | 仍走 RAG（与旧 `mode:"deep"` 同源，但经 `answerMode` 维度） |
| 🌅 思考 | `think`（默认） | `useSearch=true, useRAG=true` | 事实分支休眠 → 走 RAG；唯一默认态 |

> 后端派发顺序 Capability→Freshness→Knowledge 不变，三模式在 Freshness 层生效（休眠态），故**典型哲思问题回答内容本阶段零差异**。

---

## 5. 默认回答逻辑不变验证（满足要求 #4）

默认请求体对比：

| 阶段 | 请求 `data` |
|---|---|
| Q2-1-B 前（旧前端） | `{ message, history, mode:"plain", conversationId }` |
| Q2-2（本阶段） | `{ message, history, mode:"plain", answerMode:"think", conversationId }` |

- 唯一新增字段 `answerMode:"think"` 恰等于后端 `(event.answerMode) || "think"` 默认值 → 后端解析结果完全一致。
- 旧 `mode:"plain"` 仍原样透传，`generateAnswer` 的 RAG 深度子开关链路完全兼容。
- **结论**：默认回答逻辑与行为零变化。

---

## 6. 兼容性 & 禁止事项遵守（满足要求 #2/#3/#5）

- ✅ 未修改 `corpus.json` / `intent.js` / `knowledgeRouter.js` / `rag.js`（本阶段未触碰 `cloudfunctions/` 任何文件）。
- ✅ 未接真实搜索：`SEARCH_PROVIDER=mock` + `FRESHNESS_FACTUAL_ENABLED=false` 维持（后端未改）。
- ✅ 保留旧 `mode` 字段：请求体仍含 `mode`，后端 RAG 深度逻辑不受影响。
- ✅ 未部署 / 未 commit / 未 push / 未改环境变量。

---

## 7. 验证结果

| 项 | 结果 |
|---|---|
| `node --check chat.js` | ✅ PASS（语法） |
| `chat.wxml` 旧引用清理 | ✅ 无 `setMode` / `{{modes}}` 残留；使用 `setAnswerMode` / `{{answerModes}}` / `data-mode` |
| `chat.wxss` 规则唯一性 | ✅ 无重复 `.mode-chip` / `.ans-mode-tag` 块 |
| 冻结资产 SHA | ✅ 4/4 未触碰（本阶段仅前端 3 文件） |
| 三模式选择器可交互 | ✅ 点击切换 `answerMode` + 刷新 `modeDesc`；选中态高亮 |
| 回答徽标回溯 | ✅ 本轮及历史会话（loadConversation 还原）均显示 🌐/📚/🌅 徽标 |

---

## 8. 风险与开放决策（进入 Q2-3 前需人工确认）

| 项 | 状态 | 阻塞？ |
|---|---|---|
| 搜索供应商 + API 密钥（bing/tavily/serp） | 未提供（P1 OPEN 遗产） | 是（真实源激活前提） |
| 跨境数据 / 内容合规（备案审核中） | 需法务/平台确认 | 是 |
| 问思融合引擎（Q2-3：让 Deep/Think 真正驱动 RAG 深度 + Reasoning，Fast 走 search） | 骨架已备，待填充 | 否 |
| 默认模式 = think | 已落地（前端默认 + 后端默认一致） | 否 |

---

## 9. 下一步建议

等待人工授权进入 **Phase Q2-3**：问思融合引擎（Fact Extractor + RAG 只读检索 + Reasoning Prompt + 引用管理 + 复用 `detectFabrication` 硬闸），使三模式从"产品形态"升级为"差异化回答能力"。真实源激活前置 = 提供供应商选择 + API 密钥 + 合规结论，届时 `FRESHNESS_FACTUAL_ENABLED=true` 且 `SEARCH_PROVIDER` 从 `mock` 切到真实源。
