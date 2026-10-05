# Phase R Freeze Integrity Report
### O-0.6 冻结基线完整性校验

| 项 | 值 |
|---|---|
| 基线代号 | O-0.6 |
| 校验时间 | 2026-08-05 12:26 (GMT+8) |
| 校验范围 | Phase R — Capability Layer 上线前审查 |
| 校验方法 | SHA256 逐文件比对（Before / After）+ mtime 佐证 |
| **结论** | **PASS** |

---

## 1. 冻结资产清单与校验结果

| # | 文件 | O-0.6 权威基线 | Before | After | 结果 |
|---|---|---|---|---|---|
| 1 | `cloudfunctions/chat/corpus.json` | `db01fbc9…eabc8b` | 一致 | 一致 | ✅ PASS |
| 2 | `cloudfunctions/chat/intent.js` | `765ad138…1560ca38` | 一致 | 一致 | ✅ PASS |
| 3 | `cloudfunctions/chat/rag.js` | `5b380b3f…ece1408286` | 一致 | 一致 | ✅ PASS |
| 4 | `cloudfunctions/chat/knowledgeRouter.js` | `848908445…36ffed0a935` | 一致 | 一致 | ✅ PASS |

### 完整哈希值（可复制核对）

```
db01fbc92064cbea3a6688a98160b6a70c9e150259b54063c8e2e96974eabc8b  corpus.json
765ad138ec68c0f159c6f75a60e5268beb02fba152f6d53dbdc539ba1560ca38  intent.js
5b380b3f7c68f374e3d4e5127bd7dbeff747849401ca9d0488498dece1408286  rag.js
848908445dbb5ea93a6f52775dc3c8e6922ff971d6cee115547f236ffed0a935  knowledgeRouter.js
```

**Before ≡ After ≡ 权威基线，三方完全一致。零漂移。**

---

## 2. mtime 佐证（本轮无写入）

| 文件 | mtime | 说明 |
|---|---|---|
| `corpus.json` | 19:57 | Phase G 及更早，本轮未触碰 |
| `intent.js` | 20:37 | 同上 |
| `knowledgeRouter.js` | 21:51 | 同上 |
| `rag.js` | 21:54 | 同上 |
| `capabilities/*.js` | 11:57–12:05 | Phase R 开发时段，本轮（12:26）未写入 |

SHA256 一致 + mtime 未刷新，**双重证据**排除"修改后又改回"的可能。

---

## 3. 冻结禁令逐条核验

| 禁令 | 核验方式 | 结果 |
|---|---|---|
| 禁止修改内容 | SHA256 比对 | ✅ 未修改 |
| 禁止格式化导致变化 | SHA256 对格式化敏感，任何空白/换行变更都会改变哈希 | ✅ 未发生 |
| 禁止自动生成覆盖 | 无生成脚本指向四资产；mtime 未刷新 | ✅ 未发生 |
| 禁止增加字段 | 同 SHA256 | ✅ 未发生 |
| 禁止调整逻辑 | 同 SHA256 | ✅ 未发生 |
| 禁止新增知识进入 `corpus.json` | 哈希一致，文件大小 9,903 B 未变 | ✅ 未发生 |
| 禁止实时数据进入 RAG | `capabilities/` 零 `db.` 写入、零 corpus 引用；能力路径 `citations` 恒为空 | ✅ 未发生 |
| 禁止 Capability 内容 embedding | `capabilities/` 全目录零 embedding/向量化调用（测试 K 组断言锁定） | ✅ 未发生 |
| 禁止修改 Prompt 核心人格 | `ROLE_PROMPT` 位于冻结 `rag.js` 内，哈希一致即证未改 | ✅ 未发生 |

---

## 4. 冻结资产的合法依赖关系

Phase R 对冻结资产**只存在一处引用，且为只读消费**：

```js
// capabilities/index.js:35
classifyIntent = require('../intent').classifyIntent;
```

性质说明：

- 调用冻结**纯函数**获取意图结论（主要用于危机让位），不修改其行为、不复制其逻辑、不覆盖其导出。
- 包 try/catch，`intent.js` 不可用时降级为 `null`，不产生硬依赖。
- `intent.js` 不反向引用 `capabilities/`，无循环依赖。

与 Phase P+ 观测层调用 `knowledgeRouter.routeQuestion` 的模式一致，属既有惯例内的合法只读引用。

---

## 5. 非冻结改动文件的可回滚性

Phase R 修改了 2 个**非冻结**文件，均具备改前副本：

| 文件 | 基线副本 | 位置 |
|---|---|---|
| `chat/index.js` | `chat-index.js.o06.bak` (8,173 B) | `weapp/scripts/baseline-o0.6/` |
| `chat/observability/observabilityLogger.js` | `observabilityLogger.js.o06.bak` (5,316 B) | 同上 |

副本哈希记录于同目录 `SHA256SUMS.txt`。**L2 回滚具备完整执行条件。**

---

## 6. 结论

**Freeze Integrity: PASS。**

Phase R 全程未破坏 O-0.6 冻结基线。能力层为纯增量旁路模块，与知识层的唯一接触面是一次对冻结纯函数的只读调用。冻结资产**无需回滚**——它们从未被改动。
