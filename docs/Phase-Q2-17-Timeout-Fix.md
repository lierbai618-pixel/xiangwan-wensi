# Phase Q2-17：联网搜索超时根因修复

**日期**: 2026-08-07 21:13  
**状态**: ✅ COMPLETED / 已部署  
**触发**: 用户反馈"还是不行"——截图显示 person_identity_boundary 降级模板

## 问题现象

用户在小程序问"付航是谁"，回答为：

> 关于这个人的具体背景（学历、经历、履历等），我没有可靠的信息来源可以核实，不能凭印象给你细节——这类信息错一处就可能误导你。

这是 `downgrade.js` 的 `PERSON_IDENTITY_TEMPLATES` 降级文案，说明链路走到了：
1. eventClassifier 正确归为 B 类（person-identity）✅
2. freshness/index.js 进入 Category B 完整链路 ✅
3. `searchLayer.search()` 返回 `!retrieval.ok || !results.length` ❌ → 降级

## 根因分析（三层bug叠加）

### Bug 1: URL 拼接缺失（HTTP 404）

**文件**: `providers/search/qwenSearch.js:112-115`

环境变量分支直接使用 `QWEN_SEARCH_BASE_URL` 原值作为请求 URL：

```javascript
// 修复前（❌ 缺少 /chat/completions）
if (envBase) {
    baseUrl = envBase;  // "https://dashscope.aliyuncs.com/compatible-mode/v1"
}
```

而 modelConfig 分支（第118行）有正确的拼接逻辑：

```javascript
// modelConfig 分支（✅ 正确）
baseUrl = mc.baseURL.replace(/\/+$/, '').replace(/\/chat\/completions$/i, '') + '/chat/completions';
```

**结果**: 请求发到 `/v1`（目录）而非 `/v1/chat/completions`（端点）→ HTTP 404

### Bug 2: SEARCH_TIMEOUT_MS 过短（主因）

**文件**: `cloudbaserc.json` → 环境变量 `SEARCH_TIMEOUT_MS=3000`

**实测数据**:

| 指标 | 值 |
|------|-----|
| 百炼 deepseek-v4-flash-0731 + enable_search 实际耗时 | **9000~9200ms** |
| SEARCH_TIMEOUT_MS 配置 | **3000ms（3秒）** |
| searchLayer withTimeout | 3秒杀请求 → timeout |
| withRetry 重试次数 | 2（共3次尝试） |
| 总等待时间 | ~10秒后最终 provider_exception |

**影响**: 即使 URL 正确，3秒超时也会杀死所有搜索请求。

### Bug 3: httpPostJson 未传递 timeout（隐匿因子）

**文件**: `providers/search/util.js:76-89`

```javascript
// 修复前（❌ timeout 参数被忽略）
function httpPostJson(nodeFetch, url, body, headers, timeout) {
  return nodeFetch(url, {
    method: 'POST',
    headers: headers || { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
    // ⚠️ timeout 参数未传递！nodeFetch 用自身默认值 8000ms
  }).then(...)
}
```

而 `eventRetriever.nodeFetch`（第45行）默认 timeout=8000ms：

```javascript
timeout: (options && options.timeout) || 8000,
```

**叠加效应**: 
- qwenSearch 传 timeout=8000 给 httpPostJson → 被忽略
- nodeFetch 用默认 8000ms
- 百炼实际 9200ms > 8000ms → nodeFetch 内部 timeout
- searchLayer 外层 15秒 withTimeout 虽然没到，但内层 Promise 已 reject

## 修复方案

### Fix 1: URL 拼接统一（qwenSearch.js）

```javascript
if (envBase) {
    baseUrl = envBase.replace(/\/+$/, '').replace(/\/chat\/completions$/i, '') + '/chat/completions';
    // ...
}
```

### Fix 2: 超时放宽（cloudbaserc.json）

```diff
- "SEARCH_TIMEOUT_MS": "3000",
+ "SEARCH_TIMEOUT_MS": "15000",
```

### Fix 3: timeout 透传（util.js）

```javascript
function httpPostJson(nodeFetch, url, body, headers, timeout) {
  return nodeFetch(url, {
    method: 'POST',
    headers: headers || { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
+   timeout: timeout || 20000,  // ✅ 真正传递给 nodeFetch
  }).then(...)
}

function httpGetJson(nodeFetch, url, headers, timeout) {
  return nodeFetch(url, {
    method: 'GET',
    headers: headers || {},
+   timeout: timeout || 20000,  // ✅ 同步修复
  }).then(...)
}
```

### Fix 4: qwenSearch 内部超时对齐（qwenSearch.js）

```diff
- return util.httpPostJson(nodeFetch, baseUrl, body, headers, 8000).then(...)
+ return util.httpPostJson(nodeFetch, baseUrl, body, headers, 15000).then(...)
```

## 验证结果

```
=== Q2-17 端到端验证：15秒超时下搜索链路 ===

【单元1】qwenSearch 直接调百炼 API
  耗时: 9051ms  ✅ ok=true reason=synth_content synthesized=true
  snippet 包含 "付航" ✅  包含 "大专" ✅

【单元2】searchLayer 完整链路（privacyGate→canaryGate→qwen→withTimeout=15s）
  耗时: 7874ms  ✅ ok=true reason=synth_content provider=qwen
  data_route=domestic ✅

【单元3】回归验证：3秒超时应 timeout
  ✅ 3秒超时 → ok=false reason=timeout

=== 结果：19 PASS / 0 FAIL ===
```

## 修改文件清单

| 文件 | 改动 | 冻结资产 |
|------|------|---------|
| `cloudbaserc.json` | SEARCH_TIMEOUT_MS 3s→15s | N/A（配置） |
| `providers/search/qwenSearch.js` | URL拼接 + timeout 8s→15s | 非冻结 |
| `providers/search/util.js` | httpPostJson/httpGetJson 透传 timeout | 非冻结 |

**冻结资产 SHA 4/4 不变**:
- corpus.json: `db01fbc9...`
- intent.js: `765ad138...`
- rag.js: `4fb2dca4...`
- knowledgeRouter.js: `84890844...`

## 用户体验变化

**修复前**: 问"付航是谁" → 降级模板"我没有可靠来源"
**修复后**: 问"付航是谁" → 百炼合成底座（含大专学历、脱口秀冠军等信息）+ "未经独立核实"免责声明

⚠️ 注意：合成底座模式无独立来源链接，置信度低于真·搜索API。后续可切腾讯云WSA获得带URL的结构化结果。
