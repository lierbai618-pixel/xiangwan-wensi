# Phase Q2-3 实现报告：问思融合引擎（Think Fusion Engine）

> 项目：向晚问思 (WenDao) · 微信云开发小程序 AI 思辨助手
> 阶段：Q2-3（三层轨道架构 → 问思融合编排）
> 日期：2026-08-06
> 状态：**已完工 · 未部署 · 等待下一阶段授权**

---

## 0. 授权范围回顾

| 项 | 授权 | 本阶段执行 |
|---|---|---|
| 新增 `think/` 模块 | ✅ 允许 | 4 文件就位 |
| 新增测试文件 | ✅ 允许 | `scripts/test_q23.js`（84 断言） |
| 修改非冻结编排代码 | ✅ 允许 | `index.js` 2 处插入 |
| 改 corpus.json / intent.js / knowledgeRouter.js / rag.js | ❌ 禁止 | **未触碰，SHA 4/4 MATCH** |
| 部署 | ❌ 禁止 | **未部署** |
| 接真实搜索 API | ❌ 禁止 | `SEARCH_PROVIDER=mock` 保持 |
| 改知识库 | ❌ 禁止 | **未改** |

---

## 1. 交付物清单

### 新增：`cloudfunctions/chat/think/`（4 模块，请求级生命周期）

| 文件 | 行数 | 职责 |
|---|---|---|
| `thinkEngine.js` | ~370 | 三模式分流编排器（核心）。`run(message, opts)` 返回 `result\|null`，返回 `null` 即不接管、交回冻结链路。 |
| `factExtractor.js` | ~200 | 事实抽取层。把 Search Provider 统一结果规整为带来源/置信的原子事实 `Fact[]`，铁律「无 URL 不可核实即丢弃」。 |
| `reasoning.js` | ~180 | 思想层（纯派生）。只输出假设/张力/开放问题三类非断言句式，严禁生成新事实。 |
| `citation.js` | ~160 | 引用层。统一 `fact` + `classic` 引用，融合引用走 `result.think.citations`，不破坏既有 `result.citations`。 |

### 新增测试：`scripts/test_q23.js`（84 断言，全依赖注入 / 离线零网络）

### 修改：`cloudfunctions/chat/index.js`（2 处，非冻结编排代码）

1. **加载 thinkEngine**（CAPABILITY 块之后）：`THINK_ENGINE_ENABLED` 开关 + try/catch 软加载，失败回退原链路。
2. **派发插入**：在 `if (!result && freshnessMaybeHandle)` 之后、`generateAnswer` 兜底之前插入 thinkEngine 调用，同样 try/catch fail-soft。

### 备份：`cloudfunctions/chat/index.js.preQ23.bak`（17070 字节，L0 回滚点）

---

## 2. 三模式真实行为分流矩阵

| 模式 | 图标 | 真实行为 | 是否调模型 | 是否调 RAG | 是否调 Search | 思想层 |
|---|---|---|---|---|---|---|
| `fast` 🌐 | 快答 | 仅 Search → 确定性模板组装 | 否 | 否 | 是（有事实才接管） | 否 |
| `deep` 📚 | 深读 | 原 RAG 链路 | 是 | 是 | 否 | 否 |
| `think` 🌅 | 思辨 | Search + RAG + 思想层融合 | 是（RAG） | 是（只读打底） | 是（有事实才增强） | 是 |

**关键不变量：**
- `deep` 模式 `thinkEngine.run` **直接 `return null`**（逐字节零改动既有深读链路）。
- `fast` 模式无可用事实时 `return null`（交回原链路，不强行接管）。
- `think` 模式 RAG 仅作「只读打底」，事实与思想层在其上融合增强。

---

## 3. 三层派发序（严格优先级，本阶段嵌入 think 层）

```
① Capability（时间/天气/计算/位置）  ── 最高优先级，确定性实时事实
        ↓ 未接管
② Freshness（热点 B/C/D 安全闸）       ── 事件背景，需联网
        ↓ 未接管
③ thinkEngine（本阶段新增）            ── 三模式分流编排
        ↓ 未接管（return null 或异常）
④ generateAnswer（RAG 冻结兜底）       ── 既有知识库兜底
```

thinkEngine 插入在 Capability/Freshness 之后、generateAnswer 之前；deep 直接 return null 保证既有优先级不被抢占。

---

## 4. 核心机制

### 4.1 三重搜索准入闸（`searchGate`）
1. `FRESHNESS_FACTUAL_ENABLED=true`（事实源总闸）
2. `SEARCH_PROVIDER !== "none"`
3. `provider=mock` 时必须显式测试开关 `THINK_ALLOW_MOCK_FACTS=true`（**mock 永不服务真实用户**）

任一不满足 → 不进搜索、不增强。

### 4.2 事实层铁律（`factExtractor`）
- 无 `url` 的条目不可核实 → 丢弃（Q0 铁律）
- mock 结果默认硬拦（`filterUsable` 默认不含 mock）
- 多独立源 → `confidence=high`
- 观点/不确定措辞 → 降置信并标记

