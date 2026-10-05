# Phase Q2-14-b：联网搜索「分类器路由」修复（续 Q2-14）

## 背景
Q2-14 修复了 freshness 层读取旧变量 `FRESHNESS_SEARCH_PROVIDER` 导致永久短路的 bug，并部署上线。
但用户实测仍「无法联网」。进一步排查发现：**真正的阻断在更上游——问题分类器（eventClassifier）**。

## 根因
freshness 层先对 query 做四分类（A/B/C/D），**只有 B 类才会真正调用联网检索**（searchLayer.search）。
分类器存在大量「自然问法落不到 B」的缺口：

| 问法 | 修复前分类 | 结果 |
|------|-----------|------|
| 你可以联网吗 | A（无锚点） | 不进 freshness，走 RAG → 看不到搜索 |
| 今天有什么**科技**新闻 | C（歧义兜底） | 143 行直接降级、不检索 |
| 今天有什么AI相关的消息 | C | 不检索 |
| 今天有什么值得关注的科技动态 | C | 不检索 |
| 最近电影票房怎么样 | C | 不检索 |
| 现在正在发生什么大事 | A（现在/大事无锚点） | 不检索 |

> 只有「今天有什么新闻」「怎么看最近的AI突破」这类精确句式才命中 B。
> 所以用户用自然语言问新闻/动态，90% 触发不了搜索——表现为「联网没好」。

## 修复（eventClassifier.js，非冻结资产）
1. `TIME_ANCHOR_RE` 扩充时间锚点：`现在 / 最新 / 当下 / 近来 / 近期 / 时下 / 此刻`。
2. 新增 `CURRENT_EVENT_NOUN_RE`：新闻 / 消息 / 动态 / 进展 / 热点 / 大事 / 事件 / 财报 / 票房 / 行情 / 股市 / 比赛 / 发布 / 上市 / 获奖 / 突破 / 事故 / 通报 / 官宣 / 上架 / 开播 / 上映 / 开售 / 出炉 / 怎么样 / 如何 / 有啥 / 有什么 / 啥 / 近况。
3. 新增路由规则 ②-c：带时间锚点且含「当前事件名词」→ 直接归 **B（高置信）**，触发联网检索 + 反思。

修复后实测：上述所有自然问法均稳定归 **B[high]**；纯哲学/知识问法（庄子/人生/好书/勾股/论语）仍归 **A**（符合设计，不联网）。

## 验证
- 新增 `scripts/test_q32.js`：分类器路由断言（15）+ 集成断言（freshness 对 B 类**确实调用 searchLayer.search**，锁死 Q2-14 短路修复）+ 纯哲学仍归 A。**29 PASS / 0 FAIL**。
- 回归：`test_q29=225` / `test_q30=104` / `test_q31=132` 全绿；四冻结资产 SHA 4/4 不变（corpus/intent/knowledgeRouter/rag）。
- `tcb fn deploy chat --force` 成功（COS 上传整包，含 freshness/index.js + eventClassifier.js 修复）。
- 注：`tcb fn detail` 沙箱内仅展示入口 index.js 源码，不展示依赖模块，故不能直接 grep 到 freshness/eventClassifier 的改动字符串；入口文件可见 `searchLayer._setSearchModelConfig` 注入（57/327/329 行）证明包已更新。

## 用户侧仍需确认（联网真正跑通的前置）
1. **后台 `model_config` 已启用且填了 apiKey**：baseURL 用 OpenAI 兼容 `chat/completions` 端点，模型选支持 `enable_search` 的（qwen-plus / qwen-max / qwen-turbo）。搜索自动复用首个启用模型（配置一次，对话+联网双用）。
2. **用你自己的微信账号测**（openid = `YOUR_ADMIN_OPENID`，已在 `SEARCH_CANARY_OPENIDS` 白名单）。其他账号会被 canary 拦成 mock。
3. **问「当前事件」类问题**，例如：
   - 「今天有什么科技新闻」
   - 「最近电影票房怎么样」
   - 「怎么看最近的 AI 突破」
   - ❌ 不要问「你可以联网吗」（那是能力元问题，归 A 类走 RAG，本就不该触发搜索）。

## 失败兜底（便于自查）
若仍看不到联网结果，按优先级排查：
- canary 拦截（非 admin 账号）→ 换 admin 账号。
- `model_config` 未配/无 apiKey → qwenSearch 返回 `no_endpoint` → 优雅降级。
- 模型不支持 `enable_search` 或响应无 `search_results` → 返回 `no_results` → 降级。
- 以上均不报错，只会走「诚实边界+反思」路径；如需定位，可查云函数日志中 `search` 相关 `_audit` / `downgrade_reason`。

## 回滚
`FRESHNESS_FACTUAL_ENABLED=false` 或 `SEARCH_PROVIDER=mock` 改后重 deploy 即秒级回滚。
