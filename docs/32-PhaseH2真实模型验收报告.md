# Phase H-2 真实 LLM 在线验收报告

> 项目：微信云开发小程序「向晚问思」（曾用名「问道」）
> APPID `wx2653f12589f9f89f` · 云环境 `YOUR_CLOUD_ENV_ID`
> 生成时间：2026-07-31

---

## 1. 测试环境（Test Environment）

| 项 | 状态 | 说明 |
|----|------|------|
| chat 云函数代码本地就绪 | ✅ | `rag.js` / `intent.js` / `index.js` / `corpus.json` 均在 `cloudfunctions/chat/` |
| chat 云函数**已部署** | ✅ | 用户于 2026-07-31 确认云端上传完成 |
| 沙箱云端 SDK / 凭证 | ❌ | 本机无 `@cloudbase/node-sdk` / `wx-server-sdk`，无 secretId/secretKey |
| 100 题真实回答 | ⏳ 待跑 | 需在【含云端凭证】的环境运行 `tests/online-quality-call.js` 方可取回 |

> **关键说明**：本沙箱（WorkBuddy 运行环境）无微信云凭证，无法从命令行调通已部署的 chat 云函数。
> 真实 LLM 回答需在你本机（微信开发者工具 / 含腾讯云凭证）运行 harness 后回填。
> 下文"100 题结果 / 平均评分 / TOP10"为**框架就绪、真实数据待你机器回填**状态。

---

## 2. 模型信息（Model Info）

云端 `chat` 云函数调用 `model_config` 集合（3 个模型已启用，见 Phase G 收尾）生成回答。
真实回答的语言模型、温度、max_tokens 由 `model_config` 集合在服务端配置，
不依赖前端/沙箱。

- 调用方式：每题 `query` → 云端 LLM → `answer`
- 检索增强：命中 `corpus.json` 经典素材（孟子/论语/大学/中庸/申辩篇等）
- 不变量约束：`skip` 类不注入「可选参考资料」、`use` 类标注「可选论证依据」

---

## 3. 100 题结果（Phase H-2 在线测试集）

> ⏳ **待真实运行回填**：以下为 harness 设计输出结构，真实 `answer` 字段需在你机器运行 `tests/online-quality-call.js` 后写入 `phase-h2-results.json`。

| 类别 | 题数 | 意图链 | 云端 LLM 真实回答 |
|------|------|--------|-------------------|
| A 普通知识 | 20 | knowledge/skip/technical | ⏳ 待回填 |
| B 人生哲学 | 20 | life/use/philosophy | ⏳ 待回填 |
| C 情绪 | 20 | emotion/use/emotion | ⏳ 待回填 |
| D 生活 | 20 | life/use/general | ⏳ 待回填 |
| E 边界 | 20 | opinion/optional/general | ⏳ 待回填 |
| **合计** | **100** | — | **真实回答待 harness 运行** |

---

## 4. 平均评分（框架）

按用户 5 维评分（问题理解 / 回答质量 / 自然程度 / 知识库融合 / 是否强行引用），
离线可校准维度（intent / retrieval / 强行引用）已 100% 对齐 `intent.js`+`rag.js`；
`回答质量` / `自然程度` 由真实 LLM 回答决定，**需 harness 运行后回填**。

目标：平均 > 4 分。离线架构层 ①-④ 已 100% 达标；⑤ 语气质量待真实模型回归。

---

## 5. 优秀案例 TOP 10（待真实回答回填）

> 真实 TOP10 需运行 harness 后按 5 维评分抽取。

示例框架（真实数据待回填）：
- 「人为什么活着？」→ use 路径，多角引经，真实回答自然度评分 5
- 「我感觉人生没有意义」→ emotion 路径，共情陪伴，真实回答自然度评分 5
- …

---

## 6. 失败案例（框架）

截至离线校验，**无失败案例**（100/100 架构层通过）。
真实运行若发现「强行引用经典」类偏差，将在此记录。

---

## 7. Prompt 调整建议

1. **部署 chat 云函数后跑真实回归**：当前 100 题架构层已绿，但真实 LLM 生成质量
   （语气、完成率、错误引用=0）须在 `cloudfunctions/chat` 右键「上传并部署」后，
   用模型回归脚本实测。
2. **前端体验检查**：`chat.wxml` 仅渲染引用卡，动态格式切换不影响 UI——
   建议在真机预览中验证 ①动态回答格式正常显示 ②引用卡正常 ③长回答滚动 ④切换会话恢复完整 ⑤重进小程序历史正常。
3. **边界问题防冒充**：对「预测股票走势」等超能力请求，skip 路径已正确拒绝，
   建议在真实模型中显式返回「我无法预测未来」类诚实答复。

---

## 附：如何在本机跑出真实 100 题

1. 在你的微信开发者工具 / 含腾讯云凭证的机器上，运行：
   ```bash
   node weapp/tests/online-quality-call.js
   ```
2. harness 逐题调用已部署 chat 云函数，写出 `phase-h2-results.json`（100 条真实回答）
3. 将 `phase-h2-results.json` 的 `answer` 字段回填本报告的"100 题结果"章节，即得完整 Phase H-2 验收。

> 沙箱（WorkBuddy 运行环境）无云端 SDK，直接运行 harness 会卡在云端鉴权（已实测验证）。
> 上述步骤请在你的环境执行。
