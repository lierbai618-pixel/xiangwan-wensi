# 03 · 代码结构（Code Structure）

> **刷新于 2026-08-07（终校至 Q2-15）**：补全 `freshness/`、`think/`、`providers/`、`security/`、`observability/`、`registry/`、`dashboard/` 等真实模块。

## 主要目录

```
weapp/
├── miniprogram/              # 前端小程序（7 个页面，含四模式选择）
├── cloudfunctions/          # 云端 Node.js（6 个函数 + capabilities 层）
│   ├── admin/                # 模型配置 + 日志管理
│   ├── chat/                 # 对话核心（非冻结部分持续演进）
│   │   ├── index.js          # 派发入口（非冻结，多 .bak 历史）
│   │   ├── rag.js / intent.js / knowledgeRouter.js   # ❄️ 冻结（SHA 守门）
│   │   ├── corpus.json        # ❄️ 冻结（37 经典）
│   │   ├── actionLibrary.js / config.json / answerMode.js / thinkContext.js
│   │   ├── capabilities/      # 实时能力层（时间/天气）
│   │   ├── freshness/         # Freshness 轨道：eventClassifier/contextBuilder/factExtractor/downgrade/responder/schema/eventRetriever/boundaryCheck
│   │   ├── think/             # Think 模式：Search+RAG+Reasoning
│   │   ├── providers/search/  # 搜索层：index(orchestrator)/qwenSearch/tencentWsaSearch/domesticApiSearch/mock + 护栏 canaryGate/privacyGate/util/shared + 禁用 tavily/bing/serp
│   │   ├── security/          # msgSecCheck 调用
│   │   ├── observability/     # KNOWLEDGE_OBSERVABILITY_STORE
│   │   ├── registry/ dashboard/ knowledgeHealthScore.js
│   │   └── freshnessRuntimeGuard.js  # 隔离守卫（验证搜索不污染 KB）
│   ├── feedback/  history/  ingest/  login/
├── docs/                    # 部署/验收/Phase 设计文档（含 Q2-4…Q2-15 系列）
├── scripts/ 或 cloudfunctions/chat/scripts/  # 测试集与 runner（test_q24c…test_q33 等）
└── tests/                   # Phase F/G/H 早期测试
```

## 模块职责

| 模块 | 职责 | 关键文件 | 冻结? |
|------|------|---------|------|
| 前端聊天 | UI 渲染、setData、隐私流、四模式 | `miniprogram/pages/chat/chat.js` | - |
| 对话入口 | 派发 + 轨道/模式路由 | `cloudfunctions/chat/index.js` | 否 |
| 实时能力 | 确定性实时事实 | `cloudfunctions/capabilities/router.js` | 否 |
| Freshness | 四分类 + 上下文 + 降级 + 输出守卫 | `cloudfunctions/chat/freshness/*` | 否 |
| 搜索层 | 护栏链 + 国内源 adapter | `cloudfunctions/chat/providers/search/*` | 否 |
| Think | Search+RAG+Reasoning | `cloudfunctions/chat/think/*` | 否 |
| 隔离守卫 | 验证搜索不污染 KB | `freshnessRuntimeGuard.js` | 否 |
| 知识资产 | 37 经典召回源 | `cloudfunctions/chat/corpus.json` | ❄️ 冻结 |
| RAG | 条件检索/意图/路由 | `rag.js`/`intent.js`/`knowledgeRouter.js` | ❄️ 冻结 |

## 冻结资产（SHA256 守门，漂移=违规）

> 以下文件为冻结基线，**改动须以 SHA256 比对**；任何漂移视为违规，须显式授权 + 评审。Q2-15 时四资产 SHA 仍 4/4 一致（基线未变）。

| 文件 | SHA256（基线） |
|------|------|
| `cloudfunctions/chat/corpus.json` | `068fa1fa052ec7b93a9d60008c26b29c425c40f0ab724ab33483dbd1001459ae` |
| `cloudfunctions/chat/intent.js` | `765ad138ec68c0f159c6f75a60e5268beb02fba152f6d53dbdc539ba1560ca38` |
| `cloudfunctions/chat/rag.js` | `90c9cc5fe1d9f30837f63a9a67d512e6d08262ef19e125ddd7bebf8ee0890698` |
| `cloudfunctions/chat/knowledgeRouter.js` | `848908445dbb5ea93a6f52775dc3c8e6922ff971d6cee115547f236ffed0a935` |

> 注：corpus 实际为 **22 条**数组（embedding 向量数由 corpus 条目数派生）；旧文档"16"为标签口径，以代码为真实来源。

## 硬约束（部署前必读）

- 云函数锁 **Nodejs16.13**，禁原生 `fetch`，走 `rag.js` 内置 `nodeFetch` / `util.httpPostJson`。
- 模型由云库 `model_config` 配置（须控制台手动建，且联网搜索复用同一 `model_config` 百炼模型）；前端零模型配置。
- **所有云函数改动须重新部署才生效**；沙箱可 `tcb fn deploy chat --force`（COS 上传约 52s）。
- ⚠️ 部署前**必读 `cloudbaserc.json`**——`tcb fn deploy` 套用其 `envVariables/runtime/timeout/memorySize`，与生产不一致会**静默覆盖**生产环境变量。
- 联网搜索依赖云库 `model_config` 已启用且含 `apiKey`/支持 `enable_search`；否则 `qwenSearch` 返回 `no_endpoint` → 诚实降级。

## 模块间关系

- 前端 `chat.js` ──调──▶ `cloudfunctions/chat/index.js`（派发）
- `chat` 云函数 ──读──▶ `corpus.json`（经典，冻结）+ `model_config`（模型/联网）
- `freshness/eventClassifier.js` ──判类──▶ B/D 类调 `providers/search/index.js`
- `providers/search/index.js` ──护栏链──▶ `qwenSearch`/`tencent`/`domestic`/`mock`
- `freshnessRuntimeGuard.js` ──校验──▶ 搜索结果不污染 KB/embedding
- `history` 云函数 ──管──▶ `conversations` 集合
- `ingest` 云函数 ──写──▶ `documents` / `chunks` / `metadata`
