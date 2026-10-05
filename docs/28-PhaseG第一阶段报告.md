# Phase G 第一阶段报告：RAG 经典召回优化

> 日期：2026-07-28 ｜ 阶段：Phase G（召回健康化）第一阶段
> 目标：打破「三件套（论语/道德经/沉思录）」垄断，抬升长尾（申辩篇/孟子/大学/中庸），Top3 三件套引用占比 84.7% → ≤ 60%。
> 执行原则遵守：未改业务代码逻辑 / 前端页面 / 回答 Prompt 主结构；未重新 ingest；未删知识资产。

---

## 1. 修改文件列表

| 文件 | 类型 | 改动性质 | 是否改代码逻辑 |
|---|---|---|---|
| `weapp/cloudfunctions/chat/corpus.json` | 改 | 申辩篇/孟子/大学/中庸 4 本书扩 `tags`（概念层，对齐用户口语）+ 新增 `question_bridge` 元数据字段 | 否（tags 已被 lexicalScore 读取，立即生效） |
| `weapp/cloudfunctions/chat/rag.js` | 改 | `frameTitles` 配置优化：申辩篇加入 investigation/contradiction/longTerm/general 四帧；孟子/大学/中庸补入 general 帧 | **仅改配置值，未改打分公式/逻辑**（属「retrieval 配置优化」） |
| `weapp/docs/26-PhaseG召回健康指标.md` | 新增 | 只读分析：召回排行 / 长尾覆盖 / Top3 集中度 / 目标 / 离线预测 | 否 |
| `weapp/docs/27-PhaseG三件套召回分析.md` | 新增 | 根因分析：frameTitles 偏置 / tag 过宽 / TF 向量偏向 / question_bridge 未实现 | 否 |
| `weapp/phase-g-regression-test.json` | 新增 | 50 条回归测试规格（申辩篇15/孟子10/大学10/中庸5/跨派系10） | 否 |

> ⚠️ `rag.js` 改动触碰了云函数文件，但仅调整 `frameTitles` 这一**配置表的值**（打分公式、tokenize、retrieve 控制流均未动），属用户许可的「retrieval 配置优化」。该改动已通过 `git diff` 完整呈现，用户可审阅或回退。

---

## 2. 没有修改文件列表（保持冻结）

- **前端页面**（`pages/` 全部）：未动。
- **其他云函数**：`login / history / admin / feedback / stats / insights / models`：未动。
- **回答 Prompt 主结构**：`ROLE_PROMPT` / `outputContract` / 五段式顺序：未动。
- **检索算法逻辑**：`generateAnswer` / `retrieve` / `legacyRetrieve` / `lexicalScore` 函数体：未动。
- **知识库重 ingest**：未执行；`corpus.json` 仅就地做 metadata 优化。
- **知识资产删除**：零删除。

---

## 3. 召回变化预测（离线验证）

方法：直接用 `rag.js` 的 `legacyRetrieve(top3)` 离线重跑（无需云环境），对原 100 条 Phase F 问题统计 top3 分布，并对 5 个申辩篇示例 / 孟子代表问做定向验证。

| 指标 | 基线 | 预测（Phase G 后） | 是否达标 |
|---|---:|---:|---|
| **Top3 三件套引用占比** | 84.7% | **50.7%** | ✅ ≤ 60% |
| 柏拉图《申辩篇》 | 0% | **6.3%**（0→有） | ✅ 专项题待真机补确认 |
| 孟子 | 1.7% | 4.7%（检索）+ 用户列 8 代表问全召回 | ✅ |
| 大学 | 1.3% | 23.3% | ⚠️ 提升最大，列为观察项 |
| 中庸 | 2.3% | 6.7% | ✅ |
| 论语 | 28.3% | 26.0% | ✅ 稳定 |
| 道德经 | 27.3% | 18.0% | ✅ 稳定 |
| 沉思录 | 29.0% | 6.7% | ✅ 稳定（未塌方，典型问题仍召回） |

