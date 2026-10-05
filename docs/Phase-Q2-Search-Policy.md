# Phase Q2 Search Provider 技术政策

> 版本：v1.0（设计冻结稿，禁止代码修改）
> 状态：Phase Q2-0
> 关联：Phase-Q2-Architecture.md §3.1
> 当前现实：`eventRetriever.js` 已有 `provider=none` 抽象 + Node16 `nodeFetch`，`FRESHNESS_FACTUAL_ENABLED=false`。

---

## 1. 统一接口契约（强制）

所有 provider 实现必须产出同一形状，供 `freshness/` 与 `answerMode` 无差别消费：

```js
// providers/search/index.js
async function search(query, opts) ->
  Promise<{
    ok: boolean,
    provider: string,            // 'bing' | 'tavily' | 'serp' | 'mock' | 'none'
    results: Array<{
      title: string,             // 网页标题
      url: string,               // 规范 URL（用于引用）
      snippet: string,           // 摘要文本
      source: string,            // 域名/媒体名（如 "reuters.com"）
      time: string | null,       // 发布/更新时间（ISO，可能为空）
    }>,
    reason: string,              // ok=false 时的失败原因
    cached: boolean,             // 是否命中缓存
  }>
```

**硬性约束**：
- `url` 必须可解析、可引用；禁止返回 JS 重定向壳、禁止内联追踪参数（记录前剥离 `?utm_*` 等）。
- `snippet` 是模型唯一可见的事实底座；provider 不得注入自身观点。
- 失败一律 `ok:false` + `reason`，**绝不抛未捕获异常**（fail-soft 原则，继承自 CR-002 安全加固）。

---

## 2. 候选源对比（决策输入，非结论）

| 源 | 质量 | 合规（中国） | 成本 | 速率/配额 | 备注 |
|---|---|---|---|---|---|
| **Tavily** | 高（LLM 优化摘要） | 境外 SaaS，跨境数据 | 中（按查询计费） | 有免费档 | 最契合「事实+引用」场景，但数据出境需评估 |
| **Bing (Azure)** | 中高 | 微软云，企业协议可签数据处理条款 | 中 | 高 | 企业合规路径相对清晰，需 Azure 订阅 |
| **SerpAPI** | 高（Google 结果） | 境外 SaaS | 中高 | 有免费档 | 结果最全，但 Google 结果抓取合规敏感度高 |
| **Mock** | 固定 | 无 | 0 | 无限 | 仅测试/灰度验证用，永不服务真实用户 |

**合规红线（必须人工确认）**：
1. 当前小程序处于 **备案审核中** 状态（见工作记忆）。联网抓取并呈现第三方内容，可能触发《小程序服务内容声明》与平台内容安全责任扩大——**需先确认审核状态与类目是否允许「资讯/搜索」能力**。
2. 任何境外源 = 用户查询（可能含 PII）出境。须满足 PIPL 跨境传输要求或选择境内可签 DPA 的供应商。
3. 搜索结果中的图片/文本须经 `msgSecCheck`/`imgSecCheck`（沿用 CR-002 安全体系）方可呈现。

---

## 3. 默认 none + Mock（沿用 P1 OPEN 模式）

- `SEARCH_PROVIDER` 环境变量默认 `none` → `index.js` 路由到 `mock` 或直接返回 `ok:false`，**维持 Q1-B「无事实源反思」行为，零行为变化**。
- Mock provider 返回结构化假数据，供 Q2-1 单元测试与前端联调，**绝不进入生产回答**。
- 真实 provider 接入 = 独立开关事件，不随 `FRESHNESS_ENABLED` 自动开启。

---

## 4. 限流 / 缓存 / 失败降级

| 机制 | 策略 |
|---|---|
| **限流** | 每 openid 每分钟 ≤ N 次（N 待成本预算定）；超限返回 `ok:false reason:'rate_limited'` → 降级为无事实源反思。 |
| **缓存** | `query` 归一化（去空白/小写/繁简统一）为 key，TTL 可配（新闻类短，知识类长）；命中 `cached:true` 不计入配额。 |
| **超时** | provider 调用硬超时 ≤ 3s（Node16 环境），超时即 `ok:false` → 降级。 |
| **降级链** | provider 失败 → `freshness-downgrade`（诚实边界+反思），不编造、不阻塞主流程（沿用 downgrade.js）。 |
| **成本熔断** | 当日调用额达预算 80% 预警、100% 关停真实源回退 none（需新增轻量计数器，存云数据库 `search_quota` 集合，非 KB）。 |

---

## 5. 内容责任与引用

- **引用必填**：Fast/Think 模式回答必须附带 `citations`（≥1 条有效 url），否则视为不合格输出（测试断言）。
- **「信息可能变化」声明**：Fast 模式回答末尾固定追加时效提示（计划书 Mode 1 要求）。
- **搜索结果安全扫描**：呈现前对 `snippet` 过 `msgSecCheck`；含图则 `imgSecCheck`。（CR-002 体系已有 `checkTextSafety`，Search Provider 接入时串联。）
- **不背书**：回答措辞明确「根据公开信息」，不宣称权威核实。

---

## 6. 评估指标（Q2-1 验收）

| 指标 | 要求 | 测量方式 |
|---|---|---|
| 搜索成功率 | ≥95% | 50 条测试集（新闻/人物/产品/动态）调用真实源，ok=true 比例 |
| 来源完整 | 100% | 每条成功结果含 title+url+snippet+source |
| 无污染 KB | 100% | 断言 corpus/embedding/metadata 在搜索前后 SHA 不变 |
| 引用有效 | 100% | 回答 citations 中 url 可解析且非空 |
| 降级安全 | 100% | 失败时回答为诚实边界，无虚构事实（D-a gate 覆盖） |

---

## 7. 本阶段（Q2-0）实施约束

- ❌ 不新建 `providers/` 目录、不写任何 provider 代码。
- ❌ 不修改 `eventRetriever.js`、不接真实 API、不改环境变量。
- ❌ 不部署、不 commit、不 push。
- ✅ 仅完成本设计文档，作为 Q2-1 开工基准。
