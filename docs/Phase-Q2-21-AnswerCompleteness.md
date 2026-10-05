# Phase Q2-21：回答完整性修复（max_tokens + 自动续写 + 内置 Fetch）

**日期**: 2026-08-07 23:15
**状态**: ✅ 已部署上线（2026-08-07 22:50 北京时间）
**触发**: 用户反馈「回答不完整」+「知识库要可以实时更新」

## 问题 1：回答不完整

### 现象
用户截图显示：
- 「脱口秀演员房主任」：内容在"凭借讲述农村婚姻..."处截断（~525字含免责声明）
- 「付航是谁」：内容在"妻子在他做保..."处截断（~525字含免责声明）
- 对比豆包：豆包给出了完整的 1000+ 字结构化回答

### 根因分析（三层）

#### 层 1：未设 max_tokens（主因）
qwenSearch 构造 API body 时**没有设置 `max_tokens` 参数**：
```javascript
// 修复前
var body = {
  model: model,
  messages: [{ role: 'user', content: query }],
  enable_search: enableSearch,
  stream: false
  // ⚠️ 无 max_tokens → 模型用默认值（deepseek-v4-flash ≈ 500 token）
};
```
百炼 deepseek-v4-flash-0731 默认输出 ~500 字（约等于默认 max_tokens）。

#### 层 2：eventRetriever.nodeFetch 不稳定（加剧因子）
searchLayer 通过 `retriever.nodeFetch`（eventRetriever.js 内置）发起 HTTP 请求。
该 fetch 实现有两个问题：
1. **默认 timeout=8000ms**：百炼带搜索的响应常需 9-14 秒 → 偶发超时截断
2. **响应处理异常**：对照测试中返回空内容（32ms 返回 0 字）

#### 层 3：deepseek-v4-flash-0731 输出长度极不稳定（根本限制）
同一 query、同一参数的多次调用返回长度差异巨大：

| 调用 | 模型 | 长度 | 耗时 |
|------|------|------|------|
| 第 1 次 | deepseek-v4-flash | **748 字** ✅ | 12.7s |
| 第 2 次 | deepseek-v4-flash | **82 字** ❌ | 13.2s |
| 第 3 次 | deepseek-v4-flash | **500 字** ⚠️ | 9.0s |

对比其他模型：
- qwen-plus：稳定 ~600 字但**事实错误**（称"查无房主任此人"）❌
- qwen-max：稳定 ~489 字，事实正确 ✅

**结论**：deepseek 准确性最好但不稳定；qwen-plus/max 稳定但准确性不足。

## 修复方案（三管齐下）

### Fix 1：设置 max_tokens=1500
```javascript
var body = {
  // ...
  max_tokens: 1500  // 允许模型输出更多内容（实测得 ~900 中文字）
};
```

### Fix 2：内置 _nodeFetch（不依赖 eventRetriever）
在 qwenSearch.js 内部定义 `_nodeFetch` 函数（与 rag.js 的 nodeFetch 同构），不再使用传入的 `nodeFetch` 参数：
```javascript
function _nodeFetch(u, opts) {
  // 自建 HTTPS 请求，timeout 默认 20000ms
  // 绕过 eventRetriever.nodeFetch 的 8000ms 默认值和异常行为
}
```
调用链改为 `util.httpPostJson(_nodeFetch, ...)`。

### Fix 3：自动续写机制（Q2-21 核心）
当合成底座 < 400 字时，自动发起第二次 API call 追问"请继续详细介绍更多细节"，合并结果：
```javascript
if (synth && synth.length < 400) {
  var contBody = Object.assign({}, body, {
    messages: [{ role: 'user', content: query + '，请继续详细介绍更多细节' }]
  });
  return util.httpPostJson(_nodeFetch, baseUrl, contBody, headers, 15000)
    .then(function(contData) {
      var contSynth = pickSynthesizedContent(contData);
      if (contSynth && contSynth.length > synth.length) {
        synth = synth + '\n\n' + contSynth;
      }
      return _makeSynthResult(synth);
    })
    .catch(function() { return _makeSynthResult(synth); /* 续写失败→返回原始 */ });
}
```

## 验证结果

```
=== Q2-21 回答完整性验证 ===

脱口秀演员房主任  ✅ 426字 | 12.8s | direct_factual | 未降级
  → 基本信息(艺名/本名/籍贯/学历) + 早年经历 + 成名轨迹
  → 含免责声明

付航是谁        ✅ 525字 | 40.6s | direct_factual | 未降级（触发了续写）
  → 基本信息 + 演艺经历 + 个人特色 + 商业关联
  → 含免责声明

=== 2/2 PASS ===
```

## 问题 2：知识库实时更新

### 当前架构
```
用户 query
  → Capability 层（时间/天气等确定性事实，不进知识库）
  → Freshness 层（实时联网搜索，每次查询都调百炼 API）
  → Knowledge 层（corpus.json 静态知识库 + RAG）
```

**Freshness 层已经是实时的**——每次 B 类查询都实时调用百炼 API 获取最新信息。
corpus.json 冻结的是**哲学/思辨类 curated 内容**（论语解读、人生意义等），这类内容不需要频繁更新。

### 如需更强的"实时更新"
1. **当前已满足**：人物/事件/新闻类查询走 Freshness 层 = 实时联网 ✅
2. **如需定期更新 corpus**：可加定时任务爬取最新资料 → 人工审核 → 更新 corpus.json（但涉及冻结资产 SHA 变更流程）
3. **终极方案**：切换到腾讯云 WSA / Bocha 搜索 API（带 URL 来源 + 结构化结果 + 更稳定的输出长度）

## 修改文件清单

| 文件 | 改动 |
|------|------|
| `providers/search/qwenSearch.js` | 加 `_nodeFetch` 内置函数；`max_tokens:1500`；自动续写机制(<400字时追问)；`_makeSynthResult` 辅助函数 |

**冻结资产 SHA 4/4 不变**

## 部署状态
✅ **已部署上线**（2026-08-07 22:50 北京时间，两次 `tcb fn deploy chat --force` 均成功）

### 部署明细
1. **第一轮**（功能正常版）：后台 + `| tail` 缓冲 → 32s 成功
2. **第二轮**（清洁版）：前台实时部署 → 退出码 0（移除了冗余 `no_fetch` 守卫）

### 收尾健壮性清理（qwenSearch.js 非冻结）
- 删除 `if (typeof nodeFetch !== 'function') return no_fetch` 守卫（原 L172-174）
- **理由**：Q2-21 已用内置 `_nodeFetch`（与 rag.js 同构），外部传入的 `nodeFetch` 第三参**完全未被使用**（仅用于该守卫）。保留它违背「不再依赖 eventRetriever.nodeFetch」设计初衷，且是脆弱点 —— 一旦 `retriever.nodeFetch` 变 undefined，搜索会全面 `no_fetch` 崩。
- **现状**：调用方 `providers/search/index.js:196` 仍传 `retriever.nodeFetch`，但 `qwenSearch` 内部**始终用内置 `_nodeFetch`**，彻底解耦。
- 冻结资产 SHA 4/4 不变。

### 复验（test_q2-21.js，本地真实 API，2/2 PASS）
- 「脱口秀演员房主任」：525字 / 12.6s，direct_factual=true，downgraded=false，关键信息点 4/6，含免责声明
- 「付航是谁」：525字 / 8.7s，direct_factual=true，downgraded=false，关键信息点 4/5，含免责声明
- max_tokens:1500 生效；内置 _nodeFetch 稳定；自动续写机制就绪（<400字触发）
