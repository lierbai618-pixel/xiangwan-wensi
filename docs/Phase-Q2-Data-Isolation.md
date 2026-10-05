# Phase Q2 数据隔离规范（Data Isolation）

> 版本：v1.0（设计冻结稿，禁止代码修改）
> 状态：Phase Q2-0
> 核心原则（计划书）：搜索负责事实，RAG 负责智慧，模型负责思考；互联网数据永不污染长期知识库。
> 关联：Phase-Q2-Architecture.md §6、Phase-Q2-Search-Policy.md

---

## 1. 永久知识库禁写硬规则

以下资产为冻结长期知识，Q2 任何阶段**禁止写入/修改**：

| 资产 | 禁止操作 |
|---|---|
| `corpus.json` | ❌ ingest、❌ 追加、❌ 修改条目 |
| `embedding` | ❌ 对搜索结果做向量化入库 |
| `metadata` | ❌ 写入搜索来源/时间/来源标记 |
| 知识库集合（云数据库） | ❌ 插入 search 结果文档 |

**唯一可信事实底座**：Search Provider 返回的 `results` 仅存在于**请求处理内存**中，随回答生成结束即释放。

---

## 2. search_context 请求级生命周期

```
请求开始
  → Search Provider.search(query) 返回 results
  → results 存入本次调用的局部变量 searchContext（闭包/请求对象）
  → Fact Extractor 抽取事实 → 注入 Reasoning Prompt
  → 回答生成 → searchContext 随函数返回被 GC
请求结束
  ✅ searchContext 不落任何持久化 KB
```

- `searchContext` **可以**短暂存在于 `logs` / `observability_logs` 的 **citations 字段**（仅 url/title/source，见 §3），但**绝不**进入 corpus/embedding/metadata。
- 禁止：把 `searchContext` 写入会话历史（history）作为后续 RAG 检索语料——否则间接污染。

---

## 3. 可观测日志 vs 知识库边界

现有三集合（`logs` / `question_logs` / `observability_logs`）是**观测层**，非知识层。

| 集合 | 可否记录搜索引用 | 可否记录搜索摘要全文 | 可否写入 corpus |
|---|---|---|---|
| `observability_logs` | ✅ citations(url/title/source) | ⚠️ 仅脱敏后片段 | ❌ 禁止 |
| `logs` | ✅（如适用） | ⚠️ 受 OBS-009-C 约束 | ❌ 禁止 |
| `question_logs` | 不涉及 | 不涉及 | ❌ 禁止 |
| `corpus` / 知识库 | —— | —— | ❌ 永远禁止 |

- **PII 脱敏**：搜索 snippet 可能含用户/第三方 PII，落库前必须过 `piiScrub.mask`（沿用 CR-002）。OBS-009-C 已指出 `logs` 明文隐私敞口大于 `observability_logs`，搜索接入后此敞口扩大——**Q2-3 须将搜索 snippet 脱敏后再记录**。
- **引用 ≠ 知识**：`citations` 是出处标注，不是知识沉淀。

---

## 4. 隔离违反检测（测试/CI 断言）

Q2-1/2-2/2-3 每阶段结束必须跑：

```js
// 伪代码：隔离断言
const before = sha256(corpus.json) + sha256(embeddingDir) + sha256(metadata);
await runSearchPipeline(testQuery);          // 含真实/mock 搜索
const after  = sha256(corpus.json) + sha256(embeddingDir) + sha256(metadata);
assert(before === after, 'KB 被搜索污染！');  // 必须 4/4 + embedding 全一致
```

- 单元测试中：`mock` provider 注入含「假事实」的结果，断言最终 `corpus` 无新增文档。
- 集成测试中：断言 `result.citations` 存在但 `rag` 检索语料不含搜索文本。

---

## 5. 硬性禁止清单（违反即回滚）

1. ❌ 搜索结果 `ingest` 进 corpus
2. ❌ 对搜索结果做 `embedding` 并入库
3. ❌ 修改 corpus `metadata` 标记「来自搜索」
4. ❌ 把搜索文本写入 `history` 作为后续 RAG 语料
5. ❌ 把搜索 snippet 原文（未脱敏）写入 `logs`/`observability_logs`
6. ❌ 任何让互联网数据进入「长期记忆/用户画像」的路径

---

## 6. 与既有隐私/观测问题的关联

- **OBS-009-C（logs 明文敞口）**：搜索接入会新增 snippet/url 明文。`Q2-3` 须在 `logObservation` 调用前对 search 相关字段脱敏；或在 `observability_logs` 仅存 citations，不存 snippet 全文。
- **CR-005（msgSecCheck 0% 可用）**：搜索文本呈现前的 `msgSecCheck` 仍受 `-501001`/`-40003` 影响，Q2-1 接入时需确认安全扫描降级策略（沿用 `SEC_DEGRADE_ON_API_ERROR` 默认 true）。

---

## 7. 本阶段（Q2-0）约束

- ❌ 不写任何隔离检测代码（仅设计规范）。
- ❌ 不修改 `corpus.json` / `rag.js` / `observabilityLogger.js` / `piiScrub.js`。
- ✅ 本规范作为 Q2 全阶段数据安全的强制基线，每次提交/部署前比对 SHA。
