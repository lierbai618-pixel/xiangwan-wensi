# Phase Q2-14：联网搜索功能上线（后台 model_config 复用）

> 授权：用户「我在后台配置大模型api，其余的完成联网功能」。
> 即用户在后台配置百炼模型（`model_config`），我负责联网搜索的接线、部署与验证。

## 1. 本次变更（非冻结资产；4 冻结资产 SHA 4/4 不变）

| 文件 | 改动 |
| --- | --- |
| `cloudfunctions/chat/providers/search/qwenSearch.js` | 端点来源优先级：① `QWEN_SEARCH_*` env 覆盖 → ② `opts.searchModelConfig`（后台 `model_config` 注入）→ ③ `no_endpoint` 降级。复用 `rag.js` 的 `baseURL + /chat/completions` 拼装逻辑 |
| `cloudfunctions/chat/providers/search/index.js` | 新增 `_searchModelConfig` 单例 + `_setSearchModelConfig()`；qwen 派发分支注入 `searchModelConfig` |
| `cloudfunctions/chat/index.js` | require searchLayer 单例；每请求读取首个启用 `model_config` 并注入 `searchLayer._setSearchModelConfig` |
| `cloudbaserc.json` | 写入激活 env（见 §3） |
| `scripts/test_q31.js` | 新增单元·7b（model_config 复用路径）+ no_endpoint 降级；`132 PASS` |

**设计要点**：搜索与对话共用同一份后台 `model_config`（配置一次，搜索自动同享），避免重复密钥；`QWEN_SEARCH_*` env 仍可作为独立中转的覆盖项。

## 2. 部署

- `tcb fn deploy chat --force` ✅ 成功（COS 上传）。
- `tcb fn detail` 确认线上源码含 `_setSearchModelConfig` 注入，env 全部生效（见 §3）。

## 3. 线上环境变量（已生效）

```
ADMIN_OPENID=YOUR_ADMIN_OPENID
KNOWLEDGE_OBSERVABILITY_STORE=cloud
FRESHNESS_ENABLED=true
FRESHNESS_FACTUAL_ENABLED=true
SEARCH_PROVIDER=qwen
PRIVACY_GATE_ENABLED=true
SEARCH_CANARY_ENABLED=true
SEARCH_CANARY_OPENIDS=YOUR_ADMIN_OPENID
SEARCH_MAX_RESULTS=5
SEARCH_TIMEOUT_MS=3000
SEARCH_DAILY_QUOTA=500
```
runtime `Nodejs16.13` / timeout `60` / memory `512` 与现网一致，未动。

## 4. 灰度与安全

- **真实联网搜索仅对 `SEARCH_CANARY_OPENIDS`（=ADMIN_OPENID，即你本人）生效**；其余用户走 mock/RAG，零跨境（`data_route=domestic`）。
- 隐私闸门（`PRIVACY_GATE_ENABLED=true`）、成本配额（500/日）、来源过滤、审计白名单全部在线。
- 搜索结果仅作 runtime context（fact extraction），**绝不**写 corpus/embedding/KB；事实隔离由 `qwenSearch` 只取 `search_results` 数组、丢弃 `message.content` 保证（化解 Q2-11 架构冲突）。
- 搜索请求在**云函数服务端**发起，不经小程序前端 `wx.request`，故不受微信 request 域名白名单 / 备案限制（备案仍按原节奏推进，不影响本功能运行）。

## 5. 测试

- 离线套件：`test_q29=225` / `test_q30=104` / `test_q31=132` = **461 断言 0 失败**。
- 冻结资产 SHA 4/4 不变（corpus.json / intent.js / knowledgeRouter.js / rag.js）。

## 6. 待用户验证（真机 canary）

沙箱无法发起 wx 上下文调用（`tcb fn invoke` 超时，属沙箱网络限制），真机 canary 需你操作：

1. **后台配置**：在 `model_config` 配好百炼模型——`baseURL` 为 OpenAI 兼容 `chat/completions` 端点、支持 `enable_search`（如 qwen-plus / qwen-max / qwen-turbo）；搜索复用**首个启用**模型。
2. **真机测试**：微信打开「向晚问思」，用你自己的微信号提问实时类问题（例：「今天有什么科技新闻」「现在北京时间几点」）。
3. **期望**：实时类问题出现联网检索摘要与引用来源；若 `model_config` 未配或模型不支持 `enable_search`，则优雅回退 RAG（无报错）。
4. **隔离校验**：corpus 条目数不变（14）、知识库无新增。

## 7. 回滚

- 秒级：将 `cloudbaserc.json` 中 `FRESHNESS_FACTUAL_ENABLED` 置 `false` 或 `SEARCH_PROVIDER=mock`，重新 `tcb fn deploy` 即回滚。
- 或 `tcb fn deploy` 旧版本源码。
