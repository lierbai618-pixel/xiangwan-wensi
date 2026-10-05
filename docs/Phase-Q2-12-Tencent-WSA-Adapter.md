# Phase Q2-12：腾讯云联网搜索（WSA）Provider Adapter 实施报告

- **角色**：Release Manager + Search Infrastructure Engineer
- **目标**：实现腾讯 WSA Provider Adapter，使其接入现有 `searchLayer`，保持 provider contract 与全部护栏，`data_route=domestic`，失败回退 RAG。
- **状态**：✅ 代码实现 + 离线测试全绿（225 + 104）｜⛔ **未部署 / 未改生产环境变量 / 未 commit / 未扩大用户范围**
- **约束遵守**：未修改 `corpus.json` / `intent.js` / `knowledgeRouter.js` / `rag.js`；未 modify prod env；未 deploy/commit/push。四冻结资产 SHA **4/4 不变**。

---

## 1. 交付物清单

| 文件 | 类型 | 说明 |
|---|---|---|
| `cloudfunctions/chat/providers/search/tencentWsaSearch.js` | **新增** | 腾讯 WSA 专用适配 adapter（POST + Bearer + JSON body + Pages 二次解析） |
| `cloudfunctions/chat/providers/search/index.js` | 修改（**非冻结**） | 注册 `tencent` 槽位：require、accept 于 `getProviderName`、计入 `isRealProvider`、计入 `isDomesticProvider`、新增 dispatch 分支 |
| `scripts/test_q30.js` | **新增** | 腾讯 WSA 离线单元测试 + 端到端集成测试 |
| 冻结资产 4 件 | 未动 | SHA 4/4 = 基线，mtime 未变 |

> 注：`index.js` 为既有 searchLayer 抽象层（非知识库/非意图/非 RAG），Q2-10 也曾改它注册 `domesticApiSearch`。本次仅**新增** `tencent` 分支，未改动 `domestic` 路径，故原 225 PASS 不受影响。

---

## 2. Provider Contract 实现

严格满足要求：

```js
search(query, opts, nodeFetch) → Promise<{ ok, provider, results, reason }>
```

- `provider` 固定返回 `'tencent'`（→ `data_route=domestic` 的前提）。
- `ok:false` 时 `reason` 明确（`no_endpoint` / `no_fetch` / `no_results` / 传输错误由 `withRetry` 派生），上层据此 fail-soft 回退 RAG。
- 结果经 `util.normalizeResult` 标准化（剥离追踪参数、补全 source），与 tavily/bing/serp/domestic 同一形状。

---

## 3. 腾讯 WSA 特性支持（逐项）

| 要求 | 实现 |
|---|---|
| **POST** | `util.httpPostJson` 以 `method:'POST'` 发出；测试中已断言 `init.method === 'POST'` |
| **Bearer Auth** | 当 `TENCENT_WSA_API_KEY` 配置时，请求头 `Authorization: Bearer <key>`；测试断言头值精确匹配 |
| **JSON body** | 请求体 `JSON.stringify({ [queryField]: query, ...extra })`；测试断言 body 含查询字段 |
| **Pages JSON string 二次解析** | 响应 `Pages` 字段为 JSON 字符串 → `JSON.parse` 再取数组；同时兼容已展开为数组的情形；字段名可配置（`TENCENT_WSA_PAGES_FIELD`，默认 `Pages`，支持 dot-path），并兜底探测 `SearchInfo.Pages` / `data.Pages` 等常见形状 |

### 配置驱动（零编造，避免硬编码未知 API 细节）
```
TENCENT_WSA_BASE_URL      必须；WSA 接口地址
TENCENT_WSA_API_KEY       必须；Bearer Token
TENCENT_WSA_QUERY_FIELD   请求体查询字段名（默认 'query'）
TENCENT_WSA_EXTRA_BODY    附加固定 body 字段（JSON 字符串，可选）
TENCENT_WSA_PAGES_FIELD   响应中结果数组字段（默认 'Pages'，支持 dot-path）
TENCENT_WSA_FIELD_TITLE/URL/SNIPPET/SOURCE  结果项字段映射（默认值与通用层一致）
```
复用 `SEARCH_MAX_RESULTS` / `SEARCH_TIMEOUT_MS` / `SEARCH_DAILY_QUOTA`（与既有 searchLayer 一致）。

---

## 4. 护栏与数据隔离（全部保留）

