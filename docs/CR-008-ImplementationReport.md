# CR-008 实施报告 — Skip 分支反幻觉护栏（Phase T-0 / PQ-002）

变更请求：CR-008 ｜ 设计基线：CR-008-SkipBranchAntiHallucination.md ｜ 授权：用户 2026-08-06 批准执行 T-0 止血 ｜ **状态：✅ 已完成（DEPLOYED + VERIFIED）**

## 1. 变更摘要
- **文件**：`cloudfunctions/chat/rag.js`
- **函数**：`composeUserContent()`
- **范围**：`policy === "skip"` 分支 Prompt 文案增补「准确性要求」护栏；`domain === "事实"` 时追加实时核实提示
- **严格约束（已遵守）**：未修改 `intent.js` / `knowledgeRouter.js` / `corpus.json` / RAG 检索逻辑 / 数据库 / 环境变量

## 2. 改动 Diff（仅 skip 分支，vs rag.js.preCR008.bak）
```
<     parts.push(
<       "【知识库】本轮未启用经典知识库——这是一个「" +
<         ((intentInfo && intentInfo.domain) || "客观") +
<         "」类问题。请依据你自己的通用知识直接、准确地回答，不要引用经典，不要做哲学化包装。"
<     );
---
>     const skipDomain = (intentInfo && intentInfo.domain) || "客观";
>     let skipNote =
>       "【知识库】本轮未启用经典知识库——这是一个「" + skipDomain +
>       "」类问题。请依据你自己的通用知识直接、准确地回答，不要引用经典，不要做哲学化包装。\n" +
>       "【准确性要求】对于具体专名（人物/机构/作品/事件/数据/日期/引文），只陈述你有把握的常识性内容。" +
>       "若对某一具体事实（某人生平细节、某事件精确时间、某条具体引文）没有确切把握，请明确说" +
>       "「这一点我无法确认」或给出范围性表述，切勿编造姓名、头衔、年份或原文。" +
>       "请区分「广为人知的常识」与「需要查证的具体事实」。";
>     if (skipDomain === "事实") {
>       skipNote +=
>         "\n（事实类问题）尤其注意：你无法实时核实的信息（如近况、未公开数据）应显式标注「未经核实」。";
>     }
>     parts.push(skipNote);
```

## 3. 冻结资产完整性
| 资产 | SHA256（前 8 位） | 状态 |
|------|------------------|------|
| corpus.json | db01fbc9 | ✅ ≡ O-0.6（未改） |
| intent.js | 765ad138 | ✅ ≡ O-0.6（未改） |
| knowledgeRouter.js | 84890844 | ✅ ≡ O-0.6（未改） |
| rag.js | 4fb2dca4 | ⚠️ 已改（CR-008 预期，仅 skip 分支） |

备份锚点：`cloudfunctions/chat/rag.js.preCR008.bak`（SHA `5b380b3f…` ≡ O-0.6）。

## 4. 本地回归
- `node --check rag.js`：**SYNTAX OK**
- 改动范围：`diff rag.js.preCR008.bak rag.js` 仅含 skip 分支（1325–1337 行）；`有资料`分支（五段式路径）、`检索为空`分支、`OUTPUT_FORMATS`、`buildRolePrompt` 零改动
- `scripts/test_capabilities.js`：**75 / 75 ✅**
- `scripts/test_freshness.js`：**32 / 32 ✅**（分类准确率 100%）

## 5. 部署（✅ 完成）
- 部署前已读 `cloudbaserc.json`：envId=YOUR_CLOUD_ENV_ID，runtime=Nodejs16.13，timeout=60，memorySize=512，envVariables=`ADMIN_OPENID` + `KNOWLEDGE_OBSERVABILITY_STORE=cloud`（与线上一致 → 幂等，未静默覆盖）
- 命令：`tcb fn deploy chat --force`（在 `weapp/`，走 COS 上传通道）
- **结果**：`√ [chat] Cloud function deployed successfully!` ｜ Modification time **2026-08-06 17:56:18** ｜ 环境变量完整保留 ｜ 代码体积 11,275,522 B（rag.js 增大预期内）

## 6. 真机验证（✅ 10/10，tcb fn invoke 真实调用）
验收重点 A（未知人物/事件不得凭先验编造事实）：
| # | 问题 | 结果 |
|---|------|------|
| 1 | 房主任是谁 | 拒绝编造，说明是泛称；自纠潜在幻觉（"房祖名未出演该剧"）✅ |
| 2 | 我们公司王总最近在忙什么 | "我无法获取您公司内部信息，也不了解王总的近期工作安排" ✅（首次 SCF socket hang up，重试成功） |
| 3 | 某小镇民俗节具体是哪天 | 无统一日期，列举例证，要求具体镇名 ✅ |
| 4 | 《未出版书X》的作者是谁 | "无法确认作者"，指明非真实书目 ✅ |
| 5 | 隔壁老王的生日是哪天 | 识别为虚构网络梗，无真实生日 ✅ |
| 6 | 2024年某县城马拉松冠军是谁 | 原话命中护栏：**"这一点我无法确认"** ✅ |

验收重点 B（已有知识库问题保持五段式回答）：
| # | 问题 | 结果 |
|---|------|------|
| 7 | 子曰学而时习之不亦说乎出自哪里 | 五段式 + 《论语·学而》引文 ✅ |
| 8 | 道德经如何看待无为 | 五段式 + 经典观点（动态格式）✅ |
| 9 | 什么是中庸之道 | 五段式 + 《中庸》引文 ✅ |
| 10 | 如何面对失败 | 五段式 + 《沉思录》《手册》引文 ✅ |

全部 10 条 `mode:"model"`；skip 类 citations 为空（符合设计），知识类 citations 非空。

## 7. 验收闸门
- [x] rag.js diff 仅含 skip 分支文案
- [x] 冻结其他三项 MATCH O-0.6
- [x] 本地语法 + 既有测试无回归（75/75 + 32/32）
- [x] 部署成功（ModTime 2026-08-06 17:56:18、环境变量保留）
- [x] 真机 10/10 符合验收重点（未知项无编造 / 已知项五段式）

## 8. 结论
PQ-002 盲区（skip 分支无事实护栏）已闭环：库外专名不再凭模型先验生成事实，不确定时显式声明。改动面最小（纯 Prompt 文案）、零逻辑/检索/路由变更、冻结其他三项资产零改动。回滚锚点 `rag.js.preCR008.bak` 就绪。

**按授权要求，T-0 完成后停止，不进入 T1。**