### 4.3 思想层铁律（`reasoning`）
- 只能重述/对照/追问既有材料
- 严禁生成任何新事实断言
- 无材料 → 返回空串（`derivedOnly: true`）
- 张力仅当「事实 × 经典」同时在场或「多源事实」时成立

### 4.4 反幻觉闸复用（`passesFabricationGate`）
- 复用 `freshness.detectFabrication`（D-a 闸），**刻意不复制第二份正则**
- 闸不可用时 fail-closed（不增强，交回原链路）

### 4.5 数据隔离（Search Context 只走 request 生命周期）
- `ThinkContext._ephemeral = true` 硬标记
- 出参仅 `toSafeMeta()` 脱敏元信息（来源数/事实数/模式），**绝不入 corpus / embedding / metadata / history**
- 测试证明：`corpus.json` SHA 在全部融合流程前后不变

### 4.6 旧 `mode` 字段兼容
- `plain / deep / classic` 原样透传 RAG 兜底
- `legacyMode` 在 `result.think` 元信息中留痕，便于观测与回滚审计

### 4.7 依赖注入（不污染冻结资产）
- `index.js` 向 `thinkEngine.run` 注入 `generateAnswer`（冻结资产）
- thinkEngine 不自行 `require` 冻结文件，避免耦合

### 4.8 fail-soft 容错
- thinkEngine 任何异常 → `catch` → `result = null` → 冻结链路兜底
- 一键熔断：`THINK_ENGINE_ENABLED=false` 即整体关闭

---

## 5. 新增开关一览

| 开关 | 默认值 | 作用 |
|---|---|---|
| `THINK_ENGINE_ENABLED` | `true` | think 层总闸，false 即整体熔断回退 |
| `THINK_REASONING_ENABLED` | `true` | 思想层闸，false 则不追加思辨 |
| `THINK_ALLOW_MOCK_FACTS` | `false` | 仅测试用，允许 mock 进入；真实用户永不应开 |
| `FRESHNESS_FACTUAL_ENABLED` | `false` | 事实源总闸（沿用 Q2-0 设计） |
| `SEARCH_PROVIDER` | `mock` | 搜索供应商路由（沿用 Q2-1-B 骨架） |

---

## 6. 测试结果

### Q2-3 专属（test_q23.js）
```
PASS: 84   FAIL: 0
```
覆盖 9 大块：factExtractor / reasoning / citation / searchGate / 反幻觉复用 / 三模式分流 / 增强抑制闸+旧mode兼容+数据隔离 / 派发优先级+冻结资产 / 四资产SHA。

### 全量回归（299 断言全绿）
| 套件 | 结果 |
|---|---|
| test_q21b | 37 PASS |
| test_freshness_q1 (Q1-B) | 31 PASS |
| test_freshness (Q1.5) | 32 PASS |
| test_capabilities (Phase R) | 75 PASS |
| test_pipeline | 16 PASS |
| test_security_hardening | 24 PASS |
| **test_q23 (本阶段)** | **84 PASS** |
| **合计** | **299 PASS / 0 FAIL** |

### 冻结四资产 SHA（复核 4/4 MATCH）
```
corpus.json       db01fbc9...74eabc8b  ✓
intent.js         765ad138...1560ca38  ✓
knowledgeRouter.js 84890844...fed0a935  ✓
rag.js            4fb2dca4...d58fc2b503 ✓
```

---

## 7. 回滚层级

| 层级 | 手段 | 影响 |
|---|---|---|
| L0 | `index.js.preQ23.bak` 直接还原 | 完全回到 Q2-3 前状态 |
| L1 | 关 `THINK_ENGINE_ENABLED=false` | think 层整体熔断，原链路兜底 |
| L2 | 关 `FRESHNESS_FACTUAL_ENABLED=false` | 事实源闸关闭，think 退化为纯 RAG |

---

## 8. 风险与开放项

- **真实搜索源激活仍卡 P1 OPEN**：需 ①搜索供应商 + API 密钥 ②跨境数据合规（小程序备案审核中）③成本配额（可先 mock 不阻塞）。本阶段未接真实 API。
- **mock 永不出域**：三重闸 + `filterUsable` 默认硬拦 + `buildFactCitations` 默认不输出，已测试证明用户可见文本无 `[MOCK]`。
- **未部署**：所有变更仅在源码层，未 `tcb fn deploy`，真机/线上无影响。

---

## 9. 禁止事项确认

- ✅ 未部署（未执行任何 deploy 命令）
- ✅ 未接真实搜索 API（`SEARCH_PROVIDER=mock`）
- ✅ 未修改知识库（corpus / embedding 未动）
- ✅ 未触碰四冻结资产（SHA 4/4 MATCH）

---

## 10. 下一步

等待下一阶段授权。建议候选方向：
1. **Q2-4 真实源接入**：供应商+密钥就位后，将 `SEARCH_PROVIDER` 切真实并补充真实源测试（需先解 P1 合规）。
2. **前端三模式选择器联动**（Q2-2 已落地前端未部署）：待部署时一并上。
3. **Observability 补真实样本**：R 观察期仍停滞（真实样本 <50），think 层需同样建观测。

---
*本报告由 WeChat Mini Program Developer Agent 在 Phase Q2-3 完工后产出。所有结论均有离线测试与 SHA 复核支撑。*
