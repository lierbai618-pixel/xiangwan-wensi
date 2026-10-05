# Phase Q2-16 — 百炼合成底座模式（联网搜索可用化）

## 背景
用户确认 `deepseek-v4-flash-0731` 是阿里云百炼模型。经实测确认：**百炼 OpenAI 兼容模式（`/compatible-mode/v1`）开启 `enable_search` 后，只返回模型综合文字（`choices[0].message.content`），不返回结构化 `search_results` 数组**。

- 专属 URL `ws-kkupdspdyh9jxu7...maas.aliyuncs.com` 是百炼「工作空间端点」，需工作空间专属密钥；通用 DashScope key 返回 `403 Workspace endpoint access denied`。
- 通用 DashScope 端点 `dashscope.aliyuncs.com/compatible-mode/v1` 用通用 key 可调通，HTTP 200，但同样**无 `search_results`**，仅 `content`。
- 实测 `deepseek-v4-flash-0731` 综合质量明显优于 `qwen-plus`（前者把付航「大专学历」答对了，后者编造「北航本科+中科院硕士」）。

因此原 `qwenSearch.js`（只取 `search_results` 数组）永远判定 `no_results` → 走降级模板 → 用户看到"我没有可靠信息来源"。

## 方案（用户授权：先用百炼合成模式）
当百炼只返回综合文字、无结构化数组时，**退化为「模型合成事实底座（UNVERIFIED）」**：把 `message.content` 作为联网综合文本流入 freshness 链路，受反幻觉与免责声明约束，**绝不直接当最终答案下发**。

## 改动（冻结资产零改动）
1. `providers/search/qwenSearch.js`
   - 新增 `pickSynthesizedContent(data)`：取 `choices[0].message.content`，过滤明显拒答。
   - `search()` 主流程：结构化数组优先；无数组且 `QWEN_SEARCH_SYNTH_MODE!=false` 时，取 content 组装 `{synthesized:true}` 结果，`reason='synth_content'`。
2. `freshness/factExtractor.js`
   - 识别 `r.synthesized`/`source==='bailian-synthesized'`，放宽「必须带 URL」硬规则，从 `content` 抽取事实句，置信恒为 LOW，输出 `hasSynthesized`。
3. `freshness/contextBuilder.js`
   - 尊重 schema 铁律「UNVERIFIED 禁止 fact_summary」：合成内容**不进 fact_summary**，改为在 `eventContext` 上挂 `synthesized_text` 字段单独承载，并标记 `synthesized=true`。
4. `freshness/responder.js`
   - 护栏新增「联网综合内容」说明（须标注不确定性、不得把细节当确定事实）。
   - `buildFreshnessUserContent`：合成文本以「模型联网综合（未经独立核实，仅供参考）」块呈现。
   - `guardOutput`：合成底座**不触发 biography-* 硬拒**（避免正确综合内容被误伤），但要求回答含「联网综合免责」声明（`missing-synth-disclaimer`），否则拦截回退降级。
5. `index.js`
   - 搜索模型优选 `model_config` 中名称含 `deepseek` 的模型；找不到回退 `models[0]`。对话模型仍由 `order` 最小决定（qwen-plus），互不影响。
6. `cloudbaserc.json`
   - 新增 `QWEN_SEARCH_BASE_URL` / `QWEN_SEARCH_API_KEY` / `QWEN_SEARCH_MODEL=deepseek-v4-flash-0731` / `QWEN_SEARCH_SYNTH_MODE=true`，强制搜索走百炼通用端点 + deepseek，立即生效（无需改 model_config）。

## 验证
- 新增 `test_q34.js`：26 断言全绿（qwenSearch 合成回退 / factExtractor / contextBuilder synthesized_text / responder 护栏+免责声明门槛）。
- 修正 `test_q31.js` 单元·6 以反映 Q2-16 新行为（结构化空+有文字→synth_content；文字也空→no_results）。
- 回归：**q29=225 / q30=104 / q31=135 / q32=29 / q33=36 / q34=26 = 555 断言，0 失败**。
- 四冻结资产 SHA 4/4 不变（corpus `db01fbc9` / intent `765ad138` / knowledgeRouter `848908445` / rag `4fb2dca4`）。
- `tcb fn deploy chat --force` 成功；`tcb fn detail` 确认 16 项环境变量全部生效（含 deepseek 配置）。

## 用户验收
用自己微信号（已在 canary 白名单）问实时/人物类问题，如「付航是谁」「今天有什么科技新闻」。
- 预期：返回带来源标注「未经独立核实」的联网综合内容（deepseek 已实测答对大专学历）。
- 仍看不到联网：① 非 admin 账号；② 百炼 key 失效/额度耗尽（`synth_content` 转 `no_results` 再降级）；③ 网络超时（`SEARCH_TIMEOUT_MS=3000`，可调大）。

## 已知边界（诚实说明）
- 百炼合成模式**无独立来源 URL**、事实置信降级为 UNVERIFIED，存在模型综合误差风险（反幻觉+免责声明已兜底，但非零风险）。
- 若要「带来源链接、零幻觉」的严谨联网，仍建议切换真·搜索 API（腾讯云 WSA，Q2-12 适配器已就绪 / Bocha）——届时改 `SEARCH_PROVIDER` 与对应 env 即可，本合成模式可一键回退（`QWEN_SEARCH_SYNTH_MODE=false` 或直接 `SEARCH_PROVIDER=mock`）。
