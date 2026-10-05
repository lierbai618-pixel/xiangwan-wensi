# Phase Q2-20：职业前缀+人名分类修复（解决「脱口秀演员房主任」不检索）

**日期**: 2026-08-07 22:55
**状态**: ✅ COMPLETED / 已部署
**触发**: 用户反馈「脱口秀演员房主任」仍走五段式哲学模板，而豆包给出了完美的 factual 回答

## 问题现象

用户问「脱口秀演员房主任」，小程序回答：
> 【理解】你提到"脱口秀演员房主任"，听起来像是一个具体的人...
> 【分析】在脱口秀圈，"房主任"更大概率是一个临时性角色名...

而豆包回答了完整的 factual 信息（本名、年龄、出身、走红原因、塌房经过、争议点）。

## 根因分析

### Bug：分类器守卫条件遗漏（主因）

**文件**: `freshness/eventClassifier.js:139`

```javascript
// 修复前（❌ 只检查 isPersonIdentity）
if (!anchor.hasAnchor && !isPersonIdentity) {
    return { category: A, reason: 'no-event-anchor' }  // ← PROFESSION_PREFIX_RE 永远到不了
}
```

执行顺序：
1. 第 135 行：`isPersonIdentity = PERSON_IDENTITY_RE.test(q)` → 「脱口秀演员房主任」无"是谁" → **false**
2. 第 139 行：`!anchor.hasAnchor`(true) && `!isPersonIdentity`(true) → **直接返回 A 类**
3. 第 185 行的 ②-e `PROFESSION_PREFIX_RE` **永远执行不到**

### 次要问题：百炼消歧限制

| 问法 | 搜索 query | 百炼返回 | 原因 |
|------|-----------|---------|------|
| 脱口秀演员房主任 | 脱口秀演员房主任 | ✅ 房绍莉(脱口秀) | 有职业前缀消歧 |
| 房绍莉是谁 | 房绍莉是谁 | ✅ 房绍莉(脱口秀) | 本名无歧义 |
| 房主任是谁 | 房主任是谁 | ❌ 医生房世保 | 纯艺名多义词 |
| 介绍一下房主任 | 介绍一下房主任 | ❌ 群聊群主 | 无上下文 |

## 修复方案

### Fix 1：守卫条件补全（eventClassifier.js）

```javascript
// ①-b：同时检测人物身份 + 职业前缀
var isPersonIdentity = PERSON_IDENTITY_RE.test(q);
var isProfPrefix = PROFESSION_PREFIX_RE.test(q.trim());  // Q2-20 新增

// ② 守卫：两个都穿透
if (!anchor.hasAnchor && !isPersonIdentity && !isProfPrefix) {
    // ...
}
```

### Fix 2：新增 PROFESSION_PREFIX_RE 正则

```javascript
var PROFESSION_PREFIX_RE = /^(脱口秀(演员)?|演员|歌手|主持人|导演|作家|诗人|画家|
  科学家|运动员|教练|网红|博主|UP主|主播|艺人|明星|偶像|模特|舞者|
  钢琴家|小提琴家|吉他手|厨师|企业家|CEO|创始人|政治家|教授|医生|律师|
  记者|编辑|播音员|脱口秀|相声|小品|魔术师).{0,8}[\u4e00-\u9fa5]{2,6}$/u;
```

命中时归 B + `directFactual: true`（走快速 factual 通道）。

## 验证结果

```
=== Q2-20 职业前缀+人名 分类 + 消歧验证 ===

脱口秀演员房主任  ✅ B + 快速通道 + 完美答案(525字)
  → 本名房绍莉、1975年、山东临沂、初中学历、脱口秀、停演3月

演员赵丽颖        ✅ B + 快速通道 + 完美答案(525字)
  → 1987年、河北廊坊、85后代表、《还珠格格》/《知否》

歌手周杰伦        ✅ B + 快速通道 + 完美答案(525字)
  → 1979年、台湾新北市、亚洲流行天王、中国风先声

房绍莉是谁        ✅ B + 快速通道 + 完美答案(525字)
  → 同「脱口秀演员房主任」

什么是人生意义    ✅ A 类（不受影响，不检索）
```

## 修改文件清单

| 文件 | 改动 |
|------|------|
| `freshness/eventClassifier.js` | 新增 PROFESSION_PREFIX_RE；①-b 加 isProfPrefix 检测；② 守卫加 !isProfPrefix；新增 ②-e 规则 |

**冻结资产 SHA 4/4 不变**

## 已知限制（非 bug）

1. **纯艺名无上下文查询**（如「房主任是谁」）：百炼合成模式无法消歧多义词，可能返回错误实体。解决方案：用户使用带职业前缀或本名的问法。
2. **与豆包的质量差距**：豆包使用更强的搜索索引 + 可能有多轮上下文。当前百炼合成模式是单轮零上下文，对冷门人物效果弱于头部人物。
