# Phase Q2-15: 传记幻觉防护（Biography Anti-Hallucination）

**日期**: 2026-08-07 19:58
**触发**: 用户反馈「付航是谁」→ 模型编造"北航本科+中科院硕士"，实际付航仅大专毕业
**状态**: ✅ 已部署 | 测试全绿 | 冻结资产不变

---

## 问题根因

**链路追踪**：「付航是谁」→ eventClassifier 无时间锚点 → **Category A**（`no-event-anchor`）→ freshness **完全不介入**（返回 null）→ 落到无防护的 RAG/LLM 路径 → 模型从训练数据**自信地编造学历/履历**

关键数据点：
- freshness 的反幻觉硬闸（D-a）只作用于 Category B/D 响应
- Category A = "纯哲学问题，freshness 不介入"——这对哲学问题正确，但对**人物身份查询**是灾难性的
- RAG/generateAnswer 路径**无任何传记事实防护**
- LLM 对中国公众人物的学历信息**错误率极高**（训练数据混杂百科/论坛/谣言）

## 修复内容（三层纵深）

### 第 1 层：分类器入口拦截（eventClassifier.js）

新增 `PERSON_IDENTITY_RE` 正则：
```
/(是谁|谁$|何许人也|介绍一下.{0,20}$|.{2,10}是什么人|.{2,10}是何许人|你认识.{2,10}|你知道.{2,10}吗$)/u
```

修改 `classifyCategory()`：
- 在 `!anchor.hasAnchor → A` 短路之前，检测人物身份标记 `isPersonIdentity`
- 若命中，**跳过 A 类短路**，穿透到后续分类
- 歧义兜底（第 ⑥ 步）：`isPersonIdentity` 时返回 **Category B**（触发搜索）而非 C

效果：「付航是谁」「郭德纲何许人也」「介绍一下马云」等全部归 B（联网检索路径），哲学问题「人生的意义是什么」仍归 A。

### 第 2 层：降级文案专用化（downgrade.js）

新增 `PERSON_IDENTITY_TEMPLATES`（2 条模板）：
> "关于这个人的具体背景（学历、经历、履历等），我没有可靠的信息来源可以核实，不能凭印象给你细节——这类信息错一处就可能误导你。"

修改 `buildDowngrade()`：
- 检测 query 是否匹配人物身份模式
- 匹配时使用 `person_identity_boundary` 动作（最高优先级，覆盖 intent 类型判断）
- 效果：搜索无结果时，用户看到的是**明确拒绝编造传记**的诚实文案，而非通用降级

### 第 3 层：输出硬检（responder.js）

新增 `BIOGRAPHY_HALLUCINATION_RES`（3 条检测模式）：
- `unsourced-degree`: `/ (毕业(于|自)|本科|硕士|博士|大专|研究生).{0,20}(大学|学院|学校|研究院) /u`
- `unsourced-birth`: `/ (出生于|生于).{0,4}(\d{4}年|\d{3,4}年) /u`
- `unsourced-career`: `/ (曾(任|经|在)|从事).{0,30}(工作|职业|行业|岗位) /u`

集成到 `guardOutput()`：
- 在无事实底座（`eventContext=null/unverified/ambiguous`）时启用
- 有 grounded 底座时假定传记信息来自检索来源，不拦截
- 命中即视为违规 → 不交付该回答 → 回退降级文案

额外护栏指令（`buildFreshnessGuardrails`）：
- Category B + 无事实底座时注入：**"严格禁止断言此人的学历、毕业院校、出生日期、家庭背景、具体履历等细节——即使你'记住'也不要写"**

## 验证

### 新增测试 test_q33.js：36 PASS / 0 FAIL
| # | 验证项 | 断言数 |
|---|--------|--------|
| 1 | 人物身份查询归 B（8 个 query 全覆盖） | 16 |
| 2 | 非人物身份不受影响（哲学→A/新闻→B） | 5 |
| 3 | freshness 路由不被短路 | 2 |
| 4 | 人物身份专用降级模板 | 5 |
| 5 | 传记幻觉输出检测（学历/生日/安全回答） | 7 |
| 6 | 护栏指令生成 | 1 |

### 回归测试：4 套件 0 失败
| 套件 | 断言数 | 状态 |
|------|--------|------|
| test_q29.js (Q2-10 通用适配器) | 225 | ✅ |
| test_q30.js (Q2-12 腾讯WSA) | 104 | ✅ |
| test_q31.js (Q2-13 Qwen) | 132 | ✅ |
| test_q32.js (Q2-14b 分类器修复) | 29 | ✅ |
| **累计** | **526** | **0 FAIL** |

### 冻结资产 SHA256：4/4 不变
| 文件 | SHA256（首16位） |
|------|------------------|
| corpus.json | `db01fbc92064cbea…` ✅ |
| intent.js | `765ad138ec68c0f…` ✅ |
| knowledgeRouter.js | `848908445dbb5ea…` ✅ |
| rag.js | `4fb2dca42597a27…` ✅ |

### 部署
- `tcb fn deploy chat --force` ✅ 成功（COS 上传）

## 改动文件清单（非冻结）
| 文件 | 改动类型 |
|------|----------|
| `freshness/eventClassifier.js` | +PERSON_IDENTITY_RE + 分类逻辑修改 |
| `freshness/downgrade.js` | +PERSON_IDENTITY_TEMPLATES + buildDowngrade 分支 |
| `freshness/responder.js` | +BIOGRAPHY_HALLUCINATION_RES + guardOutput 集成 + 护栏指令 |
| `scripts/test_q33.js` | 新增回归测试 |

## 用户验证指引
部署后用自己微信号（ADMIN_OPENID，已在 canary 白名单）测试：
1. 「付航是谁」→ 应触发联网检索；若搜索无结果则显示**诚实降级**（"我没有可靠来源"），**不再编造学历**
2. 「今天有什么科技新闻」→ 仍走联网（不受影响）
3. 「人生的意义是什么」→ 仍走 RAG/思辨（不受影响）

## 关联阶段
- Q2-14: freshness 短路修复（`searchLayer.getProviderName`）
- Q2-14b: 分类器路由修复（CURRENT_EVENT_NOUN_RE 扩展）
- Q2-15（本阶段）: 传记幻觉三层防护