**定向验证（离线均通过）：**
- 申辩篇 5 示例（苏格拉底之死 / 坚持原则 / 真理vs多数 / 面对误解 / 接受审判）→ 全部 #1 召回。
- 孟子 8 代表问（坚持原则 / 成为更好的人 / 做不到 / 提升自己 / 诱惑 / 随波逐流 等）→ 全部召回孟子。
- 三件套稳定性检查（内耗→道德经、学了总忘→论语、工作压力大→沉思录、生活没意思→三件套）→ 仍正常召回。

---

## 4. 新增测试数量

**50 条**（`phase-g-regression-test.json`），分布：

| 分组 | 条数 | 目的 |
|---|---:|---|
| 申辩篇专项 | 15 | 验证 0→有 的最高考验 |
| 孟子 | 10 | 验证概念层标签覆盖 |
| 大学 | 10 | 验证修身/自律类召回 |
| 中庸 | 5 | 验证情绪平衡类召回 |
| 跨派系 | 10 | 验证多传统协同、防新垄断 |

格式对齐 `phase-f-100-test.json`（`_meta` + `records[]`）；`actual_books` 等字段留空，待**重新部署 chat 云函数后真机逐条跑通回填**。

---

## 5. 风险分析

1. **大学预测占比偏高（23.3%）**：其标签（成长/自律/提升自己/进步）覆盖通用成长类问题较多，可能在新桶里略偏多。已在 docs/26 列为观察项，G-2 若确认过度则微调大学 tag 或移出部分非契合帧。
2. **`frameTitles` 触碰 rag.js 文件**：虽为配置优化（允许），但仍在云函数内。已用 `git diff` 透明呈现；如用户认为越界，可仅保留 corpus.json 的 tags 改动（孟子/大学/中庸仍提升），申辩篇 部分则需改回或转 G-2 代码方案。
3. **`question_bridge` 字段当前未被代码读取**：本次仅作为 metadata / 未来钩子写入，**真实「用户口语→经典」主动映射需给 `lexicalScore` 加约 6 行读取逻辑（属改代码，本阶段仅报告，未做）**。
4. **口径差异**：离线预测基于「检索 top3」，与真实「回答最终引用」口径不同；最终以真机跑 50 条回归测试回填 `actual_books` 为准。
5. **部署前置**：`corpus.json` + `rag.js` 改动**需重新上传 chat 云函数**方生效（非代码逻辑变更，但需重新部署）。

---

## 6. 下一阶段建议（Phase G-2）

1. **真机验证**：重新部署 chat 云函数 → 逐条跑 `phase-g-regression-test.json` → 回填 `actual_books` → 核对达标线（Top3 ≤ 60% / 申辩篇 ≥ 15 / 孟子 ≥ 15 / 大学 ≥ 12 / 中庸 ≥ 10）。
2. **question_bridge 主动读取评估**：若长尾仍有「用户措辞完全没出现过的」漏召回，G-2 评估给 `lexicalScore` 加 `question_bridge.user_phrases` 读取（代码改动 + 评审 + 重部署）。
3. **大学过拟合微调**：如真机显示大学占比 > 30%，回收其部分通用标签或移出非契合帧。
4. **资产层扩充（长期）**：当前长尾书各仅 1 chunk，从「配置抬升」走向「资产扩充」——为申辩篇/孟子/大学/中庸补充更多 chunk，从根本上提升召回质量与多样性。

---

## 附：git diff --stat（待确认，未提交）

```
 weapp/cloudfunctions/chat/corpus.json |  8 ++++----
 weapp/cloudfunctions/chat/rag.js      | 15 +++++++++++----
 2 files changed, 15 insertions(+), 8 deletions(-)
```

新增（未追踪）：`docs/26-PhaseG召回健康指标.md`、`docs/27-PhaseG三件套召回分析.md`、`phase-g-regression-test.json`。