调用链与 `domestic` 完全一致，未做任何改动：
```
privacyGate（最前端, fail-closed）→ canaryGate → quota(costGuard) → tencent provider → audit
```
- `privacyGate`：高风险 PII 直接 `pii_blocked`，零外呼，`data_route=blocked`。
- `canaryGate`：仅 `SEARCH_CANARY_OPENIDS` 内用户走真实 `tencent`，其余强制 `mock`。
- `quota`：真实调用计日配额，`quota_exceeded` 即降级。
- `audit`：仅 7 个安全白名单字段，**绝不含 query / openid / URL / 搜索全文**。
- `freshnessRuntimeGuard`：结构层 + 资产层双保险隔离检查（未在本次改动）。
- **`data_route` 恒定 `domestic`**：`isDomesticProvider('tencent')===true` → 零跨境。其正确性依赖所接入的 WSA 为国内合规服务（服务器与数据均留境），与 `domestic` 槽位同源。

---

## 5. 测试结果

### 5.1 回归：原 225 PASS 保持
```
Phase Q2-10 离线验证: 225 PASS / 0 FAIL
```
（运行 `node scripts/test_q29.js`，`index.js` 注册 `tencent` 后 `domestic` 路径零回归）

### 5.2 新增：腾讯 WSA 测试 104 PASS / 0 FAIL
```
Phase Q2-12 腾讯 WSA Adapter: 104 PASS / 0 FAIL
```
覆盖：
1. **Contract 形状**：返回 `{ok,provider,results,reason}` 且 `provider='tencent'`。
2. **POST + Bearer + JSON body 含 query**：三项断言全 ✅。
3. **Pages JSON string 二次解析**：字符串 → 数组，字段映射生效，片段含联网标记。
4. **no_endpoint**：未配置 `BASE_URL` → `ok:false` / `reason=no_endpoint` / 零外呼。
5. **no_results**：`Pages='[]'` → `ok:false` / `reason=no_results`。
6. **provider 名 = tencent**：固定为 `tencent`。
7. **searchLayer 路由**：`data_route=domestic`；`isDomesticProvider`/`isRealProvider` 均识别；审计干净。
8. **端到端（thinkEngine）**：
   - 5 条在线问题 → 联网结果进入回答文本 ✅，`data_route=domestic` ✅，审计零泄露 ✅。
   - 2 条失败问题（空结果 / 网络异常）→ 稳定回退 RAG 兜底 ✅。
   - 汇总：全程 **零 cross_border**（7/7 `domestic`）。
   - 冻结资产 SHA 4/4 不变、corpus 条目数（派生 embedding 向量数）= 14 不变、**无 ingest**。

---

## 6. 上线前置（仍阻塞，须授权后操作）

| 项 | 状态 | 说明 |
|---|---|---|
| B1 开通腾讯云联网搜索 WSA | ⛔ 待办 | 需账号开通并获取接口地址与 SecretId/Key（映射为 `TENCENT_WSA_API_KEY`） |
| B2 微信 request 合法域名白名单 | ⛔ 待办 | 公众平台 → 开发设置 → 服务器域名 → request 合法域名，添加 WSA 域名（须已 ICP 备案） |
| B3 写 env 补丁 | ⛔ 待办 | 在 `cloudbaserc.json` 注入：`SEARCH_PROVIDER=tencent` / `FRESHNESS_ENABLED=true` / `FRESHNESS_FACTUAL_ENABLED=true` / `PRIVACY_GATE_ENABLED=true`（建议）/ `SEARCH_CANARY_ENABLED=true` + `SEARCH_CANARY_OPENIDS` / `TENCENT_WSA_BASE_URL` / `TENCENT_WSA_API_KEY` / 配额参数 |
| B4 `tcb fn deploy chat --force` | ⛔ 待办 | 部署会套用 `cloudbaserc.json` 的 env，须与现网 runtime/timeout/memory 对齐 |
| B5 真实 canary 联调 | ⛔ 待办 | 仅 canary openid 走真实 `tencent`，其余仍 mock/RAG |
| B6 小程序备案 | ⛔ 审核中 | 与 B2 互为前置 |

> 建议顺序：B1 → B2 → B3（写 env）→ B4（deploy）→ B5（canary）→ B6（扩量）。

---

## 7. 结论

腾讯 WSA Adapter 已按 provider contract 完成，POST + Bearer + JSON body + Pages 二次解析全部落地，零编造（配置驱动）。搜索结果仅作 request runtime context，失败稳定回退 RAG，知识库零改动（四冻结资产 SHA 4/4、corpus=14 不变）。原 225 PASS 保持，新增 104 PASS 全绿。当前仍处**未部署 / 未改生产 env** 的准备态，等待授权推进 B1–B6。
