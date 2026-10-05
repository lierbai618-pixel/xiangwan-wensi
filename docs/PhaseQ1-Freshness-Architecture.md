# Phase Q1 — Freshness Layer 架构落地文档
## 热点思辨模式 · 工程实现（2026-08-05）

> 上游：`PhaseQ0-Freshness-Policy.md`（政策）、`PhaseQ-FreshnessLayer-Design.md`（设计）
> 本文档：实现态架构。Q0 政策与本文档冲突时，以 Q0 政策为准。
> 冻结遵守：corpus.json / intent.js / rag.js / knowledgeRouter.js 零改动（SHA256 已复核）。

---

## 1. 接入方式：旁路包装（Bypass Wrapper）

```
chat/index.js
  msgSecCheck(入参)
      │
      ▼  FRESHNESS_ENABLED=true 时启用（默认关 = 零行为变化）
  freshness.maybeHandle(message, { turn, models, mode, history })
      │        │
      │ null   │ Category A / 危机信号 / 任何异常
      ▼        ▼
  generateAnswer()  ←—— 原冻结链路，唯一兜底，100% 不变
      │
  answerId → msgSecCheck(出参) → logObservation(+freshness 字段) → logs
```

**关键不变量**：
- Freshness 永不阻断原链路：返回 null 或抛异常 → 直落 `generateAnswer`。
- Freshness 输出仍过出参 msgSecCheck——政策层与机制层双保险。
- 危机信号：Freshness 不拦截，交还原链路最高优先级危机处理。

## 2. 模块地图（cloudfunctions/chat/freshness/）

| 文件 | 职责 | 对应 Q0 章节 |
|------|------|-------------|
| `schema.js` | event_context / 枚举 / Boundary 留痕结构，强制校验 | §3 §4 |
| `eventClassifier.js` | Category A/B/C/D + user_intent_layer（information/reflection/emotion） | §2 §5 |
| `boundaryCheck.js` | normal/sensitive/restricted 三级闸门，独立于 Prompt，留痕 | §3 |
| `eventRetriever.js` | 检索源抽象（provider=none/http），自带 Node16 nodeFetch | §1 §6 |
| `factExtractor.js` | 事实抽取 + 观点/不确定/冲突标记隔离 | §4 |
| `contextBuilder.js` | event_context 构建（状态机 grounded/ambiguous/unverified + TTL） | §3 §4 |
| `downgrade.js` | 降级三动作（邀请补充/普遍人性/诚实边界），emotion 优先 | §6 |
| `responder.js` | 五段式生成：复用 rag.js 只读导出 + 护栏注入 + guardOutput 硬检 | §4 §7 |
| `index.js` | 编排器：分类→闸门→检索→抽取→上下文→生成，逐级降级 | 全文 |

## 3. 分类决策表（eventClassifier）

| 优先级 | 条件 | 结果 |
|--------|------|------|
| 1 | 命中敏感话题信号（网传/爆料/灾难/未成年/政治…） | **D**（无需另验锚点） |
| 2 | 无事件锚点（时间/媒介/指代/事件名词/争议句式） | **A** → 原 RAG |
| 3 | 显式事实框架（"经过是什么/来龙去脉/是真的吗"）且无反思框架 | **C** |
| 4 | 显式反思框架（"为什么发生/人性角度/说明了什么"） | **B**（模糊指代 → confidence=low → 澄清） |
| 5 | 意图层兜底：knowledge→C / life·opinion·emotion→B | medium 置信 |
| 6 | 均不命中 | **C**（歧义从保守） |

## 4. 状态机与降级映射

```
B 类 → boundaryCheck
  ├─ restricted ────────────→ 降级（restricted_event）
  ├─ retrieve 失败 ─────────→ 降级（no_provider / no_reliable_fact）
  ├─ 冲突+低置信 ───────────→ 降级（conflicting_info）
  ├─ contextBuilder null ───→ 降级（insufficient_source）
  ├─ 模型全失败/硬检违规 ───→ 降级（model_unavailable / guard_rejected:*）
  └─ 通过 ──────────────────→ 五段式生成（mode=freshness）
C 类 → 事实边界 + 反思邀请（category-C-guidance）
D 类 → 安全降级（不检索、不生成 event_context）
```

## 5. event_context（schema.js 强制校验）

```json
{
  "event_id": "evt_<hash>", "status": "grounded|ambiguous|unverified",
  "fact_summary": ["每句映射到 sources，否则构建即拒绝"],
  "unknown_points": ["必填非空——空即校验失败"],
  "source_confidence": "high|medium|low",
  "interpretation_boundary": { "opinions": [], "unknowns": [] },
  "sources": [{ "title", "url", "source", "publishedAt" }],
  "ttl_ms": 21600000, "expires_at": "ISO8601"
}
```

硬规则（代码级执行）：
- `unknown_points` 空 → 抛错；`unverified` 携带事实 → 抛错；`ambiguous` 事实 >2 句 → 抛错。
- `restricted` → contextBuilder 直接返回 null，event_context 不可能被生成。
- TTL 6h，`isEventContextFresh` 判定过期即失效；事实永不写入语料/向量库。

## 6. 护栏双层执行

**Prompt 层**（responder.buildFreshnessGuardrails）：事实限于底座、事实 ≤1/3、未知必承认、观点必归属、不裁决、不站队、emotion 先承接。

**代码层**（responder.guardOutput，违规即拒答回退降级）：
- `causal-assertion`：「事情的原因就是/真相就是/根源就是」
- `verdict-stance`：「明摆着是…的错/他就是人渣」类
- `unverified-accusation`：「肯定是贪污/炒作」类
- `missing-unknown-acknowledgement`：unknown_points 非空但回答无未知承认句式
- `ambiguous-detail-overflow`：ambiguous 级回答出现 >2 处具体数字/日期

## 7. 观测（observability_logs 增量字段）

`freshness: { category, user_intent, event_status, source_confidence, downgraded, downgrade_reason, boundary:{event_id,level,signals,timestamp}, guard_violations }` —— 非热点路径恒为 null，向后兼容。

## 8. 环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `FRESHNESS_ENABLED` | 关 | 总开关（一键回滚点） |
| `FRESHNESS_SEARCH_PROVIDER` | `none` | `none`=永远诚实降级；`http`=通用 JSON 检索端点（Q2 选型后启用） |
| `FRESHNESS_SEARCH_URL` / `_KEY` / `_TIMEOUT` | 空 | http provider 配置 |

## 9. 当前限制（诚实声明）

1. **生产无检索源**：provider=none 下 B 类全部走诚实降级——这是设计行为，不是缺陷。真实合规检索源选型是 Q2 的准入门槛。
2. **分类器为规则法**：依赖中文信号词表，覆盖评测集 120/120，但对未见句式可能保守误判（方向永远是更保守，不会更激进）。
3. **LLM 链路未在沙箱实测**：模型调用代码路径经单测桩验证（降级回退），真实模型质量须 Q2 灰度验证。
4. **部署须手动**：SCF 上传端点沙箱不可达，chat 云函数须在微信开发者工具「上传并部署：云端安装依赖」。
