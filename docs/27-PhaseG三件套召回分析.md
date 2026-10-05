# Phase G 三件套召回分析（为什么《论语》《道德经》《沉思录》总是优先）

> 目的：先定位原因，再决定改法。原则 = **抬升长尾，不简单压低三件套权重**（用户指令）。
> 分析对象：`cloudfunctions/chat/rag.js` 的 `legacyRetrieve` + `frameTitles` + `corpus.json`。
> 结论摘要：主因是 **`frameTitles` 的 +100 帧偏置分配不均** 与 **tag/向量(TF)对通用词的偏向**；`question_bridge` 字段在代码中**当前并未被读取**（详见 §4）。

---

## 0. 检索打分公式（事实基线）

`legacyRetrieve` 对每篇文档的得分：

```
score = lexical + vectorScore * 24 + sourcePriority + preferredBoost
  lexical      : 词法匹配（tags 精确 +12 / 包含 +7，title +6，section +5，summary +4，text +3，haystack +1）
  vectorScore  : cosine(查询词频向量, 文档词频向量)  ← 注意：是「词频 TF 余弦」，非神经嵌入
  sourcePriority: imported 才 +2，seed 全 0
  preferredBoost: 命中当前 frame 的优先书目 → +100（决定性权重）
```

最终 `filter(score >= 4)` 后取 top3，且优先书目整体前置（`preferredRanked` 先于 fallback）。

---

## 1. chunk 数量是否过多？

**否，非主因。**

| 书 | chunk 数 |
|---|---:|
| 论语 | 2 |
| 道德经 | 2 |
| 沉思录 | 2 |
| 庄子 | 2 |
| 孟子 / 大学 / 中庸 / 申辩篇 / 爱比克泰德 / 尼各马可 | 各 1 |

三件套各 2 chunk，与庄子相同；长尾书多为 1 chunk。chunk 数量并未向三件套倾斜，故**数量不是垄断来源**。真正起作用的是「每 chunk 的得分上限」与「是否被 +100 偏置覆盖」。

---

## 2. metadata（tag）覆盖是否过宽？

**是，部分原因。**

三件套的 tag 偏向**高频通用现代词**，与大量用户问题词法重叠：

- 道德经：`自知 / 内耗 / 成长 / 不争 / 柔和 / 相处`
- 沉思录：`控制 / 内心 / 安宁 / 情绪 / 判断 / 接受`
- 论语：`学习 / 实践 / 成长 / 自省 / 长期主义 / 立志`

这些词（成长 / 情绪 / 内耗 / 控制 / 实践）几乎出现在任何人生困惑类提问中 → 词法 +12/+7 频繁触发。长尾书 tag 偏「专指」（孟子原仅 `逆境/成长/坚持`、大学原仅 `修身/自我管理/知行`），与用户口语错位 → 词法几乎不命中。

**Phase G 对策**：不是收窄三件套 tag（会伤稳定性），而是**拓宽长尾 tag** 到用户口语层（见 corpus.json 改动）。已验证：孟子/大学/中庸 召回显著回升，三件套典型问题仍正常召回。

---

## 3. embedding 相似空间是否偏移？

**是，但这里的「embedding」实为 TF 词频余弦，偏移方向 = 偏向通用词文档。**

`vectorScore = cosine(queryVec, docVec)`，其中 `docVec` 由 `documentText()` 构建，覆盖 `text + summary + modernUsage + caution + tags`。三件套的 `modernUsage/caution` 使用大量通用生活词（"少和人比""把注意力放回能改变的地方"），使其 TF 向量与多数查询更近 → `vectorScore*24` 偏高。

长尾书原文偏古典、modernUsage 偏窄 → TF 向量稀疏 → 向量分低。

**这是「向量偏移」的真实形态**：不是模型偏见，而是**语料表述风格偏向**。Phase G 未引入神经嵌入（架构不变），故该偏移主要靠 tag 拓宽 + 帧配置对冲，而非重训向量。

---

## 4. question_bridge 是否过泛？—— 关键发现

**当前代码中 `question_bridge` 字段根本不存在 / 未被读取。**

检索只读取以下字段（`lexicalScore` / `documentText`）：
`title, section, source, text, summary, modernUsage, caution, tags`。

即：用户设想的「用户语言 → 哲学概念 → 经典章节」映射机制，**在现有代码里没有对应实现**。现存唯一生效的「桥」是：
- `tags`（已读取，Phase G 已拓宽）
- `frameTitles`（配置表，Phase G 已调整）
- `topicLexicon`（代码内写死的「主题词→同义词」表，非按书组织）

**因此 Phase G 的「question_bridge 优化」以两种形式落地：**
1. **生效层（代码已读）**：把桥的「概念层」直接写进 `tags`——tags 即「用户口语词 ↔ 哲学概念」的映射载体。这是本阶段实际产生召回提升的主杠杆。
2. **文档/钩子层（代码未读）**：在 `corpus.json` 每本书新增 `question_bridge: { concepts, user_phrases, maps_to }` 字段，显式记录三层映射，作为可审计的桥接资产与未来代码钩子。

> ⚠️ **必须修改代码的边界（本报告仅分析，不改）**：若要让 `question_bridge.user_phrases` 被**主动映射**（而非仅靠 tags 被动命中），需在 `lexicalScore` 中新增一段：当用户 query 命中某 chunk 的 `question_bridge.user_phrases` 时给予加权（约 6 行）。这属于「必须修改云函数逻辑」，按执行原则**先报告、不直接改**，建议放入 Phase G-2 评估。

---

## 5. 主因排序与 Phase G 对策映射

| 排名 | 原因 | 是否主因 | Phase G 对策 | 是否改代码 |
|---|---|---|---|---|
| 1 | `frameTitles` +100 偏置：三件套覆盖 general+emotion 两大桶，申辩篇 0 帧 | **是** | 将申辩篇加入其主题契合帧；孟子/大学/中庸补入 general 桶 | 仅改配置值（retrieval 配置优化） |
| 2 | tag 语义过宽 + TF 向量偏向通用词 | 是 | 拓宽长尾 tag 至用户口语层（concept 层） | 否（tags 已读） |
| 3 | question_bridge 机制代码中不存在 | 结构性 | tags 承载概念桥 + 加 metadata 钩子 | 钩子否；主动读取需 G-2 代码改动 |
| 4 | chunk 数量 | 否 | 不动 | 否 |

---

## 6. 为什么「抬升长尾」而非「压低三件套」

- 优先权重 +100 保持不变；仅调整「哪些书进入哪些帧」。
- 所有优先书在帧内**平等获得 +100**，最终 top3 由「词法+向量」决胜 → 长尾书仅在**真正相关**时才进 top3，不会无脑挤占。
- 离线验证：三件套典型问题（内耗/学了总忘/工作压力大）仍稳定召回，未塌方（见 docs/26 §5 与回归测试）。

---

## 7. 残留风险与 G-2 建议

1. **大学预测占比偏高（23.3%）**：其标签（成长/自律/提升自己/进步）覆盖通用成长类问题较多。G-2 若确认过度，可微调大学 tag 或将其移出部分非契合帧。
2. **申辩篇真实提升需新题型验证**：原 100 问不含苏格拉底类问题，申辩篇的 0→有提升将由 `phase-g-regression-test.json`（15 条）实测确认。
3. **question_bridge 主动读取**：如需更强「用户口语→经典」映射（尤其应对完全没出现过的措辞），G-2 评估给 `lexicalScore` 加 ~6 行 `question_bridge` 读取逻辑——届时需走代码评审 + 重新部署。
